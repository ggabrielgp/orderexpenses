import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CategoryRankingPanel,
  CategoryRankingView,
  DashboardAnalyticsBody,
  SpendingBreakdownView,
  TopInsightsView,
  type CategoryRankingPanelProps,
  type CategoryRankingViewProps,
  type SpendingBreakdownViewProps,
  type TopInsightsViewProps,
} from "../components/analytics/DashboardAnalyticsPanels";
import {
  SpendingChartPanel,
  SpendingChartView,
  type SpendingChartPanelProps,
  type SpendingChartViewProps,
} from "../components/analytics/SpendingChartPanel";
import { getAccountReconciliation } from "../components/analytics/accountReconciliation";
import { getDashboardPace, todayInSantiago, type DashboardPace } from "../components/analytics/dashboardPace";
import { config } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowsRotate,
  faCalendarDays,
  faRightFromBracket,
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
  prepareFinancialDashboardSyncReuse,
  writeFinancialDashboardCache,
  removeTransaction,
  syncGmail,
  updateFinancialCycle,
  updateFinancialCycleReconciliation,
  updateTransaction,
  upsertCategory,
  upsertCounterpartyRule,
  getCounterpartyRules,
} from "../api/client";
import {
  getRecategorizeNotice,
  getUndoNotice,
  saveAlwaysUseRule,
  undoRecategorize,
  type RecategorizeUndo,
} from "../components/movements/recategorizeRule";
import { getGoogleLoginUrl } from "../api/googleLogin";
import { AccountMenu } from "../components/account/AccountMenuComponent";
import {
  MovementFilterBar,
  MovementsTable,
  MovementsTableHeader,
  MovementsTableView,
  type MovementFilterBarProps,
  type MovementsTableHeaderProps,
  type MovementsTableProps,
  type MovementsTableViewProps,
} from "../components/movements/MovementsTable";
import { FeedbackNotice } from "../components/feedback/FeedbackNotice";
import { SuccessToastProvider, useSuccessToast } from "../components/feedback/SuccessToast";
import { useAnimatedView, useEditHighlight } from "../components/feedback/motion";
import {
  DashboardPeriodContext,
  DemoDashboardPage,
  DemoDashboardView,
} from "../components/demo/DemoDashboardPage";
import { DashboardLoadingState } from "../components/analytics/DashboardLoadingState";
import { AppHeader, type DashboardView } from "../components/shell/AppHeader";
import { MobileTabBar } from "../components/shell/MobileTabBar";
import { OnboardingConnect } from "../components/onboarding/OnboardingConnect";
import { hasSeenFirstResult } from "../components/onboarding/firstResult";
import {
  dismissFirstResult,
  observeFirstResult,
  startFirstResult,
  type FirstResultPhase,
} from "../components/onboarding/firstResultFlow";
import { getPeriodAnalytics } from "../components/analytics/periodAnalytics";
import { getDashboardCounterpartyRanking } from "../components/analytics/dashboardCounterpartyRanking";
import { getCategoryRanking } from "../components/analytics/categoryRanking";
import { getDashboardLead } from "../components/analytics/dashboardLead";
import {
  getDashboardStory,
  getMostFrequentCounterparty,
  getSpendingBreakdown,
  getTopCounterpartyGroup,
  getTopInsights,
  getUncategorizedExpenses,
} from "../components/analytics/dashboardInsights";
import { getSpendingChart } from "../components/analytics/spendingChart";
import {
  acquireInFlightLock,
  createManualExpenseSubmitter,
  getManualExpenseCreationNotice,
  releaseInFlightLock,
  type ManualExpenseCreationNotice,
} from "../components/movements/CreateManualExpenseDialog";
import {
  createMovementEditSubmitter,
  getMovementEditNotice,
  type MovementEditNotice,
  type MovementRecategorized,
} from "../components/movements/EditMovementDialog";
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
import { GmailInlineConsent } from "../components/gmail/GmailInlineConsent";
import {
  createGmailConsentState,
  reduceGmailConsent,
  type GmailConsentState,
} from "../components/gmail/gmailConsent";
import { createGmailSyncSubmitter, type GmailSyncResultReusePreparation } from "../components/gmail/gmailSync";
import { createCategoryMutationSubmitter } from "../components/settings/categorySettings";
import { createCounterpartyRuleSubmitter } from "../components/settings/counterpartyRules";
import type { SignInPeriodChoice } from "../components/financial-cycle/FinancialCycleEditDialog";
import {
  FinancialCycleSetupForm,
  requestFinancialSetupDismiss,
} from "../components/financial-cycle/FinancialCycleSetupForm";
import {
  clearSignInMarker,
  decideSignInPrompt,
  hasSignInMarker,
  rememberPeriodPromptSkip,
  todayIsoSantiago,
} from "../components/financial-cycle/signInPeriodPrompt";
import {
  createCycleEditSubmitter,
  getCycleEditNotice,
  type CycleEditNotice,
} from "../components/financial-cycle/cycleSettings";
import {
  formatPeriodLabel,
  getMovementUpdateTarget,
  type EditableRecognizedExpenseMovement,
  type RecognizedExpenseMovement,
} from "../components/movements/manualExpense";
import {
  createFinancialCycleSetupPayload,
  formatClp,
  formatMovementDate,
  getEditableRecognizedExpenseMovements,
  getRecognizedExpenseIdentity,
  getRecognizedExpenseMovements,
  getSpendingChartDetailMovements,
  isRecognizedExpense,
  selectLatestRecognizedExpense,
  summarizeRecognizedExpenses,
  summarizeRecognizedExpensesByKind,
} from "../components/movements/movementSummary";
import { createBulkCategorySubmitter } from "../components/movements/movementSelection";
import type {
  Category,
  FinancialDashboardData,
  FinancialPeriod,
  FinancialTransaction,
  SessionResponse,
} from "../api/types";

