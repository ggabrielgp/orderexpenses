import type { RecognizedExpenseMovement } from "../movements/manualExpense";

/**
 * Category ranking decisions for the authenticated summary: the ranked rows, the merged tail, the
 * counterparty breakdown inside a category, and the disclosure of the summarized outflows the
 * ranking had to leave out.
 *
 * Legacy rendered this through the category distribution card
 * (`renderCategoryDistribution`, `public/app.js:2733-2872`): a breakdown by category
 * (`buildCategoryBreakdown`, `:2905-2935`), a display list that merged everything after the third
 * category into `Otras categorías` (`buildCategoryDisplayRows`, `:2941-2958`), and a detail panel
 * that listed the counterparties inside the selected category (`renderCategoryDetail`, `:2994-3105`).
 * The decisions live here as pure functions for the same reason the filter and sorting decisions do:
 * the test harness has no DOM, and what these rows may claim is worth proving without rendering a
 * card.
 *
 * The rows it receives are the recognized expenses the summary already projected and loaded for the
 * configured period, so this module issues no request and adds no endpoint. These stay pure decisions:
 * the React distribution card (`CategoryDistribution.tsx`) draws the ECharts donut from them and
 * `categoryDistribution.ts` derives the insight. Legacy's insight summed already-rounded percentages
 * (`:2925`), which this module must not reproduce.
 *
 * No React import: these are decisions, not rendering.
 */

/** Legacy's label for a category-less movement (`buildCategoryBreakdown`, `public/app.js:2909`). */
export const UNCATEGORIZED_CATEGORY = "Sin categoría";
/** Legacy's label for the merged tail (`buildCategoryDisplayRows`, `public/app.js:2949`). */
export const MERGED_CATEGORY = "Otras categorías";

/** Legacy showed exactly the first three categories before merging (`rows.slice(0, 3)`, `:2945`). */
const VISIBLE_CATEGORY_COUNT = 3;

/** The identity fallback the shipped movement projection already applies (`getRecognizedExpenseIdentity`). */
const NO_COUNTERPARTY_LABEL = "Gasto sin identificar";

export interface CategoryCounterpartyRow {
	/** Counterparty as the movement projection displays it, first occurrence wins. */
	counterparty: string;
	/** Raw sum of the movements with this counterparty inside the category. */
	total: number;
	/** Movements with this counterparty inside the category. */
	count: number;
}

export interface CategoryChildRow {
	/** Real category the merged tail absorbed. */
	category: string;
	/** Raw sum of that category. */
	total: number;
	/** Movements in that category. */
	count: number;
}

export interface CategoryRankingRow {
	/** Display label; `Otras categorías` for the merged tail. */
	category: string;
	/** Raw sum of the movements in this row, computed from raw amounts, never from rounded shares. */
	total: number;
	/** Movements in this row. */
	count: number;
	/** Integer share of the ranking total, computed from the raw totals and rounded once. */
	share: number;
	/** True only for the merged tail row, which has no single category to jump to. */
	mergesTail: boolean;
	/** Counterparties inside a real category, ranked; empty for the merged tail. */
	counterparties: CategoryCounterpartyRow[];
	/** Real categories the tail absorbed, ranked; empty for a real category. */
	children: CategoryChildRow[];
}

export interface CategoryRanking {
	/** Grand total of the recognized finite outflows the ranking counted. */
	total: number;
	/** Display rows: the top three categories, plus the merged tail when more than three exist. */
	rows: CategoryRankingRow[];
	/** Recognized outflows left out because they carry no usable amount. Disclosed, never ranked. */
	unknownAmountCount: number;
	/** Statement disclosing the excluded outflows, or `null` when there are none to disclose. */
	disclosure: string | null;
}

/**
 * Mirrors legacy's `categoryKey` (`public/app.js:3311-3313`): the server's `normalizeCategoryName`
 * (trim, collapse whitespace, slice to 40) followed by the UI key (strip diacritics, lowercase).
 * It is a local copy for the same reason `movementFilters` keeps one: the filter module owns its
 * key and this module cannot import a private function from it.
 */
