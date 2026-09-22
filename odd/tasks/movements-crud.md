# Movements CRUD (React)

## Objective
Deliver the next bounded React migration slice on `framework_react`: create a manual expense, edit a movement, and remove a movement, with truthful destructive-operation semantics.

## Product decisions
- Bulk category assignment is **out of scope**; it belongs to the categories slice where the catalog lives.
- Create and edit forms expose a **read-only category select** fed by `GET /api/categories`. No category management (create/edit/delete category) in this slice.
- Create and edit use **native `<dialog>` modals**, matching the canonical legacy UX (`public/app.html` uses dialogs for detail, edit, and new expense) and the already-shipped accessible setup form.
- Removal **must distinguish manual from Gmail-derived** movements in its confirmation copy. Manual removal is permanent; Gmail removal is an irreversible dashboard hide that never deletes the Gmail email.
- Creating a movement dated **outside the selected financial period is blocked** with a message that names the valid period. The React dashboard is period-scoped, so an out-of-period movement would be stored but remain invisible, presenting as a failed save. This deliberately diverges from legacy, which did not validate it.
- The create contract carries `description`, matching legacy (`public/app.js:826`) and the server (`src/server.js:603`). It is normalized with the same trim/empty-to-null rule as `counterparty`.
- **Direction is derived from `kind`**, not chosen by the user: `income` becomes `inflow` and every other kind becomes `outflow`. The recognized-expense summary counts outflows only, so a `purchase` saved as `inflow` would silently disappear from it. This deliberately drops the legacy direction select (`public/app.html:430-441`) and means a refund cannot be recorded as an `inflow` purchase.
- `FinancialTransaction.status` is typed as an **open string**, not a closed union: the server emits `manual`, `detected`, `needs_review`, client-supplied `edited`, `null`, and any arbitrary string persisted through `sanitizePatch` (`src/server.js:632-652`).

## Scope
- Extend the client mutation layer: `POST /api/transactions`, `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id`, `GET /api/categories`.
- Extend movement types so a movement carries its identity (`id`, `source`, `status`, `isManual`) and the read projection stops dropping it.
- Add pure draft/payload/target helpers for create, edit, and removal.
- Add accessible create and edit dialogs plus a removal confirmation step.
- Wire row actions into the existing read-only `MovementsTable`.

## Non-goals
- No backend or server-contract changes; every endpoint already exists at HEAD.
- No bulk category assignment, selection machinery, category catalog management, or counterparty rules.
- No Gmail sync, analytics, cycle completion, landing-page, or legacy UI migration.
- No reapplication of the WIP snapshot `735cbe7`; only specific verified helpers are ported deliberately.

## Constraints
- TDD mode: strict; source: prior explicit user instruction; runner: `node --test` through `npm test -- test/react-vite-foundation.test.js`.
- Build check: `npm run build` (`tsc -b && vite build`).
- Existing test style is authoritative: `vite.ssrLoadModule` for pure functions, `readFile` + regex for source contracts, `globalThis.fetch` stubs asserting exact method/path/query/body.
- `PATCH`/`DELETE` on a Gmail-derived movement is validated server-side against a **single month**; the client must derive that month from the movement's original `occurredAt` or the request 404s.
- Gmail-derived movement dates are immutable; the edit flow must not offer a date change for them.
- Keep failure, double-submit, and post-success-refresh states truthful; never auto-retry a removal that already succeeded.

## Acceptance criteria
- A manual expense can be created with validated amount/date, forced `direction: "inflow"` for `kind: "income"`, category optional, no duplicate submit, and editable input preserved on failure.
- A movement can be edited; the PATCH carries the month derived from its original `occurredAt`; a Gmail-derived movement cannot change its date.
- Removal always requires explicit confirmation; the copy distinguishes permanent manual deletion from irreversible Gmail hide.
- A removal that returns success is never re-sent, even when the follow-up reload fails; the failure surface stays truthful about stale data.
- `id`/`source`/`status`/`isManual` reach the client without leaking `unknown` into payload builders.
- Focused strict-TDD tests and the production build pass.

## Tasks
- [x] MCR-1 — Mutation contract and API layer: movement identity in types, `getCategories`, and the create/update/remove client functions including month derivation.
- [x] MCR-2 — Pure draft, payload, and target helpers for create, edit, and removal.
- [x] MCR-3 — Removal flow: distinguishing confirmation, single in-flight lock, and no re-send after success.
- [x] MCR-4 — Accessible create-manual-expense dialog with read-only category select.
- [x] MCR-5 — Accessible edit dialog with Gmail date immutability, plus `MovementsTable` row actions and scoped styles.

