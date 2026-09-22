# Account Menu and Settings Consolidation (React)

## Objective
Complete the remaining authenticated account surface before legacy retirement: expose the real profile in a keyboard-accessible account menu, then consolidate the verified category and counterparty-rule settings into one entry/surface without moving Gmail's already-verified connection state machine.

## Resolved product decisions
- No logout: parity does not invent a session endpoint. `Desconectar Gmail` remains Gmail-only.
- Settings use one unified entry/surface for profile, categories, and counterparty rules.
- Gmail connection, disconnection, status, and manual sync remain in the existing body panel; the account menu does not duplicate its state machine.
- Identity appears in both the header menu and the existing body `Sesión actual` card.
- The account menu renders the optional profile picture with a safe fallback; it must never request a new asset or expose tokens.

## Unit split
1. AC-1 — Account menu foundation: profile trigger/avatar, keyboard/outside/Escape behavior, and existing settings actions moved under the authenticated menu without changing settings internals.
2. AC-2 — Unified settings surface: one settings entry with profile, category administration, and counterparty rules; preserve existing mutation contracts and demo protection.
3. AC-3 — Focused tests, build, independent verification, and source-only delivery.

## Non-goals
- No logout or session API changes.
- No Gmail panel relocation or duplicated sync/disconnect state.
- No account deletion, email change, or legacy retirement in this feature.
- No changes to server or database contracts.

## Constraints
- Strict TDD: `node --test`, focused React file, and `npm run build`.
- Production commits are source-only; focused tests remain local and uncommitted per user policy.
- Demo remains structurally read-only and never mounts account/settings surfaces.
- UI copy Spanish; identifiers/comments/commit messages English.
- Keep units sequential because they touch `DashboardPage.tsx`.

## Tasks
- [x] AC-1 — Account menu foundation and authenticated header wiring.
- [x] AC-2 — Unified settings surface using existing category/rule contracts.
- [x] AC-3 — Tests, build, independent verification, and delivery.

## AC-1 delivery and verification record
- Delivered as commit `192c1fb feat(account): add authenticated account menu`, pushed to `origin/framework_react`.
- The authenticated header now exposes the real profile with avatar/initial fallback and an accessible account menu. Existing category and counterparty settings actions moved under the menu without changing their dialogs or mutation contracts. Gmail remains in the body panel and the demo tree remains read-only.
- Verification: focused suite reports 57 passing tests and the same 5 known stale failures; `npm run build` passes. Independent verification found no blocker. Review is disabled for this clone.
- AC-2 delivered as commit `f46957e feat(settings): unify authenticated settings`, pushed to `origin/framework_react`. The two verified settings bodies are reusable in their standalone wrappers and in one unified native dialog with profile, categories, rules, and one outer close action.
- Verification: focused suite reports 59 passing tests and the same 5 known stale failures; `npm run build` passes. Independent verification found no blocker. Review is disabled for this clone.
- Accepted follow-up: the unified dialog currently performs two independent category catalog reads because both embedded verified sections retain their own loading state and contract.

## Retirement prerequisites
After AC-1 through AC-3: serve React at `/`, remove legacy routes/assets only after a repository-wide reference audit, and reconcile the legacy/test red baseline.
