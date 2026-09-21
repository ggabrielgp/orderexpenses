/**
 * Dashboard lead decisions for the authenticated summary: the prominent spending total with its
 * period/count detail, and the remaining-balance answer. The authenticated surface derives that answer
 * from the configured cycle income; the demo derives it from the fixture's observed inflow sum and never
 * claims a configured cycle, which is why the input carries an explicit income source.
 *
 * Legacy rendered this through `renderDashboardLead` (`public/app.js:1390-1420`): a primary
 * `¿Cuánto gasté?` card whose detail joined the selected period, the known-amount count and the
 * unknown-amount count, plus a `¿Cuánto me queda?` card that computed a balance only when an income
 * was configured and otherwise showed a substitute. The decisions live here as pure functions for
 * the same reason the other analytics decisions do: the test harness has no DOM, and what the
 * balance may claim is worth proving without rendering a card.
 *
 * Unlike the period metrics, this module does not read the movements: the summary already summed the
 * recognized expenses the period loaded (`summarizeRecognizedExpenses`, `DashboardPage.tsx`), and
 * the balance subtracts that same total. Taking the finished numbers is what keeps the lead from
 * disagreeing with the cards below it.
 *
 * No request, no endpoint, no currency formatting and no React: the surface owns `formatClp`, this
 * module owns the numbers and the copy.
 */

/** Legacy's lead question (`renderDashboardLead`, `public/app.js:1396`). */
export const SPENDING_LEAD_LABEL = "¿Cuánto gasté?";
/** Legacy's balance question (`renderDashboardLead`, `public/app.js:1410`). */
export const BALANCE_LEAD_LABEL = "¿Cuánto me queda?";
/**
 * The demo's net is its observed inflows minus the recognized expenses, never a configured-cycle
 * answer, so it gets its own label instead of borrowing the authenticated question.
 */
export const DEMO_BALANCE_LEAD_LABEL = "Balance de la demo";
/** The sentinel the surface shows where a real balance does not exist (`dashboardRemainingSummary`). */
export const BALANCE_EMPTY_VALUE = "—";

/**
 * Where the balance's income comes from. `configured-cycle` is the stored cycle income the
 * authenticated summary loaded; `demo-inflow` is the sum of the inflows present in the demo fixture,
 * which is not a configured cycle and must never be labelled or described as one.
 */
export type DashboardLeadIncomeSource = "configured-cycle" | "demo-inflow";

export interface DashboardLeadInput {
	/** Label of the period the summary is showing, e.g. `2026-02-01 – 2026-02-28`. */
	periodLabel: string;
	/** Sum of the recognized expenses that carry a usable amount. */
	totalSpending: number;
	/** Recognized expenses with a usable amount the total summed. */
	expenseCount: number;
	/** Recognized expenses with no usable amount; disclosed, never summed. */
	pendingAmountCount: number;
	/** Configured income for the period, or the demo's observed inflow sum; `null` when none. */
	incomeAmount: number | null;
	/**
	 * Where `incomeAmount` comes from. Defaults to `configured-cycle` when omitted, preserving the
	 * authenticated copy; the demo must pass `demo-inflow` so the lead never claims a configured cycle.
	 */
	incomeSource?: DashboardLeadIncomeSource;
}

export interface DashboardSpendingLead {
	label: string;
	/** The prominent total, the sum of the known-amount recognized expenses. */
	amount: number;
	/** Recognized expenses with a usable amount the total summed. */
	knownCount: number;
	/** Recognized expenses with no usable amount, stated separately and never added to the total. */
	pendingAmountCount: number;
	/** Period and count statement; the pending count is its own clause, never folded into the total. */
	detail: string;
}

export interface DashboardBalanceLead {
	label: string;
	/** The income the balance subtracts, or `null` when there is none to subtract. */
	incomeAmount: number | null;
	/** `incomeAmount - totalSpending` when an income exists, otherwise `null`, never a fabricated number. */
	amount: number | null;
	/** Substitute shown where `amount` is `null`, and `null` while a real amount exists. */
	emptyValue: string | null;
	/** Why the value exists or why it does not; always present. */
	detail: string;
	/**
	 * The noun the surface labels the subtracted amount with in the derivation line (`ingreso` for a
	 * configured cycle, `ingresos de la demo` for observed demo inflow), or `null` when there is no
	 * amount to derive. Keeping it here means the copy stays in the decision module, not the render.
	 */
	derivationIncomeLabel: string | null;
}

export interface DashboardLead {
	spending: DashboardSpendingLead;
	balance: DashboardBalanceLead;
}

