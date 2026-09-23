import type { RecognizedExpenseMovement } from "../movements/manualExpense";

/**
 * Dashboard insight decisions for the authenticated summary: the `Lectura rápida` story, the
 * three top insights (principal category, principal comercio/persona, último movimiento) and the
 * visual spending breakdown by kind.
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
 * Currency formatting is injected rather than imported: the surface owns `formatClp`, this module
 * owns the numbers and the copy, exactly like `dashboardLead`.
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
/** Legacy's first insight label (`renderDashboard`, `public/app.js:1317`). */
export const TOP_CATEGORY_LABEL = "Principal categoría";
/** Legacy's second insight label (`public/app.js:1322`). */
export const TOP_COUNTERPARTY_LABEL = "Principal comercio/persona";
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
	/** The principal comercio/persona; kept for the shared shape, but no story fact repeats `Destacados`. */
	topCounterparty: DashboardGroup | null;
	/** The largest recognized expense, or `null` when there is none. */
	largest: DashboardGroup | null;
	/** Formats a CLP amount; injected so the module stays free of currency formatting. */
	formatAmount: (amount: number) => string;
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
	// A concise preamble only: the period total, dates, principal category, counterparty and latest
	// movement already live in the hero and `Destacados`, so restating them here would be redundant.
	return "Puntos clave del periodo.";
}

/**
 * The story the period loaded supports: a concise period preamble and the few facts the surface shows,
 * capped at `MAX_STORY_FACTS`. One fact is emitted only when the data behind it exists, so an empty
 * period states its lack of information instead of a placeholder number.
 *
 * The facts deliberately exclude the principal category and the principal comercio/persona, and the
 * story never restates the period total, its dates or the latest movement: `Destacados` already pairs
 * those. What remains is what the surface would otherwise lose (the largest expense and the review
 * count), so `Lectura rápida` summarizes instead of repeating.
 */
export function getDashboardStory(input: DashboardStoryInput): DashboardStory {
	const formatAmount =
		typeof input?.formatAmount === "function" ? input.formatAmount : (amount: number) => String(amount);
	const knownCount = normalizeCount(input?.knownCount);
	const pendingAmountCount = normalizeCount(input?.pendingAmountCount);
	const reviewCount = normalizeCount(input?.reviewCount);
	const largest = normalizeGroup(input?.largest);

	const facts: string[] = [];
	if (largest !== null) {
		facts.push(`El gasto más alto fue ${formatAmount(largest.total)} en ${largest.label}.`);
	}
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

/** The principal comercio/persona, grouped the accent- and case-insensitive way the ranking groups. */
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

export interface DashboardInsight {
	key: "category" | "counterparty" | "latest";
	label: string;
	/** Main text: the category or comercio name, or the date for the latest movement. */
	value: string;
	/** Raw total when the insight ranks by amount; `null` for the latest-movement fact. */
	amount: number | null;
	/** Text shown where no amount exists; states the truthful fallback instead of a value. */
	note: string;
}

export interface DashboardTopInsights {
	category: DashboardInsight;
	counterparty: DashboardInsight;
	latest: DashboardInsight;
}

export interface DashboardTopInsightsInput {
	/** The principal category, or `null` when there is none. */
	category: DashboardGroup | null;
	/** The principal comercio/persona, or `null` when there is none. */
	counterparty: DashboardGroup | null;
	/** Latest recognized movement of the period, or `null` when there is none. */
	latest: { counterparty: string; date: string } | null;
}

/**
 * The three top insights, always present: each falls back to the shipped sentinel and a truthful
 * reason instead of a fabricated name or amount. The monetary facts carry their raw total so the
 * surface formats it; the latest-movement fact carries its date as the value and the identity as the
 * note, because it ranks by recency, not by amount.
 */
export function getTopInsights(input: DashboardTopInsightsInput): DashboardTopInsights {
	const category = normalizeGroup(input?.category);
	const counterparty = normalizeGroup(input?.counterparty);
	const latest = input?.latest ?? null;

	return {
		category:
			category === null
				? {
						key: "category",
						label: TOP_CATEGORY_LABEL,
						value: MISSING_VALUE,
						amount: null,
						note: "Sin gastos con monto conocido en el periodo.",
					}
				: {
						key: "category",
						label: TOP_CATEGORY_LABEL,
						value: category.label,
						amount: category.total,
						note: "",
					},
		counterparty:
			counterparty === null
				? {
						key: "counterparty",
						label: TOP_COUNTERPARTY_LABEL,
						value: MISSING_VALUE,
						amount: null,
						note: "Sin movimientos con monto conocido en el periodo.",
					}
				: {
						key: "counterparty",
						label: TOP_COUNTERPARTY_LABEL,
						value: counterparty.label,
						amount: counterparty.total,
						note: "",
					},
		latest:
			latest === null
				? {
						key: "latest",
						label: LATEST_MOVEMENT_LABEL,
						value: MISSING_VALUE,
						amount: null,
						note: "Sin movimientos en el periodo.",
					}
				: {
						key: "latest",
						label: LATEST_MOVEMENT_LABEL,
						value: latest.date,
						amount: null,
						note:
							typeof latest.counterparty === "string" && latest.counterparty.trim().length > 0
								? latest.counterparty.trim()
								: NO_IDENTITY_LABEL,
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
