# Financial-Cycle Controls (React)

## Objective
Continue the React migration on `framework_react` with the financial-cycle controls that the legacy
dashboard owns today: editing or reopening the configured cycle, completing/closing it, and the
movement filters. This is the next group after the settings/catalog foundation delivered as
`3b527d1` (categories) and `68ba41c` (counterparty rules).

## Reconciled unit split
Exploration of `public/app.js`, `public/app.html`, `public/financial-cycle.js`, `src/server.js`, and
`src/client/**` produced three units, only the first of which starts now:

1. **Unit 1 — Configured-cycle edit/reopen (this document's tasks).** In the period-scoped React
   surface, "navigation" and "edit" are the same act: there is no month axis to walk. Deliverable: a
   ready-state control that reopens the configured period and edits its dates and income through
   `PUT /api/financial-cycle`, then reloads.
2. **Unit 2 — Cycle completion/closure.** A client function for `POST /api/financial-cycle/complete`,
   a confirmation, and truthful notices for its four outcomes. Separate because it is a distinct
   endpoint with a Gmail-sync side effect and a four-way outcome union the edit unit does not need.
3. **Unit 3 — Movement filters (deferrable).** Pure filter module plus filter state on the movements
   view. Separate because in period mode it has no server contract to satisfy and can land alone.

Order: Unit 1 → Unit 2 → Unit 3.

## Headline findings that shape this plan
- **The complete/close flow does not exist in the legacy UI.** `/api/financial-cycle/complete` is
  implemented and tested server-side (`src/server.js:408-472`) but has **zero UI consumer**: grepping
  `public/` for `complete|complet|cerrar|finalizar` returns only unrelated strings, and
  `financial-cycle/complete` appears only in `src/server.js` and its test. Unit 2 is therefore
  greenfield UI over an existing capability, not a parity port.
- **Month navigation and a configured cycle are mutually exclusive in legacy.**
  `setPeriodControlMode` (`public/app.js:1013-1017`) hides the month picker once a cycle is configured,
  and the picker only ever offered `Este mes` and `Mes anterior`
  (`selectableMonthOptions`, `public/app.js:1031-1042`). The remaining "navigation" is reopening the
  cycle dialog through `#reopenFinancialCycle` → `Cambiar período` (`public/app.html:120-129`).
  Mirroring month navigation into React would contradict the period-scoped model, so this plan does not
  do it; the honest substitute is the edit/reopen control.
- **`completedAt` is advisory.** Nothing on the server blocks an edit, a manual movement, or a
  re-synchronization because a period is completed (`src/server.js:403-407`, `:162-170`, `:286-291`),
  and no code path ever clears it: `upsertFinancialCycleSettings` preserves it on a same-range edit
  through `COALESCE(excluded.completed_at, financial_periods.completed_at)` (`src/db.js:198`), while a
  **different range creates a new key whose `completed_at` is `NULL`**.

## Server contracts (verified by reading)
- `GET /api/financial-cycle` → 200 `{selectedPeriod, incomeAmount, completedAt}`
  (`src/server.js:398-402`, `emptyFinancialCycle` `:507-509`).
- `PUT /api/financial-cycle` body `{selectedPeriod, incomeAmount}` → 200 row; 400
  `{error:{code:"invalid_input",message,field}}`; same-origin required (403).
  Validation: `ReviewPeriod` shape with `startDate < endDateExclusive`, and `incomeAmount` must be
  `null` or a positive safe integer (`validateFinancialCycle`, `src/server.js:476-498`).
- `POST /api/financial-cycle/complete` body **`{period}`** (not `selectedPeriod`) → 200
  `{outcome:"success", scanned, transactions, completedAt}`; 207 `{outcome:"partial", failedCount,
  retryable:true, completedAt:null}`; 409 `{outcome:"disconnected", action:{label,href}}`; 502
  `{outcome:"error", retryable:true}` (`src/server.js:408-472`).
- **Completion requires a successful Gmail synchronization.** The handler returns 409 when
  disconnected and 207 without writing anything when a query fails; only then does it write
  `completed_at` (`src/server.js:418-453`). One row is upserted into `financial_periods`
  (`src/db.js:176-181`), and completion is idempotent because an existing `completedAt` is reused
  (`src/server.js:452`).
- `GET /api/transactions` is dual-mode: period mode (`startDate` + `endDateExclusive`) **ignores**
  `month` and `payTiming`; month mode uses both (`src/server.js:134-149`, `financialCyclePeriodFromQuery`
  `:500-505`). React only ever uses period mode (`src/client/api/client.ts:68-74`).
- Known hazard, out of scope but worth recording: supplying **only one** boundary makes
  `financialCyclePeriodFromQuery` throw a `TypeError` without a `status`, which the top-level catch
  turns into a **500** instead of a 400 (`src/server.js:500-505` with `:338-342`).

## Product decisions
Resolved by the migration principle (mirror legacy, stay truthful):
- **Reopen copy mirrors legacy:** the ready-state control says `Cambiar período`, as
  `public/app.html:120-129` does.
- **The edit dialog reuses the shipped conventions:** native `<dialog>` with `showModal()`, a pure
  decision module, a single in-flight lock, and truthful notices; the fields are the same three the
  setup form already uses (`#financial-cycle-start-date`, `-end-date`, `-income`).
- **Validation copy mirrors the wizard** (`public/financial-cycle.js:44-74`): `Selecciona la fecha
  Desde.`, `Selecciona la fecha Hasta.`, `La fecha Hasta debe ser igual o posterior a la fecha Desde.`,
  `Ingresa un monto entero positivo en CLP.`
- **No client-side lock on a completed period.** The server permits the edit; inventing a client-side
  prohibition would be a behavior change dressed as safety.
- **A range change loses the completion record, and the UI must say so** before saving, because that is
  what the server does and it is invisible otherwise.

PENDING USER DECISION (recorded as asked, before any implementation):
- Whether editing a **completed** period is offered freely, or requires an explicit acknowledgement.
- Whether the React surface shows that a period is completed at all, and in what form.

RESOLVED by the user before implementation:
- **A completed period is edited freely, with the consequence stated inside the dialog.** `Cambiar
  período` always opens; no extra acknowledgement step. When the cycle carries `completedAt`, the dialog
  says the period is closed, and when the draft range differs from the configured range it states
  before saving that the closure record does not carry over to the new range, because the server keys
  periods by range and creates the new one with `completed_at = NULL` (`src/db.js:176-181`, `:198`).
  When the range is unchanged the record is preserved and the dialog says so.
- **The summary shows a discrete closure mark** next to the configured period when `completedAt` is
  set. It is informational: it must never imply that the period is locked, because nothing on the
  server blocks edits, manual movements, or re-synchronization. The mark's date must not be falsified
  by a timezone shift, and its formatting must be deterministic in tests.
- **The completion flow is built in Unit 2 under the current server contract**: `Cerrar período`
  synchronizes Gmail and only then records the closure; a disconnected account (409) or a partial
  synchronization (207) writes nothing and is reported with exactly that meaning.
- **Unit 2 details resolved by the same principle:** the confirmation states that closing reads the
  mailbox and records the closure only if the synchronization completes, so the user consents to the
  read rather than discovering it; a 409 points the user at the existing Gmail connect control instead
  of building a second link, because the React surface deliberately gates connecting behind its consent
  dialog and the server-provided `href` would bypass it; a successful closure reloads the period so the
  closure mark appears; and the success copy shows the `completedAt` the server returned, which is the
  original timestamp when the period was already closed, because completion is idempotent.
- **Delivery is authorized per unit:** every unit that passes independent verification is committed as
  one source-only vertical commit and pushed to `origin/framework_react`, without asking again. A unit
  with an unresolved severe finding is reported before any commit.
- **Definition of done, chosen by the user: full functional parity first, legacy retirement last.** No
  user-facing capability may be lost at any point, so React becomes the canonical root and the legacy
  assets are deleted only after analytics, account settings, and filters exist in React and a
  repository-wide reference audit passes.

## Scope (Unit 1)
- A pure module owning the edit draft (derived from the configured period and income), validation, the
  completion-consequence copy, and a submitter with injected dependencies and a single in-flight lock.
- An accessible edit dialog: dates, income, `Guardar cambios` / `Cancelar`, truthful status, and the
  completion consequence when it applies.
- A `Cambiar período` control in the ready state that opens it, plus a reload of the configured period
  through the existing `FinancialDashboardHandle.reload` after a successful save.
- Scoped styles following the `react-` prefix convention.

## Non-goals (Unit 1)
- No cycle completion and no `POST /api/financial-cycle/complete` client function (Unit 2).
- No movement filters, bulk selection, or bulk category assignment (Units 3 and the table unit).
- No month navigation: the React surface is period-scoped and legacy hides the month picker under a
  cycle.
- No income-candidate loading, pay-timing filter, budget preferences, or remaining-balance metric.
- No server, database, or contract changes of any kind.
- No changes to the landing page, account menu, analytics, or legacy asset retirement.
- No reapplication of the WIP snapshot `735cbe7`.

## Constraints
- TDD mode: **strict**; source: prior explicit user instruction; runner `node --test` through
  `npm test -- test/react-vite-foundation.test.js`. Build check: `npm run build`.
- **Test delivery policy (user-owned):** production commits are source-only; new tests are written and
  must pass locally but are **not** committed.
- Baseline for this unit: the focused file is **31 tests, 26 pass, 5 fail**, where the 5 are the stale
  assertions that contradict delivered behavior. They must stay untouched and failing, and this unit
  must not increase that count. The 7 legacy failures live in `test/dashboard-period.test.js` (2) and
  `test/dashboard-runtime.test.js` (5).
- House conventions to preserve: pure module plus injected submitter
  (`createCategoryMutationSubmitter`, `categorySettings.ts:274-330`); the shared
  `acquireInFlightLock`/`releaseInFlightLock`/`InFlightLockRef` from
  `CreateManualExpenseDialog.tsx:32-48`; truthful notices with a stale variant; `syncNativeModalDialog`
  for `<dialog>`; `react-` class prefixes; and tests that assert pure-function behavior,
  `renderToStaticMarkup` markup, and source structure — the harness has no DOM.
- UI copy in Spanish; identifiers, comments, and commit messages in English.

## Acceptance criteria (Unit 1)
- The ready state offers `Cambiar período`, which opens a dialog prefilled with the configured period's
  visible inclusive end date and its income.
- Saving sends `PUT /api/financial-cycle` with the exact `{selectedPeriod, incomeAmount}` shape the
  server validates, produces nothing but a truthful status on failure, and reloads the period on
  success.
- Validation happens before any request and releases the in-flight lock; only one mutation is in flight.
- A save that changes the period range states, before it happens, that the completion record does not
  carry over; a save that keeps the range states that the record is preserved.
- When the configured period is completed, the summary shows a discrete closure mark that does not
  imply a lock, whose date is not shifted by the viewer's timezone.
- No file outside the allowed surfaces changes, the 5 stale assertions stay untouched, and
  `npm run build` passes.

## Allowed edit surfaces
- `src/client/api/client.ts`
- `src/client/api/types.ts`
- `src/client/components/financial-cycle/cycleSettings.ts`
- `src/client/components/financial-cycle/FinancialCycleEditDialog.tsx`
- `src/client/pages/DashboardPage.tsx`
- `src/client/styles.css`
- `test/react-vite-foundation.test.js`

## Tasks
- [x] FC-1 — Pure `cycleSettings` module: draft from the configured period, validation, completion-consequence copy, single-in-flight submitter.
- [x] FC-2 — Accessible `Cambiar período` edit dialog with dates, income, and truthful status.
- [x] FC-3 — Ready-state trigger, reload wiring through the dashboard handle, closure mark, and scoped styles.
- [x] FC-4 — Focused strict-TDD tests, `npm run build`, and independent verification plus one fix round.
- [x] FC-5 — Unit 2: cycle completion client function, confirmation, and the four-outcome notices.
- [ ] FC-6 — Unit 3: movement filters over the period-scoped table.

## Unit 2 delivery and verification record
- Delivered as commit `66f9675 feat(cycle): add React period closure` (412 insertions, 5 deletions across `client.ts`, `types.ts`, `cycleCompletion.ts`, `CompleteCycleDialog.tsx`, `DashboardPage.tsx`, `styles.css`), pushed with the earlier units as `bf602bb..66f9675` to `origin/framework_react`. This was the first unit to land **inside** the ~400-line review target.
- The four server outcomes are returned as data rather than thrown, so 207 and 409 can honestly state that the period stays open. The client corroborates every branch: the status selects it, the body must agree, and six contradiction paths throw instead of being read as a closure.
- Independent verification, reproduced twice, plus two correction rounds. Findings raised and resolved:
  - **The 502 copy asserted a false negative.** The server's catch wraps the synchronization, the read, *and* the write, and `completeFinancialCyclePeriod` upserts before it reads back, so a 502 with `completedAt: null` can follow a closure that was applied. The copy now names no failing step and never denies a closure it cannot rule out. The same false premise was purged from every comment and doc string that repeated it.
  - **The refusal copy contradicted itself**, asserting both that closing failed and that the record is unconfirmed. It now states only the unknown record and points at reloading.
  - A dead exported request type was removed (its `period` body-key knowledge moved to the call site); an overstated test comment was corrected; the unreadable-body contradiction path gained a test; and the pending copy now names the honest escape from a wait that cannot be cancelled.
- Accepted residual: with no `AbortSignal` and no timeout, a request that never settles leaves the dialog open until the page is reloaded. Not cancelling is correct (an abort would neither stop the server's sequential Gmail work nor prevent a written closure), and lifting the outcome to the dashboard level is deliberately deferred.

## Unit 3 scope (movement filters)
The period-scoped table has no filters today. Legacy offered a category filter over already-loaded rows and a bulk bar, and neither the kind, direction, nor status filter existed at all. Product decisions still open: whether the category filter is in-memory like legacy or persisted, and whether any filter should reach the server (in period mode the server ignores `month` and `payTiming`, so category is the only candidate and the endpoint does not accept it). Bulk selection and bulk category assignment belong to the analytics/table unit, not here.

## Remaining migration map after this group
Order chosen by the user: full parity first, legacy retirement last.
1. Movement filters (Unit 3 here).
2. Analytics: KPIs, daily spending chart, category distribution and detail, counterparty section and drill-down, budget and income detection. Large enough to need its own exploration and split.
3. Account: account menu, profile/settings surface, and the consolidation of the settings entry points this plan deliberately left split.
4. Canonical React root plus legacy retirement: serve React at `/`, delete the tracked legacy assets, and run a repository-wide reference audit — only after parity.

## Unit 1 delivery and verification record
- Delivered as commit `bf602bb feat(cycle): add React configured-cycle edit and reopen` (713 insertions, 30 deletions across `cycleSettings.ts`, `FinancialCycleEditDialog.tsx`, `DashboardPage.tsx`, `styles.css`), pushed with the earlier units to `origin/framework_react`.
- Independent verification, reproduced twice: the closure-mark timezone seam formats the instant in the viewer's zone with an explicit test seam; the closure copy was confirmed against `src/server.js:403-407` (nothing blocks edits) and the range-change copy against `src/db.js:176-203`; the payload shape, the inclusive-to-exclusive conversion through the shared `ReviewPeriod`, and the legacy validation copy were all confirmed.
- Findings raised and resolved: the changed-range copy was **false** when the user moved back to a previously completed range (fixed to state that the current closure does not transfer while the new range keeps whatever record it already had); the range warning was shown for drafts validation would never send (now gated on the same validation the submitter runs); the income rule existed twice (now a single owner in the cycle module, shared with the setup form); and a test comment overstated what its assertion proved (the assertion is now independent of the implementation seam and the comment states the UTC-runner limit).
- Blast radius checked: the five lines deleted in `DashboardPage.tsx` are the ready-state heading, replaced by an extracted `FinancialPeriodHeading` with the same period prop; the five deleted in `styles.css` merge the cycle dialog into the shipped create-expense dialog selector list, with byte-identical declarations and no specificity change, so no other dialog can render differently.
- Known residual: the income-equivalence test compares the two entry points through a wrapper, so it detects call-site divergence but not drift of the shared parser; the pinned literals cover eight inputs. Accepted, not fixed.
- Review workload: 707 added production lines, ~1.77x the ~400 target. Split proposal if ever needed: the pure module alone, then dialog plus wiring plus styles.

## Unit 2 scope (cycle completion)
- Client function for `POST /api/financial-cycle/complete` with the **`{period}`** body key (`src/server.js:411-414`), plus a discriminated response type covering all four outcomes: 200 success, 207 partial, 409 disconnected, 502 error.
- A pure module owning the outcome reading and the notice copy, and a submitter with injected dependencies and a single in-flight lock.
- An accessible confirmation dialog, a `Cerrar período` control in the ready state, and a reload on success so the closure mark from Unit 1 appears.
- Non-goals: no server change, no "close without synchronizing", no retry loop, no background completion, and no movement filters.
