# convention

A rule the codebase follows — naming, patterns, and where things live.

## With one round, only "Agregar ronda" is new on screen

What: tabs, round name, "Quitar ronda", "Personas de la salida" and the "Total de la salida" panel only show with 2+ rounds; the copied/WhatsApp text with one round is the old `buildSummary`; with 2+ it is one line per round (`Label: <old summary>` or `Label: incompleta (no se incluye)`) then `Total de la salida $X · Ana $Y · …` · Why: single-bill users must see no change; the button is the one unavoidable entry point · Where: index.html #rounds / #outing-totals, app.js rounds block (summary, renderTabs) · Learned: incomplete rounds get "· incompleta" in their tab and a note under the totals («Tragos» está incompleta: no se incluye en los totales.), and are left out of every total, so totals never show NaN or "—"
