# Fix Vite case-colliding React modules

## Objective and problem
Restore the React landing page at `/`. On this Windows worktree Vite resolves imports of `CycleCalendar.tsx` to the case-insensitive `cycleCalendar.ts` helper, which lacks the named component export. The same basename collision occurs for `AccountMenu.tsx`/`accountMenu.ts` and `CategoryDistribution.tsx`/`categoryDistribution.ts`; repairing only the first still leaves startup imports broken.

## Scope and constraints
- Give the three UI components distinct basenames; leave pure `.ts` helpers and UI behavior unchanged.
- Update component consumers and any test references to the renamed modules.
- Do not alter the wider Windows test harness or unrelated application behavior for this fix.
- Authorized by user request to fix the blank page. No push/PR/merge. No commit without explicit request.
- TDD mode: unconfigured (`.pi/settings.json`); ordinary checks. Exact runners: `npm run build`, `npm test`; runtime check: live Vite-transformed imports plus root response.
- Forecast: three file renames plus narrow import/test changes, under ~100 authored changed lines excluding rename detection. Delivery strategy: ask-on-risk. Route: delegated writer for multi-file implementation; delegated verifier for commands.

## Tasks
- [ ] T1 — Remove the three case-insensitive module basename collisions and update imports and targeted test references. All three UI components now have distinct basenames; consumers and the five direct test references are updated. Live Vite transforms point to the new `.tsx` files and the production build passes. State: implementation verified structurally, kept open because the full test suite fails.
- [ ] T2 — Verify the page startup and applicable checks, distinguishing pre-existing Windows harness failures from regressions. A temporary Vite server returned 200 for `/` and transformed modules; actual browser mount was not observed. `npm run build` passed. `npm test` failed: 68 passed, 77 failed (many `C:\\C:\\Code` config-path errors and some text assertions). State: pending live browser check and full-suite resolution.
- [ ] T3 — Blocker: decide separately whether to authorize repair of the existing Windows test harness; do not expand this blank-page fix into harness changes without approval. State: pending user decision.

## Acceptance and progress
`/` should load the React module graph without a missing named component export. Three renamed UI components are byte-identical copies of their originals; Vite transformed their imports to the correct `.tsx` files, `/` returned 200, and `npm run build` passed (chunk-size warning only). No browser DOM mount was observed. The full suite remains red with 77/145 failures; its repeated Windows `file URL .pathname` conversion in `test/react-vite-foundation.test.js` is independent of component renames, while text assertion failures need separate triage. `git diff --check` passed. No work-unit commit was created because the user did not request one.

## Next step
User restarts `npm run dev` and confirms the landing renders in browser. Report the failing suite without claiming it passes; seek separate approval before touching the Windows test harness.
