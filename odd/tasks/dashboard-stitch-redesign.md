# Feature: dashboard-stitch-redesign

## Objective
Apply the supplied Google Stitch dashboard distribution to both authenticated and demo dashboards while preserving every existing supported capability and omitting Stitch-only concepts that have no implementation.

## Product decisions
- Apply the visual composition to authenticated and demo views.
- Preserve current functionality: period/cycle controls, Gmail consent/sync, manual expense creation, account/settings, category and counterparty administration, movement filtering/sorting/selection/edit/view/remove, chart tabs/day detail, category navigation, retries, and demo read-only behavior.
- Omit unsupported Stitch-only controls: transferir, solicitar, notifications, theme toggle, global search, and report export.
- Do not fabricate balances, budgets, transfers, or actions absent from current data/contracts.

## Work units
1. Restyle shared app chrome and dashboard frame to the Stitch visual language without changing behavior.
2. Recompose the shared summary analytics into the Stitch two-column layout, preserving existing section order/data/capabilities.
3. Align movements and demo read-only surfaces with the same hierarchy, responsive behavior, and supported actions.
4. Verify focused behavior, build, diff, and visual follow-up.

## Scope
- `src/client/pages/DashboardPage.tsx`
- `src/client/components/shell/AppHeader.tsx` only if a small semantic wrapper is required
- `src/client/styles.css`
- `src/client/design-tokens.css` only for centralized tokens
- focused assertions in `test/react-vite-foundation.test.js`
- this tracker

## Non-goals
- New backend/API functionality.
- Implementing transfer, request-money, notifications, dark mode, search, or report export.
- Replacing existing analytical calculations or mutation contracts.
- Modifying `main` or unrelated legacy surfaces.

