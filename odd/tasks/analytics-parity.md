# Analytics Parity (React)

## Objective
Close the analytics gap between the legacy dashboard and the React surface, honestly. Exploration
established that the gap is smaller than the migration map assumed, because a large part of the legacy
analytics is **dead code that never renders**, and because two of its panels are month-scoped and were
already inert in the period-cycled mode this product now uses.

## Headline findings (verified by reading)
- **The legacy KPI grid and the summary strip do not render at all.** `renderHeroKpis`/`updateHeroKpis`
  look up `document.getElementById("heroKpis")` (`public/app.js:3989`, `:4017`) and `summaryEl` is
  `document.querySelector("#summary")` (`:230`), but **neither node exists** in `public/app.html` or
  anywhere in the repo; both functions return early (`:3990`, `:4036`). The CSS is orphaned
  (`public/app.css:305`, `:489`).
- **The counterparty spend section and its drill-down modal are unreachable.** `renderCounterpartySpendSection`
  (`public/app.js:3148-3221`), `buildCounterpartyRows` (`:3222-3244`), `counterpartyCategoryOptions`
  (`:3246-3248`), `saveCounterpartyCategoryRule` (`:3343-3366`), `openCounterpartyDetailModal`
  (`:3368-3391`) and `highlightTableByCategory` (`:2889-2901`) have no caller. Its endpoint is already
  consumed in React by the counterparty rules dialog.
- **Income detection and the budget panel are inert in cycle mode.** The client skips loading income
  candidates entirely when a financial cycle is configured (`public/app.js:908-909`), and
  `/api/income-candidates` is month-shaped (`src/server.js:151-160`, `src/movements.js:49-80`), so
  `payTiming` cannot exist in the period model. Budget preferences are `localStorage` keyed by month
  (`financeMonthlyBudget` v2 `{months}`, `public/app.js:12-13`, `:2141-2145`) and have no server
  counterpart.
- **Sorting IS real parity and is missing from React.** `sortTransactions` handles date, amount,
  counterparty and category (`public/app.js:928-947`) with sortable headers carrying `aria-sort` and
  `▲/▼/▬` indicators (`:3499-3578`).

## Product decisions
- **Parity means what actually renders, not what the legacy bundle contains.** Dead code is not a
  capability, so it is not ported: no KPI grid without anchors, no counterparty spend section, no
  counterparty drill-down modal, no `highlightTableByCategory`. Porting dead code would add surface
  nobody can use and would force inventing placement decisions the legacy code never answered.
