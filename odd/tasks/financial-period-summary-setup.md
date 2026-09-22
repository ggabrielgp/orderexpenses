# Financial Period Summary and Setup

## Objective
Deliver the next bounded authenticated React slice: account/session handling, financial-period setup, configured-period loading, and a truthful recognized-expense summary.

## Product decisions
- Recognized expenses with an unknown or non-finite amount are excluded from the quantified total and primary count, and shown separately as a visible pending-amount count.
- Gmail synchronization after OAuth is excluded from this slice. The session response may display connection state, but this unit does not trigger Gmail sync.

## Scope
- Load `GET /api/session/profile` and render loading, retryable failure, anonymous, and authenticated account states.
- When authenticated with no selected period, validate and save setup through `PUT /api/financial-cycle`.
- Load the financial cycle before range-scoped transactions, using shared `[start, endExclusive)` date semantics.
- Render a compact, truthful recognized-expense summary with a separate pending-amount indicator and server warning state.

## Non-goals
- No Gmail sync, categories, rules, bulk actions, movement table, edit/create/delete dialogs, analytics, budget/income management beyond existing cycle income input, legacy UI migration, or WIP reapplication.

## Constraints
- TDD mode: strict; source: prior explicit user instruction; runner: `node --test` through npm scripts.
- Reuse `src/shared/review-period.js`; do not modify backend/server contracts.
- Anonymous users must not request cycle or transactions.
- Keep all failure, warning, cancellation/stale-response, and duplicate-save states truthful.

## Acceptance criteria
- Session failure is retryable and never rendered as anonymous; anonymous state starts no financial requests.
- No-cycle setup sends an inclusive UI end date as `endDateExclusive`, validates input, blocks duplicate submission, and preserves editable input on failure.
- A configured cycle loads before transactions; stale responses cannot replace the current state.
- Totals/counts include only finite recognized outflow purchase/transfer/payment movements. Unknown/non-finite recognized amounts are visibly reported separately; warnings remain visible.
- Focused strict-TDD tests and production build pass.

## Tasks
- [x] FPS-1 — Model API contracts and pure financial-period summary derivations.
  **Proof:** Focused RED confirmed finite recognized totals/counts and pending-amount requirements were unmet; GREEN passed with finite-only totals/counts and separate pending amounts.
- [x] FPS-2 — Add session-gated period loading and resilient route state.
  **Proof:** Focused RED confirmed the account route still requested Gmail status and auto-synced; GREEN passed after session-only loading, preserving anonymous gating and cycle-first, abort-guarded financial requests.
- [x] FPS-3 — Add accessible setup and configured summary UI with scoped styles.
  **Proof:** Focused RED confirmed pending amounts and balance omission were unmet; GREEN passed with the accessible setup form's duplicate-save lock, retryable errors, visible pending count, three-card summary, and no remaining-balance claim.

## Progress
- 2026-09-16: User authorized this slice and selected separate visible reporting for recognized movements with pending amounts. Read-only mapping confirmed that existing backend and shared date modules suffice.

## Verification evidence
- RED: `npm test -- test/react-vite-foundation.test.js` failed as intended with 3 behavior-level failures: auto Gmail synchronization, finite-only count/pending count, and pending visibility/no balance.
- GREEN: `npm test -- test/react-vite-foundation.test.js` passed: 17 tests, 0 failures.
- Build: `npm run build` passed: TypeScript build and Vite production build completed.
- Independent verification: candidate behavior passed. The initially reported movement-table/category scope concern was refuted as base-only: those UI elements already exist in `07ab371` and are unchanged by this candidate. It remains a follow-up outside this slice.
- Parent spot check: `npm test -- test/react-vite-foundation.test.js` passed 17/17 in the `framework_react` worktree.

## Delivery
- 2026-09-16: Committed as `3ce6235 feat(dashboard): add React period setup summary` and pushed to `origin/framework_react`.
- Internal ODD task artifacts remain intentionally uncommitted.

## Next step
Map and authorize the next bounded React migration unit; do not reapply the WIP snapshot automatically.
