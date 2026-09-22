# React Dashboard Visual and Information Parity

## Objective
Bring the authenticated React dashboard close to the original visible dashboard in design and information, without porting dead, month-only, or over-engineered interactions.

## User decision
Deliver the principal visual/information parity first: header chrome, hero total, remaining balance when income exists, legacy section order, period reading, top insights, and visual spending breakdown. Keep the existing accessible chart, filters, CRUD, Gmail, cycle, and settings behavior. Do not add a donut dependency, bulk actions, legacy calendar wizard, or chart drill-down in this unit.

## Constraints
- Derive everything from already-loaded period data; no server/API/database changes.
- Reuse retained global design tokens/classes where safe; add scoped React styles only when needed.
- Preserve truthfulness: no balance number without configured income, no fabricated budget/income detection, and disclose unknown amounts.
- UI copy Spanish; identifiers/comments/commits English.
- Production commits source-only; focused tests remain local and uncommitted.
- Keep demo structurally read-only.

## Unit split
1. [x] DP-1 — App chrome and legacy period heading: sticky brand/navigation/account placement, with the existing summary/movements state.
2. [x] DP-2 — Hero lead and remaining balance: large total card and truthful configured-income balance.
3. [x] DP-3 — Legacy section order, period story, insights, and visual spending breakdown bars.
4. [x] DP-4 — Focused tests, build, independent verification, and source-only delivery.

## DP-1 delivery and verification record
- Delivered as commit `c9912da feat(dashboard): add React app chrome`, pushed to `origin/framework_react`.
- Added the legacy-like brand/navigation/account chrome and lifted the existing summary/movements view state so header navigation and content share one owner. No month navigation or API behavior was added.
- Verification: focused React suite reports 61 passing tests and the same 5 stale failures; static routing passes and the build passes. Independent verification found no blocker. Native review is disabled for this clone.

## DP-2 delivery and verification record
- Delivered as commit `7f8e0a4 feat(dashboard): add React spending lead`, pushed to `origin/framework_react`.
- Added the legacy-like prominent spending total and configured-income balance. Pending amounts remain disclosed; without income the balance shows no fabricated numeric value. The previous four-card duplicate grid was removed because its information is now represented in the lead.
- Verification: focused React suite reports 64 passing tests and the same 5 stale failures; build passes. Independent verification found no blocker. Native review is disabled for this clone.

## DP-3/DP-4 delivery and verification record
- Delivered as commit `55b0939 feat(dashboard): add period story and insights`, pushed to `origin/framework_react`.
- Added the period story, principal category/counterparty/latest insights, visual spending-kind bars, and legacy-like section order. Duplicate latest-expense and plain breakdown markup were removed. No API, dependency, budget, donut, bulk, calendar, or chart-drilldown work was added.
- Verification: focused React suite reports 66 passing tests and the same 5 known stale failures; `npm run build` passes. Independent verification found no blocker. Native review is disabled for this clone.
- Accepted presentation difference: all three spending kinds render as stable bars, including truthful 0% bars when a kind has no amount; this avoids changing the summary shape based on data.

## Explicit non-goals
- No ECharts/donut dependency.
- No budget panel, income detection, pay-timing control, projections, or month-only claims.
- No chart day drill-down, bulk selection/actions, or calendar wizard.
- No server or contract changes.
- No legacy asset restoration.
