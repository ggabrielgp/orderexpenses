import type { RecognizedExpenseMovement } from "./manualExpense";

/**
 * Movement sorting decisions for the period-scoped table.
 *
 * Legacy had a fully interactive sortable table: `sortTransactions` ordered by date, amount,
 * counterparty and category (`public/app.js:928-947`), `state.sortKey`/`state.sortDir` held the
 * selection (`:142-143`), `cycleSort` advanced it (`:3567-3578`) and `renderTableHead` exposed it as
 * `aria-sort` plus a `▬/▲/▼` indicator (`:3499-3578`). This module owns those decisions as pure
 * functions, because the test harness has no DOM and because the ordering contract is worth proving
 * without rendering a table.
 *
 * It is applied from outside `movementFilters`, to the rows the filter left visible: ordering narrows
 * nothing, so the filter's count statement keeps describing the filtered set.
 *
 * No React import: these are decisions, not rendering.
 */

export type MovementSortKey = "date" | "amount" | "counterparty" | "category";
export type MovementSortDirection = "asc" | "desc";
export type MovementSortState = {
	key: MovementSortKey | null;
	direction: MovementSortDirection | null;
};
export type MovementSortAriaSort = "ascending" | "descending" | "none";

/** Legacy's flat indicator for a column that is not the active sort (`sortIndicator`, `public/app.js:3562`). */
export const NEUTRAL_SORT_INDICATOR = "▬";
export const ASCENDING_SORT_INDICATOR = "▲";
export const DESCENDING_SORT_INDICATOR = "▼";

/**
 * The shipped React surface's fallbacks for a movement with no counterparty or category
 * (`getRecognizedExpenseIdentity`/`getMovementCategory`, `pages/DashboardPage.tsx`, and
 * `getMovementCategoryLabel`, `movementFilters.ts`). A blank field is ordered by the label the table
 * shows for it, so the ordering never contradicts what the user reads.
 *
 * Counterparty diverges from legacy deliberately: legacy ordered a blank counterparty as the empty
 * string (`(a.counterparty || "").localeCompare(b.counterparty || "", "es")`, `public/app.js:938`),
 * while this module orders it by `Gasto sin identificar`. The divergence is not observable in the
 * production path, because `getRecognizedExpenseIdentity` (`pages/DashboardPage.tsx:179-184`) already
 * substitutes that same label when it projects the rows the table sorts, so a blank counterparty
 * never reaches `getMovementSortCounterparty` through the dashboard. The fallback stays here so a
 * caller that bypasses that projection still orders by the label its table would render.
 */
const NO_COUNTERPARTY_LABEL = "Gasto sin identificar";
const NO_CATEGORY_LABEL = "Sin categoría";

/** Legacy's initial state: no key and no direction (`state.sortKey`/`state.sortDir`, `public/app.js:142-143`). */
export function createMovementSortState(): MovementSortState {
	return { key: null, direction: null };
}

/**
 * `cycleSort` line for line (`public/app.js:3567-3578`). Activating a column for the first time sorts
 * it ascending; activating the same column again descends; a third activation clears both values,
 * returning to the neutral state the `▬` indicator implies and making the loaded order reachable
 * again. Activating a different column starts a fresh ascending sort instead of continuing the
 * previous cycle. Never mutates the state it was handed.
 */
export function cycleMovementSort(
	state: MovementSortState,
	key: MovementSortKey,
): MovementSortState {
	if (state.key === key) {
		if (state.direction === "asc") return { key, direction: "desc" };
		if (state.direction === "desc") return { key: null, direction: null };
		// Legacy's two branches covered "asc" and "desc" only; any other value mutated nothing, so the
		// state is returned untouched instead of inventing a transition legacy never had.
		return state;
	}
	return { key, direction: "asc" };
}

/** Legacy's `sortIndicator` (`public/app.js:3562-3565`): the active column shows its direction, the rest show `▬`. */
export function getMovementSortIndicator(
	state: MovementSortState,
	key: MovementSortKey,
): string {
	if (state.key !== key) return NEUTRAL_SORT_INDICATOR;
	return state.direction === "asc" ? ASCENDING_SORT_INDICATOR : DESCENDING_SORT_INDICATOR;
}

/**
 * Legacy's `aria-sort` (`renderTableHead`, `public/app.js:3545-3553`): the active column states its
 * direction, the others state `none` instead of leaving the attribute off.
 */
export function getMovementSortAriaSort(
	state: MovementSortState,
	key: MovementSortKey,
): MovementSortAriaSort {
	if (state.key !== key) return "none";
	return state.direction === "asc" ? "ascending" : "descending";
}

