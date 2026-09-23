import type { FinancialTransaction } from "../../api/types";
import { recognizedExpenseKinds, type RecognizedExpenseMovement } from "../movements/manualExpense";

/**
 * Dashboard insight decisions for the authenticated summary: the concise `Lectura rápida` story, the
 * four top insights (mayor impacto, mayor frecuencia, último movimiento, sin clasificar) and
 * the visual spending breakdown by kind.
 *
 * Legacy rendered these through `renderMonthStoryCard` (`public/app.js:1473-1500`) with
 * `buildMonthStoryItems` (`:1502-1535`), the insights grid in `renderDashboard` (`:1313-1333`) with
 * `insightCard` (`:3456-3468`), and the `Distribución de gastos` section (`:1357-1379`) with
 * `breakdownRow` (`:3469-3486`). The decisions live here as pure functions for the same reason the
 * other analytics decisions do: the test harness has no DOM, and what these facts may claim is worth
 * proving without rendering a card.
 *
 * Everything is derived from the summary, the configured category ranking and the recognized
 * expense rows the summary already loaded, so this module issues no request and adds no endpoint.
 * Currency formatting stays in the surface: the surface owns `formatClp` and this module returns the
 * raw amounts and the copy, exactly like `dashboardLead`.
 *
 * Legacy is not reproduced where it was untruthful:
 * - the story facts are capped at the few that fit, and no fact is emitted without data to support it;
 * - the breakdown percentages are computed from the raw kind totals, never from legacy's rounded donut
 *   shares (`public/app.js:2925`), which summed already-rounded percentages;
 * - no budget, income detection or projection is produced here.
 *
 * No request, no endpoint, no currency formatting and no React: these are decisions, not rendering.
 */

/** Direct story title aligned with the reference; supersedes legacy's period title (`public/app.js:1483`). */
export const STORY_TITLE = "Lectura rápida";
/** Recipient with the most recognized expenses carrying a finite amount. */
export const TOP_FREQUENCY_LABEL = "Mayor frecuencia";
/** Recognized expenses without a stored category. */
export const UNCATEGORIZED_LABEL = "Sin clasificar";
/**
 * The one-line insight for the single largest recognized expense. The label names the impact of one
 * transaction on purpose, so it never reads as an accumulated total.
 */
export const TOP_LARGEST_LABEL = "Mayor impacto";
/** Legacy's third insight label (`public/app.js:1327`). */
export const LATEST_MOVEMENT_LABEL = "Último movimiento";

/** The sentinel the shipped surface renders where a value does not exist (`formatMovementDate`). */
const MISSING_VALUE = "—";
/** The identity fallback the movement projection already applies (`getRecognizedExpenseIdentity`). */
const NO_IDENTITY_LABEL = "Gasto sin identificar";
/** Legacy showed at most four story facts (`items.slice(0, 4)`, `public/app.js:1533`). */
const MAX_STORY_FACTS = 4;

