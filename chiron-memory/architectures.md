# architecture

How the system is put together — layers, boundaries, and how data flows.

## Inputs expose state through the global TipSplitter object

What: app.js publishes `window.TipSplitter` with `getValues()` → `{ bill, people, tipChoice, tipPercent, tipTenths, roundUp, valid, errors: { bill, people, tip } }` (bill/people/tipTenths are `null` when invalid; `tipTenths` is the tip in integer tenths of a percent, 12,5% → 125 — use it for maths, not `tipPercent`; an empty "Otro" field makes `valid` false with no error message) and `onChange(fn)` (returns an unsubscribe); every input/change also dispatches a `tipsplitter:change` CustomEvent on `document` with the same values in `event.detail` · Why: the results display is a separate work order and needs a stable read-anytime + notify-on-change contract that works without modules or a bundler · Where: app.js (header comment documents the contract)

## Rounds block: every round is raw values, recomputed with the live rules

What: the inputs module exposes a pure `evaluate(raw, named)` (the same function `readAll` uses for the form) and the results module exposes `compute(values)`; the rounds block (between results and actions in app.js) keeps each round as `getRaw()` output, swaps rounds in and out of the one form with `setNamed()` + `setRaw()`, and computes non-active rounds with evaluate + compute · Why: a round must use the same options and give the same cents as a single bill, without a second copy of the rules · Where: app.js `TipSplitter.outing` (count, summary, personTotals, grandTotal, getData, restore, reset, loadRaw, onChange) · Learned: the actions block subscribes to `TipSplitter.outing.onChange`, not `TipSplitter.onChange`, so it always runs after the active round is stored; `personTotals()` → `[{name, cents}]` plus the `tipsplitter:outing` event are the seam for settle-up (one round → that bill's split, "Persona N" in equal mode)
