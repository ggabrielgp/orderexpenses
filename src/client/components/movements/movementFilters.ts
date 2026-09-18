import type { FinancialPeriod } from "../../api/types";
import type { RecognizedExpenseMovement } from "./manualExpense";

/**
 * Movement filter decisions for the period-scoped table.
 *
 * Legacy offered exactly one filter on the movements table: a category select that narrowed the rows
 * already loaded for the period and issued no request of its own (`renderTableCategoryFilters`,
 * `public/app.js:3621-3668`). This module owns those decisions as pure functions, because the test
 * harness has no DOM: the option derivation, the in-memory selection, the period reset, the row
 * selection and the truthful count copy are provable without rendering a table.
 *
 * The filter never reaches the server, and not by choice: in period mode `/api/transactions` ignores
 * `month` and `payTiming` (`src/server.js:134-149`), so no request could even express a category.
 *
 * No React import: these are decisions, not rendering.
 */

/** Value of the "all categories" option. The empty string is "no filter", as it was in legacy. */
export const ALL_CATEGORIES_FILTER = "";

/** Legacy's label for a category-less movement (`public/app.js:2937`). */
const NO_CATEGORY_LABEL = "Sin categoría";
/** Legacy's label for the option that clears the filter. */
const ALL_CATEGORIES_LABEL = "Todas las categorías";

export type MovementFilterSelection = {
	/** Selected category, or `""` when no filter is active. */
	category: string;
	/** Period the selection was made in; a selection only applies to the period that produced it. */
	periodKey: string;
};

export type MovementFilterOption = {
	/** Value the control stores when the option is picked; `""` for "Todas las categorías". */
	value: string;
	/** Display text. It equals `value` for a category, so the control need not know the sentinel. */
	label: string;
	/** Loaded rows carrying this category. */
	count: number;
};

export type MovementFilterCount = {
	isActive: boolean;
	/** Category in effect, which is also the option the control must show as selected. */
	category: string;
	/** Rows the table renders. */
	shown: number;
	/** Rows the period has. */
	total: number;
	/** Count statement, or `null` while no filter is active: a table that hides nothing claims nothing. */
	message: string | null;
};

export type MovementFilterView = {
	/** "Todas las categorías" first, then one option per category present in the loaded rows. */
	options: MovementFilterOption[];
	/** Category in effect; `ALL_CATEGORIES_FILTER` renders every loaded row. */
	activeCategory: string;
	/** The rows the table must render. */
	rows: RecognizedExpenseMovement[];
	/** Filter-relative count statement for the table. */
	count: MovementFilterCount;
};

/** Identity of a loaded period, used to decide whether a stored selection still applies to it. */
export function getMovementFilterPeriodKey(period: FinancialPeriod): string {
	return `${period.startDate}..${period.endDateExclusive}`;
}

/**
 * The unfiltered selection for a period. It is both the initial state and the result of clearing:
 * "no category filter in this period" is one state, so one function owns it.
 */
export function createMovementFilterSelection(period: FinancialPeriod): MovementFilterSelection {
	return { category: ALL_CATEGORIES_FILTER, periodKey: getMovementFilterPeriodKey(period) };
}

/**
 * A category picked from the control, stamped with the period on screen so the selection belongs to
 * the rows the user was looking at. Picking "Todas las categorías" is a selection too: it clears.
 */
export function selectMovementFilterCategory(
	category: string,
	period: FinancialPeriod,
): MovementFilterSelection {
	return { category, periodKey: getMovementFilterPeriodKey(period) };
}

/**
 * Whether the loaded rows carry a category, grouped exactly like the options are. "No category" is
 * always present: showing every row is a state of the table, not a category it could lose.
 */
function hasLoadedCategory(
	movements: RecognizedExpenseMovement[],
	category: string,
): boolean {
	const key = getCategoryKey(category);
	if (!key) return true;
	return movements.some(
		(movement) => getCategoryKey(getMovementCategoryLabel(movement)) === key,
	);
}

/**
 * The selection that applies to the loaded period: the stored one while it belongs to that period and
 * its category is still one of the loaded rows' categories — the same object, so a caller can commit
 * only on a real change — and a fresh unfiltered one otherwise.
 *
 * This is the reset legacy performed when the month changed and when a cycle was applied
 * (`public/app.js:1008`, `:424`), plus the clear legacy performed when the stored category left the
 * loaded rows (`state.tableCategoryFilter = ""`, `:1233`). The table commits the returned selection on
 * every render, its empty-rows state included, so a stale selection is replaced rather than merely
 * ignored: a category the period no longer carries cannot re-activate itself when a later edit brings
 * it back.
 */
export function reconcileMovementFilterSelection(
	selection: MovementFilterSelection,
	period: FinancialPeriod,
	movements: RecognizedExpenseMovement[],
): MovementFilterSelection {
	return selection.periodKey === getMovementFilterPeriodKey(period) &&
		hasLoadedCategory(movements, selection.category)
		? selection
		: createMovementFilterSelection(period);
}

/**
 * Mirrors legacy's `categoryKey` (`public/app.js:3311-3313`): trim, collapse whitespace, slice to the
 * server's 40 characters (`src/server.js:773-777`), then strip diacritics and lowercase. Grouping is
 * accent- and case-insensitive, which is what made "Comida" and " comida " one row in legacy.
 */
