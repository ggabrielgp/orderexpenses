# Feature: dashboard-production-parity

## Objective
Superseded by `dashboard-unified-composition.md`: the demo must share the authenticated dashboard composition and differ only in data/capabilities, not in design.

## Scope
In:
- `src/client/pages/DashboardPage.tsx`
- `src/client/styles.css`
- focused assertions in `test/react-vite-foundation.test.js`
- this tracker

Out:
- production `main`
- authenticated dashboard behavior beyond shared component compatibility
- API/data semantics
- legacy CSS deletion

## Target demo order
1. Demo header
2. One primary spending total (no demo balance/budget panel)
3. Month story
4. Period metrics
5. Daily spending chart
6. Category distribution visualization
7. Top insights
8. Spending-type breakdown
9. Compact read-only movement list/footer

## Implementation notes
- Keep the existing shared components and data decisions where possible.
- Add a single-card lead variant for the demo; authenticated summary keeps its balance card.
- Replace the demo's text-heavy `CategoryRankingPanel` with the existing `CategoryDistributionPanel`.
- Preserve read-only demo behavior and avoid changing production `main`.

## Checks
- Focused React foundation tests covering demo composition and order.
- `npm run build`
- `git diff --check`

## Progress
- [x] Initial demo-only simplification was implemented and verified.
- [!] Superseded: user clarified that demo and authenticated dashboards must share one composition; the demo-only divergence must be corrected.
- [ ] Unified composition correction
