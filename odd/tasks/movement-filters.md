# Movement Filters (React)

## Objective
Give the period-scoped React movements table the filter parity the legacy dashboard had, honestly:
the legacy offered a **category filter over already-loaded rows** and nothing else in the table. This
is task FC-6 of `odd/tasks/financial-cycle-controls.md`, promoted to its own unit because it touches the
movements surface rather than the cycle.

## What legacy actually offered (verified by reading)
- `renderTableCategoryFilters` (`public/app.js:3621-3668`) renders a filter group labelled
  `Filtrar tabla por categoría` with copy `Filtrar detalle` / `Categoría`.
- The state is in-memory only: `state.tableCategoryFilter` (`public/app.js:161`), reset when the month
  changes (`:1008`) and when a cycle is applied (`:424`).
- It does **not** change any request. It filters rows already loaded for the period.
- The table's own summary states the filter-relative count: label `Total gastado en {period}` or
  `{categoryFilter} en {period}`, detail `{n} de {total} salidas con monto` plus `· {pending} por
  revisar` when applicable (`renderTableSummary`, `public/app.js:3590-3618`).
- **No kind, direction, or status filter.** None existed in legacy.
- **Sorting is real legacy parity and is NOT part of this unit.** Verification corrected an error in an
  earlier version of this document: legacy had a fully interactive sortable table — `sortTransactions`
  with date, amount, counterparty, and category (`public/app.js:928-947`), `state.sortKey`/`state.sortDir`
  (`:142-143`), sortable header buttons with `aria-sort` and `▲/▼/▬` indicators (`:3499-3578`), applied in
  `renderTableView` (`:1200`). This unit must not claim otherwise in code or comments; sorting is a separate
  follow-up unit with its own decisions.

## Product decisions
- **Mirror legacy: one category filter over the loaded rows.** In period mode the server ignores `month`
  and `payTiming` (`src/server.js:134-149`) and `/api/transactions` does not accept a category, so a
  server-side filter is impossible without a contract change, which is out of scope. The filter is
  therefore row-level and client-side, exactly like legacy.
- **In memory, not persisted.** Legacy kept it in memory and reset it when the period changed; the React
  surface resets it for the same reasons. Persisting a filter across a period change would hide rows the
  user expects to see, which is a behavior change nobody asked for.
- **Offer only the categories present in the loaded rows.** The filter exists to narrow what is on
  screen, so an option that could only ever produce an empty table is noise. The derivation is the
  table's business, not the catalog's.
- **The filtered count must be stated, never implied.** When a filter is active the table states how many
  rows are shown out of how many the period has, mirroring legacy's `{n} de {total}` detail. A table that
  silently drops rows while the numbers above it stay unfiltered is the specific dishonesty this unit
  exists to prevent.
- **The financial summary stays period-wide.** The cards above the table describe the whole configured
  period; the filter narrows the table only. Both statements are true at once, so the filter must not
  touch the summary and the table must name its own scope.
- **No sorting.** It is required parity but belongs in its own unit: an ordering contract over rows whose
  dates are deliberately left unparsed (to avoid timezone shifts) carries its own decisions and its own
  accessibility surface (`aria-sort`), and folding it in would inflate this unit past its budget.

## Scope
- A pure module owning the filter state transitions (select, clear), the option derivation from rows, the
  row selection, and the truthful count copy.
- The filter control in the movements view, following the existing `react-` class and accessibility
  conventions, with the active state announced.
- The table's own count statement when a filter is active.
- Scoped styles in `src/client/styles.css`.

## Non-goals
- No server, database, or contract change.
- No month or pay-timing filter: meaningless in a period-scoped surface.
- No kind, direction, or status filter: none existed in legacy.
- No sorting in this unit: it is required parity (see the decisions section) but is implemented by the
  follow-up sorting unit, so this unit must not assert anywhere that legacy lacked it.
- No bulk selection, bulk category assignment, or bulk status: that belongs to the table/analytics unit.
- No persistence in `localStorage`.
- No pagination, virtualization, or debounce machinery for a list that is already fully in memory.
- No changes to the financial summary cards, the cycle controls, or the settings surfaces.

## Constraints
- TDD mode: **strict**; source: prior explicit user instruction; runner `node --test` through
  `npm test -- test/react-vite-foundation.test.js`. Build check: `npm run build`.
- **Test delivery policy (user-owned):** production commits are source-only; tests are written and must
  pass locally but are **not** committed.
- Baseline for this unit: the focused file is **41 tests, 36 pass, 5 fail**, where the 5 are stale
  assertions that contradict delivered behavior and must stay untouched.
- House conventions: a pure module for the decisions, the shared in-flight lock only if a mutation is
  involved (this unit has none), `react-` class prefixes, and tests that assert pure-function behavior,
  `renderToStaticMarkup` markup, and source structure — the harness has no DOM.
- UI copy in Spanish; identifiers, comments, and commit messages in English.
- Review target: **at most ~300 changed production lines.** This is a small unit; do not let it grow.

## Acceptance criteria
- The movements view offers the categories present in the loaded rows, plus a way to clear the filter.
- Selecting one narrows the visible rows and the table states how many of the period's rows are shown.
- Clearing restores every row and the count statement disappears.
- The filter resets when the period's data reloads, so a stale selection cannot silently hide rows.
- The financial summary above the table is unchanged by the filter.
- No request is issued by filtering, and no file outside the allowed surfaces changes.
- Focused tests and `npm run build` pass, and the 5 stale assertions stay untouched.

## Allowed edit surfaces
- `src/client/components/movements/movementFilters.ts`
- `src/client/pages/DashboardPage.tsx`
- `src/client/styles.css`
- `test/react-vite-foundation.test.js`

## Tasks
- [x] MF-1 — Pure `movementFilters` module: option derivation, selection, row filtering, truthful count copy.
- [x] MF-2 — Filter control in the movements view with an announced active state and a clear action.
- [x] MF-3 — Table count statement when a filter is active, plus reset on data reload, plus scoped styles.
- [ ] MF-4 — Focused strict-TDD tests, `npm run build`, and independent verification (fix round in progress).
- [ ] MF-5 — Sorting parity (date, amount, counterparty, category) with `aria-sort` and direction indicators, in its own unit.

## Verification findings to resolve in this unit
Independent verification confirmed the crux guarantees at module level (a stale selection cannot hide rows
wherever rows render, the count is derived from the same rows the table shows, filtering issues no request,
and the financial summary stays period-wide at the data level) and raised these:
- The reset is skipped when the loaded rows are empty, because the reconciliation runs below the early
  return; that falsifies the comment claiming the reset always commits. Legacy cleared unconditionally.
- A vanished category is dropped only at render and never cleared from the stored selection, so an edit
  that removes the category and a later edit that reintroduces it silently re-activates the filter.
- Two comment claims overstate: "a stale selection is never merely ignored but replaced" holds only when
  rows are non-empty, and the module doc omits that legacy also cleared the stored state.
- The false sorting claim described above, in the task document and in a code comment.
- Filter state is lost on the Resumen/Movimientos toggle because the table unmounts. That is stricter than
  legacy, hides nothing, and is accepted as-is.
