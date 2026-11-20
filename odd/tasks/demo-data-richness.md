# Enrich the read-only demo dataset

## Objective and problem
Make `/app/demo` tell a believable, varied monthly spending story rather than showing a small repetitive fixture. Current May 2026 data has 23 rows, one income, seven categories, a duplicate Spotify charge, and the activity card displays the first six fixture rows rather than the latest activity.

## Scope and constraints
- Preserve the existing synthetic, local CLP fixture and its current-month rebasing; no session, Gmail, API, mutations, or multi-month support.
- Add realistic, distinct expense and income examples across the month, with recurring merchants, diverse categories, an uncategorized expense and credible inflow. Avoid duplicate monthly subscription charges. Keep unique IDs/source IDs, consistent counterpart keys and descriptions, valid dates and sensible amounts.
- Show the newest six movements without mutating fixture order or the full analytics data.
- Protect unrelated existing modifications in `src/client/pages/DashboardPage.tsx` and `test/react-vite-foundation.test.js`.
- TDD mode: unconfigured (source: `.pi/settings.json`); ordinary checks. Focused runner: `node --test test/demo-fixture.test.js`. Build: `npm run build`. Full runner: `npm test`.
- Delivery strategy: ask-on-risk; forecast approximately 300–400 authored changed lines (data rows, view selection and assertions); no push or PR. Branch: `framework_react` (already a feature branch). Existing dirty changes are not part of this work.

## Tasks
- [~] DD-1 (delegated): Expand the fixture into a coherent monthly story, surface recent activity correctly, and add focused regression tests for the real published fixture and rendered demo. Checks: focused test, production build, applicable full suite, worktree readback. Route: `gentle-ai-worker` because at least two non-trivial files are involved; prior read-only mapping by `gentle-ai-explore`. Work-unit commit identity: pending; do not include unrelated dirty changes.

## Acceptance criteria
- Fixture has materially broader realistic coverage (at least 35 movements, ten or more spending categories, more than one income), no same-period duplicate subscription and at least one uncategorized outflow.
- Totals and rankings derive from the fixture, not hardcoded dashboard claims; recent activity represents the latest six distinct fixture movements.
- Demo stays read-only and independent of authenticated API/session.

## Progress and evidence
- Explored `public/demo-data.json`, `src/client/demo-data.ts`, and demo composition. Scoped scout confirmed adapter strips extra metadata and rebases fixture days to current local month.
- DD-1 in progress. No implementation check run yet. No commit yet; the session-level safety rule requires an explicit user request before committing, notwithstanding the default ODD work-unit preference.

## Next step
Delegate the bounded data/view/test implementation, verify its diff and tests, then report any pending check or delivery boundary.
