# Feature: dashboard-demo-header

## Objective
Give `/app?demo` the same application header as the authenticated dashboard, using a clearly labeled demo identity (`demo@demo.com`) while keeping the demo read-only and offering login for gated actions.

## Scope
In:
- `src/client/pages/DashboardPage.tsx`
- focused assertions in `test/react-vite-foundation.test.js`
- this tracker

Out:
- production `main`
- header visual redesign
- authenticated header behavior
- API/data changes

## Implementation
- Reuse `AppHeader` and the existing account-menu presentation.
- Use a stable demo profile (`Usuario demo`, `demo@demo.com`) and a login action in the account menu.
- Keep the same summary navigation shape; demo navigation remains read-only/inert.
- Preserve the shared analytics composition and existing demo footer/login affordance.

## Checks
- Focused demo/header composition tests.
- `npm run build`
- `git diff --check`

## Progress
- [x] Implementation — demo reuses `AppHeader` and `AccountMenu` with `Usuario demo` / `demo@demo.com` and a login-only action.
- [x] Verification — 12 focused tests passed, build passed, and `git diff --check` passed; the stale AccountMenu usage comment was corrected without runtime changes.
- [ ] User visual confirmation
