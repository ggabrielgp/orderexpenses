import { useMemo, useState } from "react";
import { getGoogleLoginUrl } from "../../api/googleLogin";
import type { FinancialPeriod, SessionProfile } from "../../api/types";
import { getDemoTransactions, type DemoDashboardData } from "../../demo-data";
import { AccountMenu } from "../account/AccountMenuComponent";
import { DashboardAnalyticsBody } from "../analytics/DashboardAnalyticsPanels";
import { getCategoryRanking } from "../analytics/categoryRanking";
import { getDashboardCounterpartyRanking } from "../analytics/dashboardCounterpartyRanking";
import {
  getDashboardStory,
  getMostFrequentCounterparty,
  getSpendingBreakdown,
  getTopCounterpartyGroup,
  getTopInsights,
  getUncategorizedExpenses,
} from "../analytics/dashboardInsights";
import { getDashboardLead } from "../analytics/dashboardLead";
import { getDashboardPace, type PaceToday } from "../analytics/dashboardPace";
import { getPeriodAnalytics } from "../analytics/periodAnalytics";
import { getSpendingChart } from "../analytics/spendingChart";
import { useAnimatedView } from "../feedback/motion";
import { formatPeriodLabel } from "../movements/manualExpense";
import { MovementsTable } from "../movements/MovementsTable";
import {
  formatMovementDate,
  getRecognizedExpenseIdentity,
  getRecognizedExpenseMovements,
  getSpendingChartDetailMovements,
  selectLatestRecognizedExpense,
  summarizeRecognizedExpenses,
  summarizeRecognizedExpensesByKind,
} from "../movements/movementSummary";
import { AppHeader, type DashboardView } from "../shell/AppHeader";
import { MobileTabBar } from "../shell/MobileTabBar";
import { DemoScenarioControl } from "./DemoScenarioControl";
import { parseDemoPreview } from "./demoPreview";
import { DEFAULT_DEMO_SCENARIO, getDemoScenarioToday, type DemoScenario } from "./demoScenarios";
import { useDemoPreview } from "./useDemoPreview";

export function DashboardPeriodContext({ period }: { period: FinancialPeriod | null }) {
  return period ? <p className="react-dashboard-period-context">Período: {formatPeriodLabel(period)}</p> : null;
}

/**
 * The stable identity the demo header shows in the account slot. It is deliberately pictureless:
 * there is no session behind the demo, so the menu names the demo account instead of pretending a
 * real profile exists, and its only action is login, which leaves demo mode. No settings, sync or
 * mutation action is offered here.
 */
const DEMO_PROFILE: SessionProfile = {
  name: "Usuario demo",
  email: "demo@demo.com",
};

export function DemoDashboardPage({ data, search }: {
  data: DemoDashboardData;
  /** The URL query; defaults to the page's own. Only the demo reads it, to enter preview mode (S25). */
  search?: string;
}) {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  // S25: `?preview=summary|movements` is the landing phones' read-only embed; absent, the demo is unchanged.
  const preview = useMemo(() => parseDemoPreview(query), [query]);
  useDemoPreview(preview);
  const [view, setView] = useAnimatedView<DashboardView>(preview?.view ?? "summary");
  const [requestedCategory, setRequestedCategory] = useState<string | null>(null);
  // S17: the demo opens on "Ajustado"; the choice only changes which day of the cycle is simulated.
  const [scenario, setScenario] = useState<DemoScenario>(preview?.scenario ?? DEFAULT_DEMO_SCENARIO);
  return <DemoDashboardView
    previewMode={preview !== null}
    data={data}
    view={view}
    onViewChange={setView}
    scenario={scenario}
    onScenarioChange={setScenario}
    requestedCategory={requestedCategory ?? undefined}
    onRequestedCategoryChange={setRequestedCategory}
  />;
}

