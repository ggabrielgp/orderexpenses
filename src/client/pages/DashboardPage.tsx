import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { config } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowRightArrowLeft,
  faArrowTrendDown,
  faArrowTrendUp,
  faArrowsRotate,
  faBolt,
  faBullseye,
  faCalendarDays,
  faCartShopping,
  faChartColumn,
  faChartPie,
  faClock,
  faCoins,
  faLightbulb,
  faMinus,
  faReceipt,
  faRightFromBracket,
  faSackDollar,
  faStore,
  faTags,
  faUser,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
// The base Font Awesome stylesheet is imported once here and runtime injection is disabled, so the
// icon sizing works in the browser and in the server-rendered markup the tests read.
import "@fortawesome/fontawesome-svg-core/styles.css";
import {
  createManualExpense,
  clearFinancialDashboardCache,
  deleteCategory,
  getCategories,
  loadFinancialDashboardWithCache,
  refreshFinancialDashboardData,
  writeFinancialDashboardCache,
  removeTransaction,
  syncGmail,
  updateFinancialCycle,
  updateTransaction,
  upsertCategory,
  upsertCounterpartyRule,
} from "../api/client";
import { AccountMenu } from "../components/account/AccountMenu";
import { AppHeader, type DashboardView } from "../components/shell/AppHeader";
import { getPeriodAnalytics } from "../components/analytics/periodAnalytics";
import {
  getDashboardCounterpartyRanking,
  type DashboardCounterpartyRanking,
} from "../components/analytics/dashboardCounterpartyRanking";
import {
  findCategoryRankingRow,
  getCategoryRanking,
  type CategoryRanking,
  type CategoryRankingRow,
} from "../components/analytics/categoryRanking";
import {
  CategoryDetailView,
  CategoryDistributionPanel,
} from "../components/analytics/CategoryDistribution";
import { formatMovementCount } from "../components/analytics/categoryDistribution";
import {
  getDashboardLead,
  type DashboardBalancePercentTone,
  type DashboardLead,
} from "../components/analytics/dashboardLead";
import {
  getDashboardIncomeBudgetPanel,
  type DashboardIncomeBudgetPanel,
} from "../components/analytics/dashboardBudget";
import {
  getDashboardStory,
  getMostFrequentCounterparty,
  getSpendingBreakdown,
  getTopCounterpartyGroup,
  getTopInsights,
  getUncategorizedExpenses,
  type DashboardStory,
  type DashboardTopInsights,
  type SpendingBreakdown,
  type SpendingBreakdownBar,
} from "../components/analytics/dashboardInsights";
import {
  FULL_PERIOD_TAB_ID,
  getSpendingChart,
  getSpendingChartDayDetail,
  getSpendingChartDefaultDayKey,
  getSpendingChartKindLabel,
  getSpendingChartSeries,
  getSpendingChartTotalsRows,
  type SpendingChart,
  type SpendingChartBar,
  type SpendingChartDetailMovement,
  type SpendingChartSeries,
} from "../components/analytics/spendingChart";
import {
  CreateManualExpenseDialog,
  acquireInFlightLock,
  createManualExpenseSubmitter,
  getManualExpenseCreationNotice,
  releaseInFlightLock,
  syncNativeModalDialog,
  type CategorySelectOption,
  type ManualExpenseCreationNotice,
} from "../components/movements/CreateManualExpenseDialog";
import {
  EditMovementDialog,
  createMovementEditSubmitter,
  getMovementEditNotice,
  type MovementEditNotice,
} from "../components/movements/EditMovementDialog";
import { RemoveMovementDialog } from "../components/movements/RemoveMovementDialog";
import { ViewMovementDialog } from "../components/movements/ViewMovementDialog";
import {
  canSubmitRemoval,
  createMovementRemovalSubmitter,
  createRemovalState,
  getRemovalErrorMessage,
  getRemovalNotFoundMessage,
  getRemovalNotice,
  reduceRemovalDismissal,
  reduceRemovalState,
  type RemovalNotice,
  type RemovalState,
} from "../components/movements/removalState";
import { GmailConsentDialog } from "../components/gmail/GmailConsentDialog";
import {
  createGmailConsentState,
  reduceGmailConsent,
  type GmailConsentState,
} from "../components/gmail/gmailConsent";
import { createGmailSyncSubmitter } from "../components/gmail/gmailSync";
import { AccountSettingsDialog } from "../components/settings/AccountSettingsDialog";
import { createCategoryMutationSubmitter } from "../components/settings/categorySettings";
import { createCounterpartyRuleSubmitter } from "../components/settings/counterpartyRules";
import { FinancialCycleEditDialog } from "../components/financial-cycle/FinancialCycleEditDialog";
import { CycleCalendar } from "../components/financial-cycle/CycleCalendar";
import {
  createCalendarRange,
  getCurrentYearCalendarBounds,
  selectCalendarDate,
  validateCalendarRange,
} from "../components/financial-cycle/cycleCalendar";
import {
  createCycleEditSubmitter,
  getCycleEditNotice,
  parseCycleIncome,
  type CycleEditNotice,
} from "../components/financial-cycle/cycleSettings";
import {
  formatIncomeInput,
  formatPeriodLabel,
  getMovementUpdateTarget,
  normalizeLocalDateTime,
  recognizedExpenseKinds,
  type EditableRecognizedExpenseMovement,
  type RecognizedExpenseMovement,
} from "../components/movements/manualExpense";
import {
  createMovementFilterSelection,
  getMovementFilterView,
  reconcileMovementFilterSelection,
  selectMovementFilterCategory,
  type MovementFilterCount,
  type MovementFilterOption,
  type MovementFilterSelection,
  type MovementFilterView,
} from "../components/movements/movementFilters";
import {
  createMovementSortState,
  cycleMovementSort,
  getMovementSortAriaSort,
  getMovementSortIndicator,
  sortMovements,
  type MovementSortKey,
  type MovementSortState,
} from "../components/movements/movementSorting";
import {
  createBulkCategorySubmitter,
  createMovementSelection,
  getBulkCategoryFeedback,
  getBulkCategoryTargets,
  getMovementSelectionView,
  getSelectableMovementIds,
  getSimilarCounterpartyAffordance,
  reconcileMovementSelection,
  selectMovementIds,
  toggleAllMovementSelection,
  toggleMovementSelection,
  type BulkCategoryFeedback,
  type BulkCategorySubmitter,
  type MovementSelection,
  type MovementSelectionView,
} from "../components/movements/movementSelection";
import { getDemoTransactions, type DemoDashboardData } from "../demo-data";
import type {
  Category,
  FinancialDashboardData,
  FinancialPeriod,
  FinancialTransaction,
  RecognizedExpenseKind,
  SessionProfile,
  SessionResponse,
  UpdateFinancialCycleRequest,
} from "../api/types";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../shared/review-period.js";

config.autoAddCss = false;

// The recognized-expense row type is owned by the movements module; it stays re-exported
// here so the page's public type surface is unchanged. `formatPeriodLabel` is re-exported for
// the same reason: one shared definition, an unchanged public surface.
export type { RecognizedExpenseMovement };
export { formatPeriodLabel };

interface DashboardPageProps {
  session: SessionResponse;
}

/**
 * What the financial summary publishes for the Gmail card above it: the period the server has
 * configured, and the cycle-first reload that shows the imported movements.
 *
 * The summary owns both, so it registers them here instead of the page duplicating either. The
 * period is what makes a sync result verifiable at all: the request always carries it, because
 * the server only reports per-query failures in period mode (`src/movements.js:105-113`).
 */
export interface FinancialDashboardHandle {
  /** Configured period, or `null` while no cycle is configured. */
  period: FinancialPeriod | null;
  /** Re-runs the cycle-first dashboard load. Resolves `false` when the reload failed. */
  reload: () => Promise<boolean>;
  /**
   * Opens the configured-period edit dialog. The dialog and its state stay owned by the summary, so
   * the page can render the control in its heading without a second copy of the cycle state.
   */
  onEditPeriod: () => void;
  /** Opens the manual-expense dialog, which the summary still mounts and submits. */
  onCreateExpense: () => void;
}

type FinancialSummaryState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "unconfigured" }
  | { status: "ready"; data: FinancialDashboardData };

type DatedRecognizedExpense = FinancialTransaction & {
  amount: number;
  occurredAt: string;
};

export function isRecognizedExpense(transaction: FinancialTransaction) {
  return (
    transaction.direction === "outflow" &&
    typeof transaction.kind === "string" &&
    recognizedExpenseKinds.has(transaction.kind)
  );
}

export function selectLatestRecognizedExpense(
  transactions: FinancialTransaction[],
  period: FinancialPeriod,
) {
  const reviewPeriod = ReviewPeriod.create(period);
  let latestExpense: DatedRecognizedExpense | null = null;
  let latestDateTime: string | null = null;

  for (const transaction of transactions) {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      continue;
    }
    const normalizedDateTime = normalizeLocalDateTime(transaction.occurredAt);
    if (
      normalizedDateTime === null ||
      !reviewPeriod.includes(normalizedDateTime.slice(0, 10)) ||
      (latestDateTime !== null && normalizedDateTime <= latestDateTime)
    ) {
      continue;
    }
    latestExpense = transaction as DatedRecognizedExpense;
    latestDateTime = normalizedDateTime;
  }

  return latestExpense;
}

export function getRecognizedExpenseIdentity(transaction: Pick<FinancialTransaction, "counterparty" | "description">) {
  for (const value of [transaction.counterparty, transaction.description]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Gasto sin identificar";
}

function formatMovementDate(occurredAt: unknown) {
  const normalizedDateTime = normalizeLocalDateTime(occurredAt);
  return normalizedDateTime === null ? "—" : normalizedDateTime.slice(0, 10);
}

function getMovementCategory(category: unknown) {
  return typeof category === "string" && category.trim()
    ? category.trim()
    : "Sin categoría";
}

export function getRecognizedExpenseMovements(
  transactions: FinancialTransaction[],
): RecognizedExpenseMovement[] {
  return transactions.flatMap((transaction) => {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      return [];
    }
    const rawOccurredAt =
      typeof transaction.occurredAt === "string" ? transaction.occurredAt : "";
    return [{
      id: typeof transaction.id === "string" && transaction.id.trim()
        ? transaction.id.trim()
        : null,
      counterparty: getRecognizedExpenseIdentity(transaction),
      amount: transaction.amount,
      date: formatMovementDate(transaction.occurredAt),
      category: getMovementCategory(transaction.category),
      // The read-only detail projection: the same row, plus the fields the modal names. They
      // come from the stored values only, so an absent field is reported as unavailable
      // instead of being filled with a display fallback the user could mistake for data.
      description: getMovementTextField(transaction.description),
      kind: transaction.kind as RecognizedExpenseKind,
      status: typeof transaction.status === "string" ? transaction.status : null,
      source: typeof transaction.source === "string" ? transaction.source : null,
      occurredAt: normalizeLocalDateTime(transaction.occurredAt),
      hasTime: /\d{2}:\d{2}/.test(rawOccurredAt),
    }];
  });
}

/**
 * The read-only day-detail rows the spending chart shows for a selected bar. It reuses the same
 * recognized/finite predicate as the summary projection and keeps the identity and kind text; the
 * stored timestamp is normalized locally, and a date-only row reports no time instead of a
 * fabricated midnight. Identity stays optional: a row without an id is still readable here, because
 * this surface never offers an edit action.
 */
export function getSpendingChartDetailMovements(
  transactions: FinancialTransaction[],
): SpendingChartDetailMovement[] {
  return transactions.flatMap((transaction) => {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      return [];
    }
    const occurredAt = normalizeLocalDateTime(transaction.occurredAt);
    if (occurredAt === null) return [];
    const rawOccurredAt =
      typeof transaction.occurredAt === "string" ? transaction.occurredAt : "";
    return [{
      id: typeof transaction.id === "string" && transaction.id.trim()
        ? transaction.id.trim()
        : null,
      label: getRecognizedExpenseIdentity(transaction),
      kindLabel: getSpendingChartKindLabel(transaction.kind),
      amount: transaction.amount,
      dateKey: occurredAt.slice(0, 10),
      time: /\d{2}:\d{2}/.test(rawOccurredAt) ? occurredAt.slice(11, 16) : "",
    }];
  });
}

function getMovementTextField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The records the edit dialog can actually PATCH, alongside the read-side projection above.
 *
 * Every exclusion is deliberate and leaves the movement with no edit affordance instead of a
 * broken one:
 * - recognized expenses only, through the same predicate the summary uses;
 * - a finite amount only, because a recognized movement with an unknown or non-finite amount is
 *   reported separately as a pending count and never itemized, so it has no row to edit;
 * - identity and date eligibility is delegated to `getMovementUpdateTarget`, which owns the
 *   rule that a PATCH needs a non-empty id and a parseable original `occurredAt` (the server
 *   derives its single lookup month from that date);
 * - `occurredAt` is normalized to a full local `YYYY-MM-DDTHH:mm:ss` so the edit draft is always
 *   a valid `datetime-local` value, including for the date-only rows the server can store;
 * - the fields start from the stored text rather than from the display fallbacks, so editing an
 *   untouched movement never writes the "Gasto sin identificar"/"Sin categoría" placeholders back
 *   to the server.
 */
export function getEditableRecognizedExpenseMovements(
  transactions: FinancialTransaction[],
): EditableRecognizedExpenseMovement[] {
  return transactions.flatMap((transaction) => {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      return [];
    }
    const target = getMovementUpdateTarget({
      id: transaction.id,
      occurredAt: transaction.occurredAt,
      isManual: transaction.isManual,
    });
    const occurredAt = normalizeLocalDateTime(transaction.occurredAt);
    if (target === null || occurredAt === null) return [];
    return [{
      id: target.movementId,
      counterparty: getMovementTextField(transaction.counterparty),
      amount: transaction.amount,
      date: occurredAt.slice(0, 10),
      category: getMovementTextField(transaction.category),
      description: getMovementTextField(transaction.description),
      kind: transaction.kind as RecognizedExpenseKind,
      direction: "outflow",
      occurredAt,
      isManual: target.isManual,
    }];
  });
}

export function summarizeRecognizedExpenses(transactions: FinancialTransaction[]) {
  return transactions.reduce(
    (summary, transaction) => {
      if (!isRecognizedExpense(transaction)) return summary;
      if (typeof transaction.amount !== "number" || !Number.isFinite(transaction.amount)) {
        return { ...summary, pendingAmountCount: summary.pendingAmountCount + 1 };
      }
      return {
        count: summary.count + 1,
        totalSpending: summary.totalSpending + transaction.amount,
        pendingAmountCount: summary.pendingAmountCount,
      };
    },
    { count: 0, totalSpending: 0, pendingAmountCount: 0 },
  );
}

