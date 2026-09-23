# Feature: user-data-isolation

## Objective
Prevent financial dashboard data from one authenticated user remaining visible in the browser after the session switches to another user.

## Product decision
A cached dashboard response is private user data. It may only be reused when its authenticated identity matches the current session. Logout/account-switch flows must clear browser-held private dashboard state, and stale asynchronous responses must not repopulate it for a different user.

## Scope
- `src/client/api/client.ts`
- `src/client/pages/DashboardPage.tsx`
- `src/client/hooks/DashboardRoute.tsx`
- `src/server.js`
- `test/react-vite-foundation.test.js`
- focused server/session tests as needed

## Non-goals
- Change server-side account ownership or delete persisted user data.
- Change Gmail OAuth or account linking semantics.
- Alter unrelated dashboard visual work already present in the working tree.

## Tasks
- [x] Bind dashboard cache entries to the authenticated profile identity and reject/evict mismatches.
- [x] Clear private client state during logout/account transitions and guard stale async responses.
- [x] Add regression coverage for identity-mismatched cache rejection/eviction, identity-matched reuse, route remounting, logout cleanup, and private response caching.

## Evidence
- Focused React cache/account-route tests: 2/2 pass.
- Server logout/no-store tests: 3/3 pass.
- `npm run build`: pass; only the existing Vite large-bundle warning remains.
- `git diff --check`: pass.
- Unrelated concurrent worktree changes were preserved and not cleaned.
