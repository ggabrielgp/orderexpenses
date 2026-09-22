# Feature: dashboard-surface-hierarchy

## Objective
Make the local React dashboard's spending-chart detail and month-summary panels match the calmer production hierarchy by using the existing centralized muted surface token instead of a hardcoded translucent white.

## Scope
In:
- `src/client/styles.css`
- this tracker

Out:
- `main` branch
- legacy selector deletion during the React migration
- production deployment
- component or data changes

## Implementation
- Replace the active React chart panel background literal with `var(--surface-subtle)`.
- Keep the existing border, radius, spacing, and active-row accent styling unchanged.
- Do not add another token: `src/client/design-tokens.css` already defines `--surface-subtle`.

## Checks
- `npm run build`
- `git diff --check`

## Progress
- [x] Implementation — React chart detail and month-summary panels now use `var(--surface-subtle)`.
- [x] Verification — `npm run build` passed; `git diff --check` passed. Existing unrelated dirty migration changes were preserved.
- [ ] User visual confirmation