/** A count that cannot be negative or fractional, so the copy never prints a `NaN` or a `-1`. */
function normalizeCount(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** A finite amount or the additive identity; the summary already sums finite amounts only. */
function normalizeAmount(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

/** A finite income or `null`; a non-number is not an income. */
function normalizeIncomeAmount(value: number | null): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Only the demo opts out of the configured-cycle copy; an absent source keeps the authenticated claim. */
function normalizeIncomeSource(
	source: DashboardLeadIncomeSource | undefined,
): DashboardLeadIncomeSource {
	return source === "demo-inflow" ? "demo-inflow" : "configured-cycle";
}

function getExpenseNoun(count: number): string {
	return count === 1 ? "gasto" : "gastos";
}

function getMovementNoun(count: number): string {
	return count === 1 ? "movimiento" : "movimientos";
}

/**
 * Legacy's detail (`renderDashboardLead`, `public/app.js:1399`): the period, how many known-amount
 * expenses the total summed, and — only when there are any — how many were left out for want of an
 * amount. The two counts stay separate clauses instead of one folded number, so a `$0` total next to
 * pending movements cannot read as "you spent nothing".
 */
function buildSpendingDetail(
	periodLabel: string,
	knownCount: number,
	pendingAmountCount: number,
): string {
	const parts = [
		periodLabel.trim(),
		`${knownCount} ${getExpenseNoun(knownCount)} con monto`,
	];
	if (pendingAmountCount > 0) {
		parts.push(`${pendingAmountCount} sin monto claro`);
	}
	return parts.filter((part) => part.length > 0).join(" · ");
}

/** The pending-only clause shared by both sources: a pending movement is disclosed, never discounted. */
function buildPendingCaveat(pendingAmountCount: number): string {
	return pendingAmountCount > 0
		? ` ${pendingAmountCount} ${getMovementNoun(pendingAmountCount)} sin monto conocido no se ${
				pendingAmountCount === 1 ? "descuenta" : "descuentan"
			}.`
		: "";
}

/**
 * Legacy's balance rule (`dashboardRemainingSummary`, `public/app.js:1420-1440`) for the authenticated
 * summary, stated without the budget branch legacy also had: with a configured income the balance is a
 * real subtraction; without one there is no number to show, only the reason it cannot be computed. The
 * known-amount total is what it subtracts, so a pending movement is disclosed as not discounted instead
 * of silently shrinking the answer.
 */
function buildConfiguredBalance(
	incomeAmount: number | null,
	totalSpending: number,
	pendingAmountCount: number,
): DashboardBalanceLead {
	if (incomeAmount === null) {
		return {
			label: BALANCE_LEAD_LABEL,
			incomeAmount: null,
			amount: null,
			emptyValue: BALANCE_EMPTY_VALUE,
			detail:
				"No hay un ingreso configurado para el periodo, así que no se puede calcular cuánto te queda.",
			derivationIncomeLabel: null,
		};
	}
	return {
		label: BALANCE_LEAD_LABEL,
		incomeAmount,
		amount: incomeAmount - totalSpending,
		emptyValue: null,
		detail: `Ingreso configurado menos los gastos reconocidos del periodo.${buildPendingCaveat(pendingAmountCount)}`,
		derivationIncomeLabel: "ingreso",
	};
}

/**
 * The demo has no configured cycle, so the only net it may state is the fixture's observed inflow sum
 * minus the recognized expenses. The number is preserved when the fixture carries an inflow, but the
 * label, the detail and the derivation noun all describe observed demo data instead of a configured
 * income; with no inflow the absence is explicit copy, never a fabricated `$0` or a configured claim.
 */
function buildDemoBalance(
	incomeAmount: number | null,
	totalSpending: number,
	pendingAmountCount: number,
): DashboardBalanceLead {
	if (incomeAmount === null) {
		return {
			label: DEMO_BALANCE_LEAD_LABEL,
			incomeAmount: null,
			amount: null,
			emptyValue: BALANCE_EMPTY_VALUE,
			detail:
				"Los datos de la demo no registran ingresos en el periodo, así que no se puede calcular un balance.",
			derivationIncomeLabel: null,
		};
	}
	return {
		label: DEMO_BALANCE_LEAD_LABEL,
		incomeAmount,
		amount: incomeAmount - totalSpending,
		emptyValue: null,
		detail: `Ingresos observados en los datos de la demo menos los gastos reconocidos del periodo.${buildPendingCaveat(pendingAmountCount)}`,
		derivationIncomeLabel: "ingresos de la demo",
	};
}

/**
 * The source-aware balance: the authenticated summary keeps the configured-cycle subtraction, while the
 * demo states its observed inflows. Both disclose a pending movement the same way, so only the income
 * claim and its label differ.
 */
function buildBalance(
	source: DashboardLeadIncomeSource,
	incomeAmount: number | null,
	totalSpending: number,
	pendingAmountCount: number,
): DashboardBalanceLead {
	return source === "demo-inflow"
		? buildDemoBalance(incomeAmount, totalSpending, pendingAmountCount)
		: buildConfiguredBalance(incomeAmount, totalSpending, pendingAmountCount);
}

/**
 * Everything the hero needs for one render, derived from the summary the page already computed and
 * the configured income the cycle already loaded. The spending total and the balance come from the
 * same two inputs, so the balance is exactly the stated income minus the stated total.
 */
export function getDashboardLead(input: DashboardLeadInput): DashboardLead {
	const totalSpending = normalizeAmount(input?.totalSpending);
	const knownCount = normalizeCount(input?.expenseCount);
	const pendingAmountCount = normalizeCount(input?.pendingAmountCount);
	const periodLabel = typeof input?.periodLabel === "string" ? input.periodLabel : "";
	const incomeAmount = normalizeIncomeAmount(input?.incomeAmount ?? null);
	const incomeSource = normalizeIncomeSource(input?.incomeSource);

	return {
		spending: {
			label: SPENDING_LEAD_LABEL,
			amount: totalSpending,
			knownCount,
			pendingAmountCount,
			detail: buildSpendingDetail(periodLabel, knownCount, pendingAmountCount),
		},
		balance: buildBalance(incomeSource, incomeAmount, totalSpending, pendingAmountCount),
	};
}
