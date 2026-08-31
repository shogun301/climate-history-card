import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/climate-history-card.js", import.meta.url), "utf8");
const registry = new Map();
const context = {
  console,
  Date,
  Intl,
  Math,
  Number,
  Object,
  Set,
  String,
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
  HTMLElement: class {},
  customElements: {
    define: (name, value) => registry.set(name, value),
    get: (name) => registry.get(name),
  },
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "climate-history-card.js" });
const helpers = context.__CLIMATE_HISTORY_CARD_TEST__;

test("registers the card and editor", () => {
  assert.ok(registry.has("climate-history-card"));
  assert.ok(registry.has("climate-history-card-editor"));
  assert.equal(context.customCards[0].type, "climate-history-card");
});

test("requires generic zones and has no entity defaults", () => {
  assert.throws(() => helpers.normalizeConfig({}), /zones/);
  const config = helpers.normalizeConfig({ zones: [{ temperature: "sensor.alpha", setpoint: "sensor.beta" }] });
  assert.equal(config.zones[0].name, "Zone 1");
  assert.equal(config.zones[0].temperature, "sensor.alpha");
  assert.equal(config.outside, null);
  assert.equal(config.secondary, null);
});

test("draws measurements continuously and setpoints as held steps", () => {
  const points = [{ t: 0, v: 68 }, { t: 10, v: 70 }, { t: 20, v: 69 }];
  assert.equal(helpers.continuousPath(points, (v) => v, (v) => v), "M 0 68 L 10 70 L 20 69");
  assert.equal(helpers.steppedPath(points, (v) => v, (v) => v), "M 0 68 H 10 V 70 H 20 V 69");
});

test("bounds active shading intervals and area by the measured path", () => {
  const intervals = helpers.activeIntervals([
    { t: 0, v: "off" },
    { t: 10, v: "cooling" },
    { t: 30, v: "off" },
    { t: 50, v: "heating" },
  ], 5, 70, ["cooling", "heating"], 65);
  assert.deepEqual(JSON.parse(JSON.stringify(intervals)), [[10, 30], [50, 65]]);
  const area = helpers.boundedAreaPath([{ t: 10, v: 70 }, { t: 30, v: 68 }], (v) => v, (v) => v, 100);
  assert.equal(area, "M 10 70 L 30 68 L 30 100 L 10 100 Z");
});

test("labels only a matching recorded command as attributed", () => {
  const commands = [{ t: 10_000, target: 72, source: "schedule", attribution: "recorded" }];
  const result = helpers.attributeSetpointChanges([{ t: 15_000, v: 72 }, { t: 30_000, v: 74 }], commands, 125_000);
  assert.equal(result[0].attribution, "recorded");
  assert.equal(result[0].command.source, "schedule");
  assert.equal(result[1].attribution, "unattributed");
  assert.equal(result[1].command, null);
});

test("does not claim actor identity for plain or unmatched records", () => {
  const rows = [{ state: "changed through provider", last_changed: "2026-01-01T10:00:00Z" }];
  const low = Date.parse("2026-01-01T00:00:00Z");
  const high = Date.parse("2026-01-02T00:00:00Z");
  const command = helpers.parseRecordedCommands(rows, "Zone", low, high)[0];
  assert.equal(command.attribution, "recorded");
  assert.equal(command.source, "changed through provider");
  assert.equal(command.target, null);
});

test("local-day ranges honor spring-forward and fall-back DST", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const spring = helpers.localDayRange("2026-03-08");
    const fall = helpers.localDayRange("2026-11-01");
    assert.equal(spring.end - spring.start, 23 * 60 * 60 * 1000);
    assert.equal(fall.end - fall.start, 25 * 60 * 60 * 1000);
  } finally {
    process.env.TZ = original;
  }
});

test("responsive geometry preserves both axes and terminal labels", () => {
  for (const width of [390, 412, 1440]) {
    const layout = helpers.responsiveLayout(width);
    assert.ok(layout.left >= 46);
    assert.ok(layout.right >= 48);
    assert.ok(layout.plotWidth > 0);
    assert.equal(layout.left + layout.plotWidth, width - layout.right);
    assert.ok(layout.left + layout.plotWidth + 40 <= width, `right-axis label fits at ${width}px`);
    assert.ok(layout.left + layout.plotWidth <= width, `terminal x tick fits at ${width}px`);
  }
});
