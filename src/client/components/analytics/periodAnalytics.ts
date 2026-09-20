import type { FinancialTransaction } from "../../api/types";
import {
	normalizeLocalDateTime,
	recognizedExpenseKinds,
} from "../movements/manualExpense";

/**
 * Period analytics decisions for the authenticated summary: the average expense, the largest expense
 * and the review count.
 *
 * Legacy rendered these three through the support-metric strip (`renderDashboard`,
 * `public/app.js:1287-1315`) and the lead card (`:1390-1420`). The decisions are owned here as pure
 * functions for the same reason the filter and sorting decisions are: the test harness has no DOM, and
 * what these metrics may claim is worth proving without rendering a card.
 *
 * Everything is derived from the movements the summary already loaded for the configured period, so
 * this module issues no request and adds no endpoint. The period itself is not needed either: the rows
 * it receives are already the period's rows.
 *
 * No React import: these are decisions, not rendering.
 */

/** Legacy's label for the average card (`metricCard("Gasto promedio", ...)`, `public/app.js:1291`). */
export const PERIOD_AVERAGE_LABEL = "Gasto promedio";
/** Legacy's label for the largest expense card (`public/app.js:1296`). */
export const PERIOD_LARGEST_LABEL = "Mayor gasto";
/** Legacy's label for the review card (`public/app.js:1301`). */
export const PERIOD_REVIEW_LABEL = "Qué revisar";

/** The status the server emits for a parsed movement whose fields need confirmation (`src/parser.js`). */
const REVIEW_STATUS = "needs_review";

/** The sentinel the shipped surface renders where a value does not exist (`formatMovementDate`). */
const MISSING_VALUE = "—";
/** The identity fallback the shipped surface uses (`getRecognizedExpenseIdentity`, `DashboardPage.tsx`). */
const NO_COUNTERPARTY_LABEL = "Gasto sin identificar";

export interface PeriodAverageMetric {
	label: string;
	/**
	 * Rounded average of the recognized expenses carrying a usable amount, or `null` when none is
	 * usable — the state in which no number may be shown at all.
	 */
	amount: number | null;
	/** Recognized expenses the average was divided by. The copy below states it. */
	divisor: number;
	/** Text shown where the number goes while `amount` is `null`; `null` while a number exists. */
	emptyValue: string | null;
	/** States the divisor, or why no average exists. */
	detail: string;
}

export interface PeriodLargestExpenseMetric {
	label: string;
	/** Counterparty with the surface's fallback: the movement the amount belongs to. */
	counterparty: string;
	amount: number;
	/** Date the movement carries, or the surface's sentinel when it has none. */
	date: string;
}

export interface PeriodReviewMetric {
	label: string;
	/** Movements whose `status` marks them as needing review. */
	count: number;
	/**
	 * One statement per fact. Never a single number folding the review count together with the count of
	 * recognized expenses that carry no known amount: they are different facts.
	 */
	details: string[];
}

export interface PeriodAnalytics {
	average: PeriodAverageMetric;
	/** `null` when no recognized expense carries a usable amount: no largest expense is shown. */
	largest: PeriodLargestExpenseMetric | null;
	review: PeriodReviewMetric;
}

/**
 * The same predicate the summary uses (`isRecognizedExpense`, `DashboardPage.tsx`): an outflow whose
 * kind is one of the recognized expense kinds. Kept as a local function on the shared
 * `recognizedExpenseKinds` set so the two surfaces cannot disagree about what a recognized expense is.
 */
function isRecognizedExpense(transaction: FinancialTransaction): boolean {
	return (
		transaction.direction === "outflow" &&
		typeof transaction.kind === "string" &&
		recognizedExpenseKinds.has(transaction.kind)
	);
}

/**
 * Legacy's rule (`hasKnownAmount`, `public/app.js:2681-2687`), stated explicitly: only a finite number
 * is a usable amount. `null`, a string, `NaN` and `Infinity` are not amounts, so they can neither be
 * summed, nor divided by, nor presented as the largest expense.
 */
function hasUsableAmount(transaction: FinancialTransaction): boolean {
	return typeof transaction.amount === "number" && Number.isFinite(transaction.amount);
}

/** The surface's identity fallback: first non-empty counterparty or description, else the label. */
function getCounterparty(transaction: FinancialTransaction): string {
	for (const value of [transaction.counterparty, transaction.description]) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return NO_COUNTERPARTY_LABEL;
}

/** The date the table would show for this movement, including its sentinel for an unusable date. */
function getMovementDate(transaction: FinancialTransaction): string {
	const normalized = normalizeLocalDateTime(transaction.occurredAt);
	return normalized === null ? MISSING_VALUE : normalized.slice(0, 10);
}