/** Read-only production composition, with local navigation and no mutation capabilities. */
export function DemoDashboardView({ data, view, onViewChange, requestedCategory, onRequestedCategoryChange, today, scenario = DEFAULT_DEMO_SCENARIO, onScenarioChange, previewMode = false }: {
  data: DemoDashboardData;
  /** Embedded as a landing phone (S25): no scenario control and no footer call to action. */
  previewMode?: boolean;
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  requestedCategory?: string;
  onRequestedCategoryChange: (category: string) => void;
  /** Calendar day the gauge measures against; when absent it is the day the scenario simulates. */
  today?: PaceToday;
  /** "Ver la demo como": which pace state the same data is read as (S17). */
  scenario?: DemoScenario;
  onScenarioChange?: (scenario: DemoScenario) => void;
}) {
  // Every value below comes from the same pure modules the authenticated summary uses, over the
  // fixture projected to the server's transaction shape: no API client, no request and no
  // duplicated calculation. The demo mounts the same shared analytics body as the authenticated
  // summary instead of the authenticated summary container, so the mutation dialogs, the
  // account/settings surface and Gmail stay absent by construction. Only read-only selection
  // controls are interactive.
  const transactions = getDemoTransactions(data);
  const summary = summarizeRecognizedExpenses(transactions);
  const movements = getRecognizedExpenseMovements(transactions);
  const detailMovements = getSpendingChartDetailMovements(transactions);
  const periodAnalytics = getPeriodAnalytics(transactions);
  const categoryRanking = getCategoryRanking(movements, summary.pendingAmountCount);
  const counterpartyRanking = getDashboardCounterpartyRanking(transactions);
  const spendingChart = getSpendingChart(movements, data.period, summary.pendingAmountCount);
  const latestExpense = selectLatestRecognizedExpense(transactions, data.period);
  const topCategoryGroup =
    categoryRanking.rows[0] === undefined
      ? null
      : { label: categoryRanking.rows[0].category, total: categoryRanking.rows[0].total };
  const topCounterpartyGroup = getTopCounterpartyGroup(movements);
  const topInsights = getTopInsights({
    frequency: getMostFrequentCounterparty(movements),
    uncategorized: getUncategorizedExpenses(transactions),
    largest:
      periodAnalytics.largest === null
        ? null
        : { label: periodAnalytics.largest.counterparty, total: periodAnalytics.largest.amount },
    latest:
      latestExpense === null
        ? null
        : {
          counterparty: getRecognizedExpenseIdentity(latestExpense),
          date: formatMovementDate(latestExpense.occurredAt),
        },
  });
  const dashboardStory = getDashboardStory({
    totalSpending: summary.totalSpending,
    knownCount: summary.count,
    pendingAmountCount: summary.pendingAmountCount,
    reviewCount: periodAnalytics.review.count,
    topCategory: topCategoryGroup,
    topCounterparty: topCounterpartyGroup,
  });
  const spendingBreakdown = getSpendingBreakdown(summarizeRecognizedExpensesByKind(transactions));
  // The demo has no configured cycle, so the only income it may claim is the fixture's own inflow
  // sum, and only when that sum is a real positive amount. A zero inflow is the explicit no-income
  // state, never a fabricated `$0` income or a remaining balance.
  const demoIncomeAmount =
    Number.isFinite(data.currentPeriodInflow) && data.currentPeriodInflow > 0
      ? data.currentPeriodInflow
      : null;
  const dashboardLead = getDashboardLead({
    periodLabel: formatPeriodLabel(data.period),
    totalSpending: summary.totalSpending,
    expenseCount: summary.count,
    pendingAmountCount: summary.pendingAmountCount,
    incomeAmount: demoIncomeAmount,
    incomeSource: "demo-inflow",
  });
  // The month gauge reads the same income and total the lead states, so both cannot disagree.
  const demoPace = getDashboardPace({
    startDate: data.period.startDate,
    endDateExclusive: data.period.endDateExclusive,
    incomeAmount: demoIncomeAmount,
    totalSpending: summary.totalSpending,
    today: today ?? getDemoScenarioToday({
      startDate: data.period.startDate,
      endDateExclusive: data.period.endDateExclusive,
      incomeAmount: demoIncomeAmount,
      totalSpending: summary.totalSpending,
    }, scenario),
  });
  return (
    <>
      {/* View changes stay local; the account offers login, never mutations. */}
      <AppHeader view={view} onViewChange={onViewChange}>
        <AccountMenu profile={DEMO_PROFILE}>
          <a href={getGoogleLoginUrl()} role="menuitem">Iniciar sesión</a>
        </AccountMenu>
      </AppHeader>
      <main className={`shell react-shell${view === "movements" ? " react-movements-page" : ""}`}>
        <section className="panel product-panel react-dashboard-shell demo-dashboard" aria-labelledby="demo-dashboard-title" data-demo-preview={previewMode ? view : undefined}>
          <header className="react-dashboard-header">
            <div className="react-dashboard-heading">
              <p className="react-dashboard-greeting">Hola, {DEMO_PROFILE.name}</p>
              <h1 id="demo-dashboard-title">{view === "movements" ? "Movimientos" : "Resumen de la cuenta"}</h1>
              <DashboardPeriodContext period={data.period} />
              {view === "summary" && (
                <p className="subtitle">Control y análisis de gastos detectados automáticamente.</p>
              )}
            </div>
            <div className="demo-dashboard-aside">
              <span className="demo-read-only-badge">Datos de ejemplo · Solo lectura</span>
              {view === "summary" && !previewMode && <DemoScenarioControl scenario={scenario} onChange={(next) => onScenarioChange?.(next)} />}
            </div>
          </header>

          {/* The one shared analytics body: the same sections and order as the authenticated summary.
					    The demo supplies synthetic data and local category navigation; the chart detail
					    stays read-only and the account/mutation surfaces never mount. */}
          {view === "summary" ? <DashboardAnalyticsBody
            pace={demoPace}
            periodStartDate={data.period.startDate}
            paceEndExclusive={data.period.endDateExclusive}
            paceReplayKey={scenario}
            hidePaceCurve={previewMode}
            lead={dashboardLead}
            story={dashboardStory}
            chart={spendingChart}
            chartDetailMovements={detailMovements}
            ranking={categoryRanking}
            counterpartyRanking={counterpartyRanking}
            categoryMovements={movements}
            onJumpToCategory={(category) => {
              onRequestedCategoryChange(category);
              onViewChange("movements");
            }}
            insights={topInsights}
            breakdown={spendingBreakdown}
          /> : (
            <MovementsTable
              period={data.period}
              movements={movements}
              pendingAmountCount={summary.pendingAmountCount}
              editableMovements={[]}
              readOnlyReason="Edición deshabilitada en la demo"
              requestedCategory={requestedCategory}
              onEdit={() => { }}
              onRemove={() => { }}
            />
          )}

          {!previewMode && <footer className="demo-dashboard-footer">
            <p>Esta demo no guarda cambios ni se conecta a tu cuenta.</p>
            <a className="button" href={getGoogleLoginUrl()}>Inicia sesión para editar</a>
          </footer>}
        </section>
      </main>
      <MobileTabBar
        view={view}
        onViewChange={onViewChange}
        onAddExpense={previewMode ? () => {} : undefined}
      />
    </>
  );
}