function getCategoryKey(value: unknown): string {
	return String(value ?? "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 40)
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

/** Legacy's display label for a movement's category, including the empty-category fallback. */
function getMovementCategoryLabel(movement: RecognizedExpenseMovement): string {
	const category = movement?.category;
	return typeof category === "string" && category.trim() ? category.trim() : NO_CATEGORY_LABEL;
}

/**
 * "Todas las categorías" plus one option per category present in the loaded rows, each carrying the
 * rows it would show. A category the period does not carry is not listed, because an option that
 * could only produce an empty table is noise. The order mirrors legacy's breakdown, largest amount
 * first (`public/app.js:2911-2935`), with the label as the deterministic tie-break legacy's `Map`
 * insertion order did not have.
 */
function getMovementFilterOptions(
	movements: RecognizedExpenseMovement[],
): MovementFilterOption[] {
	const groups = new Map<string, { label: string; count: number; amount: number }>();
	for (const movement of movements) {
		const label = getMovementCategoryLabel(movement);
		const key = getCategoryKey(label);
		const group = groups.get(key) ?? { label, count: 0, amount: 0 };
		group.count += 1;
		// A row without a usable amount cannot be summed, but it still counts: the option states how
		// many rows it would show, not how much money they carry.
		if (Number.isFinite(movement?.amount)) group.amount += Number(movement.amount);
		groups.set(key, group);
	}

	const categoryOptions = [...groups.values()]
		.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "es"))
		.map((group) => ({ value: group.label, label: group.label, count: group.count }));

	return [
		{ value: ALL_CATEGORIES_FILTER, label: ALL_CATEGORIES_LABEL, count: movements.length },
		...categoryOptions,
	];
}

/**
 * The category actually in effect. A stored selection applies only when its category is one of the
 * loaded rows' categories, and the matched option's own value is returned so the control can show it
 * as selected. Legacy had the same guard (`activeTableCategoryFilter`, `public/app.js:1225-1235`) and
 * also cleared the stored state there (`state.tableCategoryFilter = ""`, `:1233`); the reconciliation
 * above now performs that clear, and this function remains the final check before a render: a
 * `<select>` whose value matches no option cannot show it as selected, so the control would disagree
 * with the rows the table is hiding.
 */
function resolveActiveCategory(
	selection: MovementFilterSelection,
	options: MovementFilterOption[],
): string {
	const key = getCategoryKey(selection.category);
	if (!key) return ALL_CATEGORIES_FILTER;
	const match = options.find(
		(option) => option.value !== ALL_CATEGORIES_FILTER && getCategoryKey(option.value) === key,
	);
	return match ? match.value : ALL_CATEGORIES_FILTER;
}

/** Narrows the loaded rows preserving their order; no category means every row, on a copy. */
function getFilteredMovements(
	movements: RecognizedExpenseMovement[],
	activeCategory: string,
): RecognizedExpenseMovement[] {
	if (!activeCategory) return [...movements];
	const key = getCategoryKey(activeCategory);
	return movements.filter((movement) => getCategoryKey(getMovementCategoryLabel(movement)) === key);
}

/**
 * The count statement the table owes the user while it narrows rows. Legacy stated the same thing in
 * the table's own summary (`renderTableSummary`, `public/app.js:3590-3618`): label
 * `{category} en {period}`, detail `{n} de {total}`. The rows here are recognized expenses rather
 * than legacy's "salidas con monto", so the statement names that projection, and it says in words
 * that the financial summary still covers the whole period: a filtered table next to unchanged
 * totals is only honest when it says which is which.
 */
function buildMovementFilterCount(
	activeCategory: string,
	shown: number,
	total: number,
): MovementFilterCount {
	if (!activeCategory) {
		return { isActive: false, category: ALL_CATEGORIES_FILTER, shown: total, total, message: null };
	}
	return {
		isActive: true,
		category: activeCategory,
		shown,
		total,
		message:
			`Filtro activo: ${activeCategory}. Se muestran ${shown} de ${total} gastos reconocidos del periodo. ` +
			"El filtro solo afecta a esta tabla: el resumen financiero sigue considerando el periodo completo.",
	};
}

/**
 * Everything the movements view needs for one render: the options the control offers, the category in
 * effect for the loaded period, the rows to render and the count statement. One function produces all
 * four so they can never disagree — a control showing a category the table is not applying, or a
 * count computed from different rows, is a lie the view could not detect.
 */
export function getMovementFilterView(
	selection: MovementFilterSelection,
	period: FinancialPeriod,
	movements: RecognizedExpenseMovement[],
): MovementFilterView {
	const options = getMovementFilterOptions(movements);
	// Reconciled here as well as by the caller, so no caller can narrow the table with a selection
	// that belongs to another period or names a category these rows no longer carry.
	const activeCategory = resolveActiveCategory(
		reconcileMovementFilterSelection(selection, period, movements),
		options,
	);
	const rows = getFilteredMovements(movements, activeCategory);
	return {
		options,
		activeCategory,
		rows,
		count: buildMovementFilterCount(activeCategory, rows.length, movements.length),
	};
}
