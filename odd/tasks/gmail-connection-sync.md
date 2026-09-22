# Gmail Connection and Sync (React)

## Objective
Deliver the next bounded React migration slice on `framework_react`: explain and obtain consent before connecting Gmail, show the real connection state, allow disconnecting with truthful consequences, and synchronize on explicit request with an honest in-flight state.

## Product decisions
- **No automatic synchronization.** Connecting only leaves the account ready; the user presses the sync control. The legacy `?gmail=connected` auto-sync (`public/app.js:464-473`) is deliberately **not** replicated, so the guard that forbids Gmail calls in `src/client/hooks/DashboardRoute.tsx` stays intact.
- **Indeterminate progress only.** The server exposes no progress signal; the legacy progress bar is a cosmetic client-side timer (`public/app.js:4302-4329`) that reports a percentage which corresponds to nothing. A percentage would be a lie, so the UI shows a truthful in-flight state without a number.
- **Consent before connecting.** Reading the user's email requires an explanation first, matching the legacy consent modal: which emails are read, and that imported expenses are not kept as permanent history.
- **Disconnect requires confirmation** that states the real consequences, including what it does *not* delete.
- Consent is **not** stored server-side (no column, no endpoint), so it is requested on every connection attempt. That is the existing contract, not a defect to fix here.

## Scope
- A consent dialog that gates the connection, replacing the current direct link to `/auth/google`.
- The connection entry point must always use the server-provided URL so the server-owned OAuth `state` contract is preserved; the client never builds that URL itself.
- A Gmail panel with: real connection state and account email, a refresh of that state, disconnection, and manual synchronization.
- Manual sync with a single in-flight request, an honest indeterminate state, and truthful results, including partial failures.
- The client function for disconnection and the response types the panel needs.

## Non-goals
- No server, database, or contract changes; every endpoint already exists at HEAD.
- No automatic sync after connecting, and no sync triggered by rendering.
- No fabricated percentage, progress bar, or ETA.
- No scheduling, background, or periodic sync.
- No pay-timing filter in the React surface. React syncs the configured period; the server default `payTiming` applies. This is a parity gap to revisit, not something to invent here.
- No category management, counterparty rules, analytics, cycle closure, or landing-page work.
- No reapplication of the WIP snapshot `735cbe7`.

## Constraints
- TDD mode: strict; source: prior explicit user instruction; runner: `node --test` through `npm test -- <files>`. Build check: `npm run build`.
- `src/client/hooks/DashboardRoute.tsx` must stay free of `getGmailStatus`, `syncGmail`, `/api/gmail/sync`, and the `?gmail=connected` handling; a test asserts this on purpose. Gmail state therefore lives below the page.
- Reuse the established conventions from the movements slice: a pure module owning the decisions, exported for testing; a single in-flight lock; a submitter with injected dependencies; truthful notices; `showModal()` for dialogs. The harness has no DOM, so invariants must be provable as pure functions.
- Test style: `vite.ssrLoadModule` for pure functions, `renderToStaticMarkup` for markup, `readFile` plus regex only where nothing behavioural is possible, and `globalThis.fetch` stubs asserting exact method, path, and body.
- UI copy in Spanish; identifiers, comments, and commit messages in English.
- Anonymous sessions must not be able to sync, disconnect, or fetch Gmail status.

## Acceptance criteria
- Connecting requires accepting the consent first, and without acceptance no navigation to the OAuth entry point happens.
- The consent copy states which emails are read and that imported expenses are not stored as permanent history.
- Sync can only be started by the user, only one request is in flight at a time, and the in-flight state carries no invented percentage.
- Sync results are truthful: the scanned count is reported, and a partial failure is surfaced as partial rather than as success or as a total failure. To obtain that, the request sends the configured `period`, because the server only returns `outcome` and `failedCount` in period mode (`src/movements.js:95-113`) and drops the failure count in month mode.
- A failed sync reports failure and never claims imported movements.
- Disconnection is confirmed before it runs, and the confirmation states that manual movements, stored edits and hides, rules, and categories persist, while Gmail-imported movements simply stop being readable.
- No rendering path triggers a sync or a Gmail status read for an anonymous session.
- Focused strict-TDD tests and the production build pass, and the full suite holds its baseline of 145 passing and 7 pre-existing legacy failures.

## Tasks
- [x] GS-1 — Consent module and dialog, gating the connection before it leaves the app.
- [x] GS-2 — Disconnection client function and the Gmail response types.
- [x] GS-3 — Gmail connection state, the panel, and disconnection with truthful confirmation.
- [x] GS-4 — Manual synchronization with a single in-flight lock, an indeterminate state, and truthful results.

