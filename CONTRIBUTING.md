# Contributing

Issues and pull requests are welcome. Please keep the card provider-neutral and use synthetic entity IDs, screenshots, fixtures, and timestamps.

Before opening a pull request:

1. Add or update a focused synthetic test for behavioral changes.
2. Run `npm run validate` with Node.js 20 or newer.
3. Confirm measured series remain continuous, setpoints remain stepped, and attribution labels do not claim an actor without a configured record.
4. Do not include Home Assistant exports, credentials, addresses, account identifiers, real entity IDs, or household data.

Changes to units must preserve data semantics. A display label does not convert the underlying entity values.