config.autoAddCss = false;

// Secondary modal dialogs are lazy-loaded so Vite splits them into on-demand chunks while keeping
// initial render and SSR free of modal code.
const AccountSettingsDialog = lazy(() =>
  import("../components/settings/AccountSettingsDialog").then((m) => ({
    default: m.AccountSettingsDialog,
  })),
);
const CreateManualExpenseDialog = lazy(() =>
  import("../components/movements/CreateManualExpenseDialog").then((m) => ({
    default: m.CreateManualExpenseDialog,
  })),
);
const EditMovementDialog = lazy(() =>
  import("../components/movements/EditMovementDialog").then((m) => ({
    default: m.EditMovementDialog,
  })),
);
const RemoveMovementDialog = lazy(() =>
  import("../components/movements/RemoveMovementDialog").then((m) => ({
    default: m.RemoveMovementDialog,
  })),
);
const FinancialCycleEditDialog = lazy(() =>
  import("../components/financial-cycle/FinancialCycleEditDialog").then((m) => ({
    default: m.FinancialCycleEditDialog,
  })),
);
const ViewMovementDialog = lazy(() =>
  import("../components/movements/ViewMovementDialog").then((m) => ({
    default: m.ViewMovementDialog,
  })),
);
const FirstResultDialog = lazy(() =>
  import("../components/onboarding/FirstResultDialog").then((m) => ({
    default: m.FirstResultDialog,
  })),
);

/**
 * Latches `true` once a dialog opens so SSR and initial load never trigger `React.lazy`, while
 * keeping the dialog mounted after first open so its native `<dialog>` exit animation can play.
 */
function useHasOpened(isOpen: boolean): boolean {
  const [hasOpened, setHasOpened] = useState(isOpen);
  if (isOpen && !hasOpened) setHasOpened(true);
  return hasOpened || isOpen;
}