## Review-unit plan
The estimated change (roughly 250–450 source lines plus tests) sits at or above a comfortable review threshold. Deliver as separated review units rather than one candidate:
- Unit A: MCR-1 + MCR-2 (contract, API layer, pure helpers). **Done.**
- Unit B: MCR-3 (removal semantics). **Done.**
- Unit C1: MCR-4 (create dialog). **Done.**
- Unit C2a: the editable projection, the edit dialog, and the `formatPeriodLabel` consolidation. **Done.**
- Unit C2b: table row actions, mounting both dialogs, and the removal wiring. **Done.**
Unit C was split into C1, C2a, and C2b because a combined create-plus-edit candidate exceeds a comfortable review. Even split, every unit except A exceeds a ~400-line comfort threshold, and the candidate as a whole is roughly 6,000 lines including tests, so it must be delivered as sequential review units, never as one candidate.

## Module layout
- `src/client/components/movements/manualExpense.ts` — the shared mutation-side contract: drafts, payload builders, the movement target rule, amount parsing, the create feedback mapping, `formatPeriodLabel` (single definition), and the shared `isMovementNotFoundError` classifier.
- `src/client/components/movements/removalState.ts` — the pure removal reducer, the dismissal mapping, the removal submitter, and the removal notice.
- `src/client/components/movements/CreateManualExpenseDialog.tsx`, `EditMovementDialog.tsx`, `RemoveMovementDialog.tsx` — the three native-modal dialogs, each exporting the pure decisions its flow depends on.
- `src/client/pages/DashboardPage.tsx` — the read-side projections and the wiring. No component module may import from `src/client/pages/`; the mutation helpers were relocated specifically to keep that edge absent.

## Risks
- Silently breaking the locked read contract: `getRecognizedExpenseMovements` is asserted with `assert.deepEqual`, so extending its shape requires a deliberate test update.
- Month mismatch on Gmail `PATCH`/`DELETE` producing 404s. A **pre-existing data hazard** compounds this: `loadMovementsForMonthResult` filters by the original date and only then applies overrides (`src/movements.js:219-239`), so the projection's `occurredAt` can belong to a different month than the one that produced the row, and `runtimeMovementExists` (`src/server.js:598`) then 404s. This needs a server change and is out of scope; blocking Gmail date changes already prevents new instances. MCR-3 and MCR-5 must surface that 404 explicitly and never retry it silently.
- Irreversible Gmail hide presented with the same weight as a reversible action.
- Legacy debt that must **not** be copied: missing double-submit guards and a reload that swallows its own error, leaving a removed row visible with no rollback.

## Removal semantics (unit B detail)
The removal invariants live in a pure reducer, `src/client/components/movements/removalState.ts`, because this harness has no DOM and the invariants must be provable without a component.
- `RemovalState.removedMovementIds` remembers completed removals so a **stale list cannot re-issue a DELETE for an already-removed movement**. Without it, `open` on a row still visible after a failed reload would reach `confirming` again, the server would answer 404, and the dialog would report a failure that did not happen.
- `cancel` and the terminal `dismissRemoval` transition **preserve** `removedMovementIds` by design. A caller that closes the dialog with a fresh `createRemovalState()` would erase the guard and re-enable the second DELETE.
- `open` for an already-removed movement is a reference-equality no-op, so no dialog appears and no submission becomes possible.
- A genuine failure stays retryable for the movement that actually failed; the guard is scoped to removed movements, not a blanket lock.

## Progress
- 2026-09-17: User authorized this slice, excluded bulk category assignment, chose a read-only category select, and chose native `<dialog>` modals. Read-only mapping confirmed the slice is client-only and that the server branches on the `manual_` id prefix.
- 2026-09-17: Review unit A implemented (MCR-1 + MCR-2) under strict TDD. Parent review found two divergences: a real contract defect (`description` missing from the create path, fixed) and an unauthorized period-containment guard, which the user then authorized explicitly. The category-membership guard stays as defense in depth for a select-driven form.
- 2026-09-17: Unit B implemented (MCR-3). Parent review found that the reducer allowed a stale row to re-issue a DELETE for an already-removed movement; the guard now remembers completed removals and survives dismissal.
- 2026-09-17: Unit C1 implemented (MCR-4). It introduced a circular import between the page and the dialog; the mutation-side helpers were relocated into `manualExpense.ts` to remove it, proven absent by walking the import graph.
- 2026-09-17: Unit C2a implemented: the editable projection, the edit dialog, the `formatPeriodLabel` consolidation, and its anti-drift guard.
- 2026-09-17: Unit C2b implemented: per-row actions, both dialogs mounted, and the removal submitter and dismissal wiring.
- 2026-09-17: Independent verification of units B through C2b returned approved with follow-ups and no blocking defect. Fixes applied: removal success is now reported even when the reload succeeds (previously unreported), the removal confirmation is a real native modal, the 404 rule is one shared classifier with terminal and truthful copy in both flows, and a test that passed for the wrong reason now fails when its guard is removed.

