# Canonical React Root and Legacy Retirement

## Objective
Make the built React application canonical at `/` after authenticated parity is complete, then retire legacy-only assets and references through an explicit destructive stage.

## Current audit
- `/` serves `public/index.html` while React's `LandingPage` is only reachable through the Vite development root.
- `/app` and `/app/demo` already serve the React build.
- `/legacy-app` and `/app?demo` still serve the legacy dashboard.
- `public/design-tokens.css`, `public/app.css`, and `public/demo-data.json` remain shared React runtime assets and must be retained unless separately migrated.
- Legacy tests and the uncommitted focused React test file still assert the split routing.

## Staged plan
1. [x] RR-1 — Non-destructive root canonicalization: serve React `dist/index.html` at `/`, preserve `/app`, `/app/demo`, `/legacy-app`, and `/app?demo`, and update focused routing evidence.
2. [x] RR-2 — Remove React links to `/legacy-app`, choose compatibility policy for `/legacy-app` and `/app?demo`, and remove the dev proxy only when safe.
3. [x] RR-3 — Destructive legacy asset/test retirement, only after explicit user authorization and a repository-wide reference audit.
4. [x] RR-4 — Final full-suite/build verification and delivery record.

## Non-goals until explicit authorization
- No deletion of tracked legacy assets.
- No removal of legacy routes or legacy tests.
- No removal of shared public CSS/data assets.
- No history rewrite, reset, stash, or force push.

## RR-1 delivery and verification record
- Delivered as commit `191878b feat(routing): make React the canonical root`, pushed to `origin/framework_react`.
- Production `/` now serves the built React shell while `/app`, `/app/demo`, `/legacy-app`, and `/app?demo` remain available. No legacy asset was deleted.
- Verification: `test/static-routing.test.js` passed 36/36, the focused React root-routing test passed, and `npm run build` passed. Native review is disabled for this clone.
- The local routing tests remain uncommitted with the rest of the focused test suite, per project policy.

## RR-2/RR-3/RR-4 delivery and verification record
- RR-2 delivered as `a76011c refactor(routing): retire legacy app entry points`, pushed to `origin/framework_react`: `/legacy-app` redirects to `/app`, `/app?demo` redirects to `/app/demo`, and React links to the old dashboard were removed.
- RR-3 delivered as `4d2b2ca refactor(legacy): remove retired dashboard assets`, pushed to `origin/framework_react`, after explicit user authorization and a fresh reference audit. Eleven legacy-only public assets were deleted; shared CSS/data and `src/shared/review-period.js` remain. Four legacy-only test files were deleted locally but remain uncommitted under the project's source-only test policy; `test/period.test.js`, `test/static-routing.test.js`, and the focused React test were retargeted locally.
- Final verification: `npm test` reports 118 tests, 113 passing and the same 5 known stale React failures; focused routing/period tests pass; `npm run build` passes. No production import/reference to deleted runtime files remains. Native review is disabled for this clone.
- Accepted residuals: the Vite `/legacy-app` proxy remains for development redirect parity; comments in source/tests retain historical citations to deleted legacy files; the retained `public/app.css` still contains some dead legacy selectors.

## Resolved retirement decisions
- User authorized deletion of legacy-only assets and tests after reference updates and audit.
- `/legacy-app` redirects to `/app`; `/app?demo` redirects to `/app/demo`.
- Retain shared `design-tokens.css`, `app.css`, `demo-data.json`, and the `/src/shared/review-period.js` compatibility route/module.
- Legacy-only tests may be removed after their server/client coverage is either replaced by React coverage or no longer applies.
