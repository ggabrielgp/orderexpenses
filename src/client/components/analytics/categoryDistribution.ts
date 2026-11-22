import type { Category } from "../../api/types";
import {
	getCategoryKey,
	MERGED_CATEGORY,
	UNCATEGORIZED_CATEGORY,
	type CategoryRanking,
	type CategoryRankingRow,
} from "./categoryRanking";

/**
 * Category-distribution decisions for the legacy `¿A dónde se fue tu dinero?` card: the colour a donut
 * slice and its legend row use, and the insight sentence that reads the distribution.
 *
 * Legacy rendered the card through `renderCategoryDistribution` (`public/app.js:2733-2872`), with
 * `categoryVisualColor` (`:3324-3330`) resolving a category's stored colour and
 * `renderCategoryDistributionInsight` (`:3113-3131`) writing the sentence. The decisions live here
 * as pure functions for the same reason the other analytics decisions do: the test harness has no
 * DOM, and what the card may claim is worth proving without rendering a chart.
 *
 * The distribution reads the ranking's display rows (the top categories plus the merged tail), so it
 * inherits the tail merge and the raw-total shares `categoryRanking` already decided. It never sums
 * legacy's already-rounded percentages: every share here is computed from raw totals and rounded once,
 * which is the truthfulness correction the ranking module documents (`public/app.js:2925`).
 *
 * Currency formatting is injected rather than imported: the surface owns `formatClp`, this module
 * owns the colours and the copy, exactly like `dashboardLead` and `dashboardInsights`.
 *
 * No request, no endpoint, no currency formatting and no React: these are decisions, not rendering.
 */

/**
 * Muted categorical palette of identity B (S11; `--cat-1..4` in `design-tokens.css`). None of these is a
 * month-state hue, so a category colour never reads as "en ritmo", "ajustado" or "vas rápido".
 */
const MERGED_CATEGORY_COLOR = "#8e897f";
/** An unnamed category is a neutral ink tint, distinct from every categorical swatch. */
const UNCATEGORIZED_COLOR = "#59647a";

/**
 * Default swatches for categories without a usable stored colour: the three artboard categories first
 * (the ranking shows three before merging), then ink tints. Rank decides the swatch when the surface
 * knows it, so the top categories never share a colour; otherwise a hash of the normalized key keeps a
 * category on the same swatch across reloads.
 */
const FALLBACK_PALETTE = ["#5a67a0", "#94678c", "#6f93ad", "#3f4b63", "#8b94a6"];

const CATEGORY_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isUsableColor(value: unknown): value is string {
	return typeof value === "string" && CATEGORY_COLOR_PATTERN.test(value.trim());
}

/** Stable bucket for a normalized key so the fallback colour is deterministic across reloads. */
function hashKey(key: string): number {
	let hash = 0;
	for (let index = 0; index < key.length; index += 1) {
		hash = (hash * 31 + key.charCodeAt(index)) % 100000;
	}
	return hash;
}

/**
 * The colour a slice and its legend row use. The merged tail and the unnamed bucket keep fixed muted
 * colours; a real category prefers the stored catalog colour (the user's own choice in the category
 * settings) and otherwise gets the muted palette swatch of its `rank` (or a stable hash of its key when
 * the caller has no rank). A missing catalog is not an error: it only means the palette.
 */
export function getCategoryRowColor(
	category: string,
	catalog: readonly Category[] | undefined,
	rank?: number,
): string {
	const key = getCategoryKey(category);
	if (!key) return UNCATEGORIZED_COLOR;
	if (key === getCategoryKey(MERGED_CATEGORY)) return MERGED_CATEGORY_COLOR;
	if (key === getCategoryKey(UNCATEGORIZED_CATEGORY)) return UNCATEGORIZED_COLOR;

	const stored = getStoredCategoryColor(category, catalog);
	if (stored !== null) return stored;

	const slot = rank !== undefined && rank >= 0 ? rank : hashKey(key);
	return FALLBACK_PALETTE[slot % FALLBACK_PALETTE.length];
}

/** The colour the user picked for a category in the category settings, or `null` when there is none. */
export function getStoredCategoryColor(
	category: string,
	catalog: readonly Category[] | undefined,
): string | null {
	const key = getCategoryKey(category);
	if (!key) return null;
	const stored = (catalog ?? []).find(
		(entry) => getCategoryKey(entry?.name) === key && isUsableColor(entry?.color),
	);
	return stored && isUsableColor(stored.color) ? stored.color.trim() : null;
}