## Verification evidence
- Unit A RED: `npm test -- test/react-vite-foundation.test.js` → 21 tests, 16 pass, 5 fail, for behavioral reasons only (missing movement `id` in the frozen projection assertion, and four `TypeError`s for the not-yet-implemented helpers and client functions).
- Unit A GREEN: same command → 21 pass, 0 fail. `npm run build` → success (45 modules).
- Unit A independent verification: approved with follow-ups. No candidate-caused correctness defect. Scope containment confirmed to the four authorized files. Six follow-ups closed afterwards: a real status-union lie, a date-only `occurredAt` crash in the edit draft, two boundary gaps (`00` month, half-open period end), four untested rejection branches, and two misleading comments.
- Follow-up RED: 20 pass, 1 fail (date-only edit draft). The boundary and rejection-branch assertions were already green because they pin existing behavior that simply had no test; they close coverage gaps rather than drive new code.
- Follow-up GREEN: 21 pass, 0 fail. Build success.
- Parent spot check after the follow-ups: `npm test -- test/react-vite-foundation.test.js` → 21/21.
- Units B, C1, C2a, C2b GREEN: `npm test -- test/react-vite-foundation.test.js` → 39 pass, 0 fail. `npm run build` → success (50 modules).
- Unit B/C2a/C2b independent verification: approved with follow-ups, no blocking defect. Independently verified: the removal guard survives integration (no path closes the removal state with a fresh state, so a stale row cannot re-issue a DELETE), the Gmail date lock cannot be bypassed from any wiring path, every mutation outcome is truthful, table actions are gated by the same rule the mutation layer enforces, scope containment, and the absence of any component importing from `src/client/pages/`.
- Follow-up fixes GREEN: 39 pass, 0 fail. Build success. The 404 rule is now a single shared classifier, and the previously misleading assertion was proven to fail when its guard is removed.
- Parent spot check after the follow-up fixes: 39/39.
- Full suite was not run; only `test/react-vite-foundation.test.js` was exercised.
- Known limitation: no browser, DOM, live server, or database round-trip was exercised. Modal and focus behavior, imperative dialog calls, and the server's 404 branching were verified by reading code and by stubbing, not by observation. This harness has no DOM environment, so several wiring assertions are necessarily source-text.

## Delivery
- 2026-09-17: Delivered as five source-only commits on `framework_react`, each verified to typecheck in isolation in a temporary worktree:
  - `6c71787 feat(movements): add the movement mutation contract and pure helpers`
  - `51c3b95 feat(movements): add the pure removal lifecycle`
  - `c1adfc1 feat(movements): add the create manual expense dialog`
  - `c85d431 feat(movements): add the edit and remove movement dialogs`
  - `8f106e8 feat(dashboard): wire movement create, edit, and removal`
- The user explicitly required the commits to carry **no test files**. The tests therefore remain uncommitted in the working tree: five new `test/movements-*.test.js` files plus a 77-line removal in `test/react-vite-foundation.test.js`. They are not lost, but they are not yet in history.
- 2026-09-17: Pushed to `origin/framework_react` as the fast-forward range `3ce6235..8f106e8` (guarded push; no force). Zero commits remain unpushed.
- The tests were **not** pushed, because they are not in any commit: they remain local in the working tree by the user's explicit choice.
- Full suite baseline: 152 tests, 145 pass, 7 fail. The 7 failures are **pre-existing** and confined to `test/dashboard-runtime.test.js` and `test/dashboard-period.test.js`, which exercise only legacy `public/*` modules and never reference `src/client`.

## Follow-ups outside this slice
- Consider richer read-only row explanations beyond the current short accessible label.
- Consider delivering the purely additive stylesheet block as its own cosmetic change, to thin the C2b review.

## Next step
Decide what to do with the uncommitted tests: commit them in a separate `test(movements)` commit and push, keep them local, or discard. The five production commits are already on `origin/framework_react`. Do not reapply the WIP snapshot.
