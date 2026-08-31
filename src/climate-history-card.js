/* Climate History Card v0.1.1 | Apache-2.0 */

const DAY_MS = 86_400_000;
const DEFAULT_COLORS = ["#3B82F6", "#F97316", "#8B5CF6", "#14B8A6", "#EC4899", "#EAB308"];
const SECONDARY_COLOR = "#22A06B";

function parseTimestamp(state) {
  if (typeof (state?.lu ?? state?.lc) === "number") return (state.lu ?? state.lc) * 1000;
  return new Date(state?.last_changed || state?.last_updated).getTime();
}

function localDayRange(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid local date");
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { start, end };
}

function continuousPath(points, x, y) {
  return points.map((point, index) => `${index ? "L" : "M"} ${x(point.t)} ${y(point.v)}`).join(" ");
}

function steppedPath(points, x, y) {
  if (!points.length) return "";
  let path = `M ${x(points[0].t)} ${y(points[0].v)}`;
  for (let index = 1; index < points.length; index += 1) {
    path += ` H ${x(points[index].t)} V ${y(points[index].v)}`;
  }
  return path;
}

function boundedAreaPath(points, x, y, bottom) {
  if (!points.length) return "";
  return `${continuousPath(points, x, y)} L ${x(points.at(-1).t)} ${bottom} L ${x(points[0].t)} ${bottom} Z`;
}

function activeIntervals(points, low, high, activeStates, now = Date.now()) {
  const allowed = new Set(activeStates.map((value) => String(value).toLowerCase()));
  const dataHigh = Math.min(high, now);
  const intervals = [];
  for (let index = 0; index < points.length; index += 1) {
    if (!allowed.has(String(points[index].v).toLowerCase())) continue;
    const start = Math.max(low, points[index].t);
    const end = Math.min(dataHigh, points[index + 1]?.t ?? dataHigh);
    if (end > start) intervals.push([start, end]);
  }
  return intervals;
}

function responsiveLayout(width) {
  const compact = width < 520;
  const height = compact ? 340 : 420;
  const left = compact ? 46 : 56;
  const right = compact ? 48 : 60;
  const top = 20;
  const bottom = 44;
  return {
    compact,
    width,
    height,
    left,
    right,
    top,
    bottom,
    plotWidth: Math.max(1, width - left - right),
    plotHeight: height - top - bottom,
  };
}