export function summarizeRecognizedExpensesByKind(transactions: FinancialTransaction[]) {
  return transactions.reduce(
    (totals, transaction) => {
      if (
        !isRecognizedExpense(transaction) ||
        typeof transaction.amount !== "number" ||
        !Number.isFinite(transaction.amount)
      ) {
        return totals;
      }

      switch (transaction.kind) {
        case "purchase":
          totals.purchase += transaction.amount;
          break;
        case "transfer":
          totals.transfer += transaction.amount;
          break;
        case "payment":
          totals.payment += transaction.amount;
      }
      return totals;
    },
    { purchase: 0, transfer: 0, payment: 0 },
  );
}

function formatClp(amount: number) {
  const formatted = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  return amount < 0 ? `-${formatted}` : formatted;
}

export function createFinancialCycleSetupPayload(
  startDate: string,
  endDate: string,
  incomeValue: string,
): UpdateFinancialCycleRequest {
  return {
    selectedPeriod: ReviewPeriod.fromInclusive(startDate, endDate).toJSON(),
    // The same rule the edit draft uses, owned by the cycle module: one income parser for both
    // surfaces instead of two copies that could drift apart.
    incomeAmount: parseCycleIncome(incomeValue),
  };
}

export function DashboardPage({ session }: DashboardPageProps) {
  /**
   * The financial summary publishes its configured period and its reload here, in state rather
   * than in a ref, so the Gmail card's own render sees the period as soon as the summary knows it.
   */
  const [financialDashboard, setFinancialDashboard] = useState<FinancialDashboardHandle | null>(
    null,
  );
  const registerFinancialDashboard = useCallback((handle: FinancialDashboardHandle | null) => {
    setFinancialDashboard(handle);
  }, []);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const refreshFromHeader = async () => {
    if (refreshLock.current || !financialDashboard?.period) return;
    refreshLock.current = true;
    setIsRefreshing(true);
    try {
      await financialDashboard.reload();
    } catch {
      // The summary owns reload errors; the header only owns this button's progress.
    } finally {
      refreshLock.current = false;
      setIsRefreshing(false);
    }
  };
  /**
   * The C1 synchronous lock, reused for the manual sync: React state cannot close the async window,
   * so two clicks in the same tick would otherwise both issue the request.
   */
  const syncLock = useRef(false);
  /**
   * Builds the manual sync request with the configured period and the same cycle-first reload the
   * movements slice uses, so a sync refreshes the list the user is looking at and a failed reload
   * is reported as stale data instead of as a failed sync.
   *
   * While no cycle is configured there is no period to send, and without it the server drops the
   * failure count, so this stays `null`: the card then offers no control it could not describe
   * truthfully.
   */
  const submitGmailSync = useMemo(() => {
    if (financialDashboard === null || financialDashboard.period === null) return null;
    return createGmailSyncSubmitter({
      sync: syncGmail,
      period: financialDashboard.period,
      reload: financialDashboard.reload,
      lock: syncLock,
    });
  }, [financialDashboard]);

  /**
   * Unified account settings surface. It hosts the profile, category administration and
   * counterparty rules behind the single menu entry. It is reachable only from this authenticated
   * tree: the demo route renders `DemoDashboardPage`, a separate read-only composition that never
   * mounts it, so demo writes stay impossible by construction instead of by a guard check.
   */
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  /**
   * Active dashboard view, owned here so the header navigation and the financial body stay in
   * sync. It starts on the summary, exactly like the previous in-body toggle default.
   */
  const [view, setView] = useState<DashboardView>("summary");
  /** The C1 single in-flight lock, reused for the category mutations. */
  const categorySettingsLock = useRef(false);
  const submitCategoryMutation = useMemo(
    () =>
      createCategoryMutationSubmitter({
        upsertCategory,
        deleteCategory,
        lock: categorySettingsLock,
      }),
    [],
  );

  /**
   * Counterparty rule submitter, reachable only from this authenticated tree for the same
   * structural reason as the settings surface.
   *
   * Its submitter owns the period reload the financial summary publishes: the server applies rules
   * while it loads movements, so a stored rule is invisible until the dashboard reloads. While no
   * handle has been published yet (`financialDashboard === null`, which is the state before the
   * summary mounts) the reload is reported as failed rather than as a refresh that never happened.
   */
  /** The C1 single in-flight lock, reused for the counterparty rule mutations. */
  const counterpartyRulesLock = useRef(false);
  const submitCounterpartyRule = useMemo(
    () =>
      createCounterpartyRuleSubmitter({
        upsertRule: upsertCounterpartyRule,
        reload: financialDashboard?.reload ?? null,
        lock: counterpartyRulesLock,
      }),
    [financialDashboard],
  );

  if (!session.authenticated) {
    return (
      <main className="shell react-shell">
        <section className="panel product-panel react-message" aria-labelledby="react-sign-in-title">
          <h1 id="react-sign-in-title">Conecta tu cuenta de Gmail</h1>
          <p className="subtitle">
            Inicia sesión para cargar tu perfil y el estado de la conexión.
          </p>
          <div className="react-shell-actions">
            <GmailConnectControl
              connectUrl={session.gmail.connectUrl}
              accountConnected={session.gmail.connected}
              className="button"
            />
          </div>
        </section>
      </main>
    );
  }

  const profile = session.profile;
  const connected = session.gmail.connected;

  return (
    <>
      {/* Authenticated product chrome. It hosts the one settings action under the shipped
			    account menu, so the unified settings surface keeps its unchanged mutation contract.
			    The demo uses the same chrome with a read-only account menu below. */}
      <AppHeader view={view} onViewChange={setView}>
        {connected && (
          <span className="react-gmail-connected-badge" role="status">
            <span className="react-gmail-connected-badge-dot" aria-hidden="true" />
            Gmail Sincronizado
          </span>
        )}
        <AccountMenu profile={profile}>
          <button
            type="button"
            role="menuitem"
            onClick={() => setIsAccountSettingsOpen(true)}
          >
            Configuración
          </button>
          {/* The authorized sign-out action. It is a plain same-origin anchor, so ending the
					    session is one server GET that clears the user association and returns the
					    unauthenticated app route. The menu keeps its shared keyboard and menuitem
					    semantics; only the danger styling below is specific to this item. */}
          <a
            href="/auth/logout"
            role="menuitem"
            className="react-account-logout"
            onClick={clearFinancialDashboardCache}
          >
            <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
            Cerrar sesión
          </a>
        </AccountMenu>
      </AppHeader>
      <main className={`shell react-shell${view === "movements" ? " react-movements-page" : ""}`}>
        <section className="panel product-panel react-dashboard-shell" aria-labelledby="react-dashboard-title">
          <header className="react-dashboard-header">
            <div className="react-dashboard-heading">
              <p className="react-dashboard-greeting">
                {profile?.name?.trim()
                  ? `Hola, ${profile.name.trim()}`
                  : "Hola, usuario conectado"}
              </p>
              <h1 id="react-dashboard-title">
                {view === "movements" ? "Movimientos" : "Resumen de la cuenta"}
              </h1>
              {view !== "movements" && (
                <p className="subtitle">Control y análisis de gastos detectados automáticamente.</p>
              )}
            </div>
            {/* The Stitch header composition: the configured range as an edit trigger, the
						    cycle-first reload as `Actualizar`, and the manual-expense trigger. The group is
						    absent until a configured period exists, matching the ready state. */}
            {financialDashboard?.period && (
              <div className="react-dashboard-controls">
                {/* The visible range is the edit trigger: it opens the configured-period dialog the summary
								    owns, so the header needs no duplicate cycle state. */}
                <button
                  className="react-dashboard-period"
                  type="button"
                  onClick={financialDashboard.onEditPeriod}
                  aria-label={`Editar periodo: ${formatPeriodLabel(financialDashboard.period)}`}
                >
                  <span className="react-dashboard-period-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faCalendarDays} />
                  </span>
                  <span className="react-dashboard-period-range">
                    {formatPeriodLabel(financialDashboard.period)}
                  </span>
                </button>
                {/* The cycle-first reload the summary publishes: it refetches the selected period's
								    expenses, unlike the route retry that only reloads the session shell. */}
                <button
                  className="secondary react-dashboard-refresh"
                  type="button"
                  onClick={refreshFromHeader}
                  disabled={isRefreshing}
                  aria-busy={isRefreshing}
                  aria-label={isRefreshing ? "Actualizando gastos del periodo" : "Actualizar gastos del periodo"}
                >
                  <FontAwesomeIcon icon={faArrowsRotate} aria-hidden="true" />
                  Actualizar
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={financialDashboard.onCreateExpense}
                >
                  Nuevo gasto
                </button>
              </div>
            )}
          </header>

          {/* Mounted only in this authenticated tree: `DemoDashboardPage` is a separate read-only
					    composition that never mounts the unified settings surface. The one account modal hosts
					    the session profile and the Gmail connection, so the dashboard body starts at its own
					    content instead of repeating that chrome. */}
          <AccountSettingsDialog
            isOpen={isAccountSettingsOpen}
            onClose={() => setIsAccountSettingsOpen(false)}
            profile={profile}
            authenticated={session.authenticated}
            initialConnected={connected}
            connectControl={(accountConnected) => (
              <GmailConnectControl
                connectUrl={session.gmail.connectUrl}
                accountConnected={accountConnected}
                className="button"
              />
            )}
            submitSync={submitGmailSync}
            submitCategoryMutation={submitCategoryMutation}
            submitCounterpartyRule={submitCounterpartyRule}
          />

          <FinancialSummary
            key={profile?.email?.trim().toLowerCase() ?? ""}
            email={profile?.email ?? ""}
            onHandle={registerFinancialDashboard}
            view={view}
            onViewChange={setView}
          />
        </section>
      </main>
    </>
  );
}

interface GmailConnectControlProps {
  /** Server-owned OAuth entry point. The control never builds or rewrites it. */
  connectUrl: string;
  /** Whether a Gmail account is already connected; drives the refusal guard. */
  accountConnected: boolean;
  className?: string;
}

/**
 * Connect entry point for both the anonymous shell and the disconnected status card.
 *
 * It replaces the former direct link to the server-provided OAuth URL, so the user reads the
 * consent before the app leaves for Google. The URL is only handed to the consent dialog; this
 * component never navigates on its own, which is why a dismissed consent simply returns the user
 * to the same control.
 */