/**
 * The colour of every display row of the ranking, in the donut's order: this is the one place the
 * donut legend and the movements chips read their colours from, so the two never disagree.
 */
export function getCategoryRankingColors(
	rows: readonly CategoryRankingRow[],
	catalog: readonly Category[] | undefined,
): string[] {
	return rows.map((row, index) => getCategoryRowColor(row.category, catalog, index));
}

/**
 * The colour a movement's category chip uses: the slice of the donut that category sits in. A category
 * the donut folds into `Otras categorías` takes that slice's colour, a colour the user picked still
 * wins, and a category the ranking does not know falls back to its stable palette swatch.
 */
export function createCategoryColorResolver(
	ranking: Pick<CategoryRanking, "rows">,
	catalog: readonly Category[] | undefined,
): (category: string) => string {
	const colors = getCategoryRankingColors(ranking.rows, catalog);
	const byKey = new Map<string, string>();
	ranking.rows.forEach((row, index) => {
		if (row.mergesTail) {
			for (const child of row.children) {
				byKey.set(getCategoryKey(child.category), getStoredCategoryColor(child.category, catalog) ?? colors[index]);
			}
		} else {
			byKey.set(getCategoryKey(row.category), colors[index]);
		}
	});
	return (category) => byKey.get(getCategoryKey(category)) ?? getCategoryRowColor(category, catalog);
}

/** A raw share rounded once. A zero total has no share, never a fabricated one. */
function getShare(amount: number, total: number): number {
	return total === 0 ? 0 : Math.round((amount / total) * 100);
}

/**
 * The `¿A dónde se fue tu dinero?` insight, mirroring legacy's `renderCategoryDistributionInsight`
 * (`public/app.js:3113-3131`) with its arithmetic corrected.
 *
 * Legacy summed the two already-rounded percentages, so the combined share it printed could exceed
 * the true total or sit a point off (`:3121`). Here the combined share of the top two rows is
 * computed from their raw amounts and rounded once, and the unnamed bucket is read from the tail's
 * children when the merge absorbed it, so its disclosure survives the merge.
 */
export function getCategoryDistributionInsight(
	rows: readonly CategoryRankingRow[],
	total: number,
	formatAmount: (amount: number) => string,
): string | null {
	if (rows.length === 0) return null;

	const uncategorizedKey = getCategoryKey(UNCATEGORIZED_CATEGORY);
	const entries = rows.flatMap((row) => [
		{ category: row.category, total: row.total },
		...row.children.map((child) => ({ category: child.category, total: child.total })),
	]);
	const uncategorized = entries.find(
		(entry) => getCategoryKey(entry.category) === uncategorizedKey,
	);
	if (uncategorized !== undefined) {
		const uncategorizedShare = getShare(uncategorized.total, total);
		if (uncategorizedShare >= 10) {
			return `${formatAmount(uncategorized.total)} (${uncategorizedShare}%) aún está sin categoría. Clasificarlo mejora tu análisis.`;
		}
	}

	const [top, second] = rows;
	if (top !== undefined && second !== undefined) {
		const combinedShare = getShare(top.total + second.total, total);
		if (combinedShare >= 50) {
			return `${top.category} y ${second.category} explican el ${combinedShare}% de tus gastos.`;
		}
	}
	if (top !== undefined) {
		const topShare = getShare(top.total, total);
		if (topShare >= 40) {
			return `${top.category} concentra el ${topShare}% del gasto del período.`;
		}
	}

	return "Tus gastos están distribuidos entre varias categorías; mira el top 3 antes que todos los detalles.";
}

/**
 * The accessible name for the donut container. The chart draws into a canvas, so the region carries
 * the same facts as text instead of relying on the pixels: the total and each visible slice.
 */
export function getDistributionAriaLabel(
	rows: readonly CategoryRankingRow[],
	total: number,
	formatAmount: (amount: number) => string,
): string {
	const slices = rows
		.map((row) => `${row.category}: ${formatAmount(row.total)} (${row.share}%)`)
		.join(". ");
	return `Distribución de gastos por categoría. Total ${formatAmount(total)}. ${slices}.`;
}

/** Legacy's compact count wording (`renderCategoryLegendItem`, `public/app.js:2984`). */
export function formatMovementCount(count: number): string {
	return `${count} ${count === 1 ? "movimiento" : "movimientos"}`;
}
