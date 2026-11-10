# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## Whole app is a classic script IIFE, no ES modules

What: app.js is a plain `<script defer>` wrapped in an IIFE that attaches one global; no `type="module"`, no imports, no fetch · Why: the page must work when opened via file://, where Chrome blocks module scripts and fetches for CORS reasons · Where: index.html, app.js · Learned: for file://-openable pages, classic scripts and relative `src` are the only safe loading path

## Validation is string-based, not Number()-first

What: validateBill / validatePeople test the raw text with regexes (`^-?\d*(\.\d{0,2})?$`, `^-?\d+$`) before converting, and a `type=number` field whose text the browser could not parse (validity.badInput) is treated as invalid rather than empty · Why: `Number('')` is 0 and `Number('2.5')` passes an integer check only after extra work; the regex gives exact, user-facing messages (empty vs non-numeric vs out of range) and never throws · Where: app.js validateBill, validatePeople

## Styles live inline in index.html

What: all CSS is in a `<style>` block in index.html; there is no stylesheet file · Why: the work order allows only index.html + app.js and no external resources · Where: index.html

## Money is integer cents; leftover cents spread one each, never rounded up

What: results convert the bill to cents, round the tip to the nearest cent, then split the total as `base = floor(total/people)` with `total % people` people paying base + 1 cent; amounts are formatted by a hand-written `formatCents` ("$1.250,00"), not Intl · Why: the parts must sum exactly to the total (an earlier "always round up" attempt was cancelled for overcharging), floats leak artifacts like 0,30000000000000004, and Intl's es-* locales disagree on grouping 4-digit numbers and spacing after "$" · Where: app.js results module (toCents, calculate, formatCents) · Learned: rounding up now exists only as the opt-in "Redondear por persona" switch (off on load); it rounds each share up to the next whole peso and adds the difference to the tip, so per person × people = total still holds (roundUpSplit)

## Saved values are the raw control text under one versioned localStorage key

What: the third block of app.js saves `{v:1, bill, people, noTip, tip, custom, roundUp, currency}` (raw input text, tip in '10'|'15'|'20'|'other') under `tipSplitter:v1` on every TipSplitter change, restores it through `TipSplitter.setRaw()` after the inputs module has forced rounding off, and treats anything that fails strict shape checks as absent (key removed, defaults used) · Why: raw text restores exactly what the user saw (e.g. "12,5" in "Otro"); every storage access is in try/catch with no console output because file:// and private mode can throw on `window.localStorage` itself · Where: app.js (remember/copy block), TipSplitter.getRaw/setRaw/reset · Learned: "Empezar de nuevo" pauses saving during `reset()` and then removes the key, otherwise its own change notification would re-save the defaults; new fields are added as optional (missing `noTip` loads as '', missing `currency` as '$') so older saved values keep loading under `v:1`; only an incompatible change needs a new `v`/key

## "Alguien no toma propina": no-tip people pay floor(bill / people)

What: with `noTip` = k (0..people-1), each no-tip person pays `floor(billCents / people)` and the rest (bill + the whole tip) is split among the `people - k` tip payers with the usual one-cent spread; with "Redondear por persona" only the tip payers round up to whole pesos, no-tip people keep their exact share · Why: someone who does not take tip must never pay more than their part of the bill, and the parts must still add up exactly to the total · Where: app.js results module (calculate, roundUpSplit, payerParts, buildSummary) · Learned: k must be < people (someone has to pay the tip); the copied text becomes "… · 3 × $30,00 con propina · 1 × $25,00 sin propina"

## Currency only changes the symbol; "€" goes after the amount

What: the "Moneda" selector ('$' | '€' | 'US$') is passed to `formatCents(cents, currency)`; digits stay "1.250,00" for every currency, "$" and "US$" are prefixed with no space ("US$1.250,00") and "€" is suffixed with a space ("1.250,00 €"), on screen and in the copied/WhatsApp summary · Why: euro amounts are written after the number in Spanish; no conversion is done, it is only how the amount is written · Where: app.js results module (CURRENCIES, currencyOf, formatCents); the inputs and storage blocks each keep their own copy of the list · Learned: any new money text must call formatCents with the currency (including the "$0,01 más" note), never a literal "$"

## History records a bill after a 3 s editing pause or on copy/share, never on programmatic changes

What: "Últimas cuentas" keeps the last 5 valid bills under `tipSplitter:history:v1` as `{v:1, items:[{t, raw, total, each}]}` (newest first; `raw` uses the same shape and checks as the saved values). A bill is added when the user stops editing for 3 s with valid results, when it is copied/shared, or on `pagehide` if the pause is pending; identical `raw` values move to the top instead of duplicating · Why: the app recalculates on every keystroke and has no "Calcular" button, so recording every change would fill the list with "1", "10", "100"; the user chose pause + copy over a "Guardar" button · Where: app.js storage/copy block (recordNow, onUserEdit, parseHistory) · Learned: the pause is scheduled from the form's own `input`/`change` events, not from TipSplitter.onChange, so restoring on load, "Empezar de nuevo" and loading a history entry (all via setRaw) never record; "Empezar de nuevo" does not clear the history — only "Borrar historial" does

## "Cuenta detallada": items split among who had them, tip proportional to consumption

What: a "Cómo dividir" radio switches between "Partes iguales" (unchanged) and "Cuenta detallada" (`mode: 'equal' | 'items'` in TipSplitter values). In items mode each item's cents are split among the people marked on it (leftover cents one each, starting at a different person per item); the tip is rounded on the whole ticket exactly as in equal mode and split in proportion to what each one consumed by largest remainder; "Redondear por persona" rounds each person with something to pay up to the next whole amount and adds it to their tip · Why: shares and tips must add up exactly to the total (same integer-cents rule as equal mode) and someone who consumed nothing pays nothing · Where: app.js inputs module (detailRaw, validateDetail, editor), results module (calculateItems, roundUpItems), storage block (checkDetail) · Learned: the ticket is saved raw as `detail: {people:[name], items:[{name, price, who:[personIndex]}]}` inside the same `tipSplitter:v1` object (optional field, so older saves still load) and is kept while in equal mode; removing a person re-indexes every `who`; the editor rebuilds rows only on add/remove so typing never loses focus; the copied text is "Cuenta … = total · Ana $46,00 · Beto $34,50" (no "N personas"); "Alguien no toma propina" applies only to equal mode