/**
 * Legacy compared the raw `occurredAt` text instead of parsing it (`public/app.js:934`), with the
 * runtime's default collation. That is why the date-only `YYYY-MM-DD` values this codebase
 * deliberately leaves unparsed still order chronologically: over that fixed-width format the
 * lexicographic order is the calendar order, and no timezone can shift a row into another day. The
 * React projection exposes the same date-only value as `date`, so comparing it the same way is the
 * same decision rather than a new one.
 *
 * A row whose date is unusable is the exception that claim does not cover: the projection renders it
 * as the sentinel the table displays (`formatMovementDate`, `pages/DashboardPage.tsx:186-189`), and a
 * non-string date falls back to the empty text here. That sentinel is not a date, so it participates
 * in the comparison and takes whatever position the default collation gives it — arbitrary, but
 * deterministic for a given runtime — while a missing date sorts as the empty text. Neither is
 * dropped or coerced: both keep a defined position in the total order, and the pinned sentinel order
 * is what the test asserts so the arbitrary position cannot change unnoticed.
 */
function getMovementSortText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/**
 * The projection's counterparty fallback, so a blank field is ordered by the label the table shows.
 * Legacy used the empty string here (`public/app.js:938`); the divergence and why the production path
 * cannot observe it are documented at `NO_COUNTERPARTY_LABEL` above.
 */
function getMovementSortCounterparty(movement: RecognizedExpenseMovement): string {
	const counterparty = getMovementSortText(movement?.counterparty).trim();
	return counterparty || NO_COUNTERPARTY_LABEL;
}

/** The projection's category fallback, mirroring `getMovementCategoryLabel` in `movementFilters.ts`. */
function getMovementSortCategory(movement: RecognizedExpenseMovement): string {
	const category = getMovementSortText(movement?.category).trim();
	return category || NO_CATEGORY_LABEL;
}

/**
 * Legacy compared amounts as `(Number(a.amount) || 0) - (Number(b.amount) || 0)`
 * (`public/app.js:935`), so a missing or unparsable amount became a zero and never a `NaN` that would
 * leave the order undefined. `Number.isFinite` states that rule explicitly, and it also keeps an
 * `Infinity` — which a JSON response cannot carry anyway — from becoming `Infinity - Infinity`. A
 * movement with no usable amount still has a defined place in the order; it is simply ordered as zero,
 * which is the only answer legacy ever produced for one.
 */
function getMovementSortAmount(movement: RecognizedExpenseMovement): number {
	return Number.isFinite(movement?.amount) ? Number(movement.amount) : 0;
}

/**
 * The ascending comparison for one key, mirroring `sortTransactions` (`public/app.js:930-946`).
 * Counterparty and category use the `es` collation exactly like legacy (`:937-942`); date uses the
 * default collation, which is what legacy's locale-less `localeCompare` did. Ties return `0`: the
 * deterministic tie-break belongs to `sortMovements`, which is the only place the loaded position is
 * still available.
 *
 * The result is always a finite number. `Infinity` and `NaN` are unreachable because
 * `getMovementSortAmount` collapses every non-finite amount before subtracting.
 */
export function compareMovements(
	left: RecognizedExpenseMovement,
	right: RecognizedExpenseMovement,
	key: MovementSortKey,
): number {
	if (key === "amount") return getMovementSortAmount(left) - getMovementSortAmount(right);
	if (key === "date") {
		return getMovementSortText(left?.date).localeCompare(getMovementSortText(right?.date));
	}
	if (key === "counterparty") {
		return getMovementSortCounterparty(left).localeCompare(
			getMovementSortCounterparty(right),
			"es",
		);
	}
	return getMovementSortCategory(left).localeCompare(getMovementSortCategory(right), "es");
}

/**
 * The ordering the table applies to the rows the filter left visible.
 *
 * With no key the loaded order is the answer, mirroring legacy's `if (!state.sortKey) return
 * transactions` (`public/app.js:929`). Descending is legacy's negated ascending comparison (`:945`),
 * and a tie is broken by the row's loaded position: legacy relied on a stable `Array.prototype.sort`,
 * and negating a zero is still a zero, so a tie keeps the loaded order in both directions instead of
 * flipping with it. A copy is always returned, so nothing here can reorder the loaded rows.
 */
export function sortMovements(
	movements: RecognizedExpenseMovement[],
	state: MovementSortState,
): RecognizedExpenseMovement[] {
	const key = state.key;
	if (key === null) return [...movements];
	const factor = state.direction === "desc" ? -1 : 1;
	return movements
		.map((movement, index) => ({ movement, index }))
		.sort((left, right) => {
			const compared = factor * compareMovements(left.movement, right.movement, key);
			return compared === 0 ? left.index - right.index : compared;
		})
		.map((entry) => entry.movement);
}