// The recognized-expense row type is owned by the movements module; it stays re-exported
// here so the page's public type surface is unchanged. `formatPeriodLabel` and the pure movement
// summary helpers are re-exported for the same reason: one shared definition, an unchanged public surface.
export type {
  CategoryRankingPanelProps,
  CategoryRankingViewProps,
  MovementFilterBarProps,
  MovementsTableHeaderProps,
  MovementsTableProps,
  MovementsTableViewProps,
  RecognizedExpenseMovement,
  SpendingBreakdownViewProps,
  SpendingChartPanelProps,
  SpendingChartViewProps,
  TopInsightsViewProps,
};
export {
  CategoryRankingPanel,
  CategoryRankingView,
  DashboardPeriodContext,
  DemoDashboardPage,
  DemoDashboardView,
  MovementFilterBar,
  MovementsTable,
  MovementsTableHeader,
  MovementsTableView,
  SpendingBreakdownView,
  SpendingChartPanel,
  SpendingChartView,
  TopInsightsView,
  createFinancialCycleSetupPayload,
  formatPeriodLabel,
  getEditableRecognizedExpenseMovements,
  getRecognizedExpenseIdentity,
  getRecognizedExpenseMovements,
  getSpendingChartDetailMovements,
  isRecognizedExpense,
  requestFinancialSetupDismiss,
  selectLatestRecognizedExpense,
  summarizeRecognizedExpenses,
  summarizeRecognizedExpensesByKind,
};

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
   * Starts the same reload without waiting for it and resolves `true` at once, so a saved mutation
   * can close its dialog and confirm immediately. A failed background reload is reported by the
   * summary as one stale-list warning instead of by the caller.
   */
  reloadInBackground: () => Promise<boolean>;
  /** Captures the ready dashboard before sync so only an unchanged load can reuse its result. */
  prepareSyncResultReuse: GmailSyncResultReusePreparation;
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
      prepareResultReuse: financialDashboard.prepareSyncResultReuse,
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
  const [view, setView] = useAnimatedView<DashboardView>("summary");
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
        reload: financialDashboard?.reloadInBackground ?? null,
        lock: counterpartyRulesLock,
      }),
    [financialDashboard],
  );

  const hasOpenedAccountSettings = useHasOpened(isAccountSettingsOpen);

  if (!session.authenticated) {
    return (
      // Onboarding step 1: trust in three points; the real connect control keeps the consent flow.
      <OnboardingConnect>
        <GmailConnectControl
          connectUrl={session.gmail.connectUrl}
          accountConnected={session.gmail.connected}
          className="button"
          inlineConsent
        />
      </OnboardingConnect>
    );
  }

  const profile = session.profile;
  const connected = session.gmail.connected;

  return (
    <SuccessToastProvider>
      {/* Authenticated product chrome. It hosts the one settings action under the shipped
			    account menu, so the unified settings surface keeps its unchanged mutation contract.
			    The demo uses the same chrome with a read-only account menu below. */}
      <AppHeader view={view} onViewChange={setView}>
        {connected && (
          <span className="react-gmail-connected-badge" role="status">
            <span className="react-gmail-connected-badge-dot" aria-hidden="true" />
            Gmail conectado
          </span>
        )}
        <AccountMenu profile={profile} gmailConnected={connected}>
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
              {/* The period button below already shows the range, so no context line here. */}
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
                  aria-label={`Editar período: ${formatPeriodLabel(financialDashboard.period)}`}
                  title={formatPeriodLabel(financialDashboard.period)}
                >
                  <span className="react-dashboard-period-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faCalendarDays} />
                  </span>
                  <span className="react-dashboard-period-range react-dashboard-period-range-full">
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
                  aria-label={isRefreshing ? "Actualizando gastos del período" : "Actualizar gastos del período"}
                >
                  <FontAwesomeIcon icon={faArrowsRotate} aria-hidden="true" />
                  <span className="react-dashboard-refresh-label">Actualizar</span>
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
          {hasOpenedAccountSettings && (
            <Suspense fallback={null}>
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
            </Suspense>
          )}

          <FinancialSummary
            key={profile?.email?.trim().toLowerCase() ?? ""}
            email={profile?.email ?? ""}
            onHandle={registerFinancialDashboard}
            view={view}
            onViewChange={setView}
          />
        </section>
      </main>
      <MobileTabBar view={view} onViewChange={setView} onAddExpense={financialDashboard?.period ? financialDashboard.onCreateExpense : undefined} />
    </SuccessToastProvider>
  );
}

