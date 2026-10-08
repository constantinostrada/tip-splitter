# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## Whole app is a classic script IIFE, no ES modules

What: app.js is a plain `<script defer>` wrapped in an IIFE that attaches one global; no `type="module"`, no imports, no fetch · Why: the page must work when opened via file://, where Chrome blocks module scripts and fetches for CORS reasons · Where: index.html, app.js · Learned: for file://-openable pages, classic scripts and relative `src` are the only safe loading path

## Validation is string-based, not Number()-first

What: validateBill / validatePeople test the raw text with regexes (`^-?\d*(\.\d{0,2})?$`, `^-?\d+$`) before converting, and a `type=number` field whose text the browser could not parse (validity.badInput) is treated as invalid rather than empty · Why: `Number('')` is 0 and `Number('2.5')` passes an integer check only after extra work; the regex gives exact, user-facing messages (empty vs non-numeric vs out of range) and never throws · Where: app.js validateBill, validatePeople

## Styles live inline in index.html

What: all CSS is in a `<style>` block in index.html; there is no stylesheet file · Why: the work order allows only index.html + app.js and no external resources · Where: index.html