export function getCategoryKey(value: unknown): string {
	const name = String(value ?? "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 40);
	return normalizeKey(name);
}

/** Legacy's `normalizeCounterpartyForUI`: the accent- and case-folding half of the key, no slice. */
function getCounterpartyKey(value: unknown): string {
	return normalizeKey(String(value ?? ""));
}

function normalizeKey(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

/** The display label for a movement's category, with legacy's empty-category fallback. */
function getCategoryLabel(movement: RecognizedExpenseMovement): string {
	const category = typeof movement?.category === "string" ? movement.category : "";
	const normalized = category.trim().replace(/\s+/g, " ").slice(0, 40);
	return normalized || UNCATEGORIZED_CATEGORY;
}

/** The counterparty the detail lists, with the surface's own identity fallback. */
function getCounterpartyLabel(movement: RecognizedExpenseMovement): string {
	const counterparty = typeof movement?.counterparty === "string" ? movement.counterparty.trim() : "";
	return counterparty || NO_COUNTERPARTY_LABEL;
}

/** A raw share rounded once. A zero total has no share, never a fabricated one. */
function getShare(amount: number, total: number): number {
	return total === 0 ? 0 : Math.round((amount / total) * 100);
}

function buildCounterpartyRows(
	group: { counterparties: Map<string, { label: string; total: number; count: number }> },
): CategoryCounterpartyRow[] {
	return [...group.counterparties.values()]
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"))
		.map((counterparty) => ({
			counterparty: counterparty.label,
			total: counterparty.total,
			count: counterparty.count,
		}));
}

function buildCategoryRow(
	group: { label: string; total: number; count: number; counterparties: Map<string, { label: string; total: number; count: number }> },
	total: number,
): CategoryRankingRow {
	return {
		category: group.label,
		total: group.total,
		count: group.count,
		share: getShare(group.total, total),
		mergesTail: false,
		counterparties: buildCounterpartyRows(group),
		children: [],
	};
}

/**
 * Legacy's tail merge (`buildCategoryDisplayRows`, `public/app.js:2941-2958`): more than three
 * categories keep the top three and become one `Otras categorías` row whose total, count and share
 * are computed from the raw amounts it absorbed, not from the child rows' rounded shares.
 */
function mergeTail(rows: CategoryRankingRow[], total: number): CategoryRankingRow[] {
	const visible = rows.slice(0, VISIBLE_CATEGORY_COUNT);
	const rest = rows.slice(VISIBLE_CATEGORY_COUNT);
	const tailTotal = rest.reduce((sum, row) => sum + row.total, 0);
	const tailCount = rest.reduce((sum, row) => sum + row.count, 0);
	return [
		...visible,
		{
			category: MERGED_CATEGORY,
			total: tailTotal,
			count: tailCount,
			share: getShare(tailTotal, total),
			mergesTail: true,
			counterparties: [],
			children: rest.map((row) => ({
				category: row.category,
				total: row.total,
				count: row.count,
			})),
		},
	];
}

/**
 * The unknown-amount disclosure. Like the period metrics, the excluded outflows are their own fact:
 * the ranking states how many the summary left out instead of silently ranking a smaller total.
 */
function buildDisclosure(unknownAmountCount: number): string | null {
	if (unknownAmountCount <= 0) return null;
	return unknownAmountCount === 1
		? "1 salida reconocida del periodo no tiene monto conocido y no se incluye en esta distribución."
		: `${unknownAmountCount} salidas reconocidas del periodo no tienen monto conocido y no se incluyen en esta distribución.`;
}

/**
 * Everything the category ranking needs for one render, derived from the recognized expense rows the
 * summary already loaded. One pass groups by category — accent- and case-insensitively, like legacy's
 * `categoryKey` — and groups each category's counterparties at the same time, so the row, its share
 * and its detail can never come from different sets of movements.
 *
 * `unknownAmountCount` is the count of recognized outflows the projection excluded because they carry
 * no usable amount; the caller computes it once with the summary. It is disclosed, never added to a
 * total, because an unknown amount cannot be summed.
 *
 * The merged tail appears only when more than three categories exist, exactly as legacy decided.
 */
export function getCategoryRanking(
	movements: RecognizedExpenseMovement[],
	unknownAmountCount: number,
): CategoryRanking {
	const groups = new Map<
		string,
		{
			label: string;
			total: number;
			count: number;
			counterparties: Map<string, { label: string; total: number; count: number }>;
		}
	>();

	for (const movement of movements) {
		// The projection already guarantees a finite amount; the guard keeps a caller that bypasses it
		// from turning the totals into `NaN`.
		if (!Number.isFinite(movement?.amount)) continue;
		const amount = Number(movement.amount);
		const label = getCategoryLabel(movement);
		const key = getCategoryKey(label);
		const group = groups.get(key) ?? { label, total: 0, count: 0, counterparties: new Map() };
		group.total += amount;
		group.count += 1;

		const counterpartyLabel = getCounterpartyLabel(movement);
		const counterpartyKey = getCounterpartyKey(counterpartyLabel);
		const counterparty = group.counterparties.get(counterpartyKey) ?? {
			label: counterpartyLabel,
			total: 0,
			count: 0,
		};
		counterparty.total += amount;
		counterparty.count += 1;
		group.counterparties.set(counterpartyKey, counterparty);

		groups.set(key, group);
	}

	const total = [...groups.values()].reduce((sum, group) => sum + group.total, 0);
	const ranked = [...groups.values()]
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"))
		.map((group) => buildCategoryRow(group, total));

	return {
		total,
		rows: ranked.length > VISIBLE_CATEGORY_COUNT ? mergeTail(ranked, total) : ranked,
		unknownAmountCount,
		disclosure: buildDisclosure(unknownAmountCount),
	};
}

/**
 * The display row a selection names, matched the same accent- and case-insensitive way the movement
 * filter matches its own options. `null` when the ranking has no such row, so a stale selection shows
 * nothing rather than a row the ranking does not contain.
 */
export function findCategoryRankingRow(
	ranking: CategoryRanking,
	category: string,
): CategoryRankingRow | null {
	const key = getCategoryKey(category);
	if (!key) return null;
	return ranking.rows.find((row) => getCategoryKey(row.category) === key) ?? null;
}
