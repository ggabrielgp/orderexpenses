# Counterparty Category Rules (React)

## Objective
Complete the settings/catalog foundation of the React migration on `framework_react`: let the user
see and edit the counterparty category rules that the server already applies automatically when it
loads movements. This is task CA-6 of `odd/tasks/category-counterparty-admin.md`, split out as its own
review unit because it carries product decisions the legacy code cannot answer.

## Why this is not a parity port
Exploration established that the legacy dashboard has **no reachable** counterparty-rules UI:
`saveCounterpartyCategoryRule` (`public/app.js:3343-3366`), `renderCounterpartySpendSection`
(`:3148-3220`), `counterpartyCategoryOptions` (`:3246-3248`) and `openCounterpartyDetailModal`
(`:3368-3391`) are all unreachable dead code, and `GET /api/counterparty-rules` is never fetched
anywhere in `public/`. There is therefore no legacy behavior to preserve, only a server contract to
respect. Unlike the category unit, every user-visible shaping decision here is a product decision, not
a parity question.

## What the server does (source of truth)
- `GET /api/counterparty-rules` → `{ rules: [{counterpartyKey, displayName, category, createdAt, updatedAt}] }`,
  ordered `updated_at DESC, counterparty_key ASC` (`src/db.js:409-423`).
- `PUT /api/counterparty-rules` body `{counterpartyKey, displayName, category}`: an **empty category
  deletes the rule** and answers `{ok: true, deleted: true}` (`src/server.js:213-218`); otherwise it
  upserts and answers `{rule}`. `counterpartyKey` is required (400 `"counterpartyKey es obligatorio"`)
  and `displayName` defaults to the key when blank (`src/server.js:219`).
- `DELETE /api/counterparty-rules/:key` → `{ok: true}`, 404 `"Rule not found"` (`src/server.js:228-242`).
- Rules are applied by the server only when it **loads movements**
  (`applyStoredCounterpartyRules`, `src/movements.js:249-284`): a matching rule overwrites the
  movement's `category` and always sets `counterpartyKey`. Nothing is applied retroactively at write
  time, which is why the UI must reload the period to show the effect.

## Product decisions
- **List source: existing rules plus free entry** (user decision). The dialog lists the rules the
  server already stores and lets the user create or update one by typing a counterparty name and
  choosing a category. The observed-counterparty grid from the dead legacy code is **explicitly out of
  scope**: it would require per-counterparty aggregation and a decision about partially-quantified
  spend, which this unit does not take.
- **Clearing a rule uses the documented empty-category PUT path** (user decision implied by the server
  contract), presented to the user as `Sin categoría`. The dedicated `DELETE` endpoint exists, but the
  React surface does not get a second control that produces the same outcome, and no client function is
  added for it: an exported client function with no consumer would be dead code.
- **Saving reloads the period** (user decision). The server re-applies rules only on movement load, so
  a save without a reload would leave the user looking at a list that contradicts the rule they just
  wrote. The reload reuses the existing `FinancialDashboardHandle.reload`
  (`src/client/pages/DashboardPage.tsx:89-93`).
- **The reload outcome is reported separately and truthfully.** A saved rule plus a failed reload is two
  statements, matching the shipped convention for the movements and category surfaces: the write
  succeeded, and the list on screen may be stale. If no reload handle is available yet, the surface must
  say the movements could not be refreshed instead of implying they were.
- **The counterparty key is normalized client-side by mirroring the server.** The key stored in a rule
  must equal the `counterpartyKey` the server computes for movements (`normalizeCounterpartyKey`,
  `src/movements.js:294-301`: NFD accent strip, lowercase, trim, collapse whitespace), or the rule
  silently never applies. The mirror is guarded by a **divergence test that compares it against the
  real server function over a fixture set**, so a future change to either side fails the suite instead
  of failing silently in production. A true single source of truth would require the server to import a
  shared module, which is out of scope for this unit; the duplication is deliberate and test-guarded.
- **Entry point: a second header trigger with its own dialog.** The committed category dialog stays
  untouched: reworking it into a multi-section settings modal would churn already-verified code and
  break the source-linkage assertion its tests rely on. Consolidating both entries into one settings
  surface belongs to the account-menu unit (map item 6), which owns that decision.
- **Display name:** the user types the counterparty as it appears; the trimmed value is sent as
  `displayName` (falling back to the key when blank, as the server does), and the key is derived from
  the same input with the mirrored normalization.

