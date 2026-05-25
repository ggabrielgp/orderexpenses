## Review

- Correct:
  - Row chip confirmation flow is intact. Chips now call `requestCounterpartySelection(...)` and re-render a confirmation prompt instead of selecting immediately (`public/app.js:3778-3817`). Confirming then selects matching visible transactions via `confirmCounterpartySelection()` → `selectVisibleCounterpartyTransactions()` (`public/app.js:3504-3520`).
  - Dashboard “Seleccionar similares” remains scoped to expense records. It passes the dashboard `expenses` array into `requestCounterpartySelection(...)` (`public/app.js:2860-2865`), and the prompt filters by those allowed IDs before selecting (`public/app.js:3347-3353`).
  - Removing the redundant bulk similar button looks OK. Similar-selection is now initiated from row chips/dashboard rows, while the bulk bar keeps category assignment and clear actions (`public/app.js:3319-3336`).
  - Table vertical scroll cap is reasonable: `.transactions-table-wrap` now has `max-height`, `overflow: auto`, and containment (`public/styles.css:1910-1918`). Horizontal scrolling is preserved because `overflow: auto` covers both axes.
  - Sticky table headers are implemented on `th` with `position: sticky`, `top: 0`, `z-index`, and a stronger background/backdrop (`public/styles.css:2063-2074`), which is compatible with the scroll container.

- Blocker:
  - None found.

- Note:
  - The dashboard selection handler may render twice when reduced-motion mode is active because `setView("table")` renders synchronously in that path, then the handler calls `render()` again if `state.view === "table"` (`public/app.js:2866-2867`). This is non-blocking; it’s just a minor inefficiency.
  - I did not write `/home/gabriel/projects/personal/yo/review/table-scroll-and-selection-ux.md` because the task also said “Do not modify files,” and the review-only/no-edit instruction takes precedence.