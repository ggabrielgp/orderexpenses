# Category Administration and Counterparty Rules (React)

## Objective
Continue the React migration on `framework_react` with the settings/catalog foundation: category
administration end to end in React, then counterparty category rules. The legacy dashboard currently
owns both, and the React header tells users to go back to it for category management
(`src/client/pages/DashboardPage.tsx:393-395`) — a statement this work makes false.

## Reconciled unit split
Exploration (`public/app.js`, `public/app.html`, `src/server.js`, `src/client/**`) established that the
two features are not equally specified and must be separate review units:

- **CA-1 / CA-2 — Category administration.** Has an authoritative legacy implementation to mirror
  (`public/app.html:334-369`, `public/app.js:621-707`) and a complete server contract. Unblocked.
- **CA-3 — Counterparty category rules.** Has **no reachable legacy UI**: `saveCounterpartyCategoryRule`
  (`public/app.js:3343-3366`), `renderCounterpartySpendSection` (`:3148-3220`), `counterpartyCategoryOptions`
  (`:3246-3248`) and `openCounterpartyDetailModal` (`:3368-3391`) are all unreachable dead code, and
  `GET /api/counterparty-rules` is never fetched anywhere in `public/`. It therefore carries product
  decisions that cannot be resolved by mirroring legacy. Deferred to its own unit.

## Product decisions
- **Defaults are listed and protected.** `GET /api/categories` always merges the 12 builtins
  (`src/server.js:751-771`, flagged `builtin: true`). React mirrors legacy: builtins render as
  `Predeterminada` with no delete control; custom rows render `Personalizada` with delete.
- **Saving a builtin's name overwrites it into a custom category.** This is the existing server
  contract (`src/server.js:762-769`) and legacy behavior; the client adds no protection and must not
  pretend otherwise. The row then honestly reports `Personalizada`.
- **Delete confirmation is truthful, not cascading.** Legacy asks a bare
  `confirm('¿Eliminar la categoría X?')` and the server deletes only the `categories` row
  (`src/db.js:507-516`): existing movements keep their stored category string and counterparty rules
  are untouched. React mirrors the single-step confirmation but states that consequence in the copy
  instead of implying reassignment. This is a truthfulness fix in the same spirit as the removal
  dialog, not a behavior redesign.
- **No rename affordance.** Legacy's form is create/overwrite by name only; a rename would require a
  server contract change, which is out of scope.
- **Native `<dialog>` + `showModal()`**, matching the legacy settings modal and the already-shipped
  React dialogs.
- **Settings entry point:** a `Configuración` trigger in the dashboard header actions, mirroring where
  legacy hosts it (account menu → `Configuración` modal, `public/app.html:64-67`, `public/app.js:342`).
  React has no account menu yet; this trigger is designed to be absorbed by that later unit, not to
  preempt it.
- **Demo is protected structurally, not by a guard function.** React has no `guardDemoMutation`
  equivalent; `DemoDashboardPage` is a separate read-only tree. The settings surface is therefore
  reachable only from the authenticated `AccountDashboardRoute` tree and must never be mounted in
  `DemoDashboardPage`.

## Scope
- Typed client functions and response types for `GET`/`PUT /api/categories` and
  `DELETE /api/categories/:name`; no counterparty-rule client functions in this unit (they would ship
  as dead code before CA-3).
- A pure decision module owning validation, catalog merge/derivation, and the mutation submitter, so
  invariants stay provable without a DOM.
- An accessible `Configuración` dialog: catalog list with builtin/custom distinction, create/overwrite
  form (name + color), delete with truthful confirmation, and success/error status.
- Replacement of the now-false header copy that redirects users to the legacy dashboard.
- Scoped `react-settings-*` / `react-category-*` styles in `src/client/styles.css`.

## Non-goals
- No server, database, or contract changes; all six endpoints already exist at HEAD.
- No counterparty rules UI, typed client, or `counterpartyKey` typing in this unit (CA-3).
- No cascade delete, no movement reassignment, no rename, no per-row color edit.
- No account-menu, profile/settings-modal, or account-management migration (map item 6).
- No bulk assignment, filters, analytics, cycle closure, or legacy-asset retirement.
- No reapplication of the WIP snapshot `735cbe7`.

## Constraints
- TDD mode: **strict**; source: prior explicit user instruction; runner `node --test` through
  `npm test -- test/react-vite-foundation.test.js`. Build check: `npm run build`.
- **Test delivery policy (user-owned, restated):** production commits are source-only. The new tests are
  written and must pass locally, but are **not** committed. Consequence to keep visible: the tracked
  `test/react-vite-foundation.test.js` keeps drifting from shipped behavior, and the suite baseline is
  red by explicit user decision (12 failures at HEAD: 7 legacy dashboard tests plus 5 stale React
  assertions). This unit must not increase that count.
- Test style is authoritative: `vite.ssrLoadModule` for pure modules, `renderToStaticMarkup` for
  markup, `readFile` + regex only where nothing behavioural is possible, and `globalThis.fetch` stubs
  asserting exact method, path, and body.
- `getJson` in `src/client/api/client.ts` does not read the server `{error}` body; server messages are
  Spanish and user-facing, so a mutation that must surface `"color inválido"` needs its own fetch path.
- Demo mode must remain write-free by construction.
- UI copy in Spanish; identifiers, comments, and commit messages in English.

## Acceptance criteria
- Opening `Configuración` loads the merged catalog; builtins are listed, labelled `Predeterminada`, and
  offer no delete control; custom rows are labelled `Personalizada` and can be deleted.
