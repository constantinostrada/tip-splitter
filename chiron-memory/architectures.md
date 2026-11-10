# architecture

How the system is put together — layers, boundaries, and how data flows.

## Inputs expose state through the global TipSplitter object

What: app.js publishes `window.TipSplitter` with `getValues()` → `{ bill, people, tipPercent, valid, errors }` (bill/people are `null` when invalid) and `onChange(fn)` (returns an unsubscribe); every input/change also dispatches a `tipsplitter:change` CustomEvent on `document` with the same values in `event.detail` · Why: the results display is a separate work order and needs a stable read-anytime + notify-on-change contract that works without modules or a bundler · Where: app.js (header comment documents the contract)