function setpointChanges(rows, low, high) {
  const points = rows.map((state) => ({ t: parseTimestamp(state), v: Number(state.state) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
    .sort((a, b) => a.t - b.t);
  const changes = [];
  let previous = null;
  for (const point of points) {
    if (point.t > high) break;
    if (previous !== null && Math.abs(point.v - previous) > 0.01 && point.t >= low) changes.push(point);
    previous = point.v;
  }
  return changes;
}

function parseRecordedCommands(rows, zoneName, low, high) {
  return rows.map((state) => {
    const t = parseTimestamp(state);
    const raw = String(state.state ?? "").trim();
    if (!raw || !Number.isFinite(t) || t < low || t > high || ["unknown", "unavailable", "none", "null"].includes(raw.toLowerCase())) return null;
    let detail;
    try { detail = JSON.parse(raw); } catch { detail = { detail: raw }; }
    const targetValue = detail.target_temperature ?? detail.temperature ?? detail.target ?? detail.setpoint;
    const numericTarget = Number(targetValue);
    return {
      t,
      zone: zoneName,
      target: Number.isFinite(numericTarget) ? numericTarget : null,
      source: String(detail.source || detail.reason || detail.detail || "recorded command"),
      attribution: "recorded",
    };
  }).filter(Boolean);
}

function attributeSetpointChanges(changes, commands, windowMs = 125_000) {
  const used = new Set();
  return changes.map((change) => {
    let match = -1;
    let closest = Infinity;
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      if (used.has(index) || !Number.isFinite(command.target) || Math.abs(command.target - change.v) > 0.01) continue;
      const delta = change.t - command.t;
      if (delta < -5_000 || delta > windowMs || Math.abs(delta) >= closest) continue;
      match = index;
      closest = Math.abs(delta);
    }
    if (match >= 0) {
      used.add(match);
      return { ...change, command: commands[match], attribution: "recorded" };
    }
    return { ...change, command: null, attribution: "unattributed" };
  });
}

function normalizeConfig(config) {
  if (!Array.isArray(config?.zones) || !config.zones.length) throw new Error("zones must contain at least one zone");
  const zones = config.zones.map((zone, index) => {
    if (!zone?.temperature || !zone?.setpoint) throw new Error(`zones[${index}] requires temperature and setpoint entities`);
    const baseColor = zone.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    return {
      name: zone.name || `Zone ${index + 1}`,
      temperature: zone.temperature,
      setpoint: zone.setpoint,
      active: zone.active || null,
      command_log: zone.command_log || null,
      color: baseColor,
      setpoint_color: zone.setpoint_color || baseColor,
      active_color: zone.active_color || baseColor,
      active_states: Array.isArray(zone.active_states) && zone.active_states.length
        ? zone.active_states
        : ["on", "cooling", "heating", "active"],
    };
  });
  const outside = config.outside?.entity ? {
    entity: config.outside.entity,
    attribute: config.outside.attribute || null,
    label: config.outside.label || "Outside",
    color: config.outside.color || "#A855F7",
    resample_minutes: Math.max(0, Number(config.outside.resample_minutes) || 0),
  } : null;
  const secondary = config.secondary?.entity ? {
    entity: config.secondary.entity,
    label: config.secondary.label || "Secondary",
    unit: config.secondary.unit || "%",
    min: Number.isFinite(Number(config.secondary.min)) ? Number(config.secondary.min) : 0,
    max: Number.isFinite(Number(config.secondary.max)) ? Number(config.secondary.max) : 100,
    color: config.secondary.color || SECONDARY_COLOR,
  } : null;
  if (secondary && secondary.max <= secondary.min) throw new Error("secondary.max must be greater than secondary.min");
  return {
    type: "custom:climate-history-card",
    title: config.title || "Climate history",
    subtitle: config.subtitle || "Measured values are continuous; setpoints are stepped",
    temperature_unit: config.temperature_unit || "°F",
    temperature_min: Number.isFinite(Number(config.temperature_min)) ? Number(config.temperature_min) : null,
    temperature_max: Number.isFinite(Number(config.temperature_max)) ? Number(config.temperature_max) : null,
    selected_date: config.selected_date !== false,
    collection_key: config.collection_key || null,
    today: Boolean(config.today),
    hours_to_show: Math.max(1, Number(config.hours_to_show) || 24),
    refresh_seconds: Math.max(30, Number(config.refresh_seconds) || 60),
    command_match_seconds: Math.max(5, Number(config.command_match_seconds) || 125),
    show_unattributed_changes: config.show_unattributed_changes !== false,
    zones,
    outside,
    secondary,
  };
}

class ClimateHistoryCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("climate-history-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Climate history",
      zones: [{
        name: "Zone 1",
        temperature: "sensor.zone_1_temperature",
        setpoint: "sensor.zone_1_setpoint",
        active: "binary_sensor.zone_1_active",
      }],
    };
  }

  setConfig(config) {
    this.config = normalizeConfig(config);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._data = null;
    this._error = null;
    this._periodKey = null;
    this._lastLoad = 0;
    this._renderShell();
  }

  set hass(hass) {
    this._hass = hass;
    this._maybeLoad();
  }

  connectedCallback() {
    this._poll = setInterval(() => this._maybeLoad(), 1_500);
    const Observer = globalThis.ResizeObserver;
    if (Observer) {
      this._resizeObserver = new Observer(() => {
        clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => this._renderChart(), 80);
      });
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    clearInterval(this._poll);
    clearTimeout(this._resizeTimer);
    this._resizeObserver?.disconnect();
  }

  getCardSize() { return 7; }

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-width:0; max-width:100%; }
        ha-card { min-width:0; max-width:100%; overflow:hidden; }
        .head { display:flex; gap:12px; align-items:flex-start; padding:18px 20px 4px; }
        .titles { min-width:0; flex:1; }
        .title { color:var(--primary-text-color); font-size:22px; line-height:1.25; }
        .subtitle { margin-top:4px; color:var(--secondary-text-color); font-size:13px; }
        button { border:0; background:transparent; color:var(--secondary-text-color); cursor:pointer; font-size:21px; padding:2px 6px; }
        .legend { display:flex; flex-wrap:wrap; gap:7px 15px; padding:7px 20px 2px; color:var(--secondary-text-color); font-size:12px; }
        .key { display:inline-flex; align-items:center; white-space:nowrap; }
        .swatch { width:18px; height:3px; margin-right:6px; border-radius:2px; background:var(--c); }
        .swatch.step { height:5px; }
        .fill { width:15px; height:11px; margin-right:6px; border-radius:2px; background:var(--c); opacity:.24; }
        .wrap { position:relative; min-width:0; padding:2px 8px 12px; overflow:hidden; }
        svg { display:block; width:100%; max-width:100%; height:auto; overflow:hidden; }
        .tip { display:none; position:absolute; z-index:3; pointer-events:none; padding:8px 10px; border-radius:7px; background:var(--card-background-color,#222); color:var(--primary-text-color); box-shadow:0 2px 9px rgba(0,0,0,.35); font-size:12px; line-height:1.45; white-space:pre-line; }
        .status { min-height:340px; display:grid; place-items:center; color:var(--secondary-text-color); padding:20px; text-align:center; }
        @media (max-width:520px) {
          .head { padding:14px 12px 3px; gap:8px; }
          .title { font-size:18px; }
          .subtitle { font-size:12px; }
          .legend { gap:6px 10px; padding:6px 12px 2px; font-size:11px; }
          .swatch { width:14px; }
          .wrap { padding:2px 4px 10px; }
          .status { min-height:300px; }
        }
      </style>
      <ha-card>
        <div class="head"><div class="titles"><div class="title"></div><div class="subtitle"></div></div><button title="Refresh history" aria-label="Refresh history">↻</button></div>
        <div class="legend"></div>
        <div class="wrap"><div class="status">Loading history…</div><div class="tip"></div></div>
      </ha-card>`;
    this.shadowRoot.querySelector(".title").textContent = this.config.title;
    this.shadowRoot.querySelector(".subtitle").textContent = this.config.subtitle;
    const legend = [];
    for (const zone of this.config.zones) {
      legend.push(`<span class="key"><i class="swatch" style="--c:${this._esc(zone.color)}"></i>${this._esc(zone.name)} measured</span>`);
      legend.push(`<span class="key"><i class="swatch step" style="--c:${this._esc(zone.setpoint_color)}"></i>${this._esc(zone.name)} setpoint</span>`);
      if (zone.active) legend.push(`<span class="key"><i class="fill" style="--c:${this._esc(zone.active_color)}"></i>${this._esc(zone.name)} active</span>`);
    }
    if (this.config.outside) legend.push(`<span class="key"><i class="swatch" style="--c:${this._esc(this.config.outside.color)}"></i>${this._esc(this.config.outside.label)}</span>`);
    if (this.config.secondary) legend.push(`<span class="key"><i class="swatch" style="--c:${this._esc(this.config.secondary.color)}"></i>${this._esc(this.config.secondary.label)}</span>`);
    if (this.config.zones.some((zone) => zone.command_log)) legend.push('<span class="key">◆ recorded command</span>');
    if (this.config.show_unattributed_changes) legend.push('<span class="key">▲ unattributed setpoint change</span>');
    this.shadowRoot.querySelector(".legend").innerHTML = legend.join("");
    this.shadowRoot.querySelector("button").addEventListener("click", () => this._load(true));
  }

  _collection() {
    if (!this.config.selected_date || !this._hass?.connection) return null;
    const key = this.config.collection_key
      ? `_${this.config.collection_key}`
      : (this._hass.panelUrl ? `_energy_${this._hass.panelUrl}` : "_energy");
    return this._hass.connection[key] || null;
  }

  _range() {
    const now = new Date();
    if (this.config.selected_date) {
      const selected = this._collection()?.start;
      if (selected && Number.isFinite(new Date(selected).getTime())) return localDayRange(new Date(selected));
      return localDayRange(now);
    }
    if (this.config.today) return localDayRange(now);
    return { start: new Date(now.getTime() - this.config.hours_to_show * 3_600_000), end: now };
  }

  _entityIds() {
    const ids = new Set();
    for (const zone of this.config.zones) {
      [zone.temperature, zone.setpoint, zone.active, zone.command_log].filter(Boolean).forEach((id) => ids.add(id));
    }
    if (this.config.outside?.entity) ids.add(this.config.outside.entity);
    if (this.config.secondary?.entity) ids.add(this.config.secondary.entity);
    return [...ids];
  }

  _maybeLoad(force = false) {
    if (!this._hass || this._loading) return;
    const { start, end } = this._range();
    const key = `${start.toISOString()}|${end.toISOString()}`;
    if (!force && key === this._periodKey && Date.now() - this._lastLoad < this.config.refresh_seconds * 1000) return;
    this._load(force, { start, end, key });
  }

  async _load(force = false, range = null) {
    if (!this._hass || this._loading) return;
    const selected = range || (() => { const value = this._range(); return { ...value, key: `${value.start.toISOString()}|${value.end.toISOString()}` }; })();
    if (!force && selected.key === this._periodKey && Date.now() - this._lastLoad < this.config.refresh_seconds * 1000) return;
    this._loading = true;
    this._error = null;
    try {
      const ids = this._entityIds();
      const attributeOutside = this.config.outside?.attribute ? this.config.outside.entity : null;
      const ordinaryIds = ids.filter((id) => id !== attributeOutside);
      const path = `history/period/${encodeURIComponent(selected.start.toISOString())}?filter_entity_id=${encodeURIComponent(ordinaryIds.join(","))}&end_time=${encodeURIComponent(selected.end.toISOString())}&minimal_response&no_attributes`;
      const [groups, attributeHistory] = await Promise.all([
        ordinaryIds.length ? this._hass.callApi("GET", path) : Promise.resolve([]),
        attributeOutside ? this._hass.callWS({
          type: "history/history_during_period",
          start_time: selected.start.toISOString(),
          end_time: selected.end.toISOString(),
          entity_ids: [attributeOutside],
          include_start_time_state: true,
          significant_changes_only: false,
          minimal_response: false,
          no_attributes: false,
        }) : Promise.resolve({}),
      ]);
      const byId = {};
      for (const group of groups || []) if (group?.[0]?.entity_id) byId[group[0].entity_id] = group;
      if (attributeOutside && attributeHistory?.[attributeOutside]?.length) byId[attributeOutside] = attributeHistory[attributeOutside];
      for (const id of ids) if (!byId[id]?.length && this._hass.states[id]) byId[id] = [this._hass.states[id]];
      this._data = { start: selected.start, end: selected.end, byId };
      this._periodKey = selected.key;
      this._lastLoad = Date.now();
    } catch (error) {
      this._error = error?.message || String(error);
    } finally {
      this._loading = false;
      this._renderChart();
    }
  }

  _series(entityId, valueOf = (state) => Number(state.state), numeric = true) {
    if (!entityId) return [];
    const { start, end, byId } = this._data;
    const all = (byId[entityId] || []).map((state) => ({ t: parseTimestamp(state), v: valueOf(state) }))
      .filter((point) => Number.isFinite(point.t) && (!numeric || Number.isFinite(point.v)))
      .sort((a, b) => a.t - b.t);
    if (!all.length) return [];
    const low = start.getTime();
    const high = end.getTime();
    const dataHigh = Math.min(high, Date.now());
    const bounded = all.filter((point) => point.t >= low && point.t <= high);
    const seed = [...all].reverse().find((point) => point.t <= low) || bounded[0] || all[0];
    if (!bounded.length || bounded[0].t > low) bounded.unshift({ t: low, v: seed.v });
    else bounded[0] = { ...bounded[0], t: Math.max(low, bounded[0].t) };
    const last = bounded.at(-1);
    if (last.t < dataHigh) bounded.push({ t: dataHigh, v: last.v });
    return bounded;
  }

  _resample(points, intervalMinutes) {
    const interval = intervalMinutes * 60_000;
    if (points.length < 2 || !Number.isFinite(interval) || interval <= 0) return points;
    const output = [];
    const first = points[0].t;
    const last = points.at(-1).t;
    if (Math.ceil(first / interval) * interval > first) output.push({ ...points[0] });
    let cursor = 0;
    for (let t = Math.ceil(first / interval) * interval; t <= last; t += interval) {
      while (cursor < points.length - 2 && points[cursor + 1].t < t) cursor += 1;
      const before = points[cursor];
      const after = points[Math.min(cursor + 1, points.length - 1)];
      const ratio = after.t === before.t ? 0 : Math.max(0, Math.min(1, (t - before.t) / (after.t - before.t)));
      output.push({ t, v: before.v + (after.v - before.v) * ratio });
    }
    if (!output.length || output.at(-1).t < last) output.push({ ...points.at(-1) });
    return output;
  }

  _renderChart() {
    const wrap = this.shadowRoot?.querySelector(".wrap");
    if (!wrap) return;
    if (this._error) {
      wrap.innerHTML = `<div class="status">Could not load chart history.<br>${this._esc(this._error)}</div><div class="tip"></div>`;
      return;
    }
    if (!this._data) return;
    wrap.querySelector(".status")?.remove();
    wrap.querySelector("svg")?.remove();

    const zoneData = this.config.zones.map((zone) => ({
      config: zone,
      temperature: this._series(zone.temperature),
      setpoint: this._series(zone.setpoint),
      active: this._series(zone.active, (state) => state.state, false),
    }));
    const outside = this.config.outside
      ? this._resample(this._series(
        this.config.outside.entity,
        this.config.outside.attribute
          ? (state) => Number(state.attributes?.[this.config.outside.attribute] ?? state.a?.[this.config.outside.attribute])
          : (state) => Number(state.state),
      ), this.config.outside.resample_minutes)
      : [];
    const secondary = this.config.secondary ? this._series(this.config.secondary.entity) : [];
    const low = this._data.start.getTime();
    const high = this._data.end.getTime();

    const width = Math.round(wrap.getBoundingClientRect().width || this.getBoundingClientRect().width || 0);
    if (width < 180) return;
    const layout = responsiveLayout(width);
    const { compact, height, left, right, top, bottom, plotWidth, plotHeight } = layout;
    const x = (time) => left + ((time - low) / (high - low)) * plotWidth;
    const values = [...zoneData.flatMap((zone) => [...zone.temperature, ...zone.setpoint]), ...outside].map((point) => point.v);
    if (!values.length && !secondary.length) {
      wrap.innerHTML = '<div class="status">No numeric history was returned for this interval.</div><div class="tip"></div>';
      return;
    }
    const rawMin = this.config.temperature_min ?? Math.min(...values);
    const rawMax = this.config.temperature_max ?? Math.max(...values);
    const paddedMin = this.config.temperature_min ?? rawMin - Math.max(1, (rawMax - rawMin) * 0.08);
    const paddedMax = this.config.temperature_max ?? rawMax + Math.max(1, (rawMax - rawMin) * 0.08);
    const span = Math.max(1, paddedMax - paddedMin);
    const tick = span > 36 ? 10 : span > 18 ? 5 : compact ? 4 : 2;
    const temperatureMin = Math.floor(paddedMin / tick) * tick;
    const temperatureMax = Math.ceil(paddedMax / tick) * tick;
    const yTemperature = (value) => top + ((temperatureMax - value) / Math.max(1, temperatureMax - temperatureMin)) * plotHeight;
    const secondaryConfig = this.config.secondary;
    const ySecondary = (value) => top + ((secondaryConfig.max - value) / (secondaryConfig.max - secondaryConfig.min)) * plotHeight;
    const fontSize = compact ? 10 : 12;
    const grid = [];
    for (let value = temperatureMin; value <= temperatureMax + 0.001; value += tick) {
      const y = yTemperature(value);
      grid.push(`<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="var(--divider-color)" opacity=".7"/>`);
      grid.push(`<text x="${left - 6}" y="${y + 4}" text-anchor="end" fill="var(--secondary-text-color)" font-size="${fontSize}">${value}${this._esc(this.config.temperature_unit)}</text>`);
    }
    if (secondaryConfig) {
      for (let index = 0; index <= 4; index += 1) {
        const value = secondaryConfig.min + (secondaryConfig.max - secondaryConfig.min) * index / 4;
        grid.push(`<text x="${left + plotWidth + 6}" y="${ySecondary(value) + 4}" fill="var(--secondary-text-color)" font-size="${fontSize}">${Number(value.toFixed(1))}${this._esc(secondaryConfig.unit)}</text>`);
      }
    }
    const spanMs = high - low;
    const multiDay = spanMs > DAY_MS && new Date(low).toDateString() !== new Date(high).toDateString();
    const tickCount = compact ? 3 : 6;
    const timeFormatter = new Intl.DateTimeFormat(undefined, multiDay
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { hour: "numeric", minute: "2-digit" });
    for (let index = 0; index <= tickCount; index += 1) {
      const time = low + spanMs * index / tickCount;
      const xx = x(time);
      grid.push(`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${top + plotHeight}" stroke="var(--divider-color)" opacity=".35"/>`);
      grid.push(`<text x="${xx}" y="${height - 17}" text-anchor="middle" fill="var(--secondary-text-color)" font-size="${fontSize}">${this._esc(timeFormatter.format(new Date(time)))}</text>`);
    }

    const uid = this._uid();
    const clipDefs = [];
    const shadedPaths = [];
    for (let index = 0; index < zoneData.length; index += 1) {
      const zone = zoneData[index];
      if (!zone.config.active || !zone.temperature.length) continue;
      const clipId = `active-${uid}-${index}`;
      const intervals = activeIntervals(zone.active, low, high, zone.config.active_states);
      clipDefs.push(`<clipPath id="${clipId}">${intervals.map(([start, end]) => `<rect x="${x(start)}" y="${top}" width="${Math.max(1, x(end) - x(start))}" height="${plotHeight}"/>`).join("")}</clipPath>`);
      shadedPaths.push(`<path d="${boundedAreaPath(zone.temperature, x, yTemperature, top + plotHeight)}" fill="${this._esc(zone.config.active_color)}" opacity=".22" clip-path="url(#${clipId})"/>`);
    }
    clipDefs.push(`<clipPath id="plot-${uid}"><rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"/></clipPath>`);

    const commandMarkers = [];
    for (const zone of this.config.zones) {
      const commands = zone.command_log
        ? parseRecordedCommands(this._data.byId[zone.command_log] || [], zone.name, low, high)
        : [];
      for (const command of commands) {
        commandMarkers.push({
          ...command,
          color: zone.setpoint_color,
          label: `${zone.name}: recorded command · ${command.source}${Number.isFinite(command.target) ? ` · ${command.target}${this.config.temperature_unit}` : ""}`,
        });
      }
      const changes = setpointChanges(this._data.byId[zone.setpoint] || [], low, high);
      const attributed = attributeSetpointChanges(changes, commands, this.config.command_match_seconds * 1000);
      if (this.config.show_unattributed_changes) {
        for (const change of attributed.filter((item) => item.attribution === "unattributed")) {
          commandMarkers.push({
            t: change.t,
            color: zone.setpoint_color,
            attribution: "unattributed",
            label: `${zone.name}: unattributed setpoint change · ${change.v}${this.config.temperature_unit}`,
          });
        }
      }
    }
    commandMarkers.sort((a, b) => a.t - b.t);
    const markerSvg = commandMarkers.map((marker) => {
      const xx = x(marker.t);
      const recorded = marker.attribution === "recorded";
      const symbol = recorded
        ? `<path d="M ${xx} ${top - 1} l 5 7 l -5 7 l -5 -7 z" fill="${this._esc(marker.color)}"/>`
        : `<path d="M ${xx} ${top - 1} l 6 12 h -12 z" fill="${this._esc(marker.color)}"/>`;
      const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(marker.t));
      return `<g><title>${this._esc(`${when} · ${marker.label}`)}</title><line x1="${xx}" y1="${top}" x2="${xx}" y2="${top + plotHeight}" stroke="${this._esc(marker.color)}" stroke-width="1.5" stroke-dasharray="${recorded ? "4 4" : "2 4"}" opacity=".8"/>${symbol}</g>`;
    }).join("");

    const measuredPaths = zoneData.map((zone) => `<path d="${continuousPath(zone.temperature, x, yTemperature)}" fill="none" stroke="${this._esc(zone.config.color)}" stroke-width="2.2"/>`).join("");
    const setpointPaths = zoneData.map((zone) => `<path d="${steppedPath(zone.setpoint, x, yTemperature)}" fill="none" stroke="${this._esc(zone.config.setpoint_color)}" stroke-width="4"/>`).join("");
    const outsidePath = this.config.outside ? `<path d="${continuousPath(outside, x, yTemperature)}" fill="none" stroke="${this._esc(this.config.outside.color)}" stroke-width="2"/>` : "";
    const secondaryPath = secondaryConfig ? `<path d="${continuousPath(secondary, x, ySecondary)}" fill="none" stroke="${this._esc(secondaryConfig.color)}" stroke-width="2.4"/>` : "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${this.config.title} chart`);
    svg.innerHTML = `<defs>${clipDefs.join("")}</defs><g>${grid.join("")}</g><g clip-path="url(#plot-${uid})">${shadedPaths.join("")}${markerSvg}${measuredPaths}${setpointPaths}${outsidePath}${secondaryPath}<line class="cross" x1="0" y1="${top}" x2="0" y2="${top + plotHeight}" stroke="var(--primary-text-color)" opacity=".55" style="display:none"/></g><text x="${left}" y="13" fill="var(--secondary-text-color)" font-size="12" font-weight="600">${this._esc(this.config.temperature_unit)}</text>${secondaryConfig ? `<text x="${left + plotWidth}" y="13" text-anchor="end" fill="${this._esc(secondaryConfig.color)}" font-size="12" font-weight="600">${this._esc(secondaryConfig.label)}</text>` : ""}<rect class="hit" x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="transparent"/>`;
    wrap.insertBefore(svg, wrap.querySelector(".tip"));

    const rows = [];
    for (const zone of zoneData) {
      rows.push([`${zone.config.name} measured`, zone.temperature, this.config.temperature_unit]);
      rows.push([`${zone.config.name} setpoint`, zone.setpoint, this.config.temperature_unit]);
    }
    if (this.config.outside) rows.push([this.config.outside.label, outside, this.config.temperature_unit]);
    if (secondaryConfig) rows.push([secondaryConfig.label, secondary, secondaryConfig.unit]);
    const tip = wrap.querySelector(".tip");
    const cross = svg.querySelector(".cross");
    const hit = svg.querySelector(".hit");
    hit.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = width / Math.max(1, rect.width);
      const px = (event.clientX - rect.left) * scaleX;
      const time = low + Math.max(0, Math.min(1, (px - left) / plotWidth)) * spanMs;
      cross.style.display = "";
      cross.setAttribute("x1", px);
      cross.setAttribute("x2", px);
      const valuesAtTime = rows.map(([label, points, unit]) => {
        const value = this._valueAt(points, time);
        return `${label}: ${value === null ? "—" : `${Number(value).toFixed(unit === "%" ? 0 : 1)}${unit}`}`;
      });
      tip.textContent = `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time))}\n${valuesAtTime.join("\n")}`;
      tip.style.display = "block";
      const localX = event.clientX - wrap.getBoundingClientRect().left;
      tip.style.left = `${Math.min(Math.max(8, localX + 12), Math.max(8, wrap.clientWidth - 210))}px`;
      tip.style.top = `${Math.max(8, event.clientY - wrap.getBoundingClientRect().top - 80)}px`;
    });
    hit.addEventListener("pointerleave", () => { cross.style.display = "none"; tip.style.display = "none"; });
  }

  _valueAt(points, time) {
    if (!points.length) return null;
    let value = points[0].v;
    for (const point of points) { if (point.t > time) break; value = point.v; }
    return value;
  }

  _uid() {
    if (!this.__uid) this.__uid = Math.random().toString(36).slice(2, 9);
    return this.__uid;
  }

  _esc(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
}