interface GmailConnectControlProps {
  /** Server-owned OAuth entry point. The control never builds or rewrites it. */
  connectUrl: string;
  /** Whether a Gmail account is already connected; drives the refusal guard. */
  accountConnected: boolean;
  className?: string;
  /**
   * Step 1 only (S26): the consent points are already on screen, so the acknowledgement is a checkbox
   * above the control instead of a dialog. Everywhere else (reconnecting from inside the app) the
   * dialog explains them, and an already connected account keeps its refusal flow.
   */
  inlineConsent?: boolean;
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
  inlineConsent = false,
}: GmailConnectControlProps) {
  const [consent, setConsent] = useState<GmailConsentState>(createGmailConsentState);
  // The inline consent is an always-open consent: the same state machine, opened on first render.
  const [inlineState, setInlineState] = useState<GmailConsentState>(() =>
    reduceGmailConsent(createGmailConsentState(), { type: "open", accountConnected: false }),
  );

  const openConsent = useCallback(() => {
    setConsent((current) => reduceGmailConsent(current, { type: "open", accountConnected }));
  }, [accountConnected]);

  const closeConsent = useCallback(() => {
    setConsent((current) => reduceGmailConsent(current, { type: "cancel" }));
  }, []);

  if (inlineConsent && !accountConnected) {
    return (
      <GmailInlineConsent
        state={inlineState}
        connectUrl={connectUrl}
        className={className}
        onAcknowledge={(acknowledged) =>
          setInlineState((current) =>
            reduceGmailConsent(current, { type: "acknowledge", acknowledged }),
          )
        }
      />
    );
  }

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
  // Onboarding step 3 (S21): the first cycle save continues into "Paso 3 de 3 · Tu medidor", a dialog
  // that opens at once, loads until the reload yields the ready state and then shows the real gauge.
  const [firstResultPhase, setFirstResultPhase] = useState<FirstResultPhase>("idle");
  const handleFirstCycleSaved = useCallback(() => {
    setFirstResultPhase(startFirstResult(hasSeenFirstResult(browserStorage())));
    retry();
  }, [retry]);
  useEffect(() => {
    setFirstResultPhase((phase) => observeFirstResult(phase, state.status));
  }, [state.status]);
  /** "Ver mi resumen", Escape and the backdrop: closing the shown step counts as seen. */
  const closeFirstResult = useCallback(() => {
    setFirstResultPhase((phase) => dismissFirstResult(phase, browserStorage()));
  }, []);
  // S27: the OAuth return (`/app?gmail=connected`) is a fresh sign-in. It is read once, at mount, and it
  // stays pending until the summary has an outcome and the marker is removed from the URL.
  const signInPending = useRef(typeof window !== "undefined" && hasSignInMarker(window.location.search));
  const activeLoad = useRef<AbortController | null>(null);
  // Invalidate a prepared sync even when an intervening refresh finishes with identical values.
  const dashboardLoadEpoch = useRef(0);
  // A failed explicit reload leaves ready data on screen, but those transactions may be stale.
  const dashboardStale = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creationNotice, setCreationNotice] = useState<ManualExpenseCreationNotice | null>(null);
  const showSuccessToast = useSuccessToast();
  /** Set when a background reload after a confirmed save failed: the visible list may be stale. */
  const [staleAfterSave, setStaleAfterSave] = useState(false);
  /** Movement being edited; `null` keeps the edit dialog closed. */
  const [editMovement, setEditMovement] = useState<EditableRecognizedExpenseMovement | null>(null);
  // A recategorization notice also carries what "Deshacer" restores (S7).
  const [editNotice, setEditNotice] = useState<(MovementEditNotice & { undo?: RecategorizeUndo }) | null>(null);
  const [isUndoingEdit, setIsUndoingEdit] = useState(false);
  // The row just edited is highlighted for ~1.2s in the movements table and list (S15).
  const [highlightedMovementId, flashEdited] = useEditHighlight();
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
    dashboardLoadEpoch.current += 1;
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    try {
      const current = stateRef.current;
      const periodHint = current.status === "ready" ? current.data.cycle.selectedPeriod : null;
      const data = await refreshFinancialDashboardData(email, controller.signal, periodHint);
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
   * The save path's reload: the mutation is already confirmed, so the dialog closes and the check
   * shows without waiting for the slow cycle + Gmail refetch. Only a real failure (not a reload that
   * a newer one superseded) raises the stale-list warning; the next successful reload clears it.
   */
  const reloadInBackground = useCallback((): Promise<boolean> => {
    void reloadFinancialDashboard().then((reloaded) => {
      if (!mounted.current) return;
      if (reloaded) setStaleAfterSave(false);
      else if (dashboardStale.current) setStaleAfterSave(true);
    });
    return Promise.resolve(true);
  }, [reloadFinancialDashboard]);

  const retryStaleReload = useCallback(() => {
    void reloadFinancialDashboard().then((reloaded) => {
      if (mounted.current && reloaded) setStaleAfterSave(false);
    });
  }, [reloadFinancialDashboard]);

  const prepareSyncResultReuse = useCallback<GmailSyncResultReusePreparation>((period) => {
    const reuse = prepareFinancialDashboardSyncReuse(email, period, () => {
      const current = stateRef.current;
      return {
        data: current.status === "ready" ? current.data : null,
        loadEpoch: dashboardLoadEpoch.current,
        mounted: mounted.current,
        stale: dashboardStale.current,
        loading: activeLoad.current !== null,
      };
    });
    if (!reuse) return null;
    return (payload) => {
      const data = reuse(payload);
      if (data === "invalidated") return "invalidated";
      if (!data) return false;
      publishState({ status: "ready", data });
      dashboardStale.current = false;
      return true;
    };
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

  /** "edit" is the period button's dialog; "signIn" is the same dialog asking to confirm the stored period (S27). */
  const [cycleEditMode, setCycleEditMode] = useState<"edit" | "signIn">("edit");

  const openCycleEdit = useCallback(() => {
    // A previous outcome must not describe the new attempt.
    setCycleEditNotice(null);
    setCycleEditMode("edit");
    setIsCycleEditOpen(true);
  }, []);

  // S27: once the summary resolves after an OAuth return, a configured period opens the dialog prefilled
  // (unless the user asked not to be asked until the period ends) and the marker leaves the URL either way.
  useEffect(() => {
    if (!signInPending.current || typeof window === "undefined") return;
    const decision = decideSignInPrompt({
      search: window.location.search,
      status: state.status,
      email,
      storage: browserStorage(),
      today: todayIsoSantiago(new Date()),
    });
    if (!decision.handled) return;
    signInPending.current = false;
    clearSignInMarker(window);
    if (decision.open) {
      setCycleEditNotice(null);
      setCycleEditMode("signIn");
      setIsCycleEditOpen(true);
    }
  }, [state.status, email]);

  const handleSignInConfirmed = useCallback(
    (choice: SignInPeriodChoice) => {
      if (choice.skipUntilPeriodEnd) rememberPeriodPromptSkip(browserStorage(), email, choice.endDate);
    },
    [email],
  );

  const handleCycleEdited = useCallback((reloadFailed: boolean) => {
    if (!mounted.current) return;
    const notice = getCycleEditNotice({ status: "saved", reloadFailed });
    // A clean save is confirmed by the check alone; the banner stays for a stale summary.
    if (!reloadFailed && notice.tone === "success") showSuccessToast("Período actualizado");
    else setCycleEditNotice(notice);
    setIsCycleEditOpen(false);
  }, [showSuccessToast]);

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
      reloadInBackground,
      prepareSyncResultReuse: prepareSyncResultReuse,
      onEditPeriod: openCycleEdit,
      onCreateExpense: openCreateExpense,
    });
    return () => onHandle(null);
  }, [
    onHandle,
    configuredPeriod,
    reloadFinancialDashboard,
    reloadInBackground,
    prepareSyncResultReuse,
    openCycleEdit,
    openCreateExpense,
  ]);

  const submitManualExpense = useMemo(
    () =>
      createManualExpenseSubmitter({
        createExpense: createManualExpense,
        reload: reloadInBackground,
      }),
    [reloadInBackground],
  );

  const handleManualExpenseSaved = useCallback((reloadFailed: boolean) => {
    const notice = getManualExpenseCreationNotice(reloadFailed);
    if (!reloadFailed && notice.tone === "success") showSuccessToast("Gasto guardado");
    else setCreationNotice(notice);
    setIsCreateOpen(false);
  }, [showSuccessToast]);

  useEffect(() => {
    dashboardLoadEpoch.current += 1;
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    publishState({ status: "loading" });
    // The first mount is cache-first, so a browser reload (F5) reuses the tab's stored response
    // without a request. Every later run is a user-requested retry, which bypasses the cache and
    // reads current data instead.
    // A sign-in also reads current data: the dialog must show what the server stored, not a tab cache.
    const load = retryToken > 0 || signInPending.current
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

  const hasOpenedFirstResult = useHasOpened(firstResultPhase !== "idle");
  const hasOpenedCreate = useHasOpened(isCreateOpen);
  const hasOpenedCategoryDetail = useHasOpened(categoryDetailMovementId !== null);
  const hasOpenedEdit = useHasOpened(editMovement !== null);
  const hasOpenedRemoval = useHasOpened(removal.phase !== "closed");
  const hasOpenedChartDetail = useHasOpened(chartDetailMovementId !== null);
  const hasOpenedCycleEdit = useHasOpened(isCycleEditOpen);

  // Step 3 sits at the same position in every state, so the one dialog instance survives the move from
  // the saved setup, through loading, to the ready summary instead of re-opening.
  const firstResultStep = (pace: DashboardPace | null) =>
    hasOpenedFirstResult ? (
      <Suspense fallback={null}>
        <FirstResultDialog
          phase={firstResultPhase}
          pace={pace}
          formatClp={formatClp}
          onDone={closeFirstResult}
          onAddIncome={() => {
            closeFirstResult();
            openCycleEdit();
          }}
        />
      </Suspense>
    ) : null;
  if (state.status === "loading") {
    return <><DashboardLoadingState view={view} />{firstResultStep(null)}</>;
  }
  if (state.status === "failed") {
    return (
      <>
        <section className="react-financial-state" role="alert">
          <p>No se pudo cargar el resumen financiero.</p>
          <p className="react-financial-state-safe">Tus categorías, reglas y gastos manuales siguen guardados.</p>
          <button className="secondary" type="button" onClick={retry}>Reintentar resumen financiero</button>
        </section>
        {firstResultStep(null)}
      </>
    );
  }
  if (state.status === "unconfigured") {
    // While step 3 waits for the reload the setup form is not remounted behind it.
    return (
      <>
        {firstResultPhase === "idle" ? <FinancialCycleSetupForm onSaved={handleFirstCycleSaved} /> : null}
        {firstResultStep(null)}
      </>
    );
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
  // The month gauge reads the same configured income and total as the lead.
  const dashboardPace = getDashboardPace({
    startDate: selectedPeriod!.startDate,
    endDateExclusive: selectedPeriod!.endDateExclusive,
    incomeAmount,
    totalSpending: summary.totalSpending,
    today: todayInSantiago(new Date()),
  });
  const reconciliation = getAccountReconciliation({
    incomeAmount,
    totalSpending: summary.totalSpending,
    pendingAmountCount: summary.pendingAmountCount,
    actualBalance: state.data.cycle.actualBalance ?? null,
    actualBalanceAt: state.data.cycle.actualBalanceAt ?? null,
    transactions: state.data.transactions,
  });
  const handleSaveActualBalance = async (actualBalance: number | null) => {
    await updateFinancialCycleReconciliation({
      period: selectedPeriod!,
      actualBalance,
    });
    showSuccessToast(actualBalance === null ? "Saldo real borrado" : "Saldo real guardado");
    void reloadInBackground();
  };
  const periodAnalytics = getPeriodAnalytics(state.data.transactions);
  const spendingByKind = summarizeRecognizedExpensesByKind(state.data.transactions);
  const latestExpense = selectLatestRecognizedExpense(state.data.transactions, selectedPeriod!);
  // A confirmed removal reloads in the background; until that reload lands, the removed rows are
  // hidden locally so the list never shows a movement the server already deleted.
  const removedIds = removal.removedMovementIds;
  const isVisibleRow = (movement: { id?: string | null }) => !movement.id || !removedIds.includes(movement.id);
  const movements = getRecognizedExpenseMovements(state.data.transactions).filter(isVisibleRow);
  const editableMovements = getEditableRecognizedExpenseMovements(state.data.transactions).filter(isVisibleRow);
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
    reload: reloadInBackground,
    saveRule: (input) =>
      saveAlwaysUseRule({ getRules: () => getCounterpartyRules(), upsertRule: upsertCounterpartyRule }, input),
  });
  const submitRemoval = createMovementRemovalSubmitter({
    removeMovement: removeTransaction,
    reload: reloadInBackground,
  });
  // The bulk category assignment reuses the same PATCH client and the same reload as the single-edit
  // flow, so a bulk pass and a single edit cannot disagree about how a movement is written or how
  // the visible list is refreshed. This is built per render, like the single-edit/removal submitters,
  // because this branch sits after loading/failed/unconfigured early returns and must not add a hook
  // only when the summary is ready.
  const rawSubmitBulkCategory = createBulkCategorySubmitter({
    updateMovement: updateTransaction,
    reload: reloadInBackground,
  });
  const submitBulkCategory: typeof rawSubmitBulkCategory = async (targets, category) => {
    const outcome = await rawSubmitBulkCategory(targets, category);
    if (
      mounted.current &&
      outcome.total > 0 &&
      outcome.succeeded === outcome.total &&
      !outcome.reloadFailed
    ) {
      showSuccessToast("Categoría asignada");
    }
    return outcome;
  };

  const openMovementEdit = (movement: EditableRecognizedExpenseMovement) => {
    // A previous outcome must not describe the new attempt.
    setEditNotice(null);
    setEditMovement(movement);
  };

  const handleMovementEditSaved = (reloadFailed: boolean, recategorized?: MovementRecategorized) => {
    const notice = recategorized
      ? { ...getRecategorizeNotice({ reloadFailed, ...recategorized }), undo: recategorized.undo }
      : getMovementEditNotice(reloadFailed);
    if (!reloadFailed && notice.tone === "success") showSuccessToast("Cambios guardados");
    // The banner stays for warnings and for the recategorization's Deshacer action.
    setEditNotice(notice.tone === "success" && !("undo" in notice && notice.undo) ? null : notice);
    flashEdited(editMovement?.id);
    setEditMovement(null);
  };

  const undoMovementEdit = async (undo: RecategorizeUndo) => {
    if (isUndoingEdit) return;
    setIsUndoingEdit(true);
    try {
      const { reloadFailed } = await undoRecategorize(
        { upsertRule: upsertCounterpartyRule, updateMovement: updateTransaction, reload: reloadInBackground },
        undo,
      );
      const notice = getUndoNotice({ status: "done", reloadFailed });
      if (notice.tone === "success") {
        showSuccessToast("Cambio deshecho");
        setEditNotice(null);
      } else {
        setEditNotice(notice);
      }
    } catch {
      // Nothing confirms the revert, so the action stays available for another attempt.
      setEditNotice({ ...getUndoNotice({ status: "failed" }), undo });
    } finally {
      setIsUndoingEdit(false);
    }
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
    const notice = getRemovalNotice(removal);
    if (notice?.tone === "success") showSuccessToast("Movimiento eliminado");
    else setRemovalNotice(notice);
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
        // A confirmed removal closes at once with the check: the reducer still records the id
        // (so the row cannot be removed twice) and the dismissal keeps that guard.
        setRemoval((current) =>
          reduceRemovalDismissal(
            reduceRemovalState(current, {
              type: "succeeded",
              hadReloadFailure: outcome.reloadFailed,
            }),
          ),
        );
        setRemovalMovement(null);
        releaseInFlightLock(removalLock);
        if (outcome.reloadFailed) {
          setRemovalNotice(getRemovalNotice({ ...removal, phase: "removed", reloadFailed: true }));
        } else {
          showSuccessToast("Movimiento eliminado");
        }
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
    <>
    <section className="react-financial-summary" aria-label="Resumen financiero del período">
      {state.data.warning && (
        <div className="react-financial-summary-heading">
          <p className="react-financial-warning" role="status">Advertencia: {state.data.warning}</p>
        </div>
      )}
      {staleAfterSave && (
        <FeedbackNotice
          className="react-financial-mutation-notice react-financial-mutation-notice-warning"
          tone="warning"
          message="Los cambios se guardaron, pero la lista no se pudo actualizar y puede estar desactualizada."
          action={{ label: "Reintentar", onClick: retryStaleReload }}
          onDismiss={() => setStaleAfterSave(false)}
        />
      )}
      {creationNotice && (
        <FeedbackNotice
          className={`react-financial-creation-notice react-financial-creation-notice-${creationNotice.tone}`}
          tone={creationNotice.tone}
          message={creationNotice.message}
        />
      )}
      {editNotice && (
        <FeedbackNotice
          className={`react-financial-mutation-notice react-financial-mutation-notice-${editNotice.tone}`}
          tone={editNotice.tone}
          message={editNotice.message}
          onDismiss={editNotice.undo ? () => setEditNotice((current) => (current === editNotice ? null : current)) : undefined}
          action={
            editNotice.undo
              ? {
                  label: isUndoingEdit ? "Deshaciendo..." : "Deshacer",
                  onClick: () => void undoMovementEdit(editNotice.undo!),
                  disabled: isUndoingEdit,
                }
              : undefined
          }
        />
      )}
      {removalNotice && (
        <FeedbackNotice
          className={`react-financial-mutation-notice react-financial-mutation-notice-${removalNotice.tone}`}
          tone={removalNotice.tone}
          message={removalNotice.message}
        />
      )}
      {cycleEditNotice && (
        <FeedbackNotice
          className={`react-financial-mutation-notice react-financial-mutation-notice-${cycleEditNotice.tone}`}
          tone={cycleEditNotice.tone}
          message={cycleEditNotice.message}
          autoDismissMs={cycleEditNotice.autoDismissMs}
          onDismiss={() => setCycleEditNotice(null)}
        />
      )}
      {view === "summary" ? (
        <>
          {/* The shared analytics body owns the section order, so both the authenticated summary and
					    the read-only demo read the same composition. Here it carries the authenticated
					    capabilities: the jump switches to the movements view with the requested category, and
					    the chart detail opens the read-only movement dialog. */}
          <DashboardAnalyticsBody
            pace={dashboardPace}
            reconciliation={reconciliation}
            onSaveActualBalance={handleSaveActualBalance}
            periodStartDate={selectedPeriod!.startDate}
            paceEndExclusive={selectedPeriod!.endDateExclusive}
            onAddIncome={openCycleEdit}
            lead={dashboardLead}
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
            <div className="react-financial-empty-block">
              <p className="react-financial-empty" role="status">No se encontraron gastos reconocidos para este período.</p>
              <div className="react-financial-empty-actions">
                <button className="button" type="button" onClick={openCreateExpense}>Agregar gasto</button>
                <button className="secondary" type="button" onClick={() => { void reloadFinancialDashboard(); }}>Actualizar</button>
              </div>
            </div>
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
          highlightedMovementId={highlightedMovementId}
          onCreateExpense={openCreateExpense}
          onRefresh={() => { void reloadFinancialDashboard(); }}
        />
      )}
      {/* Only a configured summary can create an expense: the trigger lives here, and the
			    dialog is the only place that requests the category catalog. */}
      {hasOpenedCreate && (
        <Suspense fallback={null}>
          <CreateManualExpenseDialog
            isOpen={isCreateOpen}
            period={selectedPeriod!}
            onClose={() => setIsCreateOpen(false)}
            submitExpense={submitManualExpense}
            onSaved={handleManualExpenseSaved}
          />
        </Suspense>
      )}
      {/* Category detail is independent from the weekday's read-only dialog. Unmount it before
			    opening edit so native modal top layers never overlap. Only eligible rows offer Editar. */}
      {hasOpenedCategoryDetail && (
        <Suspense fallback={null}>
          <ViewMovementDialog
            movement={categoryDetailMovement}
            editableMovement={categoryDetailMovementEditable}
            onClose={() => setCategoryDetailMovementId(null)}
            onEdit={(movement) => {
              setCategoryDetailMovementId(null);
              openMovementEdit(movement);
            }}
          />
        </Suspense>
      )}
      {/* The edit dialog is only reachable from a row action, and every row that offers one is
			    already bound to a target the PATCH accepts. */}
      {hasOpenedEdit && (
        <Suspense fallback={null}>
          <EditMovementDialog
            isOpen={editMovement !== null}
            movement={editMovement}
            period={selectedPeriod!}
            onClose={() => setEditMovement(null)}
            submitEdit={submitEdit}
            onSaved={handleMovementEditSaved}
          />
        </Suspense>
      )}
      {/* Unit B's dialog, driven by the reducer that owns the guard against a second DELETE. */}
      {hasOpenedRemoval && (
        <Suspense fallback={null}>
          <RemoveMovementDialog
            movement={removalMovement}
            state={removal}
            onCancel={dismissMovementRemoval}
            onConfirm={confirmMovementRemoval}
          />
        </Suspense>
      )}
      {/* The chart's day-detail dialog is read-only: it names the movement and offers only `Cerrar`,
			    reusing the same native modal the movements table mounts. */}
      {hasOpenedChartDetail && (
        <Suspense fallback={null}>
          <ViewMovementDialog
            movement={chartDetailMovement}
            editableMovement={chartDetailMovementEditable}
            onClose={() => setChartDetailMovementId(null)}
          />
        </Suspense>
      )}
      {/* Mounted inside the ready state: an unconfigured or failed summary has no period to edit. */}
      {hasOpenedCycleEdit && (
        <Suspense fallback={null}>
          <FinancialCycleEditDialog
            isOpen={isCycleEditOpen}
            cycle={state.data.cycle}
            onClose={() => setIsCycleEditOpen(false)}
            submitCycle={submitCycleEdit}
            onSaved={handleCycleEdited}
            signIn={cycleEditMode === "signIn"}
            onSignInConfirmed={handleSignInConfirmed}
          />
        </Suspense>
      )}
    </section>
    {firstResultStep(dashboardPace)}
    </>
  );
}

/** `localStorage` when the browser exposes it; null during SSR tests or when access is denied. */
function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
