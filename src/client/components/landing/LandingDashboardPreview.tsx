import { useId } from "react";
import { getDemoTransactions, type DemoDashboardData } from "../../demo-data";
import {
	DashboardLeadView,
	SpendingChartView,
	formatPeriodLabel,
	getRecognizedExpenseMovements,
	summarizeRecognizedExpenses,
} from "../../pages/DashboardPage";
import { CategoryDistributionView } from "../analytics/CategoryDistributionPanel";
import { getCategoryRanking } from "../analytics/categoryRanking";
import { getDashboardLead } from "../analytics/dashboardLead";
import { FULL_PERIOD_TAB_ID, getSpendingChart } from "../analytics/spendingChart";
import "./landing-dashboard-preview.css";

const noSelection = () => {};
const formatAmount = (amount: number) => new Intl.NumberFormat("es-CL", {
	style: "currency", currency: "CLP", maximumFractionDigits: 0,
}).format(amount);

/** A compact, inert illustration of the shipped views, not an account dashboard container. */
export function LandingDashboardPreview({ data, previewError = null }: { data: DemoDashboardData | null; previewError?: string | null }) {
	const instanceId = useId();
	if (data === null) {
		return <div className="landing-dashboard-preview landing-dashboard-preview-loading" role="status">
			<span className="material-symbols-outlined" aria-hidden="true">dashboard</span>
			<p>{previewError ?? "Cargando datos de ejemplo…"}</p>
		</div>;
	}

	const transactions = getDemoTransactions(data);
	const summary = summarizeRecognizedExpenses(transactions);
	const movements = getRecognizedExpenseMovements(transactions);
	const ranking = getCategoryRanking(movements, summary.pendingAmountCount);
	const chart = getSpendingChart(movements, data.period, summary.pendingAmountCount);
	const periodLabel = formatPeriodLabel(data.period);
	const lead = getDashboardLead({
		periodLabel,
		totalSpending: summary.totalSpending,
		expenseCount: summary.count,
		pendingAmountCount: summary.pendingAmountCount,
		incomeAmount: data.currentPeriodInflow > 0 ? data.currentPeriodInflow : null,
		incomeSource: "demo-inflow",
	});

	return <div className="landing-dashboard-preview">
		<p className="landing-dashboard-preview-summary">
			{periodLabel}. Total gastado: {formatAmount(summary.totalSpending)}.
			Saldo disponible: {lead.balance.amount === null ? lead.balance.emptyValue : formatAmount(lead.balance.amount)}.
			Gráficos del dashboard: gasto por día de la semana y distribución por categoría.
			Vista de solo lectura; abre Ver dashboard para explorar todos los datos de ejemplo.
		</p>
		<header className="landing-dashboard-preview-heading">
			<span>Resumen de la cuenta</span>
			<h2>{periodLabel}</h2>
			<p>Datos de ejemplo · Solo lectura</p>
		</header>
		{/* The figure supplies the accessible summary; the real chart controls are visual only. */}
		<div className="landing-dashboard-preview-canvas" inert>
			<DashboardLeadView lead={lead} />
			<SpendingChartView titleId={`${instanceId}-spending-title`} detailId={`${instanceId}-spending-detail`}
				chart={chart} selectedTab={FULL_PERIOD_TAB_ID}
				selectedDayKey={null} onSelectTab={noSelection} onSelectDay={noSelection}
				detailMovements={[]} />
			<CategoryDistributionView titleId={`${instanceId}-category-title`} ranking={ranking} selectedCategory={null}
				onSelect={noSelection} onClearSelection={noSelection}
				onJumpToCategory={noSelection} formatAmount={formatAmount} />
		</div>
	</div>;
}