## Progress
- [x] Product scope resolved: both authenticated and demo; unsupported controls omitted.
- [x] Work unit 1: shared chrome and dashboard frame — Stitch light card/header treatment, 1340px canvas, centralized layout tokens.
- [x] Work unit 2: summary analytics grid — shared four-up KPI band and responsive two-column analytics wrappers; existing order and capabilities preserved.
- [x] Work unit 3: movements/demo surfaces — authenticated movements use one Stitch-style card; demo movements/footer share the same card hierarchy and remain read-only.
- [x] Follow-up: chart detail placement — selected-day detail now renders below the graph and `Resumen del mes`, spanning the chart width; narrow screens stack graph, summary, then detail.
- [x] Follow-up verification — focused chart tests, build, and diff check pass.
- [x] Follow-up: title hierarchy — direct lead labels, a single `Periodo` heading, compact section titles, and shorter category copy now avoid repeated wording without changing data claims.
- [x] Follow-up verification — focused title/composition tests, build, and diff check pass.
- [x] Follow-up: highlighted balance and period controls — the truthful available-income percentage and free Font Awesome trend/wallet icons now live inside a highlighted balance card; compact period/date/actions and `Nuevo gasto` sit beside `Resumen de la cuenta`.
- [x] Follow-up: compact day expenses — each selected-day expense now has a left-side Font Awesome person icon and tighter row spacing; read-only movement behavior is unchanged.
- [x] Follow-up verification — focused chart/detail tests, build, and diff check pass.
- [x] Follow-up: mobile chart density — ported only the mobile worktree's thinner bar/gap/vertical-value treatment to the React chart; current below-chart day detail behavior remains intact.
- [x] Follow-up verification — focused spending-chart tests, build, and diff check pass.
- [x] Follow-up: concise period copy — displayed ranges now read `DD/MM/YYYY a DD/MM/YYYY`; the lead/income cards drop redundant period dates and the balance card drops the `ingreso − gastos` derivation line while preserving truthful values and the no-income empty state.
- [x] Follow-up verification — focused period/lead/budget/spending-chart tests, full foundation suite (81/85 with the same four pre-existing failures), build, and diff check pass.
- [x] Work unit 4: automated verification — 81/85 foundation tests pass with the same four pre-existing failures; build and diff check pass. Visual confirmation remains pending.
- [x] Follow-up: spending distribution card — replaced the verbose `Tipos de gasto` rows with the Stitch-style `Distribución de gastos` card: one rounded segmented bar using each existing `breakdown.bars` percent, an emphasized `formatClp` total labeled `total registrado`, and a compact icon legend (`Compras`/`Transferencias`/`Pagos` with free solid `cart`/`arrows`/`receipt` glyphs). The `getSpendingBreakdown` module and recognized-kind semantics are untouched; the zero-total empty state still shows only its truthful message.
- [x] Follow-up verification — focused spending breakdown and shared analytics tests pass; full foundation suite is 82/85 with the same three remaining pre-existing stale English/legacy source assertions (`Unable to load the account`, `Unidentified expense`, `Pending amounts`); the previous `react-spending-breakdown` stale assertion is now updated to the new markup. Build and diff check pass.
- [x] Follow-up: Stitch distribution polish — each legend marker now carries its own `react-spending-breakdown-icon-<kind>` class and reuses the exact `--color-blue-deep`/`--color-blue-bright`/`--color-violet` token of its bar segment, and a free solid `faChartPie` glyph now lives in a hidden, non-interactive `.react-spending-breakdown-header-icon` container at the upper right of the card. Card placement is recorded in the placement follow-up below. Labels, amounts, percentages, empty state and `getSpendingBreakdown` semantics are unchanged.
- [x] Follow-up verification — focused dashboard/distribution tests (8 tests) pass; `npm run build` and `git diff --check` pass.
- [x] Follow-up: Stitch card placement — `Distribución de gastos` now occupies the main-column slot that `Lectura rápida` held, rendered before `DashboardStoryView` inside `.react-analytics-main`; `.react-analytics-side` leads with `CategoryRankingPanel` then `TopInsightsView`. The temporary `.react-analytics-pair` wrapper and its placement CSS were removed, so distribution is physically left of category at desktop under the unchanged 2fr/1fr grid and narrow screens stack main before side.
- [x] Follow-up verification — focused dashboard/distribution tests pass (5 named tests green: breakdown by kind, insights module, shared analytics production order, both category distribution tests); the surrounding 28-test dashboard/analytics subset is 26 pass / 2 fail, both the pre-existing stale English/legacy source assertions (`Unable to load the account`, `Pending amounts`). Also repaired a stale legend-item count assertion that the previous uncommitted polish left matching the modifier class twice. `npm run build` and `git diff --check` pass.
- [x] Follow-up verification (placement correction) — the shared analytics production-order test now proves distribution sits in `.react-analytics-main` before `DashboardStoryView`, category leads `.react-analytics-side` and DOM order is distribution → story → category → insights; the styles assertion rejects any `.react-analytics-pair` rule. Focused dashboard/distribution tests 5/5 pass; broader dashboard/demo subset 13/13 pass. `npm run build` and `git diff --check` pass.
- [x] Follow-up: card icon coverage — added accessible decorative Font Awesome icons to the remaining dashboard cards, matching the supplied Stitch visual language without changing data or actions.
- [x] Follow-up: semantic balance status — colored the existing available-balance percentage by tone and added `En control`, `Al límite`, or `Peligro` without inventing a value when the percentage is unavailable.
- [x] Follow-up verification — focused tests 15/15 pass; `npm run build` and `git diff --check` pass; full foundation suite is 136/139 with the same three stale English/legacy assertions (`Unable to load the account`, `Unidentified expense`, `Pending amounts`).
- [x] Follow-up: concise Lectura rápida callouts — `Lectura rápida` now renders after `Destacados` in `.react-analytics-side`, while the main column keeps distribution → period metrics → chart; `getDashboardStory` emits only the largest expense and the review count behind a `Puntos clave del periodo.` preamble, dropping the principal category/counterparty facts and the restated total; each fact renders as a `react-dashboard-story-callout` list item with a `--color-blue-soft` background and a `--color-blue-standard` border, and the empty-period summary carries `role="status"`.
- [x] Follow-up verification — focused story/analytics/dashboard subset 14/14 pass; `npm run build` and `git diff --check` pass; full foundation suite 82/85 with the same three pre-existing stale English/legacy source assertions (`Unable to load the account`, `Unidentified expense`, `Pending amounts`).
- [ ] Follow-up: Lectura Rápida intelligence card — rebuild the same-column `Destacados` section using the supplied bordered insight-card pattern and uniform 2×2 tiles, mapping only truthful existing facts (`Mayor impacto`, `Mayor destinatario`, `Último movimiento`, `Principal categoría`) without fabricating unsupported `Mayor frecuencia`, `IA Activa`, or `Sin clasificar` data.
- [x] Follow-up: merge Lectura rápida cards — moved the existing story insight into a bottom note inside the intelligence card and removed the separate story card; 2×2 tiles and truthful copy remain. `git diff --check` passes; tests intentionally not run per request.
- [x] Follow-up: compact intelligence icons — tiny decorative glyphs now sit at each tile's top-right without a reserved icon column; the bottom note's lightbulb is inline with its text. `git diff --check` passes; tests intentionally not run.
- [x] Follow-up: remove Métricas panel — removed its display in authenticated and demo views; the user accepts losing average spending and detailed pending count. Period analytics calculations remain available to Lectura rápida. Source inspection and diff check passed; tests intentionally not run.
- [x] Follow-up: exact intelligence tiles — uses `Mayor impacto`, derived `Mayor frecuencia`, `Último movimiento` and summed `Sin clasificar` in a 2×2 layout with screenshot-matched compact colored glyphs, amber uncategorized tile and inline note. The authenticated action reads `Clasificar ahora →` and opens movements filtered to `Sin categoría`; the demo has no false action. The badge remains truthful (`Resumen del periodo`). Values use .9rem text. Diff check passes; tests/build intentionally not run.
- [ ] Follow-up verification — run focused Lectura Rápida/dashboard tests, build, and diff checks.
- [ ] Follow-up: movement surface alignment — give authenticated and demo movement cards the same dashboard header hierarchy, decorative icon treatment, spacing, and responsive card language without changing table behavior or read-only demo constraints.
- [x] Follow-up: dashboard period control cleanup — removed duplicate `FinancialPeriodHeading` and its accepted `Cerrar período` action; `react-dashboard-period` remains the sole edit control with readable hover/active/focus text and icon.
- [x] Follow-up verification — focused period/dashboard tests 3/3, related demo tests 6/6, build and diff check pass.