## Review-unit plan
The estimated change is roughly 300 to 500 production lines, above a comfortable review on its own, so deliver as three units:
- Unit A: GS-1 (consent and connection). **Done.**
- Unit B1: GS-2 + GS-3 (disconnection function, response types, connection panel, truthful disconnect confirmation). **Done.**
- Unit B2: GS-4 (manual synchronization). **Done.**
Revisit the split against the real diff size before delivery.

## Risks
- **Token exposure.** None is in scope and none must be introduced: the client never sees tokens, and the OAuth entry stays a link to the server-provided URL. Do not build the URL in the client.
- **Duplicate syncs.** Sync is idempotent server-side (`movementKey` is a deterministic hash and nothing from Gmail is persisted), so duplicates waste work rather than corrupt data. Still lock it to one in flight.
- **Long-running request.** One sync can perform up to 200 sequential Gmail fetches with no server progress signal and no cancellation today. The UI must not promise a duration.
- **Partial imports.** Only period mode reports them; the client must send `period` or it cannot tell the truth about them.
- **Deceptive UI.** A percentage, an ETA, or an "imported" claim after a failure would each be a lie. The legacy does the first.
- **Guard collision.** Putting Gmail state in `DashboardRoute` breaks a deliberate test.

## Progress
- 2026-09-17: Unit B1 implemented (GS-2 + GS-3). The aborted writer resumed and completed the client disconnect function, response type, status panel, truthful confirmation, and corrected the missing-credentials copy so it no longer exposes an internal path or asks the user to fix server configuration.
- 2026-09-17: Unit B2 implemented (GS-4): explicit manual sync only, period-mode request for partial-failure reporting, indeterminate state, one-in-flight lock, and truthful success/partial/failure/stale-reload notices.
- 2026-09-17: Independent verification returned approved with follow-ups and no blocking defect. The follow-ups were fixed: stale header copy after sync, StrictMode status-lock ownership race, and a refresh that announced loading after a busy rejection. Parent final spot check passed 80/80 focused tests and preserved the full-suite baseline failures.
- 2026-09-17: Delivery decision: commit and push production code, discard all newly added/modified tests, and do not include tests in commits.

## Verification evidence
- GS-1 GREEN: consent + foundation focused pair → 22/22; build success (52 modules).
- GS-2/GS-3 GREEN: `npm test -- test/gmail-connection.test.js` → 13/13; build success (54 modules); full suite 171/164/7 at that point.
- GS-4 GREEN: Gmail/movement focused suite → 77/77; build success (55 modules); full suite 180/173/7 at that point.
- Final follow-up GREEN: focused Gmail/movement suite → **80 pass, 0 fail**; `npm run build` → success, 55 modules.
- Final full suite: **183 tests, 176 pass, 7 fail**. The 7 failures remain the same pre-existing failures in `test/dashboard-runtime.test.js` (5) and `test/dashboard-period.test.js` (2); no candidate regression was found.
- Independent verification: approved with follow-ups and no blocking defect. It verified consent safety, exact request bodies, disconnect persistence semantics, one-in-flight locks, partial-sync reporting, truthful notices, dashboard layering, and scope containment. Follow-ups were then fixed and parent spot-checked.
- Known limitation: no browser, DOM, live server, or database round-trip was exercised. Modal/focus behavior, effects, and real `/api/gmail/*` responses were verified by code reading, SSR markup, and fetch stubs.
- Full test suite failure details are recorded in the verification handoff; all seven are outside this slice's changed files.

## Delivery
- 2026-09-17: Delivered as source-only commit `1fa8181 fix(ui): unify the React surface copy in Spanish` plus `3a67708 feat(gmail): add React consent, connection, and sync`.
- 2026-09-17: Pushed to `origin/framework_react` as the guarded fast-forward range `8f106e8..3a67708`; zero commits remain unpushed.
- The user explicitly requested that tests not be maintained or committed. The seven Gmail/movement test files were discarded and `test/react-vite-foundation.test.js` was restored; no test files are present in either delivery commit.
- The final source build passed after test removal. The last complete test evidence before removal was 80/80 focused; the full-suite snapshot was 183/176/7 with the same seven pre-existing legacy failures.

## Next step
Continue with the next explicitly authorized migration slice. Do not reapply the discarded tests or the WIP snapshot `735cbe7`.
