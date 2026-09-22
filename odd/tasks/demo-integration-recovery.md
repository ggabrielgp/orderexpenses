# Canonical Demo Integration Recovery

## Objective
Preserve the accumulated dirty React migration as a local recoverable snapshot, then make the verified isolated demo commit the clean `framework_react` baseline for subsequent separated migration units.

## Rationale
The published demo commit `2eda507` is the user-selected canonical implementation. The prior `framework_react` worktree had incompatible, broad uncommitted work, so direct cherry-picking would have risked losing or silently merging unrelated changes.

## Scope
- Preserve the previous dirty main-worktree migration content as a local WIP recovery commit without pushing it.
- Make `2eda507` the clean `framework_react` baseline locally.
- Do not reapply WIP or implement the next product slice until it is separately authorized.

## Constraints
- Do not push the WIP snapshot or `framework_react` without explicit authorization.
- Keep the isolated demo implementation canonical for conflicting demo files.
- No destructive Git operation, reset, stash, or history rewrite.

## Tasks
- [x] CDI-1 — Create a local WIP recovery commit containing all current main-worktree changes and untracked files.
  **Evidence:** `735cbe7 chore(wip): snapshot React migration before demo integration`; 12 files, 4,121 additions, 93 deletions; not pushed.
- [x] CDI-2 — Restore clean `framework_react` and apply `2eda507`.
  **Evidence:** `07ab371 feat(demo): add isolated read-only React route`; clean worktree after cherry-pick; not pushed.
- [ ] CDI-3 — Map and authorize the next separated React migration unit.
  **Evidence:** read-only mapping recommends authenticated financial-period summary and setup before mutation-heavy slices; implementation authorization is pending.

## Progress
- 2026-09-16: User selected `2eda507` as canonical and explicitly authorized a local-only WIP recovery commit.
- 2026-09-16: Created local WIP snapshot `735cbe7` and returned the main worktree to clean `framework_react`.
- 2026-09-16: Cherry-picked the canonical demo locally as `07ab371`; no push occurred.

## Verification evidence
- The demo commit was previously verified by a writer, independent verifier, and parent focused-test spot check (17/17); build passed.
- `framework_react` had clean Git status immediately after the cherry-pick, before this intentionally uncommitted ODD artifact was recreated.

## Next step
Obtain explicit authorization for the next bounded unit: authenticated financial-period summary and setup flow, excluding categories, bulk edits, manual movements, deletion, and the WIP reapplication.