## Scope
- Typed client functions and response types for the three counterparty-rule endpoints, minus the
  deliberately unused `DELETE` (see decisions).
- A pure decision module owning key normalization, draft validation, rule-row derivation, the clearing
  semantics, and a submitter with injected dependencies plus a single in-flight lock.
- An accessible `Reglas de contraparte` dialog: the stored rules with their current category, a
  create/update form (counterparty name + category select including `Sin categoría`), truthful status,
  and a truthful reload outcome.
- A header trigger, mounted only in the authenticated tree, wired to the dashboard reload handle.
- Scoped `react-counterparty-*` styles in `src/client/styles.css`.

## Non-goals
- No observed-counterparty aggregation grid, spend totals, or drill-down modal (dead legacy code).
- No `counterpartyKey` added to `FinancialTransaction`: the chosen list source does not need it.
- No server, database, or contract changes; all three endpoints exist at HEAD.
- No second delete control, no bulk rule editing, no rule-wins-over-manual precedence changes.
- No changes to the committed category administration dialog or its module.
- No translation of server messages (a 404 keeps the server's own English text).
- No account-menu, profile, analytics, filters, cycle-closure, or legacy-retirement work.
- No reapplication of the WIP snapshot `735cbe7`.

## Constraints
- TDD mode: **strict**; source: prior explicit user instruction; runner `node --test` through
  `npm test -- test/react-vite-foundation.test.js`. Build check: `npm run build`.
- **Test delivery policy (user-owned):** production commits are source-only. New tests are written and
  must pass locally, but are **not** committed. The tracked test file already carries uncommitted tests
  from the category unit, so "green" is judged per test, never by the file's exit code.
- Baseline of the focused file at the start of this unit: **24 tests, 19 pass, 5 fail**, where the 5 are
  the known stale assertions that contradict delivered behavior. They must stay untouched and failing.
  This unit must not increase that count.
- Test style is authoritative: `vite.ssrLoadModule` for pure modules, `renderToStaticMarkup` for
  markup, `readFile` + regex only where nothing behavioural is possible, and `globalThis.fetch` stubs
  asserting exact method, path, and body. The divergence test may import the server module directly,
  as the other server-facing test files do.
- UI copy in Spanish; identifiers, comments, and commit messages in English.
- Demo protection is structural: the trigger and dialog live only inside the authenticated tree and are
  never mounted by `DemoDashboardPage`.

## Acceptance criteria
- Opening the dialog lists the stored rules with their current category and a truthful empty state.
- Typing a name and choosing a category sends `PUT /api/counterparty-rules` with the derived key, the
  trimmed display name, and the chosen category.
- Choosing `Sin categoría` for an existing rule clears it through the empty-category PUT and the list
  updates accordingly.
- A blank counterparty name, or a name that normalizes to an empty key, is rejected before any request
  and leaves the lock free.
- Only one mutation is in flight; the lock is released after every outcome, including failures.
- A successful save triggers the period reload, and the surface reports the reload outcome truthfully,
  distinguishing "guardado y lista actualizada" from "guardado, pero no se pudo actualizar la lista".
- The mirrored key normalization is proven equal to the server's `normalizeCounterpartyKey` over a
  fixture set including accents, casing, surrounding and repeated whitespace, and an empty value.
- Focused tests and `npm run build` pass; no file outside the allowed surfaces changes; the 5 stale
  assertions are not modified.

## Allowed edit surfaces
- `src/client/api/client.ts`
- `src/client/api/types.ts`
- `src/client/components/settings/counterpartyRules.ts` (new)
- `src/client/components/settings/CounterpartyRulesDialog.tsx` (new)
- `src/client/pages/DashboardPage.tsx`
- `src/client/styles.css`
- `test/react-vite-foundation.test.js`

## Tasks
- [x] CR-1 — Counterparty-rule API layer: `getCounterpartyRules` and `upsertCounterpartyRule`, plus a discriminated response union so "saved" and "cleared" cannot be confused. No `deleteCounterpartyRule`: an exported function with no consumer would be dead code.
- [x] CR-2 — Pure `counterpartyRules` module: mirrored key normalization, draft validation, row derivation, list reducer, notice copy, a type-predicate phase gate, and a single-in-flight submitter reusing the exported `acquireInFlightLock`.
- [x] CR-3 — Divergence test comparing the mirror against the real `normalizeCounterpartyKey` from `src/movements.js` over a fixture set, with pinned literals on both sides.
- [x] CR-4 — Accessible `Reglas de contraparte` dialog: stored rules, free-entry form, `Sin categoría` clearing through the documented empty-category PUT, and truthful saved/cleared/stale states.
- [x] CR-5 — Header trigger mounted only in the authenticated tree, period reload injected from `FinancialDashboardHandle.reload`, and scoped `react-counterparty-*` styles.
- [x] CR-6 — Focused strict-TDD tests, `npm run build`, and three rounds of independent verification.

## Verification evidence
Independent read-only verification (gentle-ai-verify), reproduced three times across the unit and both fix rounds:

- Focused file: **31 tests, 26 pass, 5 fail**. The five failures are the committed stale assertions, unchanged by name; `git diff HEAD -- test/react-vite-foundation.test.js` is a single append-only hunk (1408 insertions, 0 deletions), so no committed assertion was modified.
- `npm run build` green (`tsc -b && vite build`, 59 modules). `dist/` and the `tsbuildinfo` files stay gitignored.
- `git status` shows no change outside the allowed surfaces; nothing staged; HEAD still `3b527d1`.
- The normalization mirror was confirmed **character-for-character identical** to `src/movements.js:294-301` (same NFD strip, same `\u0300-\u036f` range, same operation order), and the divergence test was confirmed genuine on all three counts: it imports the real server function, asserts equality over the fixture set, and pins literal expectations on both sides.
- The server-side clearing contract was confirmed against `src/server.js:213-218`: the surface sends an empty `category` and the copy claims nothing more than the rule being removed.

### Findings raised and resolved
- **D1 (real, low).** The placeholder sentinel `__sin_elegir__` could be submitted as a real category if the user re-selected the placeholder. Fixed with three gates: a `disabled` placeholder option, a change handler that coerces the sentinel to `null`, and a defensive validation refusal. Verification established that the **validation gate is the actual guarantee** and the other two are defence in depth.
- **D1b (real, low).** The original sentinel was an arbitrary reserved string, so a genuine category with that exact name was silently unsaveable. Fixed by making the sentinel collision-proof by construction: it exceeds the server's 40-character name limit, so it cannot be a fixed point of `normalizeCategoryName` (`src/server.js:773-778`) and therefore cannot be a stored category. A property test pins that invariant in both directions.
- **D2 (scope creep).** The unrequested per-rule `Editar` button and its `pickRule` handler were removed: free entry already satisfies the acceptance criteria, and the handler seeded the draft from `displayName` rather than the stored key, so a degenerate display name broke the edit-then-save round trip. Net reduction of the unit.
- **D5 (test quality).** The demo-protection test was regex-only although a behavioural render was available. Replaced with a `renderToStaticMarkup` assertion over the demo composition, with positive markers first and an in-test sensitivity control. A follow-up round removed a half-vacuous alternative (JavaScript identifiers cannot appear in rendered markup) and completed the control.

## Open follow-ups (out of scope, recorded)
- **No divergence test for `normalizeCategoryName`.** Unlike the counterparty key, the category-name rule exists only in `src/server.js`/`src/db.js` and is hand-copied in the property test, so server drift in the 40-character limit would pass. The collision-proof argument also depends on all 12 `DEFAULT_CATEGORIES` being fixed points of that rule: true today, guarded by no assertion, and `mergeCategories` stores the raw default constant.
- **Fixture-bounded divergence test.** The mirror equality loop samples a fixture set; a change confined to a codepoint range no fixture exercises would pass.
- **Reserved-sentinel cosmetic.** A genuine category named `Sin categoría` renders a second option with the same label as the clearing option (distinct values, no data loss).
- **Language consistency.** A 404 surfaces the server's English `"Rule not found"` inside Spanish UI copy; passing the server message through is the specified behavior.
- **Harness limitation.** No DOM, browser, live server, or database: the dialog's state machine, `showModal()`/focus behavior, and the real `PUT /api/counterparty-rules` round trip remain unexercised.

## Review workload note
Production impact is **935 added lines** (235 in modified tracked files, 1 deleted, plus 700 across the two new settings files), with roughly 851 test lines. That is ~2.3x the ~400-line review target, and the same shape as the category unit: one coherent vertical feature rather than a multi-area change. Cleanest split if a smaller bite is ever wanted: CR-1+CR-2+CR-3 (types, client, module, and their tests) as a foundation unit, then CR-4+CR-5 (dialog, wiring, styles) on top.