export function GmailConnectControl({
  connectUrl,
  accountConnected,
  className,
}: GmailConnectControlProps) {
  const [consent, setConsent] = useState<GmailConsentState>(createGmailConsentState);

  const openConsent = useCallback(() => {
    setConsent((current) => reduceGmailConsent(current, { type: "open", accountConnected }));
  }, [accountConnected]);

  const closeConsent = useCallback(() => {
    setConsent((current) => reduceGmailConsent(current, { type: "cancel" }));
  }, []);

  return (
    <>
      <button className={className} type="button" onClick={openConsent}>
        Conectar Gmail
      </button>
      {/* Only a refused open produces a message, and that message names the real consequence. */}
      {consent.phase === "refused" && consent.message !== null && (
        <p className="react-gmail-consent-refused" role="status">
          {consent.message}
        </p>
      )}
      <GmailConsentDialog
        isOpen={consent.phase === "open"}
        state={consent}
        connectUrl={connectUrl}
        onAcknowledge={(acknowledged) =>
          setConsent((current) =>
            reduceGmailConsent(current, { type: "acknowledge", acknowledged }),
          )
        }
        onClose={closeConsent}
      />
    </>
  );
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

export function DemoDashboardPage({ data }: { data: DemoDashboardData }) {
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
  // The demo shares the authenticated composition, so it mounts the same income/budget truth panel
  // over the demo-inflow source instead of a demo-only layout.
  const incomeBudgetPanel = getDashboardIncomeBudgetPanel({
    source: "demo-inflow",
    incomeAmount: demoIncomeAmount,
    periodLabel: formatPeriodLabel(data.period),
    formatAmount: formatClp,
  });
  return (
    <>
      {/* The demo reuses the authenticated chrome so the header matches the dashboard, but the
			    navigation is inert: it hands the header the fixed summary view and a no-op handler, so
			    Movimientos can never mount the authenticated body, and the account slot offers only the
			    login that leaves demo mode. */}
      <AppHeader view="summary" onViewChange={() => { }}>
        <AccountMenu profile={DEMO_PROFILE}>
          <a href="/auth/google" role="menuitem">Iniciar sesión</a>
        </AccountMenu>
      </AppHeader>
      <main className="shell react-shell">
        <section className="panel product-panel react-dashboard-shell demo-dashboard" aria-labelledby="demo-dashboard-title">
          <header className="react-dashboard-header">
            <div>
              <span className="section-kicker">Demo</span>
              <h1 id="demo-dashboard-title">Resumen mensual de ejemplo</h1>
              <p className="subtitle">Datos sintéticos para conocer Gastos Controlados.</p>
            </div>
            <span className="demo-read-only-badge">Solo lectura</span>
          </header>

          {/* The one shared analytics body: the same sections and order as the authenticated summary.
					    The demo only supplies dummy data and inert capabilities, so the category jump and the
					    chart detail stay read-only and the account/mutation surfaces never mount. */}
          <DashboardAnalyticsBody
            lead={dashboardLead}
            budgetPanel={incomeBudgetPanel}
            story={dashboardStory}
            chart={spendingChart}
            chartDetailMovements={detailMovements}
            ranking={categoryRanking}
            counterpartyRanking={counterpartyRanking}
            categoryMovements={movements}
            onJumpToCategory={() => { }}
            insights={topInsights}
            breakdown={spendingBreakdown}
          />

          <section className="demo-movements" aria-labelledby="demo-movements-title">
            <header className="demo-movements-header">
              <div className="demo-movements-heading">
                <span className="section-kicker">Movimientos</span>
                <h2 id="demo-movements-title">Actividad del periodo</h2>
              </div>
              {/* The same decorative glyph as the authenticated movement card, hidden because the title
							    already names the section. */}
              <span className="react-card-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faReceipt} />
              </span>
            </header>
            <ul>
              {data.movements.slice(0, 6).map((movement) => (
                <li key={movement.id}>
                  <div>
                    <strong>{movement.counterparty}</strong>
                    <span>{movement.category ?? "Sin categoría"} · {movement.occurredAt.slice(0, 10)}</span>
                  </div>
                  <b className={movement.direction === "inflow" ? "demo-inflow" : ""}>
                    {movement.direction === "inflow" ? "+" : "-"}{formatClp(movement.amount)}
                  </b>
                </li>
              ))}
            </ul>
          </section>

          <footer className="demo-dashboard-footer">
            <p>Esta demo no guarda cambios ni se conecta a tu cuenta.</p>
            <a className="button" href="/auth/google">Inicia sesión para editar</a>
          </footer>
        </section>
      </main>
    </>
  );
}

export interface DashboardLeadViewProps {
  /** The decided lead, from `getDashboardLead`. */
  lead: DashboardLead;
}

/**
 * The free solid icon each available-income direction uses. The tone is decided by the analytics
 * module, so the surface only maps it to an icon and never re-interprets the number.
 */
const BALANCE_PERCENT_ICONS: Record<DashboardBalancePercentTone, typeof faArrowTrendUp> = {
  positive: faArrowTrendUp,
  flat: faMinus,
  negative: faArrowTrendDown,
};

/**
 * The compact Spanish status the adjacent flag names for each tone the analytics module decided. The
 * module owns the threshold behind `availablePercentTone`; this surface only maps its tone to copy, so
 * no rule is re-derived from the number here.
 */
const BALANCE_STATUS_LABELS: Record<DashboardBalancePercentTone, string> = {
  positive: "En control",
  flat: "Al límite",
  negative: "En peligro",
};

/**
 * The hero: the prominent `Total gastado` total with its period/count detail, and the
 * `Saldo disponible` answer.
 *
 * Exported so both states of the balance are provable from a static render, like the other analytics
 * panels: a live summary only ever reaches its loading state without a session. The component renders
 * the decisions the pure module made and formats their amounts; it computes no balance of its own.
 *
 * The balance shows a number only when the module derived one from an income: the configured cycle
 * income on the authenticated summary, or the demo's observed inflows. Without one the value is the
 * shipped sentinel, never a fabricated `$0`, and the detail says why. Both cards always render, so the
 * authenticated summary and the read-only demo differ in the income source and its copy, not in layout.
 */
export function DashboardLeadView({ lead }: DashboardLeadViewProps) {
  return (
    <section className="react-dashboard-lead" aria-label="Resumen principal del periodo">
      <article className="react-lead-primary">
        <div className="react-lead-primary-heading">
          <span className="react-lead-question">{lead.spending.label}</span>
          {/* Decorative: the label beside it already names the card, so the glyph is hidden. */}
          <span className="react-card-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faCoins} />
          </span>
        </div>
        <strong className="react-lead-amount">{formatClp(lead.spending.amount)}</strong>
        <p className="react-lead-detail">{lead.spending.detail}</p>
      </article>
      <article className="react-lead-answer">
        <div className="react-lead-answer-heading">
          <span className="react-lead-answer-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faWallet} />
          </span>
          <span className="react-lead-question">{lead.balance.label}</span>
        </div>
        <strong className="react-lead-amount">
          {lead.balance.amount === null
            ? lead.balance.emptyValue
            : formatClp(lead.balance.amount)}
        </strong>
        {/* The `ingreso − gastos` derivation is deliberately not rendered and the positive detail is
				    only the pending caveat: an empty value renders no paragraph and adds no visual spacing. */}
        {lead.balance.detail.length > 0 && (
          <p className="react-lead-detail">{lead.balance.detail}</p>
        )}
        {/* The percentage row is derived only from the amount and income above; without a truthful
				    base the module returns `null` and the row is omitted instead of fabricated. The number and
				    its trend icon carry the tone colour the module decided, and the adjacent compact flag names
				    that same tone in Spanish with the matching soft surface. */}
        {lead.balance.availablePercent !== null &&
          lead.balance.availablePercentTone !== null && (
            <div className="react-lead-balance-status-row">
              <span
                className={`react-lead-balance-percent react-lead-balance-percent-${lead.balance.availablePercentTone}`}
              >
                <FontAwesomeIcon
                  icon={BALANCE_PERCENT_ICONS[lead.balance.availablePercentTone]}
                  aria-hidden="true"
                />
                <span>{lead.balance.availablePercent}%</span>
              </span>
              <span
                className={`react-lead-balance-status react-lead-balance-status-${lead.balance.availablePercentTone}`}
              >
                {BALANCE_STATUS_LABELS[lead.balance.availablePercentTone]}
              </span>
            </div>
          )}
      </article>
    </section>
  );
}

export interface DashboardBudgetPanelProps {
  /** The decided income/budget truth, from `getDashboardIncomeBudgetPanel`. */
  panel: DashboardIncomeBudgetPanel;
}

/**
 * The period-adapted income/budget truth panel, mounted by the shared analytics body for both the
 * authenticated summary and the read-only demo.
 *
 * It states the configured cycle income when one exists and an explicit absence otherwise, and
 * always reports the budget as not configured, because the product stores no budget to read. It
 * renders only the decisions the pure module made: no fabricated zero, percentage, progress or
 * remaining value. Its configured-cycle and demo-inflow sources keep different, truthful copy, so the
 * demo never borrows the authenticated claim.
 */
export function DashboardBudgetPanel({ panel }: DashboardBudgetPanelProps) {
  return (
    <section className="react-budget-panel" aria-labelledby="react-budget-panel-title">
      <h3 id="react-budget-panel-title">{panel.title}</h3>
      <div className="react-financial-grid">
        <article className="react-financial-card">
          <span>{panel.income.label}</span>
          <strong>{panel.income.value}</strong>
          <p>{panel.income.detail}</p>
          {/* Decorative: the adjacent label names the card, so the glyph is hidden. */}
          <span className="react-card-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faSackDollar} />
          </span>
        </article>
        <article className="react-financial-card">
          <span>{panel.budget.label}</span>
          <strong>{panel.budget.value}</strong>
          <p>{panel.budget.detail}</p>
          <span className="react-card-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faBullseye} />
          </span>
        </article>
      </div>
    </section>
  );
}

/**
 * The category ranking as one already-decided state: the ranked rows, and the detail of the selected
 * row when there is one.
 *
 * Exported so both the list and the detail markup are provable from a static render, like
 * other analytics views: a live summary only ever reaches the list without a session, and what the
 * detail claims is worth proving from what the user reads. The component renders the decisions the
 * pure module made and computes nothing of its own.
 *
 * The merged tail offers no jump: `Otras categorías` is not a category the movement filter can
 * select, so a control that pretended otherwise would narrow the table to nothing. Its detail lists
 * the categories it merged, which is the part of the distribution a user can still act on.
 */
export interface CategoryRankingViewProps {
  /** The decided ranking, from `getCategoryRanking`. */
  ranking: CategoryRanking;
  /** Category whose detail is shown, or `null` for the ranked list. */
  selectedCategory: string | null;
  onSelect: (category: string) => void;
  onClearSelection: () => void;
  /** Jumps into the movement table filter; never called for the merged tail. */
  onJumpToCategory: (category: string) => void;
}

export function CategoryRankingView({
  ranking,
  selectedCategory,
  onSelect,
  onClearSelection,
  onJumpToCategory,
}: CategoryRankingViewProps) {
  const selectedRow: CategoryRankingRow | null =
    selectedCategory === null ? null : findCategoryRankingRow(ranking, selectedCategory);

  return (
    <section className="react-category-ranking" aria-labelledby="react-category-ranking-title">
      <h3 id="react-category-ranking-title">Gasto reconocido por categoría</h3>
      {/* The excluded outflows are their own fact, stated only when there is one to state. */}
      {ranking.disclosure !== null && (
        <p className="react-category-ranking-disclosure" role="status">{ranking.disclosure}</p>
      )}
      {ranking.rows.length === 0 ? (
        <p className="react-category-ranking-empty" role="status">
          Aún no hay gastos con monto conocido para distribuir por categoría en este periodo.
        </p>
      ) : selectedRow === null ? (
        <ul className="react-category-ranking-list">
          {ranking.rows.map((row) => (
            <li key={row.category}>
              <button
                type="button"
                className="react-category-ranking-row"
                onClick={() => onSelect(row.category)}
              >
                <strong>{row.category}</strong>
                <small>
                  {formatClp(row.total)} · {row.share}% · {formatMovementCount(row.count)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <CategoryDetailView
          row={selectedRow}
          onClearSelection={onClearSelection}
          onJumpToCategory={onJumpToCategory}
          formatAmount={formatClp}
        />
      )}
    </section>
  );
}

/**
 * The legacy `Dónde se fue tu plata` mount point: it hands the decided ranking, the stored colours
 * and the jump to the distribution container, which owns the selection. The jump stays the
 * summary's, because only the summary can switch to the movements view and carry the requested
 * category into it.
 */
export interface CategoryRankingPanelProps {
  ranking: CategoryRanking;
  /** Stored category catalog, used for the donut and legend colours. */
  catalog?: readonly Category[];
  onJumpToCategory: (category: string) => void;
  movements?: readonly RecognizedExpenseMovement[];
  onOpenMovement?: (movementId: string) => void;
}

export function CategoryRankingPanel({ ranking, catalog, onJumpToCategory, movements, onOpenMovement }: CategoryRankingPanelProps) {
  return (
    <CategoryDistributionPanel
      ranking={ranking}
      catalog={catalog}
      onJumpToCategory={onJumpToCategory}
      formatAmount={formatClp}
      movements={movements}
      onOpenMovement={onOpenMovement}
    />
  );
}

/**
 * Accessible name of one bar: it names the day and, when it carries a value, the total it selects.
 * A padded day outside the period is stated as outside instead of claiming a zero.
 */
function getSpendingChartBarLabel(series: SpendingChartSeries, day: SpendingChartBar): string {
  if (!day.isInPeriod) return `${day.label}, fuera del periodo`;
  const prefix =
    series.mode === "period"
      ? `Ver detalle de ${day.titleDetail ?? day.label}`
      : `Ver detalle de ${day.label} ${day.detail}`;
  return `${prefix}: ${day.total > 0 ? formatClp(day.total) : "$0"}`;
}

/**
 * Native hover tooltip for one bar track, restored from legacy's `track.title`
 * (`public/app.js:2286-2289`): the weekday label plus the day's date (or the period-wide weekday
 * detail) and its total, and the explicit "outside the period" wording for a padded day.
 */
function getSpendingChartBarTitle(day: SpendingChartBar): string {
  if (!day.isInPeriod) return `${day.label}: fuera del periodo`;
  const detail = day.titleDetail ?? day.detail;
  return `${day.label} · ${detail}: ${day.total > 0 ? formatClp(day.total) : "$0"}`;
}

/**
 * The spending chart as one already-decided state: the selected series, its proportional bars, the
 * read-only detail of the selected bar and the totals summary grid.
 *
 * Exported so the populated and empty markup are provable from a static render, like the other
 * analytics panels. The component renders the heights, the detail and the totals the pure module
 * decided and computes nothing of its own beyond the string labels that need the page formatter.
 *
 * Bars are selectable buttons again, like legacy's `weekly-bar` buttons (`public/app.js:2277`), so
 * each one carries `aria-pressed` and `aria-controls` for the detail panel. A padded day outside the
 * period is disabled and cannot become the selected day. The detail itself offers no edit or delete
 * action: a row with an identity can open the read-only movement dialog, and a row without one stays
 * plain text. `onOpenMovement` is optional so the read-only demo can select bars without ever
 * mounting a dialog.
 */
export interface SpendingChartViewProps {
  /** The decided chart, from `getSpendingChart`. */
  chart: SpendingChart;
  /** Id of the tab whose series is shown; an unknown id falls back to the full period. */
  selectedTab: string;
  onSelectTab: (tabId: string) => void;
  /** Calendar key of the selected bar, or `null` while none is selected. */
  selectedDayKey: string | null;
  onSelectDay: (dayKey: string) => void;
  /** Recognized outflow rows the read-only detail reads. */
  detailMovements: SpendingChartDetailMovement[];
  /** Opens the read-only movement dialog for a row identity; absent keeps every row inert. */
  onOpenMovement?: (movementId: string) => void;
}

const DAY_DETAIL_ID = "react-spending-chart-day-detail";

export function SpendingChartView({
  chart,
  selectedTab,
  onSelectTab,
  selectedDayKey,
  onSelectDay,
  detailMovements,
  onOpenMovement,
}: SpendingChartViewProps) {
  const series = getSpendingChartSeries(chart, selectedTab);
  const selectedDay =
    selectedDayKey === null ? null : series.days.find((day) => day.key === selectedDayKey) ?? null;
  const detail = getSpendingChartDayDetail(series, selectedDay, detailMovements);
  const totalsRows = getSpendingChartTotalsRows(chart, series.id);
  const [startDate, endDate] = series.detail.split(" - ");
  return (
    <section className="react-spending-chart" aria-labelledby="react-spending-chart-title">
      <div className="react-spending-chart-header">
        <h3 id="react-spending-chart-title">Gasto por día de la semana</h3>
        {/* Decorative: the adjacent title names the card, so the glyph is hidden. */}
        <span className="react-card-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faChartColumn} />
        </span>
      </div>
      {/* Each excluded fact is its own statement, only when there is one to state. */}
      {chart.disclosures.map((disclosure) => (
        <p key={disclosure} className="react-spending-chart-disclosure" role="status">
          {disclosure}
        </p>
      ))}
      {!chart.hasData ? (
        <p className="react-spending-chart-empty" role="status">
          {chart.emptyMessage}
        </p>
      ) : (
        <>
          <div
            className="react-spending-chart-tabs"
            role="group"
            aria-label="Periodo del gráfico de gastos"
          >
            {chart.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="react-spending-chart-tab"
                aria-pressed={tab.id === series.id}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="react-spending-chart-heading">
            <span>
              <strong>{startDate}</strong>
              {endDate !== undefined && <>{" - "}<strong>{endDate}</strong></>}
            </span>
          </div>
          <div className="react-spending-chart-body">
            <div className="react-spending-chart-bars" role="region" aria-label={series.ariaLabel}>
              {series.days.map((day) => {
                const isSelected = day.key === selectedDayKey;
                return (
                  <button
                    key={day.key}
                    type="button"
                    className={
                      isSelected
                        ? "react-spending-chart-bar react-spending-chart-bar-selected"
                        : "react-spending-chart-bar"
                    }
                    aria-pressed={isSelected}
                    aria-controls={DAY_DETAIL_ID}
                    aria-label={getSpendingChartBarLabel(series, day)}
                    disabled={!day.isInPeriod}
                    onClick={() => onSelectDay(day.key)}
                  >
                    <span
                      className={day.isInPeriod && day.total > 0
                        ? "react-spending-chart-value react-spending-chart-value-positive"
                        : "react-spending-chart-value"}
                      aria-hidden="true"
                    >
                      {day.isInPeriod
                        ? day.total > 0 ? formatClp(day.total) : "$0"
                        : null}
                    </span>
                    <span
                      className={
                        day.isInPeriod
                          ? "react-spending-chart-track"
                          : "react-spending-chart-track react-spending-chart-track-empty"
                      }
                      title={getSpendingChartBarTitle(day)}
                    >
                      {day.isInPeriod && day.total > 0 && (
                        <span
                          className="react-spending-chart-fill"
                          style={{
                            height: `${day.heightPercent}%`,
                            backgroundColor: `hsl(219 85% ${72 - 37 * day.total / series.max}%)`,
                          }}
                        />
                      )}
                    </span>
                    <strong className="react-spending-chart-day">{day.label}</strong>
                    <small className="react-spending-chart-detail">{day.detail}</small>
                  </button>
                );
              })}
            </div>
            <aside
              className="react-spending-chart-summary"
              aria-label="Resumen de gastos del periodo"
            >
              <h4>Resumen del periodo</h4>
              {totalsRows.map((row) => (
                <div
                  key={row.id}
                  className={
                    row.isActive
                      ? "react-spending-chart-summary-row react-spending-chart-summary-row-active"
                      : "react-spending-chart-summary-row"
                  }
                  aria-current={row.isActive ? "true" : undefined}
                  aria-label={
                    row.isActive
                      ? `${row.label} seleccionado: ${formatClp(row.total)}`
                      : undefined
                  }
                >
                  <span>{row.label}:</span>
                  <strong>{formatClp(row.total)}</strong>
                </div>
              ))}
            </aside>
            <aside
              id={DAY_DETAIL_ID}
              className="react-spending-chart-day-panel"
              aria-live="polite"
            >
              <header className="react-spending-chart-day-header">
                <h4>{detail.title}</h4>
                {selectedDay?.isInPeriod && (
                  <strong className="react-spending-chart-day-total">
                    {detail.total > 0 ? formatClp(detail.total) : "$0"}
                  </strong>
                )}
              </header>
              {detail.groups.length === 0 ? (
                <p className="react-spending-chart-day-empty">
                  {detail.isEmpty
                    ? "No hay gastos con monto conocido para este día."
                    : "Elige un día del gráfico para ver qué gastos forman ese total."}
                </p>
              ) : (
                detail.groups.map((group) => (
                  <div key={group.key} className="react-spending-chart-day-group">
                    <span className="react-spending-chart-day-date">{group.label}</span>
                    <ul className="react-spending-chart-day-list">
                      {group.movements.map((movement) => {
                        const movementId = movement.id;
                        const rowContent = (
                          <>
                            <span className="react-spending-chart-day-identity">
                              <span className="react-spending-chart-day-person" aria-hidden="true">
                                <FontAwesomeIcon icon={faUser} />
                              </span>
                              <span className="react-spending-chart-day-info">
                                <strong>
                                  {movement.time
                                    ? `${movement.time} · ${movement.label}`
                                    : movement.label}
                                </strong>
                                <small>{movement.kindLabel}</small>
                              </span>
                            </span>
                            <strong className="react-spending-chart-day-amount">
                              {formatClp(movement.amount)}
                            </strong>
                          </>
                        );
                        return (
                          <li
                            key={
                              movementId ??
                              `${movement.dateKey}-${movement.time}-${movement.label}-${movement.amount}`
                            }
                            className="react-spending-chart-day-item"
                          >
                            {onOpenMovement !== undefined && movementId !== null ? (
                              <button
                                type="button"
                                className="react-spending-chart-day-open"
                                onClick={() => onOpenMovement(movementId)}
                              >
                                {rowContent}
                              </button>
                            ) : (
                              rowContent
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The spending chart container: it owns which period tab and which bar are selected and hands that
 * decided state to the view. It starts on the full period, like legacy's `chartTab: "month"`
 * (`public/app.js:145`), selects Monday of that aggregate, and reselects the default bar of the new
 * series whenever the tab changes (`public/app.js:2261`).
 */
export interface SpendingChartPanelProps {
  chart: SpendingChart;
  /** Recognized outflow rows for the read-only detail; empty when the caller has none. */
  detailMovements?: SpendingChartDetailMovement[];
  /** Opens the read-only movement dialog for a row identity; absent keeps every row inert. */
  onOpenMovement?: (movementId: string) => void;
}

export function SpendingChartPanel({
  chart,
  detailMovements = [],
  onOpenMovement,
}: SpendingChartPanelProps) {
  const [selectedTab, setSelectedTab] = useState<string>(FULL_PERIOD_TAB_ID);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(() =>
    getSpendingChartDefaultDayKey(getSpendingChartSeries(chart, FULL_PERIOD_TAB_ID)),
  );
  const handleSelectTab = (tabId: string) => {
    setSelectedTab(tabId);
    setSelectedDayKey(getSpendingChartDefaultDayKey(getSpendingChartSeries(chart, tabId)));
  };
  return (
    <SpendingChartView
      chart={chart}
      selectedTab={selectedTab}
      onSelectTab={handleSelectTab}
      selectedDayKey={selectedDayKey}
      onSelectDay={setSelectedDayKey}
      detailMovements={detailMovements}
      onOpenMovement={onOpenMovement}
    />
  );
}

/** Compact ranking of stored identities, shared by authenticated and demo period views. */
function DashboardCounterpartyRankingView({ ranking }: { ranking: DashboardCounterpartyRanking }) {
  return (
    <section className="react-counterparty-ranking" aria-labelledby="react-counterparty-ranking-title">
      <header className="react-counterparty-ranking-header">
        <div className="react-counterparty-ranking-heading">
          <span className="react-counterparty-ranking-heading-icon" aria-hidden="true"><FontAwesomeIcon icon={faStore} /></span>
          <div>
            <h3 id="react-counterparty-ranking-title">Top Comercios y Personas</h3>
            <p>Destinatarios identificados de tus gastos.</p>
          </div>
        </div>
        <div className="react-counterparty-ranking-header-actions">
          <span className="react-counterparty-ranking-badge">Ranking del periodo</span>
        </div>
      </header>
      {ranking.rows.length === 0 ? (
        <p className="react-counterparty-ranking-empty">No hay destinatarios identificados con monto conocido en este periodo.</p>
      ) : (
        <ul className="react-counterparty-ranking-list">
          {ranking.rows.slice(0, 4).map((row, index) => {
            const initials = row.name.split(" ").slice(0, 2)
              .map((word) => Array.from(word)[0]?.toLocaleUpperCase("es") ?? "").join("");
            return (
              <li key={row.name} className="react-counterparty-ranking-row">
                <span className={`react-counterparty-ranking-avatar react-counterparty-ranking-avatar-${index % 4}`} aria-hidden="true">
                  {initials}<span className="react-counterparty-ranking-rank">{index + 1}</span>
                </span>
                <div className="react-counterparty-ranking-detail">
                  <div className="react-counterparty-ranking-line">
                    <strong>{row.name}</strong>
                    <b>{Number.isFinite(row.total) ? formatClp(row.total) : "Monto no disponible"}</b>
                  </div>
                  <div className="react-counterparty-ranking-meta">
                    <span>{row.count} {row.count === 1 ? "movimiento" : "movimientos"}</span>
                    <span>{row.share === null ? "Porcentaje no disponible" : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(row.share)}% del gasto cuantificado`}</span>
                  </div>
                  <div className="react-counterparty-ranking-track" aria-hidden="true">
                    <span style={{ width: `${Math.max(0, Math.min(100, row.share ?? 0))}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="react-counterparty-ranking-denominator">
        Base: {Number.isFinite(ranking.allRecognizedQuantifiedSpending) ? formatClp(ranking.allRecognizedQuantifiedSpending) : "monto no disponible"} de todos los gastos reconocidos con monto conocido del periodo, incluidos los no identificados.
        {ranking.unnamedCount > 0 && ` ${ranking.unnamedCount} ${ranking.unnamedCount === 1 ? "movimiento sin destinatario identificado" : "movimientos sin destinatario identificado"} incluidos en la base.`}
        {(!Number.isFinite(ranking.allRecognizedQuantifiedSpending) || ranking.allRecognizedQuantifiedSpending <= 0) && " No se calcula un porcentaje sin una base positiva y finita."}
      </p>
    </section>
  );
}

export interface TopInsightsViewProps {
  /** The decided insights, from `getTopInsights`. */
  insights: DashboardTopInsights;
  /** The non-duplicative period note, from `getDashboardStory`. */
  story: DashboardStory;
  /** Authenticated category-filter jump; omitted by the read-only demo. */
  onJumpToUncategorized?: () => void;
}

/**
 * The one free solid glyph each top insight keeps beside its label. The label already names the
 * insight, so the glyph is decorative and never carries information on its own.
 */
const TOP_INSIGHT_ICONS: Record<"frequency" | "uncategorized" | "largest" | "latest", typeof faTags> = {
  frequency: faStore,
  uncategorized: faTags,
  largest: faBolt,
  latest: faClock,
};

/**
 * The `Lectura rápida · Inteligencia de gastos` card keeps its existing four equal tiles and period
 * note. Its optional authenticated category action remains separate from the ranking above it.
 */
export function TopInsightsView({ insights, story, onJumpToUncategorized }: TopInsightsViewProps) {
  const tiles = [insights.largest, insights.frequency, insights.latest, insights.uncategorized];
  return (
    <section className="react-top-insights" aria-labelledby="react-top-insights-title">
      <header className="react-top-insights-header">
        <div className="react-top-insights-heading">
          {/* Decorative: the adjacent title names the card, so the glyph is hidden. */}
          <span className="react-card-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faLightbulb} />
          </span>
          <h3 id="react-top-insights-title">Lectura rápida · Inteligencia de gastos</h3>
        </div>
        <p className="react-top-insights-subtitle">Tus datos más relevantes del periodo.</p>
        {/* A compact, supported badge: it names what the card summarizes without claiming AI. */}
        <span className="react-top-insights-badge">Resumen del periodo</span>
      </header>
      <ul className="react-top-insights-grid">
        {tiles.map((insight) => (
          <li key={insight.key} className={`react-insight-callout react-insight-callout-${insight.key}`}>
            <div className="react-insight-callout-header">
              <span className="react-insight-callout-label">{insight.label}</span>
              {/* Decorative: the adjacent label names the insight, so the glyph is hidden. */}
              <span className="react-insight-callout-icon" aria-hidden="true">
                <FontAwesomeIcon icon={TOP_INSIGHT_ICONS[insight.key]} />
              </span>
            </div>
            <strong className="react-insight-callout-value">
              {insight.key === "uncategorized" && insight.amount !== null
                ? formatClp(insight.amount) : insight.value}
            </strong>
            <p className="react-insight-callout-detail">
              {insight.key === "uncategorized" ? insight.note
                : insight.amount === null ? insight.note : formatClp(insight.amount)}
              {insight.hint.length > 0 && (
                <span className="react-insight-callout-hint">{insight.hint}</span>
              )}
            </p>
            {insight.key === "uncategorized" && insights.uncategorizedCount > 0 &&
              onJumpToUncategorized && (
                <button type="button" className="react-insight-category-action"
                  onClick={onJumpToUncategorized}>
                  Clasificar ahora →
                </button>
              )}
          </li>
        ))}
      </ul>
      <div className="react-top-insights-note" role={story.facts.length === 0 ? "status" : undefined}>
        <span className="react-top-insights-note-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faLightbulb} />
        </span>
        <div className="react-top-insights-note-copy">
          <p>{story.summary}</p>
          {story.facts.map((fact) => (
            <p key={fact}>{fact}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The visual spending breakdown as one already-decided state: a single segmented bar whose segments
 * are the proportional shares by kind, plus a readable icon legend and the recognized quantified
 * total.
 *
 * Exported so both the populated and the empty markup are provable from a static render, like the
 * other analytics panels. Each segment width is the share the pure module decided from raw amounts,
 * and the legend states every kind's amount and percentage as text too, so the distribution is
 * readable without the bar or its colour. Every legend marker reuses its segment's colour token, an
 * upper-right decorative chart glyph names the card, and there is deliberately no donut or charting
 * dependency. A zero total shows a truthful message instead of fabricated segments.
 */
export interface SpendingBreakdownViewProps {
  /** The decided bars, from `getSpendingBreakdown`. */
  breakdown: SpendingBreakdown;
}

/**
 * The one free Font Awesome solid glyph each recognized kind keeps in the legend. The icon is
 * decorative — the adjacent label names the kind — so it never carries information on its own and
 * the card never relies on colour alone.
 */
const SPENDING_BREAKDOWN_ICONS: Record<SpendingBreakdownBar["key"], typeof faCartShopping> = {
  purchase: faCartShopping,
  transfer: faArrowRightArrowLeft,
  payment: faReceipt,
};

export function SpendingBreakdownView({ breakdown }: SpendingBreakdownViewProps) {
  return (
    <section className="react-spending-breakdown" aria-labelledby="react-spending-breakdown-title">
      <div className="react-spending-breakdown-header">
        <div className="react-spending-breakdown-heading">
          <h3 id="react-spending-breakdown-title">Distribución de gastos</h3>
          {breakdown.emptyMessage === null ? (
            <p className="react-spending-breakdown-total">
              <strong>{formatClp(breakdown.total)}</strong>
              <span>total registrado</span>
            </p>
          ) : null}
        </div>
        <span className="react-spending-breakdown-header-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faChartPie} />
        </span>
      </div>
      {breakdown.emptyMessage !== null ? (
        <p className="react-spending-breakdown-empty" role="status">{breakdown.emptyMessage}</p>
      ) : (
        <>
          <div
            className="react-spending-breakdown-bar"
            role="img"
            aria-label={`Distribución de gastos por tipo. Total registrado ${formatClp(breakdown.total)}.`}
          >
            {breakdown.bars.map((bar) => (
              <span
                key={bar.key}
                className={`react-spending-breakdown-segment react-spending-breakdown-segment-${bar.key}`}
                style={{ width: `${bar.percent}%` }}
              />
            ))}
          </div>
          <ul className="react-spending-breakdown-legend">
            {breakdown.bars.map((bar) => (
              <li
                key={bar.key}
                className={`react-spending-breakdown-legend-item react-spending-breakdown-legend-item-${bar.key}`}
              >
                <span className="react-spending-breakdown-legend-heading">
                  <span
                    className={`react-spending-breakdown-icon react-spending-breakdown-icon-${bar.key}`}
                    aria-hidden="true"
                  >
                    <FontAwesomeIcon icon={SPENDING_BREAKDOWN_ICONS[bar.key]} />
                  </span>
                  <span className="react-spending-breakdown-kind">{bar.label}</span>
                </span>
                <strong>{formatClp(bar.amount)}</strong>
                <span className="react-spending-breakdown-percent">{bar.percent}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface DashboardAnalyticsBodyProps {
  /** Named counterparties from the same period's raw transactions. */
  counterpartyRanking: DashboardCounterpartyRanking;
  /** The decided lead, from `getDashboardLead`. */
  lead: DashboardLead;
  /** The decided income/budget truth, from `getDashboardIncomeBudgetPanel`. */
  budgetPanel: DashboardIncomeBudgetPanel;
  /** The decided month story, from `getDashboardStory`. */
  story: DashboardStory;
  /** The decided chart, from `getSpendingChart`. */
  chart: SpendingChart;
  /** Recognized outflow rows for the read-only chart detail. */
  chartDetailMovements: SpendingChartDetailMovement[];
  /** The decided ranking, from `getCategoryRanking`. */
  ranking: CategoryRanking;
  /** Individual recognized expenses for the donut detail, from the same period as the ranking. */
  categoryMovements: readonly RecognizedExpenseMovement[];
  /** Authenticated-only movement detail action; no edit/mutation is mounted in demo. */
  onOpenCategoryMovement?: (movementId: string) => void;
  /** Stored category catalog for the donut colours; absent when the caller has none. */
  catalog?: readonly Category[];
  /** Jumps into the caller's movement surface; the demo passes an inert callback. */
  onJumpToCategory: (category: string) => void;
  /** The decided insights, from `getTopInsights`. */
  insights: DashboardTopInsights;
  /** Authenticated-only jump to the uncategorized movement filter. */
  canJumpToUncategorized?: boolean;
  /** The decided breakdown, from `getSpendingBreakdown`. */
  breakdown: SpendingBreakdown;
  /** Opens the read-only chart day detail; absent keeps every row inert in the demo. */
  onOpenMovement?: (movementId: string) => void;
}

/**
 * The one dashboard analytics composition both the authenticated summary and the read-only demo mount:
 * primary lead, income/budget truth, month story, spending chart, spending-type
 * breakdown, category distribution/ranking and top insights, in that order.
 *
 * It is deliberately internal and holds no state, data or request: each caller decides the data and
 * passes the capabilities it supports. The authenticated summary wires the category jump and the chart
 * detail dialog; the demo passes an inert jump and no detail callback, and omits the stored catalog, so
 * the two differ in capabilities and copy, never in layout. The authenticated movement table and the
 * demo's read-only movements list/footer stay outside this body.
 *
 * Two semantic wrappers express the Stitch composition without changing any shipped data or
 * capability: a four-up KPI band (lead plus income/budget truth) and a two-column region that keeps
 * the chart/history column beside the category/insight column. The spending-type distribution leads
 * the main column, so it sits physically left of the category distribution, which leads the side
 * column before the `Lectura rápida · Inteligencia de gastos` card. The card keeps its highlights
 * primary and carries the non-duplicative story note below them. Every panel keeps a single mount,
 * so both trees read the same structure.
 */
function DashboardAnalyticsBody({
  lead,
  budgetPanel,
  story,
  chart,
  chartDetailMovements,
  ranking,
  counterpartyRanking,
  categoryMovements,
  onOpenCategoryMovement,
  catalog,
  onJumpToCategory,
  insights,
  canJumpToUncategorized,
  breakdown,
  onOpenMovement,
}: DashboardAnalyticsBodyProps) {
  return (
    <div className="react-analytics-body">
      {/* Four-up KPI band: the spending/balance hero and the income/budget truth, side by side. */}
      <div className="react-analytics-summary">
        <DashboardLeadView lead={lead} />
        <DashboardBudgetPanel panel={budgetPanel} />
      </div>
      {/* Two-column region: the larger chart/history column and the category/insight column. */}
      <div className="react-analytics-columns">
        <div className="react-analytics-main">
          {/* The distribution card leads the main column, so it aligns beside the category card in the
					    side column at desktop. */}
          <SpendingBreakdownView breakdown={breakdown} />
          <SpendingChartPanel
            chart={chart}
            detailMovements={chartDetailMovements}
            onOpenMovement={onOpenMovement}
          />
        </div>
        <div className="react-analytics-side">
          <CategoryRankingPanel
            ranking={ranking}
            catalog={catalog}
            movements={categoryMovements}
            onOpenMovement={onOpenCategoryMovement}
            onJumpToCategory={onJumpToCategory}
          />
          <DashboardCounterpartyRankingView ranking={counterpartyRanking} />
          <TopInsightsView insights={insights} story={story}
            onJumpToUncategorized={canJumpToUncategorized
              ? () => onJumpToCategory("Sin categoría") : undefined} />
        </div>
      </div>
    </div>
  );
}

interface FinancialSummaryProps {
  /** Session profile identity used for all dashboard cache operations. */
  email: string;
  onHandle?: (handle: FinancialDashboardHandle | null) => void;
  /** Current view, owned by the page so the header navigation and this body stay in sync. */
  view: DashboardView;
  /** Requests a view change, e.g. when the ranking jumps into the filtered movements table. */
  onViewChange: (view: DashboardView) => void;
}

function FinancialSummary({ email, onHandle, view, onViewChange }: FinancialSummaryProps) {
  const [state, setState] = useState<FinancialSummaryState>({ status: "loading" });
  // Mirrors every scheduled dashboard state write so async saves inspect the latest load, not a
  // render-time closure. React state remains the source rendered by the summary.
  const stateRef = useRef(state);
  const publishState = useCallback((next: FinancialSummaryState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  /**
   * Category the analytics ranking jumped to, consumed by the movements table on its next mount. It
   * is state rather than a ref because the table reads it during its first render, and the jump is
   * what switches the view: the table mounts after this state is already set.
   */
  const [requestedCategory, setRequestedCategory] = useState<string | null>(null);
  /**
   * Stored category catalog for the distribution colours. It is requested only inside the
   * authenticated summary — the demo composition never mounts this component — and a failure is not
   * an error: the distribution falls back to its deterministic palette instead of failing the summary.
   */
  const [categoryCatalog, setCategoryCatalog] = useState<Category[]>([]);
  const [retryToken, setRetryToken] = useState(0);
  const retry = useCallback(() => setRetryToken((token) => token + 1), []);
  const activeLoad = useRef<AbortController | null>(null);
  // A failed explicit reload leaves ready data on screen, but those transactions may be stale.
  const dashboardStale = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creationNotice, setCreationNotice] = useState<ManualExpenseCreationNotice | null>(null);
  /** Movement being edited; `null` keeps the edit dialog closed. */
  const [editMovement, setEditMovement] = useState<EditableRecognizedExpenseMovement | null>(null);
  const [editNotice, setEditNotice] = useState<MovementEditNotice | null>(null);
  /**
   * Identity the chart's read-only day detail opened; `null` keeps the dialog closed. Only the id is
   * stored, so a reload that drops the row closes the dialog instead of showing stale bytes.
   */
  const [chartDetailMovementId, setChartDetailMovementId] = useState<string | null>(null);
  /** Separate from the read-only weekday dialog: only category-origin detail may edit. */
  const [categoryDetailMovementId, setCategoryDetailMovementId] = useState<string | null>(null);
  /**
   * Removal lifecycle owned by unit B. `removal.movementId` is the single source of "which record
   * is being removed"; the movement snapshot below is only the data the dialog renders.
   */
  const [removal, setRemoval] = useState<RemovalState>(createRemovalState);
  const [removalNotice, setRemovalNotice] = useState<RemovalNotice | null>(null);
  /**
   * Movement the removal dialog shows, captured only when the reducer accepts the open. It is
   * deliberately not derived from `editableMovements`: a successful removal followed by a
   * successful reload drops the row from that list, so a derived movement would unmount the
   * dialog and lose the outcome before the user could dismiss it.
   */
  const [removalMovement, setRemovalMovement] = useState<EditableRecognizedExpenseMovement | null>(
    null,
  );
  /**
   * The C1 synchronous lock, reused for the DELETE. React state cannot close the async window:
   * two clicks in the same tick both read a submittable phase, so this ref is what guarantees a
   * single DELETE per attempt.
   */
  const removalLock = useRef(false);

  /**
   * Cycle-first refresh shared by the create, edit, and removal flows (review unit C2 reuses
   * it). It resolves `true` when the dashboard was reloaded and `false` when the reload failed,
   * so a caller can say the visible list may be stale instead of reporting a mutation that
   * already happened as failed. The previous data stays on screen when the reload fails.
   */
  const reloadFinancialDashboard = useCallback(async (): Promise<boolean> => {
    if (!mounted.current) return false;
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    try {
      const data = await refreshFinancialDashboardData(email, controller.signal);
      if (!mounted.current || controller.signal.aborted) return false;
      publishState(
        data.cycle.selectedPeriod ? { status: "ready", data } : { status: "unconfigured" },
      );
      dashboardStale.current = false;
      return true;
    } catch {
      if (activeLoad.current === controller) dashboardStale.current = true;
      return false;
    } finally {
      if (activeLoad.current === controller) activeLoad.current = null;
    }
  }, [email, publishState]);

  /**
   * Configured-period edit surface. It reloads through the same helper the summary publishes as
   * `FinancialDashboardHandle.reload`, so a saved period and a failed refresh stay two statements
   * instead of one invented one.
   */
  const [isCycleEditOpen, setIsCycleEditOpen] = useState(false);
  const [cycleEditNotice, setCycleEditNotice] = useState<CycleEditNotice | null>(null);
  /** The C1 synchronous lock, reused for the cycle save. */
  const cycleEditLock = useRef(false);
  const submitCycleEdit = useMemo(
    () =>
      createCycleEditSubmitter({
        updateCycle: updateFinancialCycle,
        reload: reloadFinancialDashboard,
        lock: cycleEditLock,
        prepareIncomeOnlyReuse: (payload) => {
          const initial = stateRef.current;
          if (initial.status !== "ready") return null;
          const period = initial.data.cycle.selectedPeriod;
          if (
            period === null || !mounted.current || dashboardStale.current || activeLoad.current !== null ||
            period.startDate !== payload.selectedPeriod.startDate ||
            period.endDateExclusive !== payload.selectedPeriod.endDateExclusive ||
            initial.data.cycle.incomeAmount === payload.incomeAmount
          ) return null;
          const previousCycle = initial.data.cycle;
          return (savedCycle) => {
            const current = stateRef.current;
            if (current.status !== "ready") return false;
            const currentPeriod = current.data.cycle.selectedPeriod;
            // A concurrent load may have changed the ready cycle or its movements. Reuse only
            // the current ready data after all pending loads have finished; otherwise reload.
            if (
              !mounted.current || dashboardStale.current || activeLoad.current !== null || currentPeriod === null ||
              currentPeriod.startDate !== payload.selectedPeriod.startDate ||
              currentPeriod.endDateExclusive !== payload.selectedPeriod.endDateExclusive ||
              current.data.cycle.incomeAmount !== previousCycle.incomeAmount ||
              current.data.cycle.completedAt !== previousCycle.completedAt
            ) return false;
            const merged = { ...current.data, cycle: savedCycle };
            publishState({ status: "ready", data: merged });
            writeFinancialDashboardCache(email, merged);
            return true;
          };
        },
      }),
    [email, publishState, reloadFinancialDashboard],
  );

  const openCycleEdit = useCallback(() => {
    // A previous outcome must not describe the new attempt.
    setCycleEditNotice(null);
    setIsCycleEditOpen(true);
  }, []);

  const handleCycleEdited = useCallback((reloadFailed: boolean) => {
    if (!mounted.current) return;
    setCycleEditNotice(getCycleEditNotice({ status: "saved", reloadFailed }));
    setIsCycleEditOpen(false);
  }, []);

  /**
   * The manual-expense trigger, defined here so the publish effect below can hand it to the page
   * heading. The dialog, its notice and its submitter all stay owned by this summary.
   */
  const openCreateExpense = useCallback(() => {
    // A previous outcome must not describe the new attempt.
    setCreationNotice(null);
    setIsCreateOpen(true);
  }, []);

  /**
   * The configured period, read before the early returns so the registration below can publish it
   * for the Gmail card. It is `null` while the cycle is loading, failed, or unconfigured — the
   * states in which there is no period a sync request could carry and no result it could verify.
   */
  const configuredPeriod = state.status === "ready" ? state.data.cycle.selectedPeriod : null;
  /**
   * Publishes the period and the reload the Gmail card asks for. A new load re-registers the same
   * helper with the fresh period, which is what
   * lets the card sync exactly the range the summary is showing. A failed reload is reported to the
   * card as `false`; it never throws. The control callbacks are stable `useCallback`s, so the
   * registration does not re-run on every render.
   */
  useEffect(() => {
    if (!onHandle) return;
    onHandle({
      period: configuredPeriod,
      reload: reloadFinancialDashboard,
      onEditPeriod: openCycleEdit,
      onCreateExpense: openCreateExpense,
    });
    return () => onHandle(null);
  }, [
    onHandle,
    configuredPeriod,
    reloadFinancialDashboard,
    openCycleEdit,
    openCreateExpense,
  ]);

  const submitManualExpense = useMemo(
    () =>
      createManualExpenseSubmitter({
        createExpense: createManualExpense,
        reload: reloadFinancialDashboard,
      }),
    [reloadFinancialDashboard],
  );

  const handleManualExpenseSaved = useCallback((reloadFailed: boolean) => {
    setCreationNotice(getManualExpenseCreationNotice(reloadFailed));
    setIsCreateOpen(false);
  }, []);

  useEffect(() => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    publishState({ status: "loading" });
    // The first mount is cache-first, so a browser reload (F5) reuses the tab's stored response
    // without a request. Every later run is a user-requested retry, which bypasses the cache and
    // reads current data instead.
    const load = retryToken > 0
      ? refreshFinancialDashboardData(email, controller.signal)
      : loadFinancialDashboardWithCache(email, controller.signal);
    load
      .then((data) => {
        if (controller.signal.aborted) return;
        publishState(
          data.cycle.selectedPeriod
            ? { status: "ready", data }
            : { status: "unconfigured" },
        );
        dashboardStale.current = false;
      })
      .catch(() => {
        if (!controller.signal.aborted) publishState({ status: "failed" });
      })
      .finally(() => {
        if (activeLoad.current === controller) activeLoad.current = null;
      });
    return () => {
      controller.abort();
      activeLoad.current?.abort();
      activeLoad.current = null;
    };
  }, [retryToken, email, publishState]);

  useEffect(() => {
    const controller = new AbortController();
    getCategories(controller.signal)
      .then((categories) => {
        if (!controller.signal.aborted) setCategoryCatalog(categories);
      })
      .catch(() => {
        // Palette fallback: stored colours are an enhancement, never a load dependency.
      });
    return () => controller.abort();
  }, [retryToken]);

  if (state.status === "loading") {
    return <section className="react-financial-state" aria-live="polite">Cargando resumen financiero...</section>;
  }
  if (state.status === "failed") {
    return (
      <section className="react-financial-state" role="alert">
        <p>No se pudo cargar el resumen financiero.</p>
        <button className="secondary" type="button" onClick={retry}>Reintentar resumen financiero</button>
      </section>
    );
  }
  if (state.status === "unconfigured") {
    return <FinancialCycleSetupForm onSaved={retry} />;
  }

  const { selectedPeriod, incomeAmount } = state.data.cycle;
  const summary = summarizeRecognizedExpenses(state.data.transactions);
  // The hero reads the summary and the configured income the cycle already loaded, so it issues no
  // request and its balance is exactly the stated income minus the stated total.
  const dashboardLead = getDashboardLead({
    periodLabel: formatPeriodLabel(selectedPeriod!),
    totalSpending: summary.totalSpending,
    expenseCount: summary.count,
    pendingAmountCount: summary.pendingAmountCount,
    incomeAmount,
    incomeSource: "configured-cycle",
  });
  // The budget truth panel reads the same configured income the lead subtracted, so the two
  // statements cannot disagree. It issues no request and never fabricates a budget, and its
  // configured-cycle source keeps the stored-income label the authenticated surface has always used.
  const incomeBudgetPanel = getDashboardIncomeBudgetPanel({
    source: "configured-cycle",
    incomeAmount,
    periodLabel: formatPeriodLabel(selectedPeriod!),
    formatAmount: formatClp,
  });
  const periodAnalytics = getPeriodAnalytics(state.data.transactions);
  const spendingByKind = summarizeRecognizedExpensesByKind(state.data.transactions);
  const latestExpense = selectLatestRecognizedExpense(state.data.transactions, selectedPeriod!);
  const movements = getRecognizedExpenseMovements(state.data.transactions);
  const editableMovements = getEditableRecognizedExpenseMovements(state.data.transactions);
  // The chart's day-detail dialog reads the same loaded lists the table does. The identity is the only
  // state: the movement is re-resolved every render, so a removed or reloaded row cannot keep a stale
  // dialog alive. It is read-only here: no edit or remove callback is wired, so the dialog offers only
  // its fields and `Cerrar`, and the editable record only suppresses the "viewable only" note.
  const chartDetailMovement =
    chartDetailMovementId === null
      ? null
      : movements.find((movement) => movement.id === chartDetailMovementId) ?? null;
  const chartDetailMovementEditable =
    chartDetailMovement === null
      ? null
      : editableMovements.find((movement) => movement.id === chartDetailMovement.id) ?? null;
  // Resolve category-origin identity against each fresh load, never a cached detail snapshot.
  const categoryDetailMovement = categoryDetailMovementId === null
    ? null
    : movements.find((movement) => movement.id === categoryDetailMovementId) ?? null;
  const categoryDetailMovementEditable = categoryDetailMovement === null
    ? null
    : editableMovements.find((movement) => movement.id === categoryDetailMovement.id) ?? null;
  // The ranking reads the rows and the pending count the summary already computed, so it adds no
  // request and shares the same "recognized finite outflow" projection the table shows.
  const categoryRanking = getCategoryRanking(movements, summary.pendingAmountCount);
  // Raw rows retain actual counterparties; the display projection may substitute a description.
  const counterpartyRanking = getDashboardCounterpartyRanking(state.data.transactions);
  // The chart reads the same rows and the same pending count, so it adds no request either. Its
  // read-only day detail reads the same loaded transactions through the richer projection.
  const spendingChart = getSpendingChart(movements, selectedPeriod!, summary.pendingAmountCount);
  const spendingChartDetailMovements = getSpendingChartDetailMovements(state.data.transactions);
  // The story and tiles reuse loaded movements and the largest expense `getPeriodAnalytics`
  // already decided. The raw rows distinguish missing categories from their display fallback.
  const topCategoryGroup =
    categoryRanking.rows[0] === undefined
      ? null
      : { label: categoryRanking.rows[0].category, total: categoryRanking.rows[0].total };
  const topCounterpartyGroup = getTopCounterpartyGroup(movements);
  const topInsights = getTopInsights({
    frequency: getMostFrequentCounterparty(movements),
    uncategorized: getUncategorizedExpenses(state.data.transactions),
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
  const spendingBreakdown = getSpendingBreakdown(spendingByKind);

  // Both submitters are rebuilt per render on purpose: the period only exists once the cycle is
  // configured, and their dependencies (`updateTransaction`, `removeTransaction` and the stable
  // reload helper) are the same on every render, so no memo is needed to keep them honest.
  const submitEdit = createMovementEditSubmitter({
    period: selectedPeriod!,
    updateMovement: updateTransaction,
    reload: reloadFinancialDashboard,
  });
  const submitRemoval = createMovementRemovalSubmitter({
    removeMovement: removeTransaction,
    reload: reloadFinancialDashboard,
  });
  // The bulk category assignment reuses the same PATCH client and the same reload as the single-edit
  // flow, so a bulk pass and a single edit cannot disagree about how a movement is written or how
  // the visible list is refreshed. This is built per render, like the single-edit/removal submitters,
  // because this branch sits after loading/failed/unconfigured early returns and must not add a hook
  // only when the summary is ready.
  const submitBulkCategory = createBulkCategorySubmitter({
    updateMovement: updateTransaction,
    reload: reloadFinancialDashboard,
  });

  const openMovementEdit = (movement: EditableRecognizedExpenseMovement) => {
    // A previous outcome must not describe the new attempt.
    setEditNotice(null);
    setEditMovement(movement);
  };

  const handleMovementEditSaved = (reloadFailed: boolean) => {
    setEditNotice(getMovementEditNotice(reloadFailed));
    setEditMovement(null);
  };

  const openMovementRemoval = (movement: EditableRecognizedExpenseMovement) => {
    setRemovalNotice(null);
    // The lock only closes the same-tick double-click window; the reducer owns the in-flight
    // rule (`open` is a no-op while `removing`), so freeing a previous attempt here cannot
    // re-enable a DELETE and keeps a second removal from being silently blocked.
    releaseInFlightLock(removalLock);
    // Unit B's guard owns the stale row: opening a movement whose removal already completed is
    // a no-op, so the dialog cannot even appear for it and no second DELETE becomes possible.
    // The transition is computed before committing so the dialog only ever shows a movement the
    // reducer actually opened; a refused open must not stamp a snapshot the reducer does not hold.
    const opened = reduceRemovalState(removal, { type: "open", movementId: movement.id });
    if (opened.phase !== "confirming" || opened.movementId !== movement.id) return;
    setRemovalMovement(movement);
    setRemoval(opened);
  };

  const dismissMovementRemoval = () => {
    // The by-phase mapping is unit B's: `confirming` cancels, and a terminal phase dismisses
    // through `dismissRemoval`, which keeps `removedMovementIds`. Closing with a fresh
    // `createRemovalState()` here would erase the guard and re-arm a completed removal.
    setRemovalNotice(getRemovalNotice(removal));
    setRemoval((current) => reduceRemovalDismissal(current));
    setRemovalMovement(null);
    releaseInFlightLock(removalLock);
  };

  const confirmMovementRemoval = async () => {
    if (!canSubmitRemoval(removal)) return;
    const movement = removalMovement;
    const target =
      movement === null
        ? null
        : getMovementUpdateTarget({
          id: movement.id ?? undefined,
          occurredAt: movement.occurredAt,
          isManual: movement.isManual,
        });
    // No usable target means no DELETE: the same rule that leaves a row without an action keeps
    // a stale confirmation from sending a request the API layer would refuse.
    if (target === null) return;
    if (!acquireInFlightLock(removalLock)) return;
    setRemoval((current) => reduceRemovalState(current, { type: "confirm" }));
    try {
      const outcome = await submitRemoval(target);
      if (outcome.status === "removed") {
        // The result stays on screen until the user dismisses it, which is when the outcome
        // is published on the dashboard.
        setRemoval((current) =>
          reduceRemovalState(current, {
            type: "succeeded",
            hadReloadFailure: outcome.reloadFailed,
          }),
        );
        return;
      }
      if (outcome.status === "notFound") {
        // Terminal, exactly like the edit flow: a 404 cannot be repaired by repeating the same
        // DELETE, so the dialog offers only a truthful close and never a retry control.
        releaseInFlightLock(removalLock);
        setRemoval((current) =>
          reduceRemovalState(current, {
            type: "notFound",
            message: getRemovalNotFoundMessage(),
          }),
        );
        return;
      }
      releaseInFlightLock(removalLock);
      setRemoval((current) =>
        reduceRemovalState(current, { type: "failed", message: outcome.message }),
      );
    } catch {
      // The submitter reports instead of throwing, so this is only reachable if it is replaced:
      // the attempt is over, so the lock is released and the failure is truthful.
      releaseInFlightLock(removalLock);
      setRemoval((current) =>
        reduceRemovalState(current, {
          type: "failed",
          message: getRemovalErrorMessage(undefined),
        }),
      );
    }
  };

  return (
    <section className="react-financial-summary" aria-label="Resumen financiero del periodo">
      {state.data.warning && (
        <div className="react-financial-summary-heading">
          <p className="react-financial-warning" role="status">Advertencia: {state.data.warning}</p>
        </div>
      )}
      {creationNotice && (
        <p
          className={`react-financial-creation-notice react-financial-creation-notice-${creationNotice.tone}`}
          role="status"
        >
          {creationNotice.message}
        </p>
      )}
      {editNotice && (
        <p
          className={`react-financial-mutation-notice react-financial-mutation-notice-${editNotice.tone}`}
          role="status"
        >
          {editNotice.message}
        </p>
      )}
      {removalNotice && (
        <p
          className={`react-financial-mutation-notice react-financial-mutation-notice-${removalNotice.tone}`}
          role="status"
        >
          {removalNotice.message}
        </p>
      )}
      {cycleEditNotice && (
        <p
          className={`react-financial-mutation-notice react-financial-mutation-notice-${cycleEditNotice.tone}`}
          role="status"
        >
          {cycleEditNotice.message}
        </p>
      )}
      {view === "summary" ? (
        <>
          {/* The shared analytics body owns the section order, so both the authenticated summary and
					    the read-only demo read the same composition. Here it carries the authenticated
					    capabilities: the jump switches to the movements view with the requested category, and
					    the chart detail opens the read-only movement dialog. */}
          <DashboardAnalyticsBody
            lead={dashboardLead}
            budgetPanel={incomeBudgetPanel}
            story={dashboardStory}
            chart={spendingChart}
            chartDetailMovements={spendingChartDetailMovements}
            ranking={categoryRanking}
            counterpartyRanking={counterpartyRanking}
            categoryMovements={movements}
            onOpenCategoryMovement={setCategoryDetailMovementId}
            catalog={categoryCatalog}
            onJumpToCategory={(category) => {
              setRequestedCategory(category);
              onViewChange("movements");
            }}
            insights={topInsights}
            canJumpToUncategorized
            breakdown={spendingBreakdown}
            onOpenMovement={setChartDetailMovementId}
          />
          {summary.count === 0 && (
            <p className="react-financial-empty" role="status">No se encontraron gastos reconocidos para este periodo.</p>
          )}
        </>
      ) : (
        <MovementsTable
          key={`${selectedPeriod!.startDate}..${selectedPeriod!.endDateExclusive}`}
          period={selectedPeriod!}
          movements={movements}
          pendingAmountCount={summary.pendingAmountCount}
          editableMovements={editableMovements}
          requestedCategory={requestedCategory ?? undefined}
          onEdit={openMovementEdit}
          onRemove={openMovementRemoval}
          submitBulkCategory={submitBulkCategory}
          categoryCatalog={categoryCatalog}
        />
      )}
      {/* Only a configured summary can create an expense: the trigger lives here, and the
			    dialog is the only place that requests the category catalog. */}
      <CreateManualExpenseDialog
        isOpen={isCreateOpen}
        period={selectedPeriod!}
        onClose={() => setIsCreateOpen(false)}
        submitExpense={submitManualExpense}
        onSaved={handleManualExpenseSaved}
      />
      {/* Category detail is independent from the weekday's read-only dialog. Unmount it before
			    opening edit so native modal top layers never overlap. Only eligible rows offer Editar. */}
      <ViewMovementDialog
        movement={categoryDetailMovement}
        editableMovement={categoryDetailMovementEditable}
        onClose={() => setCategoryDetailMovementId(null)}
        onEdit={(movement) => {
          setCategoryDetailMovementId(null);
          openMovementEdit(movement);
        }}
      />
      {/* The edit dialog is only reachable from a row action, and every row that offers one is
			    already bound to a target the PATCH accepts. */}
      <EditMovementDialog
        isOpen={editMovement !== null}
        movement={editMovement}
        period={selectedPeriod!}
        onClose={() => setEditMovement(null)}
        submitEdit={submitEdit}
        onSaved={handleMovementEditSaved}
      />
      {/* Unit B's dialog, driven by the reducer that owns the guard against a second DELETE. */}
      <RemoveMovementDialog
        movement={removalMovement}
        state={removal}
        onCancel={dismissMovementRemoval}
        onConfirm={confirmMovementRemoval}
      />
      {/* The chart's day-detail dialog is read-only: it names the movement and offers only `Cerrar`,
			    reusing the same native modal the movements table mounts. */}
      <ViewMovementDialog
        movement={chartDetailMovement}
        editableMovement={chartDetailMovementEditable}
        onClose={() => setChartDetailMovementId(null)}
      />
      {/* Mounted inside the ready state: an unconfigured or failed summary has no period to edit. */}
      <FinancialCycleEditDialog
        isOpen={isCycleEditOpen}
        cycle={state.data.cycle}
        onClose={() => setIsCycleEditOpen(false)}
        submitCycle={submitCycleEdit}
        onSaved={handleCycleEdited}
      />
    </section>
  );
}

function FinancialCycleSetupForm({ onSaved }: { onSaved: () => void }) {
  // The first setup is a real modal, like the configure/edit dialog: the same `showModal()` helper
  // gives it the focus trap, `Esc` handling and inert backdrop. The form is the only unconfigured
  // surface, so the dialog opens on mount and closes with the component.
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    syncNativeModalDialog(dialogRef.current, true);
  }, []);
  // The configured review period for a first setup is the current month: it is the range the form
  // starts on. The calendar's own navigation and selectable bounds are the current year through the
  // current month, so a historical range the default does not cover is still reachable. Both are
  // frozen for the life of the form so a midnight rollover cannot re-anchor either mid-edit.
  const configuredPeriod = useMemo(() => ReviewPeriod.currentMonth().toJSON(), []);
  const calendarBounds = useMemo(() => getCurrentYearCalendarBounds(), []);
  const [startDate, setStartDate] = useState(configuredPeriod.startDate);
  const [endDate, setEndDate] = useState<string>(ReviewPeriod.create(configuredPeriod).visibleEndDate);
  const [incomeValue, setIncomeValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  /** The legacy two-click range: the first click sets the start, the second sets the end. */
  const [awaitingRangeEnd, setAwaitingRangeEnd] = useState(false);
  const calendarRange = { ...createCalendarRange(startDate, endDate), awaitingEnd: awaitingRangeEnd };

  const handleCalendarSelect = (dateKey: string) => {
    const next = selectCalendarDate(calendarRange, dateKey);
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    setAwaitingRangeEnd(next.awaitingEnd);
    setCalendarError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveLock.current) return;

    // The calendar error is derived here, not rendered on every keystroke: the date half of the
    // validation is stated inline while the income half keeps the form's existing copy.
    const dateValidation = validateCalendarRange(startDate, endDate);
    if (!dateValidation.ok) {
      setCalendarError(dateValidation.message);
      setError("Revisa las fechas del periodo antes de guardar.");
      return;
    }
    setCalendarError(null);

    let cycle: UpdateFinancialCycleRequest;
    try {
      cycle = createFinancialCycleSetupPayload(startDate, endDate, incomeValue);
    } catch {
      setError("Ingresa un rango de fechas válido y un ingreso en CLP positivo sin decimales, o deja el ingreso en blanco.");
      return;
    }

    saveLock.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await updateFinancialCycle(cycle);
      onSaved();
    } catch {
      saveLock.current = false;
      setError("No se pudo guardar tu periodo financiero. Inténtalo de nuevo.");
      setIsSaving(false);
    }
  };

  const formatIncomeOnBlur = () => {
    try {
      const incomeAmount = parseCycleIncome(incomeValue);
      if (incomeAmount !== null) setIncomeValue(formatIncomeInput(incomeAmount));
    } catch {
      // Keep the user's value unchanged so it can be corrected.
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="react-financial-setup-dialog react-financial-state"
      aria-labelledby="react-financial-setup-title"
    >
      <div>
        <span className="section-kicker">Configuración financiera</span>
        <h2 id="react-financial-setup-title">Configura tu periodo financiero</h2>
        <p>Elige las fechas inclusivas del periodo que quieres revisar.</p>
      </div>
      <form className="react-financial-setup-form" onSubmit={handleSubmit}>
        {/* The calendar augments the text inputs; it never replaces them. It is bounded to the current
				    year through the current month, so any month of the year so far is selectable. */}
        <CycleCalendar
          bounds={calendarBounds}
          range={calendarRange}
          onSelectDate={handleCalendarSelect}
          disabled={isSaving}
          error={calendarError}
        />
        <div className="react-financial-setup-fields">
          <label htmlFor="financial-cycle-start-date">
            <span>Fecha de inicio</span>
            <input
              id="financial-cycle-start-date"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setCalendarError(null);
              }}
              disabled={isSaving}
              required
            />
          </label>
          <label htmlFor="financial-cycle-end-date">
            <span>Fecha de término (inclusive)</span>
            <input
              id="financial-cycle-end-date"
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setCalendarError(null);
              }}
              disabled={isSaving}
              required
            />
          </label>
          <label htmlFor="financial-cycle-income">
            <span>Ingreso mensual (opcional)</span>
            <input
              id="financial-cycle-income"
              type="text"
              inputMode="numeric"
              pattern="[0-9.]*"
              value={incomeValue}
              onChange={(event) => setIncomeValue(event.target.value)}
              onBlur={formatIncomeOnBlur}
              disabled={isSaving}
              aria-describedby="financial-cycle-income-help"
            />
            <small id="financial-cycle-income-help">Monto en CLP sin decimales. Ejemplo: 900.000</small>
          </label>
        </div>
        {error && <p className="react-financial-setup-error" role="alert">{error}</p>}
        <div className="react-shell-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Guardando periodo financiero..." : "Guardar periodo financiero"}
          </button>
        </div>
      </form>
      <p aria-live="polite">{isSaving ? "Guardando periodo financiero..." : ""}</p>
    </dialog>
  );
}

/**
 * Movements filter control: the category narrowed over the rows already loaded for the period.
 *
 * Exported so both the unfiltered and the active markup are provable from a static render; the live
 * table only ever reaches the unfiltered one, because a static render has no state to select with.
 * It shows the category decision and the table's current count (which also reflects search and kind),
 * so it cannot display a category the table is not applying. It keeps a labelled group, an announced
 * count when filters are active, and a visible way to clear the category.
 */
export interface MovementFilterBarProps {
  options: MovementFilterOption[];
  count: MovementFilterCount;
  onSelect: (category: string) => void;
  onClear: () => void;
}

export function MovementFilterBar({ options, count, onSelect, onClear }: MovementFilterBarProps) {
  return (
    <div className="react-movements-filters" role="group" aria-label="Filtrar tabla por categoría">
      <label className="react-movements-filter-field">
        <span>Categoría</span>
        <select value={count.category} onChange={(event) => onSelect(event.target.value)}>
          {options.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {`${option.label} · ${option.count}`}
            </option>
          ))}
        </select>
      </label>
      {/* Announce the current table count when any filter narrows the rows. */}
      {count.message !== null && (
        <p className="react-movements-filter-count" role="status">{count.message}</p>
      )}
      {/* Offered only while there is something to clear: a control that cannot change anything is noise. */}
      {count.isActive && (
        <button type="button" className="secondary react-movements-filter-clear" onClick={onClear}>
          Limpiar filtro
        </button>
      )}
    </div>
  );
}

/**
 * Legacy's sortable columns and their labels (`renderTableHead`, `public/app.js:3506-3520`). The
 * actions column is deliberately absent: legacy never made it sortable and it carries no value to
 * order by.
 */
const movementSortColumns: { key: MovementSortKey; label: string }[] = [
  { key: "counterparty", label: "Contraparte" },
  { key: "amount", label: "Monto" },
  { key: "date", label: "Fecha" },
  { key: "category", label: "Categoría" },
];

export interface MovementsTableHeaderProps {
  /** The sort in effect; `createMovementSortState()` is the neutral one. */
  sort: MovementSortState;
  onActivate: (key: MovementSortKey) => void;
  /**
   * Selection view. When present together with `onToggleAllSelection` the head gains the select-all
   * column; a caller that omits both renders the pre-selection head, which is what the standalone
   * header proof relies on.
   */
  selection?: MovementSelectionView;
  onToggleAllSelection?: () => void;
}

/**
 * The table head: one activatable header per legacy-sortable column, carrying the `aria-sort` value
 * and the `▬/▲/▼` indicator the pure module decided (`renderTableHead`, `public/app.js:3499-3578`).
 * It only displays that decision, so it cannot disagree with the order of the rows. Exported so both
 * the neutral and the active markup are provable from a static render, like `MovementFilterBar`.
 */
export function MovementsTableHeader({
  sort,
  onActivate,
  selection,
  onToggleAllSelection,
}: MovementsTableHeaderProps) {
  const selectionEnabled = selection !== undefined && onToggleAllSelection !== undefined;
  return (
    <thead>
      <tr>
        {/* The select-all control only exists while a selection layer is mounted. Its mixed state is
				    exposed both as the native `indeterminate` property and as `aria-checked="mixed"` so a
				    static render can prove it without a live DOM. */}
        {selectionEnabled && selection !== undefined && (
          <th scope="col" className="react-movements-select-column">
            <input
              type="checkbox"
              className="react-movements-select-all"
              aria-label="Seleccionar todos los movimientos editables"
              checked={selection.headerChecked}
              aria-checked={selection.indeterminate ? "mixed" : undefined}
              ref={(node) => {
                if (node) node.indeterminate = selection.indeterminate;
              }}
              disabled={selection.selectableCount === 0}
              onChange={onToggleAllSelection}
            />
          </th>
        )}
        {movementSortColumns.map((column) => (
          <th
            key={column.key}
            scope="col"
            aria-sort={getMovementSortAriaSort(sort, column.key)}
            className={sort.key === column.key ? "react-movement-sort-active" : undefined}
          >
            <button
              type="button"
              className="react-movement-sort-button"
              aria-label={`Ordenar por ${column.label}`}
              onClick={() => onActivate(column.key)}
            >
              {column.label} {getMovementSortIndicator(sort, column.key)}
            </button>
          </th>
        ))}
        <th scope="col">Acciones</th>
      </tr>
    </thead>
  );
}

/**
 * The movements view for one already-decided state: the filter's rows in the order the sort decided,
 * the filter bar the table is actually applying, and the actions each row can offer.
 *
 * The action availability is not a second rule: a row is actionable exactly when the editable
 * projection produced a record for it, which already requires a usable identity and a parseable
 * original date. A row outside that projection therefore renders no control at all instead of a
 * control that could only produce a rejected request.
 *
 * The filter narrows the rows already loaded, like legacy (`public/app.js:3621-3668`), and the
 * ordering sorts the rows the filter left visible, like legacy's `renderTableView`
 * (`sortTransactions(filtered)`, `:1200-1203`). Neither issues a request.
 *
 * Exported so both the neutral and an active sort are provable from a static render, like
 * `MovementsTableHeader`: the container below owns the state and this component only displays the
 * decision it was handed.
 */
export interface MovementsTableViewProps {
  /** The filter's own view: its options, its rows and its count statement. */
  filteredView: MovementFilterView;
  /** All finite recognized expenses, used only for period-wide KPI totals. */
  periodMovements?: RecognizedExpenseMovement[];
  pendingAmountCount?: number;
  search?: string;
  onSearchChange?: (value: string) => void;
  kind?: string;
  onKindChange?: (value: string) => void;
  /** The ordering in effect; `createMovementSortState()` renders the loaded order. */
  sort: MovementSortState;
  /** Records a mutation may target, from `getEditableRecognizedExpenseMovements`. */
  editableMovements: EditableRecognizedExpenseMovement[];
  onActivate: (key: MovementSortKey) => void;
  onSelect: (category: string) => void;
  onClear: () => void;
  onEdit: (movement: EditableRecognizedExpenseMovement) => void;
  onRemove: (movement: EditableRecognizedExpenseMovement) => void;
  /**
   * Opens the read-only detail. It is called for every row, including ones with no editable target,
   * and is optional only so the standalone sort/filter proofs can render the table without it.
   */
  onView?: (movement: RecognizedExpenseMovement) => void;
  /** Selection view produced by the container; omitted, the table renders no selection column. */
  selection?: MovementSelectionView;
  onToggleSelection?: (id: string) => void;
  onToggleAllSelection?: () => void;
  /** Selects exactly the counterparty-similar ids the row's affordance offered. */
  onSelectSimilar?: (ids: string[]) => void;
  onClearSelection?: () => void;
  /** Bulk category control, offered only while a selection layer is mounted. */
  bulkCategoryOptions?: CategorySelectOption[];
  bulkCategoryValue?: string;
  onBulkCategoryChange?: (value: string) => void;
  onAssignCategory?: () => void;
  isBulkAssigning?: boolean;
  bulkNotice?: BulkCategoryFeedback | null;
}

export function MovementsTableView({
  filteredView,
  periodMovements,
  pendingAmountCount = 0,
  search = "",
  onSearchChange,
  kind = "",
  onKindChange,
  sort,
  editableMovements,
  onActivate,
  onSelect,
  onClear,
  onEdit,
  onRemove,
  onView,
  selection,
  onToggleSelection,
  onToggleAllSelection,
  onSelectSimilar,
  onClearSelection,
  bulkCategoryOptions,
  bulkCategoryValue,
  onBulkCategoryChange,
  onAssignCategory,
  isBulkAssigning,
  bulkNotice,
}: MovementsTableViewProps) {
  // The rows the table renders: the filter's own rows put in the order the sort decided. Sorting is
  // applied to the filtered rows, never to the loaded ones, and the count stays the filter's own — it
  // was computed from the filtered set, so ordering can neither hide nor reveal a row it describes.
  const visibleRows = sortMovements(filteredView.rows, sort);
  const editableById = new Map(
    editableMovements.map((movement) => [movement.id, movement] as const),
  );
  const selectionEnabled = selection !== undefined && onToggleSelection !== undefined;
  const selectedIds = new Set(selection?.selectedIds ?? []);
  const periodRows = periodMovements ?? filteredView.rows;
  const uncategorized = periodRows.filter((movement) => movement.category === "Sin categoría");
  const classified = periodRows.filter((movement) => movement.category !== "Sin categoría");
  const total = (rows: RecognizedExpenseMovement[]) =>
    rows.reduce((sum, movement) => sum + movement.amount, 0);
  const kindTabs = [
    { value: "", label: "Todos" },
    { value: "purchase", label: "Compras" },
    { value: "transfer", label: "Transferencias" },
    { value: "payment", label: "Pagos" },
  ];

  return (
    <div className="react-movements-view">
      {/* Keep the section title and its decorative, screen-reader-hidden glyph. */}
      <header className="react-movements-header">
        <h2>Actividad del periodo</h2>
        <span className="react-card-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faReceipt} />
        </span>
      </header>
      <section className="react-movements-metrics" aria-label="Indicadores del periodo">
        <article className="react-movements-metric">
          <span>Gastos reconocidos</span><strong>{periodRows.length}</strong>
        </article>
        <article className="react-movements-metric">
          <span>Total gastado</span><strong>{formatClp(total(periodRows))}</strong>
          <small>Periodo completo, sin filtros</small>
        </article>
        <article className="react-movements-metric react-movements-metric-pending">
          <span>Sin categoría</span><strong>{uncategorized.length}</strong>
          <small>{formatClp(total(uncategorized))}</small>
        </article>
        <article className="react-movements-metric react-movements-metric-classified">
          <span>Clasificados</span><strong>{classified.length}</strong>
          <small>{formatClp(total(classified))}</small>
        </article>
      </section>
      {pendingAmountCount > 0 && (
        <p className="react-movements-pending-note" role="status">
          {pendingAmountCount} gastos reconocidos sin monto conocido no figuran en estos indicadores ni en la tabla.
        </p>
      )}
      <div className="react-movements-toolbar" role="group" aria-label="Buscar y filtrar movimientos">
        {onSearchChange && (
          <label className="react-movements-search">
            <span>Buscar movimientos</span>
            <input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar contraparte, descripción o categoría" />
          </label>
        )}
        <MovementFilterBar
          options={filteredView.options}
          count={filteredView.count}
          onSelect={onSelect}
          onClear={onClear}
        />
      </div>
      {onKindChange && (
        <div className="react-movements-kind-tabs" role="group" aria-label="Filtrar por tipo de gasto">
          {kindTabs.map((tab) => (
            <button key={tab.value || "all"} type="button" className="react-movements-kind-tab"
              aria-pressed={kind === tab.value} onClick={() => onKindChange(tab.value)}>
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {selectionEnabled && selection !== undefined && (
        <div className="react-movements-bulk" role="group" aria-label="Acciones sobre la selección">
          <strong className="react-movements-bulk-count">
            {selection.message ?? "Sin selección"}
          </strong>
          {bulkCategoryOptions !== undefined && (
            <label className="react-movements-bulk-field">
              <span>Categoría de la selección</span>
              <select
                value={bulkCategoryValue ?? ""}
                onChange={(event) => onBulkCategoryChange?.(event.target.value)}
                disabled={isBulkAssigning}
              >
                {bulkCategoryOptions.map((option) => (
                  <option key={option.value || "none"} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="react-movements-bulk-actions">
            <button
              type="button"
              className="secondary react-movements-bulk-clear"
              onClick={onClearSelection}
              disabled={selection.selectedCount === 0 || isBulkAssigning}
            >
              Limpiar selección
            </button>
            <button
              type="button"
              className="react-movements-bulk-assign"
              onClick={onAssignCategory}
              disabled={selection.selectedCount === 0 || isBulkAssigning}
              aria-busy={isBulkAssigning}
            >
              {isBulkAssigning ? "Asignando..." : "Asignar categoría"}
            </button>
          </div>
          {bulkNotice !== null && bulkNotice !== undefined && (
            <p
              className={`react-movements-bulk-notice react-movements-bulk-notice-${bulkNotice.tone}`}
              role="status"
            >
              {bulkNotice.message}
            </p>
          )}
        </div>
      )}
      <section className="react-movements-table-card" aria-label="Detalle de movimientos">
        <header className="react-movements-table-heading">
          <h3>Detalle de movimientos</h3>
          {filteredView.count.message === null && (
            <span className="react-movements-table-count">{visibleRows.length} de {periodRows.length} movimientos</span>
          )}
        </header>
        {/* The table keeps its own scroll container, so the filter bar cannot scroll away with it. */}
        <div className="react-movements-table-wrapper">
        <table className="react-movements-table">
          <MovementsTableHeader
            sort={sort}
            onActivate={onActivate}
            selection={selection}
            onToggleAllSelection={onToggleAllSelection}
          />
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={selectionEnabled ? 6 : 5} className="react-movements-no-results">
                {periodRows.length === 0
                  ? "No hay gastos reconocidos disponibles para este periodo."
                  : "No hay movimientos que coincidan con los filtros actuales."}
              </td></tr>
            )}
            {visibleRows.map((movement, index) => {
              const editable =
                movement.id === null ? null : editableById.get(movement.id) ?? null;
              const similar =
                selectionEnabled && selection !== undefined
                  ? getSimilarCounterpartyAffordance(
                    movement,
                    visibleRows,
                    selection.selectableIds,
                  )
                  : null;
              return (
                <tr key={`${movement.counterparty}-${movement.date}-${index}`}>
                  {selectionEnabled && (
                    <td className="react-movements-select-column">
                      {editable ? (
                        <input
                          type="checkbox"
                          className="react-movement-select"
                          aria-label={`Seleccionar ${movement.counterparty}`}
                          checked={movement.id !== null && selectedIds.has(movement.id)}
                          onChange={() => movement.id !== null && onToggleSelection?.(movement.id)}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          className="react-movement-select react-movement-select-disabled"
                          aria-label={`No seleccionable: ${movement.counterparty}`}
                          disabled
                        />
                      )}
                    </td>
                  )}
                  <td>
                    {movement.counterparty}
                    {movement.kind && (
                      <span className="react-movement-kind-badge">{getSpendingChartKindLabel(movement.kind)}</span>
                    )}
                    {similar !== null && similar.count > 1 && onSelectSimilar !== undefined && (
                      <button
                        type="button"
                        className="react-movement-similar"
                        onClick={() => onSelectSimilar(similar.ids)}
                      >
                        {similar.label}
                      </button>
                    )}
                  </td>
                  <td className="react-movement-amount">{formatClp(movement.amount)}</td>
                  <td className="react-movement-date">{movement.date}</td>
                  <td><span className={`react-movement-category${movement.category === "Sin categoría" ? " react-movement-category-unassigned" : ""}`}>{movement.category}</span></td>
                  <td className="react-movements-actions">
                    <button
                      type="button"
                      className="secondary react-movement-action"
                      onClick={() => onView?.(movement)}
                    >
                      Ver
                    </button>
                    {editable ? (
                      <>
                        <button
                          type="button"
                          className="secondary react-movement-action"
                          onClick={() => onEdit(editable)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="secondary react-movement-action"
                          onClick={() => onRemove(editable)}
                        >
                          Eliminar
                        </button>
                      </>
                    ) : (
                      <span className="react-movements-read-only">
                        Solo lectura: sin identificación o fecha válida
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

/**
 * Movements table container: it owns the period-scoped filter selection and the in-memory ordering,
 * and hands the decided state to `MovementsTableView`, which renders it.
 */
export interface MovementsTableProps {
  /**
   * Period the loaded rows belong to. Together with the rows it owns the reset: a selection made in
   * another period, or naming a category these rows do not carry, is replaced before anything renders
   * — the empty-rows state included — so a stale category cannot hide rows after the data reloads.
   */
  period: FinancialPeriod;
  /** Read projection: every recognized expense of the period. */
  movements: RecognizedExpenseMovement[];
  pendingAmountCount?: number;
  /** Records a mutation may target, from `getEditableRecognizedExpenseMovements`. */
  editableMovements: EditableRecognizedExpenseMovement[];
  /**
   * Category the analytics ranking jumped to. It is read only while the state is first created, so it
   * is consumed on mount and a later manual choice is never overwritten by it; `undefined` renders
   * the unfiltered table. A category these rows no longer carry is cleared by the reconciliation
   * below, exactly like a selection made in another period.
   */
  requestedCategory?: string;
  onEdit: (movement: EditableRecognizedExpenseMovement) => void;
  onRemove: (movement: EditableRecognizedExpenseMovement) => void;
  /** Assigns one category to the whole selection through the existing PATCH client. */
  submitBulkCategory?: BulkCategorySubmitter;
  /** Read-only category catalog already loaded by the summary; `[]` still offers "Sin categoría". */
  categoryCatalog?: Category[];
}

export function MovementsTable({
  period,
  movements,
  pendingAmountCount = 0,
  editableMovements,
  requestedCategory,
  onEdit,
  onRemove,
  submitBulkCategory,
  categoryCatalog = [],
}: MovementsTableProps) {
  // Initialised for the period the rows belong to; the unified view also renders for empty periods.
  // the rows belong to. The requested category is only read here, which is what makes it a mount-time
  // input instead of a controlled value the table would have to re-adopt on every render.
  const [selection, setSelection] = useState<MovementFilterSelection>(() =>
    requestedCategory
      ? selectMovementFilterCategory(requestedCategory, period)
      : createMovementFilterSelection(period),
  );

  // The ordering is its own state, never stored and never persisted, exactly like the filter: a period
  // reload cannot carry a category the user did not pick, and sorting cannot reset the filter. Legacy
  // kept `sortKey`/`sortDir` in memory too (`public/app.js:142-143`).
  const [sort, setSort] = useState<MovementSortState>(() => createMovementSortState());
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");

  // Row selection, the detail modal and the bulk action are table-local state.
  const [rowSelection, setRowSelection] = useState<MovementSelection>(() => createMovementSelection());
  const [detailMovement, setDetailMovement] = useState<RecognizedExpenseMovement | null>(null);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkNotice, setBulkNotice] = useState<BulkCategoryFeedback | null>(null);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  // The single in-flight lock: React state cannot close the async window, so this ref is what keeps
  // two same-tick clicks from launching two bulk passes.
  const bulkLock = useRef(false);

  // Reconciling during render, instead of in an effect, is React's documented way to adjust state
  // when an input changes: the new period's rows are never rendered under the previous period's
  // selection. It runs even for empty rows, so the reset commits in every case — a
  // period with no rows still replaces the selection it inherited, and a category the loaded rows no
  // longer carry is cleared instead of only being hidden at render. The module returns the same
  // object while the selection still applies, so this re-renders only when something really changed
  // and cannot loop.
  const currentSelection = reconcileMovementFilterSelection(selection, period, movements);
  if (currentSelection !== selection) setSelection(currentSelection);

  const categoryView = getMovementFilterView(currentSelection, period, movements);
  const query = search.trim().toLocaleLowerCase("es");
  const matchingRows = categoryView.rows.filter((movement) =>
    (!kind || movement.kind === kind) &&
    (!query || [movement.counterparty, movement.description, movement.category]
      .some((value) => value?.toLocaleLowerCase("es").includes(query))),
  );
  const filteredView: MovementFilterView = {
    ...categoryView,
    rows: matchingRows,
    count: query || kind
      ? {
        ...categoryView.count,
        shown: matchingRows.length,
        message: `${categoryView.count.isActive ? `Filtro: ${categoryView.activeCategory} · ` : ""}${matchingRows.length} de ${movements.length} movimientos con los filtros actuales.`,
      }
      : categoryView.count,
  };
  // The selection is reconciled against the rows the table is actually showing, so a filtered-away
  // or reloaded-away row cannot stay silently selected. The module returns the same set while nothing
  // changed, so this only re-renders on a real transition.
  const visibleRows = sortMovements(filteredView.rows, sort);
  const selectableIds = getSelectableMovementIds(visibleRows, editableMovements);
  const reconciledRowSelection = reconcileMovementSelection(rowSelection, selectableIds);
  if (reconciledRowSelection !== rowSelection) setRowSelection(reconciledRowSelection);
  const selectionView = getMovementSelectionView(reconciledRowSelection, selectableIds);

  const bulkCategoryOptions: CategorySelectOption[] = [
    { value: "", label: "Sin categoría", disabled: false },
    ...categoryCatalog.map((category) => ({
      value: category.name,
      label: category.name,
      disabled: false,
    })),
  ];

  const openDetail = (movement: RecognizedExpenseMovement) => setDetailMovement(movement);
  const closeDetail = () => setDetailMovement(null);
  const detailEditable =
    detailMovement === null
      ? null
      : editableMovements.find((movement) => movement.id === detailMovement.id) ?? null;

  const handleDetailEdit = (movement: EditableRecognizedExpenseMovement) => {
    // The detail view is read-only; handing the row to the existing edit flow closes it first so the
    // two native dialogs never stack.
    setDetailMovement(null);
    onEdit(movement);
  };
  const handleDetailRemove = (movement: EditableRecognizedExpenseMovement) => {
    setDetailMovement(null);
    onRemove(movement);
  };

  const assignCategory = async () => {
    if (selectionView.selectedCount === 0) return;
    if (!submitBulkCategory) return;
    const targets = getBulkCategoryTargets(editableMovements, selectionView.selectedIds).flatMap(
      (movement) => {
        const target = getMovementUpdateTarget({
          id: movement.id ?? undefined,
          occurredAt: movement.occurredAt,
          isManual: movement.isManual,
        });
        return target === null ? [] : [target];
      },
    );
    // No usable targets means no bulk PATCH: the same rule that leaves a row untickable keeps a stale
    // selection from sending a request the API layer would refuse.
    if (targets.length === 0) return;
    if (!acquireInFlightLock(bulkLock)) return;
    setIsBulkAssigning(true);
    setBulkNotice(null);
    try {
      const outcome = await submitBulkCategory(targets, bulkCategory);
      setBulkNotice(getBulkCategoryFeedback(outcome));
      // A fully applied selection has nothing left to act on, so it clears. A partial one keeps the
      // selection so the user can see and re-run the action deliberately; nothing retries on its own.
      if (outcome.total > 0 && outcome.succeeded === outcome.total) {
        setRowSelection(createMovementSelection());
      }
    } finally {
      releaseInFlightLock(bulkLock);
      setIsBulkAssigning(false);
    }
  };

  return (
    <>
      <MovementsTableView
        filteredView={filteredView}
        periodMovements={movements}
        pendingAmountCount={pendingAmountCount}
        search={search}
        onSearchChange={setSearch}
        kind={kind}
        onKindChange={setKind}
        sort={sort}
        editableMovements={editableMovements}
        onActivate={(key) => setSort(cycleMovementSort(sort, key))}
        onSelect={(category) => setSelection(selectMovementFilterCategory(category, period))}
        onClear={() => setSelection(createMovementFilterSelection(period))}
        onEdit={onEdit}
        onRemove={onRemove}
        onView={openDetail}
        selection={selectionView}
        onToggleSelection={(id) =>
          setRowSelection((current) =>
            toggleMovementSelection(current, id, selectableIds),
          )
        }
        onToggleAllSelection={() =>
          setRowSelection((current) =>
            toggleAllMovementSelection(current, selectableIds),
          )
        }
        onSelectSimilar={(ids) => setRowSelection(selectMovementIds(ids))}
        onClearSelection={() => setRowSelection(createMovementSelection())}
        bulkCategoryOptions={bulkCategoryOptions}
        bulkCategoryValue={bulkCategory}
        onBulkCategoryChange={setBulkCategory}
        onAssignCategory={assignCategory}
        isBulkAssigning={isBulkAssigning}
        bulkNotice={bulkNotice}
      />
      {/* The detail modal is rendered for every recognized row, editable or not. */}
      <ViewMovementDialog
        movement={detailMovement}
        editableMovement={detailEditable}
        onClose={closeDetail}
        onEdit={handleDetailEdit}
        onRemove={handleDetailRemove}
      />
    </>
  );
}
