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
