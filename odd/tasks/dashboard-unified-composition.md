# Feature: dashboard-unified-composition

## Objective
Use one dashboard analytics composition for both the authenticated account and `/app?demo`. Demo data remains meaningful and read-only; only capabilities, labels, and login-gated actions differ.

## Scope
In:
- `src/client/pages/DashboardPage.tsx`
- `src/client/styles.css` only if the shared composition needs a small modifier
- `test/react-vite-foundation.test.js`
- this tracker

Out:
- production `main`
- API/data semantics
- deletion of legacy CSS
- unrelated migration changes

## Design contract
- Extract a shared dashboard analytics body used by `DemoDashboardPage` and `FinancialSummary`.
- Keep the same section order and same component families in both paths.
- Demo uses dummy data and displays a clear Demo/read-only indicator.
- Demo does not mount mutation dialogs, account settings, Gmail sync, or authenticated movement actions; actions that require login must be absent or route to login.
- Do not remove analytics sections from the demo independently. Differences are capabilities and copy, not layout.
- Preserve the current authenticated interactions: category jump to movements, chart read-only detail, CRUD dialogs, and budget/income truth.

## Checks
- Focused React composition tests.
- `npm run build`
- `git diff --check`

## Progress
- [x] Shared composition implemented — `DashboardAnalyticsBody` is used by both demo and authenticated summary.
- [x] Demo/authenticated assertions updated — both paths keep the same order and component families; only capabilities differ.
- [x] Build and focused checks — 9 focused tests passed, build passed, and `git diff --check` passed; four unrelated pre-existing foundation failures remain.
- [ ] User visual confirmation