/** A count that cannot be negative or fractional, so the copy never prints a `NaN` or a `-1`. */
function normalizeCount(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** A finite amount or the additive identity; the callers already published the totals from finite numbers. */
function normalizeAmount(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

/** A labeled group (category or counterparty) or `null` when there is nothing to name. */
function normalizeGroup(
	group: { label: string; total: number } | null | undefined,
): { label: string; total: number } | null {
	if (group === null || group === undefined) return null;
	const label = typeof group.label === "string" ? group.label.trim() : "";
	if (label.length === 0 || label === MISSING_VALUE) return null;
	return { label, total: normalizeAmount(group.total) };
}

export interface DashboardGroup {
	label: string;
	total: number;
}

export interface DashboardStoryInput {
	/**
	 * Sum of the recognized expenses that carry a usable amount. Kept in the shared summary shape the
	 * surface passes, but no longer restated by the story: `Destacados` already shows `Total gastado`.
	 */
	totalSpending: number;
	/** Recognized expenses with a usable amount the total summed. */
	knownCount: number;
	/** Recognized expenses with no usable amount; disclosed, never summed. */
	pendingAmountCount: number;
	/** Movements the period loaded whose `status` marks them as needing review. */
	reviewCount: number;
	/** The principal category; kept for the shared shape, but no story fact repeats `Destacados`. */
	topCategory: DashboardGroup | null;
	/** The mayor destinatario; kept for the shared shape, but no story fact repeats `Destacados`. */
	topCounterparty: DashboardGroup | null;
}

export interface DashboardStory {
	title: string;
	/** Concise preamble; a populated period keeps it short instead of restating the hero or `Destacados`. */
	summary: string;
	/** Up to `MAX_STORY_FACTS` facts `Destacados` does not already show; each only when its data is. */
	facts: string[];
}

function buildStorySummary(knownCount: number, pendingAmountCount: number): string {
	if (knownCount === 0) {
		return pendingAmountCount > 0
			? "Los gastos reconocidos del periodo todavía no tienen monto conocido: aún no hay una historia que contar."
			: "Todavía no hay gastos reconocidos para contarte el periodo.";
	}
	// A concise preamble only: the period total and the four tile topics are already visible.
	return "Puntos clave del periodo.";
}

/**
 * The story the period loaded supports: a concise period preamble and the few facts the surface shows,
 * capped at `MAX_STORY_FACTS`. One fact is emitted only when the data behind it exists, so an empty
 * period states its lack of information instead of a placeholder number.
 *
 * The facts exclude the period total and the four tile topics. What remains is the review count,
 * so the bottom note summarizes instead of repeating the largest expense.
 */
export function getDashboardStory(input: DashboardStoryInput): DashboardStory {
	const knownCount = normalizeCount(input?.knownCount);
	const pendingAmountCount = normalizeCount(input?.pendingAmountCount);
	const reviewCount = normalizeCount(input?.reviewCount);

	const facts: string[] = [];
	if (reviewCount > 0) {
		facts.push(
			`${reviewCount} ${reviewCount === 1 ? "gasto necesita" : "gastos necesitan"} una revisión rápida.`,
		);
	}
	if (facts.length === 0 && knownCount > 0) {
		facts.push("Tus gastos ya están listos para explorarse en el detalle.");
	}

	return {
		title: STORY_TITLE,
		summary: buildStorySummary(knownCount, pendingAmountCount),
		facts: facts.slice(0, MAX_STORY_FACTS),
	};
}

/** The mayor destinatario, grouped the accent- and case-insensitive way the ranking groups. */
export function getTopCounterpartyGroup(
	movements: RecognizedExpenseMovement[],
): DashboardGroup | null {
	const groups = new Map<string, DashboardGroup>();

	for (const movement of movements ?? []) {
		// The projection already guarantees a finite amount; the guard keeps a caller that bypasses it
		// from turning the totals into `NaN`.
		if (!Number.isFinite(movement?.amount)) continue;
		const amount = Number(movement.amount);
		const label =
			typeof movement?.counterparty === "string" && movement.counterparty.trim().length > 0
				? movement.counterparty.trim()
				: NO_IDENTITY_LABEL;
		const key = label
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase();
		const group = groups.get(key) ?? { label, total: 0 };
		group.total += amount;
		groups.set(key, group);
	}

	const ranked = [...groups.values()].sort(
		(a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"),
	);
	return ranked[0] ?? null;
}

/** Locale ordering with a code-point fallback, including labels the locale collator considers equal. */
function compareNames(a: string, b: string): number {
	return a.localeCompare(b, "es") || (a < b ? -1 : a > b ? 1 : 0);
}

/** Count recipient identities the same accent- and case-insensitive way as the existing total grouping. */
export function getMostFrequentCounterparty(
	movements: RecognizedExpenseMovement[],
): { label: string; count: number } | null {
	const groups = new Map<string, { label: string; count: number }>();
	for (const movement of movements ?? []) {
		if (!Number.isFinite(movement?.amount)) continue;
		const label =
			typeof movement.counterparty === "string" && movement.counterparty.trim()
				? movement.counterparty.trim()
				: NO_IDENTITY_LABEL;
		// An unidentified expense cannot truthfully be presented as a recipient.
		if (label === NO_IDENTITY_LABEL) continue;
		const key = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
		const group = groups.get(key);
		groups.set(key, {
			label: group === undefined || compareNames(label, group.label) < 0 ? label : group.label,
			count: (group?.count ?? 0) + 1,
		});
	}
	return [...groups.entries()]
		.sort((a, b) => b[1].count - a[1].count || compareNames(a[0], b[0]) ||
			compareNames(a[1].label, b[1].label))[0]?.[1] ?? null;
}

/** Raw rows retain whether a category was missing; the display projection cannot distinguish that
 * from a stored category literally named "Sin categoría". Match its recognized/finite predicate. */
export function getUncategorizedExpenses(
	transactions: FinancialTransaction[],
): { count: number; total: number } {
	let count = 0;
	let total = 0;
	for (const transaction of transactions ?? []) {
		if (transaction?.direction !== "outflow" ||
			typeof transaction.kind !== "string" || !recognizedExpenseKinds.has(transaction.kind) ||
			typeof transaction.amount !== "number" || !Number.isFinite(transaction.amount) ||
			(typeof transaction.category === "string" && transaction.category.trim().length > 0)) continue;
		count += 1;
		total += transaction.amount;
	}
	return { count, total };
}

export interface DashboardInsight {
	key: "frequency" | "uncategorized" | "largest" | "latest";
	label: string;
	/** Main text: the recipient or expense identity, or the uncategorized total. */
	value: string;
	/** Raw amount for largest/uncategorized; `null` when no amount should appear. */
	amount: number | null;
	/** Text shown where no amount exists; states the truthful fallback instead of a value. */
	note: string;
	/** Optional clarification below the secondary detail. */
	hint: string;
}

export interface DashboardTopInsights {
	frequency: DashboardInsight;
	uncategorized: DashboardInsight;
	/** Positive only when a real uncategorized outflow can be filtered in the movements view. */
	uncategorizedCount: number;
	largest: DashboardInsight;
	latest: DashboardInsight;
}

export interface DashboardTopInsightsInput {
	frequency: { label: string; count: number } | null;
	uncategorized: { count: number; total: number };
	/** The single largest recognized expense, or `null` when there is none. */
	largest: DashboardGroup | null;
	/** Latest recognized movement of the period, or `null` when there is none. */
	latest: { counterparty: string; date: string } | null;
}

/**
 * The four tile facts, always present with truthful no-data copy. Frequency counts movements,
 * not visits; the uncategorized amount appears only if one or more eligible rows exist.
 */
export function getTopInsights(input: DashboardTopInsightsInput): DashboardTopInsights {
	const frequency = input?.frequency;
	const uncategorized = input?.uncategorized;
	const uncategorizedCount = normalizeCount(uncategorized?.count ?? 0);
	const largest = normalizeGroup(input?.largest);
	const latest = input?.latest ?? null;

	return {
		frequency:
			frequency === null || frequency === undefined || normalizeCount(frequency.count) === 0
				? {
						key: "frequency", label: TOP_FREQUENCY_LABEL, value: MISSING_VALUE,
						amount: null, note: "Sin destinatarios identificados con monto conocido en el periodo.", hint: "",
					}
				: {
						key: "frequency", label: TOP_FREQUENCY_LABEL, value: frequency.label,
						amount: null,
						note: `${normalizeCount(frequency.count)} ${normalizeCount(frequency.count) === 1 ? "movimiento" : "movimientos"}`,
						hint: "",
					},
		uncategorized:
			uncategorizedCount === 0
				? {
						key: "uncategorized", label: UNCATEGORIZED_LABEL, value: MISSING_VALUE,
						amount: null, note: "Sin gastos sin categoría con monto conocido en el periodo.", hint: "",
					}
				: {
						key: "uncategorized", label: UNCATEGORIZED_LABEL,
						value: MISSING_VALUE,
						amount: uncategorized && Number.isFinite(uncategorized.total) ? uncategorized.total : null,
						note: `${uncategorizedCount} ${uncategorizedCount === 1 ? "movimiento" : "movimientos"} sin categoría${uncategorized && Number.isFinite(uncategorized.total) ? "" : "; monto no disponible"}`,
						hint: "",
					},
		uncategorizedCount,
		largest:
			largest === null
				? {
						key: "largest",
						label: TOP_LARGEST_LABEL,
						value: MISSING_VALUE,
						amount: null,
						note: "Sin gastos con monto conocido en el periodo.",
						hint: "",
					}
				: {
						key: "largest",
						label: TOP_LARGEST_LABEL,
						value: largest.label,
						amount: largest.total,
						note: "",
						hint: "",
					},
		latest:
			latest === null
				? {
						key: "latest",
						label: LATEST_MOVEMENT_LABEL,
						value: MISSING_VALUE,
						amount: null,
						note: "Sin movimientos en el periodo.",
						hint: "",
					}
				: {
						key: "latest",
						label: LATEST_MOVEMENT_LABEL,
						value:
							typeof latest.counterparty === "string" && latest.counterparty.trim().length > 0
								? latest.counterparty.trim()
								: NO_IDENTITY_LABEL,
						amount: null,
						note: latest.date,
						hint: "",
					},
	};
}

export interface SpendingKindTotals {
	purchase: number;
	transfer: number;
	payment: number;
}

export interface SpendingBreakdownBar {
	key: "purchase" | "transfer" | "payment";
	label: string;
	/** Raw recognized amount for the kind. */
	amount: number;
	/** Integer share of the recognized quantified total, rounded once. */
	percent: number;
}

export interface SpendingBreakdown {
	/** Recognized quantified total the percentages divide by. */
	total: number;
	bars: SpendingBreakdownBar[];
	/** Message shown instead of bars while `total` is zero, or `null` while there is data. */
	emptyMessage: string | null;
}

/** Legacy's kind labels (`labelForKind`, `public/app.js:3488`). */
const SPENDING_KINDS: Array<{ key: SpendingBreakdownBar["key"]; label: string }> = [
	{ key: "purchase", label: "Compras" },
	{ key: "transfer", label: "Transferencias" },
	{ key: "payment", label: "Pagos" },
];

/**
 * The breakdown bars, derived from the kind totals the summary already computed
 * (`summarizeRecognizedExpensesByKind`). The percentages divide by the recognized quantified total
 * and are rounded once from the raw amounts, so the three bars always describe the same total the
 * hero states. A zero total has no shares, never fabricated ones.
 */
export function getSpendingBreakdown(totals: SpendingKindTotals): SpendingBreakdown {
	const purchase = normalizeAmount(totals?.purchase);
	const transfer = normalizeAmount(totals?.transfer);
	const payment = normalizeAmount(totals?.payment);
	const total = purchase + transfer + payment;
	const byKey: Record<SpendingBreakdownBar["key"], number> = { purchase, transfer, payment };

	return {
		total,
		bars: SPENDING_KINDS.map(({ key, label }) => {
			const amount = byKey[key];
			return {
				key,
				label,
				amount,
				percent: total > 0 ? Math.round((amount / total) * 100) : 0,
			};
		}),
		emptyMessage:
			total > 0 ? null : "Aún no hay gastos reconocidos con monto conocido para distribuir por tipo.",
	};
}
