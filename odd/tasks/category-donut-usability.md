# Category donut usability

## Objective and why
Make “Dónde se fue tu plata” clearer and more usable after choosing a category, without changing spending calculations or claiming unknown amounts as known. Preserve all pre-existing concurrent edits.

## Scope and constraints
- Authorized: category donut empty disclosure, safe tooltip names, responsive and reduced-motion behavior, selection focus, centered context, legible legend and a tidy action group for category detail.
- Not authorized: changing category ranking or expense values, backend changes, other dashboard cards, publishing, committing without explicit user request.
- User explicitly requests no tests. TDD mode off by user instruction; test runner not used. Only source readback is planned. Delivery strategy: ask-on-risk; expected new authored lines below ~200, though existing uncommitted diff is large and unrelated.

## Tasks
- [x] CD-1 — Make donut states honest and accessible: retains unknown-amount disclosure in empty ranking; HTML-escapes tooltip values; focuses detail/returns to legend; observes chart size and reduced-motion changes. Route: delegated worker (single component). Source readback confirmed existing ranking and click/legend behavior; tests/build intentionally skipped. No commit (user did not ask).
- [x] CD-2 — Improve selected-category presentation: center displays selected visible category/amount (otherwise total); legend text wraps; donut detail uses a full-width primary category jump above a quieter back button. Route: delegated worker (component + stylesheet). Source readback confirmed scoped styles and existing jump/filter callback; tests/build and browser visual check intentionally not run. No commit (user did not ask).

## Acceptance
- Empty-state disclosure survives when all outflows have unknown amounts.
- Names cannot be interpreted as HTML markup in chart tooltip; chart selection remains available by mouse and via keyboard legend.
- Selecting a category sends focus into detail; returning restores a meaningful legend focus.
- Motion reduction and resizing do not leave stale/mis-sized chart; selected donut center truthfully identifies the active row.
- Detail buttons have a clear primary jump and secondary back action, fit narrow screens without awkward wrapping.
- No tests or build executed per user request; no commit without explicit authorization.

## Progress
- Explored existing CategoryDistribution, ranking, CSS, refresh work; baseline chart and stylesheet are already modified by concurrent work.
- CD-1 and CD-2 completed with source readback, preserving shared worktree changes. No tests/build or browser visual check (user requested no tests); no commit (user did not ask). Next: optional human visual review of detail buttons and long chart-center amounts.