function getExpenseNoun(count: number): string {
	return count === 1 ? "gasto reconocido" : "gastos reconocidos";
}

function getExitNoun(count: number): string {
	return count === 1 ? "salida reconocida" : "salidas reconocidas";
}

/**
 * The average copy, which must always say what it divided by.
 *
 * Legacy divided the known-amount expenses by their own count and fell back to `0` when there were
 * none (`knownExpenses.length ? Math.round(totalSpent / knownExpenses.length) : 0`,
 * `public/app.js:1266-1268`), so an empty period showed an average of zero. There is no average of
 * nothing, so no number is produced here; the substitute replaces it and the copy says why.
 */
function buildAverage(
	divisor: number,
	total: number,
	recognizedCount: number,
): PeriodAverageMetric {
	if (divisor === 0) {
		return {
			label: PERIOD_AVERAGE_LABEL,
			amount: null,
			divisor: 0,
			emptyValue: MISSING_VALUE,
			detail:
				recognizedCount === 0
					? "No hay gastos reconocidos en el periodo: no hay promedio ni mayor gasto que mostrar."
					: recognizedCount === 1
						? "El único gasto reconocido del periodo no tiene un monto conocido: no hay promedio ni mayor gasto que mostrar."
						: `Ninguno de los ${recognizedCount} gastos reconocidos del periodo tiene un monto conocido: no hay promedio ni mayor gasto que mostrar.`,
		};
	}
	return {
		label: PERIOD_AVERAGE_LABEL,
		// Rounded because CLP has no cents; legacy rounded the same way.
		amount: Math.round(total / divisor),
		divisor,
		emptyValue: null,
		detail: `Promedio de ${divisor} ${getExpenseNoun(divisor)} del periodo con monto conocido.`,
	};
}

/**
 * The review copy. `count` is the review count alone; the unknown-amount fact is its own statement, and
 * each appears only when that fact is true.
 *
 * Legacy had one card for both: it showed `String(pendingReviewCount || unknownExpenseCount)` and picked
 * the label of whichever branch won (`public/app.js:1301-1310`), so a movement needing confirmation
 * masked every movement whose amount was unknown, and the two were never stated as the two different
 * facts they are. That folding is exactly what this replaces; only the wording of each statement is
 * adapted from the legacy copy.
 */
function buildReview(count: number, unknownAmountCount: number): PeriodReviewMetric {
	const details = [
		count > 0
			? `${count} ${count === 1 ? "movimiento del periodo necesita" : "movimientos del periodo necesitan"} confirmación.`
			: "Nada urgente por corregir.",
	];
	if (unknownAmountCount > 0) {
		details.push(
			`${unknownAmountCount} ${getExitNoun(unknownAmountCount)} del periodo sin monto conocido.`,
		);
	}
	return { label: PERIOD_REVIEW_LABEL, count, details };
}

/**
 * Everything the three metric cards need for one render of the configured period, derived from the
 * movements the summary already loaded. One pass decides the average's divisor and total, the largest
 * expense, the review count and the unknown-amount count together, so the numbers in the copy can never
 * come from different sets of rows.
 *
 * - the average and the largest expense read the recognized expenses with a usable amount, which is the
 *   same projection the summary's own totals use, so the average the user reads is the total they can
 *   verify divided by the count next to it;
 * - the review count reads `status` across the loaded movements, exactly like legacy's
 *   `reviewableTransactions` (`public/app.js:1594-1597`) minus its month scoping;
 * - movements with no usable amount are counted, disclosed and never averaged.
 */
export function getPeriodAnalytics(transactions: FinancialTransaction[]): PeriodAnalytics {
	let recognizedCount = 0;
	let quantifiedTotal = 0;
	let unknownAmountCount = 0;
	let needsReviewCount = 0;
	let largest: PeriodLargestExpenseMetric | null = null;

	for (const transaction of transactions) {
		if (transaction.status === REVIEW_STATUS) needsReviewCount += 1;
		if (!isRecognizedExpense(transaction)) continue;
		recognizedCount += 1;
		if (!hasUsableAmount(transaction)) {
			unknownAmountCount += 1;
			continue;
		}
		const amount = Number(transaction.amount);
		quantifiedTotal += amount;
		// Legacy's reduce took the first movement and replaced it only on a strict increase
		// (`public/app.js:1269-1273`), so a tie keeps the order the movements were loaded in.
		if (largest === null || amount > largest.amount) {
			largest = {
				label: PERIOD_LARGEST_LABEL,
				counterparty: getCounterparty(transaction),
				amount,
				date: getMovementDate(transaction),
			};
		}
	}

	return {
		average: buildAverage(recognizedCount - unknownAmountCount, quantifiedTotal, recognizedCount),
		largest,
		review: buildReview(needsReviewCount, unknownAmountCount),
	};
}