class ClimateHistoryCardEditor extends HTMLElement {
  set hass(hass) { this._hass = hass; }

  setConfig(config) {
    this._config = { ...config };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        label { display:block; margin:12px 0 4px; font-weight:600; }
        input, textarea { box-sizing:border-box; width:100%; padding:8px; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:4px; font:inherit; }
        textarea { min-height:210px; font-family:monospace; font-size:12px; }
        .hint { margin-top:5px; color:var(--secondary-text-color); font-size:12px; }
        .error { min-height:18px; margin-top:5px; color:var(--error-color,#db4437); font-size:12px; }
      </style>
      <label>Title</label><input class="title">
      <label>Temperature unit</label><input class="unit">
      <label>Zones (JSON)</label><textarea class="zones"></textarea>
      <div class="hint">Each zone requires name, temperature and setpoint. Optional: active, command_log and colors.</div>
      <div class="error"></div>`;
    this.shadowRoot.querySelector(".title").value = this._config.title || "Climate history";
    this.shadowRoot.querySelector(".unit").value = this._config.temperature_unit || "°F";
    this.shadowRoot.querySelector(".zones").value = JSON.stringify(this._config.zones || [], null, 2);
    this.shadowRoot.querySelector(".title").addEventListener("change", (event) => this._emit({ title: event.target.value }));
    this.shadowRoot.querySelector(".unit").addEventListener("change", (event) => this._emit({ temperature_unit: event.target.value }));
    this.shadowRoot.querySelector(".zones").addEventListener("change", (event) => {
      try {
        const zones = JSON.parse(event.target.value);
        normalizeConfig({ ...this._config, zones });
        this.shadowRoot.querySelector(".error").textContent = "";
        this._emit({ zones });
      } catch (error) {
        this.shadowRoot.querySelector(".error").textContent = error.message;
      }
    });
  }

  _emit(change) {
    this._config = { ...this._config, ...change };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("climate-history-card")) customElements.define("climate-history-card", ClimateHistoryCard);
if (!customElements.get("climate-history-card-editor")) customElements.define("climate-history-card-editor", ClimateHistoryCardEditor);

globalThis.customCards = globalThis.customCards || [];
if (!globalThis.customCards.some((card) => card.type === "climate-history-card")) {
  globalThis.customCards.push({
    type: "climate-history-card",
    name: "Climate History Card",
    description: "Climate history with continuous measurements, stepped setpoints, active shading, and explicit attribution boundaries.",
    preview: true,
  });
}

globalThis.__CLIMATE_HISTORY_CARD_TEST__ = Object.freeze({
  DAY_MS,
  activeIntervals,
  attributeSetpointChanges,
  boundedAreaPath,
  continuousPath,
  localDayRange,
  normalizeConfig,
  parseRecordedCommands,
  responsiveLayout,
  setpointChanges,
  steppedPath,
});