- Creating a category validates a non-empty name and a valid color before any request, and reports the
  server's own message on rejection.
- Deleting asks for confirmation whose copy states that existing movements keep the category and that
  nothing is reassigned.
- Only one mutation is in flight at a time; the list refreshes after a successful mutation; a failed
  mutation leaves the input editable and never claims success.
- The dashboard no longer tells users that category management lives in the legacy dashboard.
- Focused tests and `npm run build` pass; no file outside the allowed surfaces changes.

## Allowed edit surfaces
- `src/client/api/client.ts`
- `src/client/api/types.ts`
- `src/client/components/settings/CategorySettingsDialog.tsx` (new)
- `src/client/components/settings/categorySettings.ts` (new)
- `src/client/pages/DashboardPage.tsx`
- `src/client/styles.css`
- `test/react-vite-foundation.test.js`

## Tasks
- [x] CA-1 — Category API layer: typed client functions (`upsertCategory`, `deleteCategory`) and response types. `getJson`/`getCategories` untouched; a scoped `throwServerError` is used only by the new mutations so the server's own Spanish message survives.
- [x] CA-2 — Pure `categorySettings` module: draft validation mirroring the server's trim/collapse/slice-40 rule, display-row derivation, truthful delete confirmation, catalog reducer, single-in-flight submitter reusing the already-exported `acquireInFlightLock`.
- [x] CA-3 — Accessible `Configuración` dialog: merged catalog, `Predeterminada`/`Personalizada` labels, create/overwrite form, inline truthful delete confirmation, three truthful status states.
- [x] CA-4 — Header trigger plus the single dialog mount inside the authenticated tree, replacement of the false legacy-redirect copy, and scoped `react-settings-*` / `react-category-*` styles.
- [x] CA-5 — Focused strict-TDD tests, `npm run build`, independent verification, and a scoped fix round for the two findings it produced.
- [ ] CA-6 — Counterparty category rules (separate unit; blocked on product decisions).

## Verification evidence
Independent read-only verification (gentle-ai-verify), reproduced twice:

- Focused file: **24 tests, 19 pass, 5 fail**. The five failures are the pre-existing stale assertions, unchanged by name and neither repaired nor weakened; `git diff` on the test file is `556 insertions, 0 deletions` (single append-only hunk), so no existing assertion was modified.
- `npm run build` green (`tsc -b && vite build`, 57 modules). `dist/` is gitignored, so the build leaves no tracked change.
- `git status` shows no change outside the allowed surfaces; nothing staged, committed, or stashed.
- 15 verification points PASS: scope discipline, existing callers unaffected, exact request contracts, server-message surfacing, validation before any request, single in-flight mutation, builtin protection, truthful delete copy, truthful failure/refresh states, demo protection, false copy removed, real test evidence, build, type honesty, and house conventions.

### Findings raised and resolved
- **D1 (real, reachable).** A same-tick double submit dispatched a second mutation runner whose `finally` cleared `isMutating` while the owning mutation was still in flight, re-enabling the submit and delete controls and contradicting the in-flight comment. Fixed by replacing the `finally` with an explicit gate on the exported pure predicate `shouldClearCategoryMutationPhase` (`busy` never clears the phase; every other outcome does), plus a `.catch` that maps a throwing injected submitter to a `failed` outcome so no path can leave the phase stuck. No duplicate request was ever sent; the lock always refused it.
- **D2 (claim mismatch, unreachable from this server).** Protection was derived from `builtin === true`, so a row with no flag became deletable. Now only an explicit non-builtin is deletable, and the label is three-way so it can never disagree with the control: `true` → `Predeterminada`, `false` → `Personalizada`, unknown → `Protegida`. The unknown branch is defensive: `mergeCategories` always stamps the flag.

## Open follow-ups (out of scope, recorded)
- **Language consistency:** a 404 surfaces the server's English `"Category not found"` inside an otherwise Spanish status line. Passing the server message through is the specified behavior; translating it client-side would require a message-mapping layer.
- **Accessibility:** the inline confirmation uses `role="group"` rather than an announced confirmation surface, and the surface has three parallel live regions that can double-announce. Native `<dialog>` already restores focus on close.
- **Harness limitation:** the dialog's state machine (release-before-status ordering, the `busy` early return, the closed/open transition) is not behaviourally testable here because the harness has no DOM. The invariant is proven as a pure predicate and linked to the component by a source assertion; a DOM harness would be needed to close that gap.
- **No live round trip:** no browser, DOM, live server, or database verification was performed. `showModal()`/focus behavior and the real `PUT`/`DELETE` category round trips remain unexercised.
- **Red baseline:** the suite stays red by explicit user decision (source-only commits). Of the 12 failures at HEAD, 7 are legacy (`test/dashboard-period.test.js` x2, `test/dashboard-runtime.test.js` x5) and 5 are stale React assertions that contradict already-delivered behavior.

## Review workload note
Production impact is **971 added lines** (269 in modified tracked files + 702 in the two new settings files) plus 556 test lines, which is ~2.4x the ~400-line review target. It is one coherent vertical feature (list, create/overwrite, delete) rather than a multi-area change, so it was not silently split; the delivery shape is a user decision. Cheap split options if a smaller bite is wanted: the Readable reviewer's CSS block (139 lines) as a separate cosmetic commit, or `CategorySettingsRow` plus the catalog reducer as their own unit.
