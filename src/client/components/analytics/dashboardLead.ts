/**
 * Dashboard lead decisions for the authenticated summary: the prominent spending total with its
 * period/count detail, and the remaining-balance answer derived only from a configured income.
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
/** The sentinel the surface shows where a real balance does not exist (`dashboardRemainingSummary`). */
export const BALANCE_EMPTY_VALUE = "—";

export interface DashboardLeadInput {
	/** Label of the period the summary is showing, e.g. `2026-02-01 – 2026-02-28`. */
	periodLabel: string;
	/** Sum of the recognized expenses that carry a usable amount. */
	totalSpending: number;
	/** Recognized expenses with a usable amount the total summed. */
	expenseCount: number;
	/** Recognized expenses with no usable amount; disclosed, never summed. */
	pendingAmountCount: number;
	/** Configured income for the period, or `null` when none is configured. */
	incomeAmount: number | null;
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
	/** The configured income the balance subtracts, or `null` when none is configured. */
	incomeAmount: number | null;
	/** `incomeAmount - totalSpending` when configured, otherwise `null`, never a fabricated number. */
	amount: number | null;
	/** Substitute shown where `amount` is `null`, and `null` while a real amount exists. */
	emptyValue: string | null;
	/** Why the value exists or why it does not; always present. */
	detail: string;
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

/** A finite configured income or `null`; a non-number is not a configured income. */
function normalizeIncomeAmount(value: number | null): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
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

/**
 * Legacy's balance rule (`dashboardRemainingSummary`, `public/app.js:1420-1440`), stated without the
 * budget branch legacy also had: with a configured income the balance is a real subtraction; without
 * one there is no number to show, only the reason it cannot be computed. The known-amount total is
 * what it subtracts, so a pending movement is disclosed as not discounted instead of silently
 * shrinking the answer.
 */
function buildBalance(
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
		};
	}
	const pendingCaveat =
		pendingAmountCount > 0
			? ` ${pendingAmountCount} ${getMovementNoun(pendingAmountCount)} sin monto conocido no se ${
					pendingAmountCount === 1 ? "descuenta" : "descuentan"
				}.`
			: "";
	return {
		label: BALANCE_LEAD_LABEL,
		incomeAmount,
		amount: incomeAmount - totalSpending,
		emptyValue: null,
		detail: `Ingreso configurado menos los gastos reconocidos del periodo.${pendingCaveat}`,
	};
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

	return {
		spending: {
			label: SPENDING_LEAD_LABEL,
			amount: totalSpending,
			knownCount,
			pendingAmountCount,
			detail: buildSpendingDetail(periodLabel, knownCount, pendingAmountCount),
		},
		balance: buildBalance(incomeAmount, totalSpending, pendingAmountCount),
	};
}
