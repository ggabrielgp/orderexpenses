# Income-only period edit without refetch

## Goal
When editing an existing period and changing only its stored monthly income, persist the income with the existing server PUT, reuse the already loaded transactions, and recompute the balance/income views without a cycle or transaction GET.

## Scope and constraints
- Compare normalized selected-period bounds and parsed income amount, not form strings. Reuse only a currently ready dashboard whose selected period still matches the persisted PUT response; date changes still require the existing cycle-first fresh reload.
- Reuse the authoritative returned cycle, including completion metadata. Preserve transactions and warning. Update both ready state and session dashboard cache on successful income-only save; failed PUT does not change either. If reuse becomes unsafe because state changed, fall back to the existing fresh reload and saved-but-stale warning on failure.
- No backend changes, no new expense requests, no invented local persistence. Preserve unrelated concurrent changes. User previously requested no tests: do not run tests/build; source readback and structural diff check only. No commit without explicit authorization.

## Tasks
- [x] IC-1 — Submitter supports an optional prepared reuse callback after an authoritative PUT, preserving validation, lock, failure/outcome and normal reload fallback. Route: delegated writer (`cycleSettings.ts`), source readback confirmed; tests/build skipped.
- [x] IC-2 — FinancialSummary reuses current ready transactions and warning, publishes server-returned cycle and writes identity-bound session cache only for changed parsed income with same normalized period. Changed dates/unsafe state still reload; post-unmount fallback reload and notice writes are guarded. Route: delegated writer and targeted correction; source readback plus independent read-only final audit found no concrete blocker; tracked diff check passed. Tests/build/browser network check skipped; no commit.

## Acceptance
- Income-only edit performs one PUT, zero financial-cycle/transaction GETs, rerenders income/balance from existing expenses, and refreshes session cache.
- Date changes still fetch the new period; failed save leaves state/cache unchanged; a needed failed reload keeps the saved-but-stale warning; no extra request for mutation helpers elsewhere.
- No tests/build per user preference; browser/network observation remains unverified until authorized. No commit.

## Progress
- Read-only scout mapped dialog validation, submitter, FinancialSummary, authoritative PUT response, and session cache.
- IC-1 and IC-2 completed by source readback. Independent audit found a post-unmount GET risk and later a stale notice-setter risk; both were guarded and final re-audit found no concrete blocker. Tracked diff check passed. No tests/build/typecheck/browser network check per user; the literal request count is not runtime-verified. Shared worktree changes preserved, no commit. Next: optional browser network inspection if authorized.