- **Income detection and the budget panel are not ported.** They are month-scoped, they were already
  inert under a configured cycle, and the candidate endpoint has no period shape. A period-shaped
  candidate endpoint would be a server change with its own product decisions (does a confirmed candidate
  write the server's `incomeAmount`? does it stay manually confirmed?). Recorded as an explicit,
  justified non-parity rather than a silent gap.
- **The configured cycle's income is the only income concept in React**, which already exists as
  `incomeAmount` and is editable through the cycle dialog. No second income model.
- **Corrections to legacy truths are carried over deliberately.** The legacy analytics contain claims the
  data does not support; each is listed under Truthfulness corrections below and the React port must not
  reproduce it.
- **The donut is not ported.** Its information — share per category, amount, movement count — is carried
  by a ranked text list, which legacy also had and used as the drill-down entry point. Adding a charting
  library is a dependency decision with its own licence, bundle and accessibility cost, and nothing in
  React needs one if the ranked list carries the data. Revisable on request.
- **The daily/weekly chart IS ported without a library.** Legacy's own bars are DOM buttons with
  `aria-label` and `aria-pressed` in a labelled region (`public/app.js:2232-2324`), so accessible bars are
  a faithful port rather than an invention. Its ECharts usage is limited to the donut.

## Truthfulness corrections to apply (legacy claims not to reproduce)
1. `Días restantes` was computed from today's calendar month regardless of the selected period
   (`public/app.js:3943-3950`). Not ported; if ever shown, derive it from the configured period.
2. `% disponible` was the share of income not yet spent, could be negative, and was labelled as available
   (`:3954`). Any share must be named for what it is and never rendered negative.
3. `Saldo restante` could show a negative number while its own caption asked for an income (`:3978-3990`).
   With no configured income the port shows no number at all.
4. `Detectado automáticamente` could accompany an empty value (`:3912-3915`, `:3966`). Never claim a
   detection that produced no amount.
5. `No explicado todavía` presented a user-typed difference as a fact about untracked money (`:2003-2008`).
   Any such statement must disclose that movements without a known amount are excluded.
6. `Gastos capturados` omitted unknown-amount movements without saying so (`:1263`, `:1966`). The React
   summary already reports a pending count; the port keeps that disclosure everywhere a total appears.
7. Chart bars had a 12% height floor, so a small day looked like a sixth of the largest one
   (`:2289-2291`). The port draws proportional heights with no floor.
8. The savings hint presented a projection as a result (`:3144`). Not ported.
9. Category insights summed already-rounded percentages (`:2925`, `:3121`), so a combined share could be
   off by a point or exceed the true total. The port computes shares from raw totals and rounds once.
10. `Confianza alta/media/baja` was a pay-timing heuristic, not measured confidence (`:1867-1881`). Not
    ported with that label; the server's real `confidence` is the only confidence worth showing.
11. Selecting an income candidate silently overwrote a typed salary (`:1842`). Not applicable: candidates
    are not ported.

## Scope
- Monthly/weekly spending chart as accessible bars with a truthful empty state and no invented precision.
- Category ranking with amount, integer share, movement count, the `Sin categoría` bucket, and the
  `Otras categorías` merge for the tail.
- Category detail: the counterparties inside one category, and the jump into the movements table using
  the filter this migration just shipped.
- Period analytics: average expense, largest expense, and a review count derived from `status`, each with
  the unknown-amount disclosure the summary already applies.
- Sorting parity for the movements table: date, amount, counterparty and category, with `aria-sort` and
  direction indicators.

## Non-goals
- No charting library and no donut.
- No income detection, no budget preferences, no pay-timing control.
- No dead legacy surface (KPI grid, counterparty spend section, counterparty drill-down modal).
- No server, database, or contract change of any kind.
- No projections, savings hints, or advice copy.
- No period-over-period comparison, alerts, goal tracking, export, or print: none exist in legacy.
- No account surface and no legacy retirement; those are later units.

## Constraints
- TDD mode: **strict**; runner `node --test` through `npm test -- test/react-vite-foundation.test.js`;
  build check `npm run build`.
- Test delivery policy: production commits are source-only; tests pass locally but are not committed.
- Baseline: the focused file is **46 tests, 41 pass, 5 fail**, the 5 being stale assertions that must stay
  untouched. The 7 legacy dashboard failures live in their own files.
- House conventions: pure module plus injected submitter, the shared in-flight lock only where a mutation
  exists, `react-` class prefixes, Spanish copy, English identifiers and comments, and tests that assert
  pure-function behavior and `renderToStaticMarkup` markup because the harness has no DOM.
- Review target: **at most ~400 changed production lines per unit.** All analytics units touch
  `DashboardPage.tsx`, so they are strictly sequential (single writer).

## Unit split and order
1. **AN-1 — Sorting parity.** `movements` table headers become sortable with `aria-sort`; the ordering
   contract is a pure function over date, amount, counterparty and category, mirroring `sortTransactions`
   including the direction toggle and the neutral state legacy showed with `▬`.
2. **AN-2 — Period analytics.** Average, largest, and review count, computed from the already-loaded
   transactions and the configured income, with the unknown-amount disclosure. No new request.
3. **AN-3 — Category ranking and detail.** Ranking with shares, the `Sin categoría` bucket, the tail merge,
   the counterparty breakdown inside a category, and the jump into the table filter.
4. **AN-4 — Daily/weekly spending chart.** Accessible proportional bars with tabs, a truthful empty state,
   and reduced-motion respect.

## Allowed edit surfaces (per unit, decided when the unit starts)
Each unit will use only: its new file under `src/client/components/analytics/` (or
`src/client/components/movements/` for sorting), `src/client/pages/DashboardPage.tsx`,
`src/client/styles.css`, and `test/react-vite-foundation.test.js`.

## Tasks
- [x] AN-1 — Sorting parity (date, amount, counterparty, category) with `aria-sort` and direction indicators.
- [x] AN-2 — Period analytics summary: average, largest, review count, with the unknown-amount disclosure.
- [x] AN-3 — Category ranking, detail, and the jump into the movements filter.
- [x] AN-4 — Daily/weekly spending chart as accessible bars.

## AN-1 delivery and verification record
- Delivered as commit `4307e4a feat(movements): sort the period table by the legacy columns`, pushed as `a54c772..4307e4a` to `origin/framework_react`.
- The module reproduces legacy's transition exactly, including the **real neutral state** a third activation reaches (`cycleSort`, `public/app.js:3567-3578`) and the `▬` indicator (`:3562-3565`), and `aria-sort` is set explicitly to `none` on the inactive sortable headers, as legacy did (`:3545-3553`). Four columns are sortable because legacy made exactly four sortable; the actions column is not.
- Comparator decisions: dates compare as locale-less strings because the app deliberately leaves dates unparsed (and the fixed-width format makes lexicographic order calendar order); amounts collapse a non-finite value to zero so the comparator is total and never `NaN`; ties keep the loaded order in both directions through an index tie-break. Legacy's own comparator could return `NaN` for two infinite amounts, which this one cannot.
- Findings raised and resolved: the production view was composed around a **source-text assertion** that pinned the literal string `view.rows.map` in the page source, so the code was shaped to satisfy a test's string match rather than its behaviour. The table is now split into a state container and a presentational `MovementsTableView`, and the order and count assertions are made on rendered output. The ordering fixture was also made discriminating (its loaded order differs from both sorted orders, so a no-op sort now fails), and a claim about the date key was corrected and pinned for the unusable-date sentinel.
- Known divergences, both reported and judged acceptable: same-day rows tie where legacy could order them by time, because the React projection keeps only the date; and a blank counterparty orders by the Spanish label the table displays instead of legacy's empty string, which the projection makes unreachable in the production path.
- Review workload: about 467 production lines (container and presenter 251, module 195, styles 21), slightly above the ~400 target because the extraction added a presentational component.
- Residual: around thirty source-text assertions remain across the filter and sorting tests, mostly for wiring and export shape that a static render cannot exercise. The order and count claims that matter are no longer among them.

## AN-2 delivery and verification record
- Delivered as commit `f5f66c3 feat(analytics): add period metrics to the React summary`, pushed as `4307e4a..f5f66c3`.
- Three metrics derived from the already-loaded period transactions, so no request was added: the average expense, the largest expense, and a review count. Production total landed exactly at the 300-line ceiling (module 232, page 57, styles 11).
- Truthfulness rules confirmed in data and in copy: the average names the divisor it used in the same sentence as the number and returns no value at all when nothing is quantifiable, so the legacy fabricated zero (`averageExpense = knownExpenses.length ? … : 0`, `public/app.js:1266-1268`) cannot reappear; the largest expense exists only when there is one and always carries an identity and a date; and the review count counts only `status === "needs_review"` movements while the unknown-amount count is a separate number in a separate sentence, with no coalescing operator anywhere, replacing legacy's `pendingReviewCount || unknownExpenseCount` (`public/app.js:1301`) which hid whichever fact lost the fallback.
- Verification corrected a premise of mine: the average's divisor is **not** smaller than the adjacent `Gastos reconocidos` card, because that card already counts only quantified expenses (`summarizeRecognizedExpenses`, `DashboardPage.tsx:278-292`). The two numbers agree, which is stronger than the consistency I expected.
- Blast radius: both modified files are additions only (zero deletions), so the four summary cards, the by-kind breakdown, the latest-expense card, the filter, the sorting and the header controls are untouched.
- Accepted residual: two of the thirteen source-text assertions guard the page's derivation and single mount, which verification judged behavioural-able because the presentational panel is already exported. They guard wiring rather than a behaviour that could be wrong silently, all three metrics are proven behaviourally through the exported panel, and making them behavioural requires extracting the summary's ready view from a 1500-line component. The conversion is expected whenever that region is next extracted for another reason.
- Residual noted: the unknown-amount fact is now stated twice, once by the shipped `Montos pendientes` card and once by the new review sentence. Same number, different nouns, no contradiction; a future unit touching this region should read it from one source.

## AN-3 delivery and verification record
- Delivered as commit `4d6fda3 feat(analytics): add category ranking and detail`, pushed to `origin/framework_react`.
- The pure ranking groups finite recognized movements by normalized category, computes shares from raw totals, retains `Sin categoría`, merges the tail after the top three into `Otras categorías`, and provides a counterparty detail breakdown. Unknown-amount movements are excluded from totals and disclosed separately.
- The authenticated summary renders the ranking and detail only in the financial tree. Real categories can jump into the existing in-memory movement filter; `Otras categorías` cannot because it is not a filter value.
- Verification: focused suite reports 51 passing tests and the same 5 known stale failures; `npm run build` passes. Independent verification found no blocking defect. Review is disabled for this clone.
- Accepted follow-up: the last jumped category remains the initial filter if the user returns to the movements view through the summary toggle; it is visible and clearable, but can be reset in a future filter-state cleanup.

## AN-4 delivery and verification record
- Delivered as commit `fc49765 feat(analytics): add daily spending chart`, pushed to `origin/framework_react`.
- The chart uses Monday-to-Sunday UTC/date-only buckets over the configured `[startDate,endDateExclusive)` period, includes weekly tabs and `Periodo completo`, uses proportional heights without the legacy 12% floor, and reports unknown amounts/dates separately. Empty data shows an explicit message; bars are static accessible marks and only tabs are interactive, per user decision.
- Verification: focused suite reports 54 passing tests and the same 5 known stale failures; `npm run build` passes. Independent verification found no blocking defect. Review is disabled for this clone.
- Accepted follow-ups: the candidate is above the nominal 400-line review target (609 production lines); unknown-date disclosure counts finite rows with unusable dates from the already-loaded period projection, and the chart uses a grouped tab pattern with `aria-pressed` rather than a native tablist because only the period selector is interactive.
