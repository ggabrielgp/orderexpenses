/**
 * Period-adapted income and budget decisions for the dashboard truth panel.
 *
 * The product has no budget endpoint and no period-shaped income detection: the authenticated surface
 * only knows the configured cycle's stored `incomeAmount`, while the demo fixture only knows the inflow
 * sum present in its own synthetic movements. Those are different claims, so this module carries the
 * income source and never states a configured cycle for the demo. Budget preferences were month-keyed
 * `localStorage` state the period model never carried (`odd/tasks/analytics-parity.md`,
 * `public/app.js:2141-2145`). This module decides what the panel may state and never fabricates a
 * budget, a percentage, a progress value or a remaining balance: when there is no income the panel says
 * so explicitly, and the budget is always reported as not configured because nothing in the product
 * stores one.
 *
 * Currency formatting is injected rather than imported: the surface owns `formatClp`, this module owns
 * the copy and the presence flags, exactly like `dashboardLead` and `dashboardInsights`.
 *
 * No request, no endpoint, no currency formatting and no React: these are decisions, not rendering.
 */

export const INCOME_BUDGET_TITLE = "Ingreso y presupuesto del periodo";
/** The authenticated surface's stored cycle income. */
export const INCOME_LABEL = "Ingreso configurado";
/** The demo's observed inflow sum: real fixture data, but never a configured cycle. */
export const DEMO_INFLOW_LABEL = "Ingresos del periodo";
export const BUDGET_LABEL = "Presupuesto";

/** The explicit absence values; substitutes, never a fabricated `$0`. */
export const INCOME_ABSENT_VALUE = "Sin ingreso configurado";
export const DEMO_INFLOW_ABSENT_VALUE = "Sin ingresos en la demo";
export const BUDGET_ABSENT_VALUE = "No configurado";

/**
 * Where the stated income comes from. `configured-cycle` is the stored cycle income the authenticated
 * summary loaded; `demo-inflow` is the sum of the inflows present in the demo fixture, which is not a
 * configured cycle and must never be labelled or described as one.
 */
export type DashboardIncomeSource = "configured-cycle" | "demo-inflow";

export interface DashboardTruthValue {
	label: string;
	/** True only when a real value exists; false means an explicit absence is stated. */
	hasValue: boolean;
	/** The formatted amount when `hasValue`, otherwise the explicit absence copy. */
	value: string;
	/** Why the value exists or why it does not; always present. */
	detail: string;
}

export interface DashboardIncomeBudgetPanel {
	title: string;
	/** Configured cycle income or demo inflow, or its explicit absence. */
	income: DashboardTruthValue;
	/** Always an explicit absence: no budget endpoint or stored budget exists. */
	budget: DashboardTruthValue;
}

export interface DashboardIncomeBudgetInput {
	/**
	 * Where `incomeAmount` comes from. Defaults to `configured-cycle` when omitted, preserving the
	 * authenticated copy; the demo must pass `demo-inflow` so the panel never claims a configured cycle.
	 */
	source?: DashboardIncomeSource;
	/** Configured cycle income, or the demo's observed inflow sum; `null`/`undefined` when none. */
	incomeAmount: number | null | undefined;
	/**
	 * Period label the panel used to adapt its copy to, e.g. `28/08/2026 a 21/09/2026`. It is accepted
	 * for callers, but the income copy no longer repeats the range: every value already belongs to the
	 * selected period, so the panel states the income or its absence without echoing the dates.
	 */
	periodLabel: string;
	/** Formats a CLP amount; injected so the module stays free of currency formatting. */
	formatAmount: (amount: number) => string;
}

function normalizeIncome(value: number | null | undefined): number | null {
	// The server stores `null` or a positive whole CLP integer for the cycle income, so a zero is not a
	// configured income: it is the explicit absence, never a fabricated `$0`.
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeSource(source: DashboardIncomeSource | undefined): DashboardIncomeSource {
	// Only the demo opts out of the configured-cycle copy; an absent source keeps the authenticated claim.
	return source === "demo-inflow" ? "demo-inflow" : "configured-cycle";
}

/**
 * The income statement for a configured cycle: the stored amount when one exists, and a concise
 * reason when it does not. The detail never repeats the selected period, because the panel already
 * sits inside it.
 */
function configuredCycleIncome(
	incomeAmount: number | null,
	formatAmount: (amount: number) => string,
): DashboardTruthValue {
	return incomeAmount === null
		? {
				label: INCOME_LABEL,
				hasValue: false,
				value: INCOME_ABSENT_VALUE,
				detail: "No hay un ingreso configurado.",
			}
		: {
				label: INCOME_LABEL,
				hasValue: true,
				value: formatAmount(incomeAmount),
				detail: "Ingreso guardado.",
			};
}

/**
 * The income statement for the demo: the sum of the inflows present in the fixture, stated as demo
 * data. It never claims a configured cycle, and its absence is explicit copy instead of a `$0`
 * amount. Like the authenticated copy, it does not repeat the selected period.
 */
function demoInflowIncome(
	incomeAmount: number | null,
	formatAmount: (amount: number) => string,
): DashboardTruthValue {
	return incomeAmount === null
		? {
				label: DEMO_INFLOW_LABEL,
				hasValue: false,
				value: DEMO_INFLOW_ABSENT_VALUE,
				detail: "La demo no registra ingresos.",
			}
		: {
				label: DEMO_INFLOW_LABEL,
				hasValue: true,
				value: formatAmount(incomeAmount),
				detail: "Ingresos presentes en la demo.",
			};
}

/**
 * The two truthful statements. The income is the stored cycle amount for the authenticated surface and
 * the fixture's observed inflow sum for the demo, each with an explicit absence when there is none; the
 * budget is always the explicit absence, because the product stores no budget to read. Neither branch
 * contains a zero, a percentage, a progress or a remaining value.
 */
export function getDashboardIncomeBudgetPanel(
	input: DashboardIncomeBudgetInput,
): DashboardIncomeBudgetPanel {
	const formatAmount =
		typeof input?.formatAmount === "function" ? input.formatAmount : (amount: number) => String(amount);
	const incomeAmount = normalizeIncome(input?.incomeAmount);
	const income =
		normalizeSource(input?.source) === "demo-inflow"
			? demoInflowIncome(incomeAmount, formatAmount)
			: configuredCycleIncome(incomeAmount, formatAmount);

	return {
		title: INCOME_BUDGET_TITLE,
		income,
		budget: {
			label: BUDGET_LABEL,
			hasValue: false,
			value: BUDGET_ABSENT_VALUE,
			detail: "Este producto todavía no guarda un presupuesto por periodo, así que no hay un monto, un avance ni un saldo que mostrar.",
		},
	};
}
