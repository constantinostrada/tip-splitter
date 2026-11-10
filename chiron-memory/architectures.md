# architecture

How the system is put together — layers, boundaries, and how data flows.

## Inputs expose state through the global TipSplitter object

What: app.js publishes `window.TipSplitter` with `getValues()` → `{ bill, people, tipChoice, tipPercent, tipTenths, roundUp, valid, errors: { bill, people, tip } }` (bill/people/tipTenths are `null` when invalid; `tipTenths` is the tip in integer tenths of a percent, 12,5% → 125 — use it for maths, not `tipPercent`; an empty "Otro" field makes `valid` false with no error message) and `onChange(fn)` (returns an unsubscribe); every input/change also dispatches a `tipsplitter:change` CustomEvent on `document` with the same values in `event.detail` · Why: the results display is a separate work order and needs a stable read-anytime + notify-on-change contract that works without modules or a bundler · Where: app.js (header comment documents the contract)
