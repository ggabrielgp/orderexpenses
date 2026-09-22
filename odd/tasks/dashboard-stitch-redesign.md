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
- [x] Work unit 4: automated verification — 81/85 foundation tests pass with the same four pre-existing failures; build and diff check pass. Visual confirmation remains pending.

