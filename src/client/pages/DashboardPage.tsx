import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
	completeFinancialCycle,
	createManualExpense,
	deleteCategory,
	loadFinancialDashboardData,
	removeTransaction,
	syncGmail,
	updateFinancialCycle,
	updateTransaction,
	upsertCategory,
	upsertCounterpartyRule,
} from "../api/client";
import { AccountMenu } from "../components/account/AccountMenu";
import { AppHeader, type DashboardView } from "../components/shell/AppHeader";
import {
	getPeriodAnalytics,
	type PeriodAnalytics,
} from "../components/analytics/periodAnalytics";
import {
	findCategoryRankingRow,
	getCategoryRanking,
	type CategoryRanking,
	type CategoryRankingRow,
} from "../components/analytics/categoryRanking";
import {
	FULL_PERIOD_TAB_ID,
	getSpendingChart,
	getSpendingChartSeries,
	type SpendingChart,
} from "../components/analytics/spendingChart";
import {
	CreateManualExpenseDialog,
	acquireInFlightLock,
	createManualExpenseSubmitter,
	getManualExpenseCreationNotice,
	releaseInFlightLock,
	type ManualExpenseCreationNotice,
} from "../components/movements/CreateManualExpenseDialog";
import {
	EditMovementDialog,
	createMovementEditSubmitter,
	getMovementEditNotice,
	type MovementEditNotice,
} from "../components/movements/EditMovementDialog";
import { RemoveMovementDialog } from "../components/movements/RemoveMovementDialog";
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
import { GmailConnectionPanel } from "../components/gmail/GmailConnectionPanel";
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
import { CompleteCycleDialog } from "../components/financial-cycle/CompleteCycleDialog";
import {
	createCycleEditSubmitter,
	getCycleClosureMark,
	getCycleEditNotice,
	parseCycleIncome,
	type CycleEditNotice,
} from "../components/financial-cycle/cycleSettings";
import { createCycleCompletionSubmitter } from "../components/financial-cycle/cycleCompletion";
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
import type { DemoDashboardData } from "../demo-data";
import type {
	FinancialDashboardData,
	FinancialPeriod,
	FinancialTransaction,
	RecognizedExpenseKind,
	SessionResponse,
	UpdateFinancialCycleRequest,
} from "../api/types";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../shared/review-period.js";

// The recognized-expense row type is owned by the movements module; it stays re-exported
// here so the page's public type surface is unchanged. `formatPeriodLabel` is re-exported for
// the same reason: one shared definition, an unchanged public surface.
export type { RecognizedExpenseMovement };
export { formatPeriodLabel };

interface DashboardPageProps {
	session: SessionResponse;
	onRetry: () => void;
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
		return [{
			id: typeof transaction.id === "string" && transaction.id.trim()
				? transaction.id.trim()
				: null,
			counterparty: getRecognizedExpenseIdentity(transaction),
			amount: transaction.amount,
			date: formatMovementDate(transaction.occurredAt),
			category: getMovementCategory(transaction.category),
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

export function DashboardPage({ session, onRetry }: DashboardPageProps) {
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
			    account menu, so the unified settings surface keeps its unchanged mutation contract;
			    the demo tree never mounts this header, which keeps the account surface out of the
			    read-only demo by construction. */}
			<AppHeader view={view} onViewChange={setView}>
				<AccountMenu profile={profile}>
					<button
						type="button"
						role="menuitem"
						onClick={() => setIsAccountSettingsOpen(true)}
					>
						Configuración
					</button>
				</AccountMenu>
			</AppHeader>
			<main className="shell react-shell">
				<section className="panel product-panel react-dashboard-shell" aria-labelledby="react-dashboard-title">
					<header className="react-dashboard-header">
						<div>
							<h1 id="react-dashboard-title">Resumen de la cuenta</h1>
							<p className="subtitle">
								Aquí puedes registrar, editar y eliminar movimientos, administrar las
								categorías y sincronizar con Gmail.
							</p>
						</div>
					</header>

					{/* Mounted only in this authenticated tree: `DemoDashboardPage` is a separate read-only
					    composition that never mounts the unified settings surface. Gmail keeps its own
					    connection state machine in the body panel below. */}
					<AccountSettingsDialog
						isOpen={isAccountSettingsOpen}
						onClose={() => setIsAccountSettingsOpen(false)}
						profile={profile}
						submitCategoryMutation={submitCategoryMutation}
						submitCounterpartyRule={submitCounterpartyRule}
					/>

					<div className="react-status-grid">
						<article className="react-status-card">
							<span className="section-kicker">Sesión actual</span>
							<strong>{profile?.name || "Usuario conectado"}</strong>
							<p>{profile?.email || "No hay un perfil de Gmail asociado a esta sesión."}</p>
						</article>
						<article className="react-status-card">
							{/* The real connection state lives in the panel: it reads `/api/gmail/status`, offers the
							    refresh, and owns the disconnection. The connect control stays unit A's and is handed
							    the effective state, so a stale session snapshot can never refuse a valid reconnection. */}
							<GmailConnectionPanel
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
							/>
						</article>
					</div>

					<FinancialSummary
						onHandle={registerFinancialDashboard}
						view={view}
						onViewChange={setView}
					/>

					<div className="react-shell-actions">
						<button className="secondary" type="button" onClick={onRetry}>
							Actualizar estado de la conexión
						</button>
						<a href="/">Volver al inicio</a>
					</div>
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

export function DemoDashboardPage({ data }: { data: DemoDashboardData }) {
	const balance = data.currentPeriodInflow - data.currentPeriodSpending;
	return (
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

				<div className="demo-kpi-grid" aria-label="Resumen financiero de ejemplo">
					<DemoKpi label="Ingresos" value={formatClp(data.currentPeriodInflow)} />
					<DemoKpi label="Gastos" value={formatClp(data.currentPeriodSpending)} />
					<DemoKpi label="Balance" value={formatClp(balance)} />
				</div>

				<section className="demo-movements" aria-labelledby="demo-movements-title">
					<div>
						<span className="section-kicker">Movimientos</span>
						<h2 id="demo-movements-title">Actividad del periodo</h2>
					</div>
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
	);
}

function DemoKpi({ label, value }: { label: string; value: string }) {
	return (
		<article className="demo-kpi">
			<span>{label}</span>
			<strong>{value}</strong>
		</article>
	);
}

export interface FinancialPeriodHeadingProps {
	period: FinancialPeriod;
	/** Closure record the server reported for this range; `null` when the period is open. */
	completedAt: string | null;
	onEdit: () => void;
	/** Opens the closure confirmation. The control never closes the period by itself. */
	onComplete: () => void;
}

/**
 * Ready-state heading: the configured period, its closure mark, and the controls that reopen or close it.
 *
 * Exported so the mark and the triggers are provable from markup instead of from a slice of source
 * text: the summary's ready state needs a live session and effect-driven loads to exist, so a static
 * render of the summary only ever shows its loading state.
 */
export function FinancialPeriodHeading({
	period,
	completedAt,
	onEdit,
	onComplete,
}: FinancialPeriodHeadingProps) {
	const closureMark = getCycleClosureMark(completedAt);
	return (
		<div>
			<span className="section-kicker">Periodo configurado</span>
			<h2 id="react-financial-summary-title">Resumen financiero</h2>
			<p>
				{formatPeriodLabel(period)}
				{closureMark !== null && (
					<span className="react-financial-cycle-closure">{closureMark}</span>
				)}
			</p>
			{/* Legacy hides the month picker once a cycle is configured (`public/app.js:1013-1017`), so
			    reopening the cycle is the only way to review another range in this surface. */}
			<div className="react-shell-actions">
				<button className="secondary" type="button" onClick={onEdit}>Cambiar período</button>
				<button className="secondary" type="button" onClick={onComplete}>Cerrar período</button>
			</div>
		</div>
	);
}

export interface PeriodAnalyticsPanelProps {
	/** The decided metrics for the loaded period, from `getPeriodAnalytics`. */
	analytics: PeriodAnalytics;
}

/**
 * The three period metrics as one already-decided state.
 *
 * Exported so both the populated and the empty markup are provable from a static render: the live
 * summary only ever shows its loading state without a session, and what these metrics may claim is worth
 * proving from what the user reads. The panel renders the decisions the pure module made and computes
 * nothing of its own, so it cannot disagree with them.
 *
 * The largest expense is not rendered when there is none: no movement carries an amount this card could
 * name, and a placeholder amount under that label would be the claim the data does not support.
 */
export function PeriodAnalyticsPanel({ analytics }: PeriodAnalyticsPanelProps) {
	return (
		<section className="react-period-analytics" aria-labelledby="react-period-analytics-title">
			<h3 id="react-period-analytics-title">Analítica del periodo</h3>
			<div className="react-financial-grid">
				<article className="react-financial-card">
					<span>{analytics.average.label}</span>
					{/* No number at all while there is no usable amount: the substitute is copy, not a value. */}
					<strong>
						{analytics.average.amount === null
							? analytics.average.emptyValue
							: formatClp(analytics.average.amount)}
					</strong>
					<p>{analytics.average.detail}</p>
				</article>
				{analytics.largest !== null && (
					<article className="react-financial-card">
						<span>{analytics.largest.label}</span>
						<strong>{formatClp(analytics.largest.amount)}</strong>
						<p>{analytics.largest.counterparty} · {analytics.largest.date}</p>
					</article>
				)}
				<article className="react-financial-card">
					<span>{analytics.review.label}</span>
					<strong>{analytics.review.count}</strong>
					{/* One paragraph per fact: the review count and the unknown-amount count are two statements. */}
					{analytics.review.details.map((detail) => (
						<p key={detail}>{detail}</p>
					))}
				</article>
			</div>
		</section>
	);
}

/** Legacy's compact count wording (`renderCategoryLegendItem`, `public/app.js:2984`). */
function formatMovementCount(count: number): string {
	return `${count} ${count === 1 ? "movimiento" : "movimientos"}`;
}

/**
 * The category ranking as one already-decided state: the ranked rows, and the detail of the selected
 * row when there is one.
 *
 * Exported so both the list and the detail markup are provable from a static render, like
 * `PeriodAnalyticsPanel`: a live summary only ever reaches the list without a session, and what the
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
				<div className="react-category-detail">
					<header className="react-category-detail-header">
						<strong>{selectedRow.category}</strong>
						<small>
							{formatClp(selectedRow.total)} · {selectedRow.share}% · {formatMovementCount(selectedRow.count)}
						</small>
					</header>
					<div className="react-category-detail-rows">
						{selectedRow.mergesTail
							? selectedRow.children.map((child) => (
									<article key={child.category} className="react-category-detail-row">
										<strong>{child.category}</strong>
										<small>{formatClp(child.total)} · {formatMovementCount(child.count)}</small>
									</article>
								))
							: selectedRow.counterparties.map((counterparty) => (
									<article key={counterparty.counterparty} className="react-category-detail-row">
										<strong>{counterparty.counterparty}</strong>
										<small>{formatClp(counterparty.total)} · {formatMovementCount(counterparty.count)}</small>
									</article>
								))}
					</div>
					<div className="react-category-detail-actions">
						{/* No jump for the merged tail: it cannot be the movement filter's category. */}
						{!selectedRow.mergesTail && (
							<button
								type="button"
								className="secondary react-category-detail-jump"
								onClick={() => onJumpToCategory(selectedRow.category)}
							>
								Ver gastos de esta categoría
							</button>
						)}
						<button
							type="button"
							className="secondary react-category-detail-back"
							onClick={onClearSelection}
						>
							← Todas las categorías
						</button>
					</div>
				</div>
			)}
		</section>
	);
}

/**
 * The category ranking container: it owns which category is being inspected and hands the decided
 * state to the view, mirroring the movements table's container/view split. The jump stays the
 * summary's, because only the summary can switch to the movements view and carry the requested
 * category into it.
 */
export interface CategoryRankingPanelProps {
	ranking: CategoryRanking;
	onJumpToCategory: (category: string) => void;
}

export function CategoryRankingPanel({ ranking, onJumpToCategory }: CategoryRankingPanelProps) {
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
	return (
		<CategoryRankingView
			ranking={ranking}
			selectedCategory={selectedCategory}
			onSelect={setSelectedCategory}
			onClearSelection={() => setSelectedCategory(null)}
			onJumpToCategory={onJumpToCategory}
		/>
	);
}

/**
 * The spending chart as one already-decided state: the selected series and its proportional bars.
 *
 * Exported so both the populated and the empty markup are provable from a static render, like the
 * other analytics panels: a live summary only ever reaches the loading state without a session, and
 * what these bars claim is worth proving from what the user reads. The component renders the heights
 * the pure module decided and computes nothing of its own.
 *
 * The bars are static labels, not controls. There is no per-day detail panel to select into, so a
 * button per bar would promise an interaction the surface does not have. Only the period tabs are
 * interactive, and each bar's value, weekday and date stay visible as text for assistive technology.
 * A padded day outside the period shows no value and an empty track instead of a fabricated zero.
 */
export interface SpendingChartViewProps {
	/** The decided chart, from `getSpendingChart`. */
	chart: SpendingChart;
	/** Id of the tab whose series is shown; an unknown id falls back to the full period. */
	selectedTab: string;
	onSelectTab: (tabId: string) => void;
}

export function SpendingChartView({ chart, selectedTab, onSelectTab }: SpendingChartViewProps) {
	const series = getSpendingChartSeries(chart, selectedTab);
	return (
		<section className="react-spending-chart" aria-labelledby="react-spending-chart-title">
			<h3 id="react-spending-chart-title">Gasto por día de la semana</h3>
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
						<span>{formatClp(series.total)} · {series.detail}</span>
					</div>
					<div className="react-spending-chart-bars" role="region" aria-label={series.ariaLabel}>
						{series.days.map((day) => (
							<div key={day.key} className="react-spending-chart-bar">
								<span className="react-spending-chart-value">
									{day.isInPeriod ? formatClp(day.total) : ""}
								</span>
								<span
									className={
										day.isInPeriod
											? "react-spending-chart-track"
											: "react-spending-chart-track react-spending-chart-track-empty"
									}
								>
									<span
										className="react-spending-chart-fill"
										style={{ height: `${day.heightPercent}%` }}
									/>
								</span>
								<strong className="react-spending-chart-day">{day.label}</strong>
								<small className="react-spending-chart-detail">{day.detail}</small>
							</div>
						))}
					</div>
				</>
			)}
		</section>
	);
}

/**
 * The spending chart container: it owns which period tab is shown and hands the decided state to the
 * view. It starts on the full period, like legacy's `chartTab: "month"` (`public/app.js:145`).
 */
export interface SpendingChartPanelProps {
	chart: SpendingChart;
}

export function SpendingChartPanel({ chart }: SpendingChartPanelProps) {
	const [selectedTab, setSelectedTab] = useState<string>(FULL_PERIOD_TAB_ID);
	return <SpendingChartView chart={chart} selectedTab={selectedTab} onSelectTab={setSelectedTab} />;
}

interface FinancialSummaryProps {
	onHandle?: (handle: FinancialDashboardHandle | null) => void;
	/** Current view, owned by the page so the header navigation and this body stay in sync. */
	view: DashboardView;
	/** Requests a view change, e.g. when the ranking jumps into the filtered movements table. */
	onViewChange: (view: DashboardView) => void;
}

function FinancialSummary({ onHandle, view, onViewChange }: FinancialSummaryProps) {
	const [state, setState] = useState<FinancialSummaryState>({ status: "loading" });
	/**
	 * Category the analytics ranking jumped to, consumed by the movements table on its next mount. It
	 * is state rather than a ref because the table reads it during its first render, and the jump is
	 * what switches the view: the table mounts after this state is already set.
	 */
	const [requestedCategory, setRequestedCategory] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const retry = useCallback(() => setRetryToken((token) => token + 1), []);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [creationNotice, setCreationNotice] = useState<ManualExpenseCreationNotice | null>(null);
	/** Movement being edited; `null` keeps the edit dialog closed. */
	const [editMovement, setEditMovement] = useState<EditableRecognizedExpenseMovement | null>(null);
	const [editNotice, setEditNotice] = useState<MovementEditNotice | null>(null);
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
		try {
			const data = await loadFinancialDashboardData();
			setState(
				data.cycle.selectedPeriod ? { status: "ready", data } : { status: "unconfigured" },
			);
			return true;
		} catch {
			return false;
		}
	}, []);

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
			}),
		[reloadFinancialDashboard],
	);

	const openCycleEdit = useCallback(() => {
		// A previous outcome must not describe the new attempt.
		setCycleEditNotice(null);
		setIsCycleEditOpen(true);
	}, []);

	/** Cycle closure surface: it reloads through the same helper the summary publishes. */
	const [isCycleCompletionOpen, setIsCycleCompletionOpen] = useState(false);
	/** The C1 synchronous lock, reused for the cycle closure. */
	const cycleCompletionLock = useRef(false);

	const handleCycleEdited = useCallback((reloadFailed: boolean) => {
		setCycleEditNotice(getCycleEditNotice({ status: "saved", reloadFailed }));
		setIsCycleEditOpen(false);
	}, []);

	/**
	 * The configured period, read before the early returns so the registration below can publish it
	 * for the Gmail card. It is `null` while the cycle is loading, failed, or unconfigured — the
	 * states in which there is no period a sync request could carry and no result it could verify.
	 */
	const configuredPeriod = state.status === "ready" ? state.data.cycle.selectedPeriod : null;

	/**
	 * Publishes the period and the reload the Gmail card asks for. A new load re-registers the same
	 * helper with the fresh period, which is what lets the card sync exactly the range the summary
	 * is showing. A failed reload is reported to the card as `false`; it never throws.
	 */
	useEffect(() => {
		if (!onHandle) return;
		onHandle({ period: configuredPeriod, reload: reloadFinancialDashboard });
		return () => onHandle(null);
	}, [onHandle, configuredPeriod, reloadFinancialDashboard]);

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

	const openCreateExpense = useCallback(() => {
		// A previous outcome must not describe the new attempt.
		setCreationNotice(null);
		setIsCreateOpen(true);
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		loadFinancialDashboardData(controller.signal)
			.then((data) => {
				if (controller.signal.aborted) return;
				setState(
					data.cycle.selectedPeriod
						? { status: "ready", data }
						: { status: "unconfigured" },
				);
			})
			.catch(() => {
				if (!controller.signal.aborted) setState({ status: "failed" });
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
	const periodAnalytics = getPeriodAnalytics(state.data.transactions);
	const spendingByKind = summarizeRecognizedExpensesByKind(state.data.transactions);
	const latestExpense = selectLatestRecognizedExpense(state.data.transactions, selectedPeriod!);
	const movements = getRecognizedExpenseMovements(state.data.transactions);
	const editableMovements = getEditableRecognizedExpenseMovements(state.data.transactions);
	// The ranking reads the rows and the pending count the summary already computed, so it adds no
	// request and shares the same "recognized finite outflow" projection the table shows.
	const categoryRanking = getCategoryRanking(movements, summary.pendingAmountCount);
	// The chart reads the same rows and the same pending count, so it adds no request either.
	const spendingChart = getSpendingChart(movements, selectedPeriod!, summary.pendingAmountCount);

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

	// Built per render, like the movement submitters above: this point sits after the summary's
	// loading/failed/unconfigured early returns, so a `useMemo` here would be a hook after an early
	// return and would break the hook order as soon as the status changes. The only input that can vary
	// is the loaded closure — the evidence a re-close is compared against — and the dialog reads the
	// callback at event time, so its identity does not matter and no memo is needed to keep it honest.
	const submitCycleCompletion = createCycleCompletionSubmitter({
		complete: completeFinancialCycle,
		reload: reloadFinancialDashboard,
		loadedCompletedAt: state.data.cycle.completedAt,
		lock: cycleCompletionLock,
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
		<section className="react-financial-summary" aria-labelledby="react-financial-summary-title">
			<div className="react-financial-summary-heading">
				<FinancialPeriodHeading
					period={selectedPeriod!}
					completedAt={state.data.cycle.completedAt}
					onEdit={openCycleEdit}
					onComplete={() => setIsCycleCompletionOpen(true)}
				/>
				<div className="react-financial-summary-actions">
					{state.data.warning && <p className="react-financial-warning" role="status">Advertencia: {state.data.warning}</p>}
					<button className="button" type="button" onClick={openCreateExpense}>
						Nuevo gasto
					</button>
				</div>
			</div>
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
					<div className="react-financial-grid">
						<article className="react-financial-card">
							<span>Ingreso configurado</span>
							<strong>{incomeAmount === null ? "Sin configurar" : formatClp(incomeAmount)}</strong>
						</article>
						<article className="react-financial-card">
							<span>Gastos reconocidos</span>
							<strong>{summary.count}</strong>
						</article>
						<article className="react-financial-card">
							<span>Gasto total</span>
							<strong>{formatClp(summary.totalSpending)}</strong>
						</article>
						<article className="react-financial-card">
							<span>Montos pendientes</span>
							<strong>{summary.pendingAmountCount}</strong>
							<p>Movimientos reconocidos que esperan un monto válido.</p>
						</article>
					</div>
					<PeriodAnalyticsPanel analytics={periodAnalytics} />
					<CategoryRankingPanel
						ranking={categoryRanking}
						onJumpToCategory={(category) => {
							setRequestedCategory(category);
							onViewChange("movements");
						}}
					/>
					<SpendingChartPanel chart={spendingChart} />
					<section className="react-latest-expense" aria-labelledby="react-latest-expense-title">
						<h3 id="react-latest-expense-title">Último gasto reconocido</h3>
						{latestExpense ? (
							<dl>
								<div>
									<dt>Comercio</dt>
									<dd>{getRecognizedExpenseIdentity(latestExpense)}</dd>
								</div>
								<div>
									<dt>Monto</dt>
									<dd>{formatClp(latestExpense.amount)}</dd>
								</div>
								<div>
									<dt>Fecha</dt>
									<dd>{latestExpense.occurredAt}</dd>
								</div>
							</dl>
						) : (
							<p>No hay un gasto reconocido con fecha para este periodo.</p>
						)}
					</section>
					<section className="react-spending-breakdown" aria-labelledby="react-spending-breakdown-title">
						<h3 id="react-spending-breakdown-title">Gasto reconocido por tipo</h3>
						<dl className="react-spending-breakdown">
							<div>
								<dt>Compras</dt>
								<dd>{formatClp(spendingByKind.purchase)}</dd>
							</div>
							<div>
								<dt>Transferencias</dt>
								<dd>{formatClp(spendingByKind.transfer)}</dd>
							</div>
							<div>
								<dt>Pagos</dt>
								<dd>{formatClp(spendingByKind.payment)}</dd>
							</div>
						</dl>
					</section>
					{summary.count === 0 && (
						<p className="react-financial-empty" role="status">No se encontraron gastos reconocidos para este periodo.</p>
					)}
				</>
			) : (
				<MovementsTable
					period={selectedPeriod!}
					movements={movements}
					editableMovements={editableMovements}
					requestedCategory={requestedCategory ?? undefined}
					onEdit={openMovementEdit}
					onRemove={openMovementRemoval}
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
			{/* Mounted inside the ready state: an unconfigured or failed summary has no period to edit. */}
			<FinancialCycleEditDialog
				isOpen={isCycleEditOpen}
				cycle={state.data.cycle}
				onClose={() => setIsCycleEditOpen(false)}
				submitCycle={submitCycleEdit}
				onSaved={handleCycleEdited}
			/>
			{/* Also inside the ready state: closing needs the configured period, as does the reload. */}
			<CompleteCycleDialog
				isOpen={isCycleCompletionOpen}
				cycle={state.data.cycle}
				onClose={() => setIsCycleCompletionOpen(false)}
				submitCompletion={submitCycleCompletion}
			/>
		</section>
	);
}

function FinancialCycleSetupForm({ onSaved }: { onSaved: () => void }) {
	const currentMonth = ReviewPeriod.currentMonth();
	const [startDate, setStartDate] = useState(currentMonth.startDate);
	const [endDate, setEndDate] = useState(currentMonth.visibleEndDate);
	const [incomeValue, setIncomeValue] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const saveLock = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (saveLock.current) return;

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
		<section className="react-financial-state" aria-labelledby="react-financial-setup-title">
			<div>
				<span className="section-kicker">Configuración financiera</span>
				<h2 id="react-financial-setup-title">Configura tu periodo financiero</h2>
				<p>Elige las fechas inclusivas del periodo que quieres revisar.</p>
			</div>
			<form className="react-financial-setup-form" onSubmit={handleSubmit}>
				<div className="react-financial-setup-fields">
					<label htmlFor="financial-cycle-start-date">
						<span>Fecha de inicio</span>
						<input
							id="financial-cycle-start-date"
							type="date"
							value={startDate}
							onChange={(event) => setStartDate(event.target.value)}
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
							onChange={(event) => setEndDate(event.target.value)}
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
		</section>
	);
}

/**
 * Movements filter control: the category narrowed over the rows already loaded for the period.
 *
 * Exported so both the unfiltered and the active markup are provable from a static render; the live
 * table only ever reaches the unfiltered one, because a static render has no state to select with.
 * It shows only what the pure module decided, so it cannot display a category the table is not
 * applying, and it follows the shipped accessibility conventions: a labelled group, an announced
 * active state and a visible way to clear.
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
			<div className="react-movements-filter-intro">
				<strong>Filtrar detalle</strong>
				<span>
					{count.isActive ? "Estás viendo solo una categoría." : "Elige una categoría para limpiar el ruido."}
				</span>
				{/* The count statement is the announced active state. It renders only while it exists, so a
				    table that is not narrowing anything claims nothing. */}
				{count.message !== null && (
					<p className="react-movements-filter-count" role="status">{count.message}</p>
				)}
			</div>
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
}

/**
 * The table head: one activatable header per legacy-sortable column, carrying the `aria-sort` value
 * and the `▬/▲/▼` indicator the pure module decided (`renderTableHead`, `public/app.js:3499-3578`).
 * It only displays that decision, so it cannot disagree with the order of the rows. Exported so both
 * the neutral and the active markup are provable from a static render, like `MovementFilterBar`.
 */
export function MovementsTableHeader({ sort, onActivate }: MovementsTableHeaderProps) {
	return (
		<thead>
			<tr>
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
	/** The ordering in effect; `createMovementSortState()` renders the loaded order. */
	sort: MovementSortState;
	/** Records a mutation may target, from `getEditableRecognizedExpenseMovements`. */
	editableMovements: EditableRecognizedExpenseMovement[];
	onActivate: (key: MovementSortKey) => void;
	onSelect: (category: string) => void;
	onClear: () => void;
	onEdit: (movement: EditableRecognizedExpenseMovement) => void;
	onRemove: (movement: EditableRecognizedExpenseMovement) => void;
}

export function MovementsTableView({
	filteredView,
	sort,
	editableMovements,
	onActivate,
	onSelect,
	onClear,
	onEdit,
	onRemove,
}: MovementsTableViewProps) {
	// The rows the table renders: the filter's own rows put in the order the sort decided. Sorting is
	// applied to the filtered rows, never to the loaded ones, and the count stays the filter's own — it
	// was computed from the filtered set, so ordering can neither hide nor reveal a row it describes.
	const visibleRows = sortMovements(filteredView.rows, sort);
	const editableById = new Map(
		editableMovements.map((movement) => [movement.id, movement] as const),
	);

	return (
		<>
			<MovementFilterBar
				options={filteredView.options}
				count={filteredView.count}
				onSelect={onSelect}
				onClear={onClear}
			/>
			{/* The table keeps its own scroll container, so the filter bar cannot scroll away with it. */}
			<div className="react-movements-table-wrapper">
				<table className="react-movements-table">
					<MovementsTableHeader sort={sort} onActivate={onActivate} />
					<tbody>
						{visibleRows.map((movement, index) => {
							const editable =
								movement.id === null ? null : editableById.get(movement.id) ?? null;
							return (
								<tr key={`${movement.counterparty}-${movement.date}-${index}`}>
									<td>{movement.counterparty}</td>
									<td>{formatClp(movement.amount)}</td>
									<td>{movement.date}</td>
									<td>{movement.category}</td>
									<td className="react-movements-actions">
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
		</>
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
}

export function MovementsTable({
	period,
	movements,
	editableMovements,
	requestedCategory,
	onEdit,
	onRemove,
}: MovementsTableProps) {
	// Declared before the empty-state return so the hook always runs, and initialised for the period
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

	// Reconciling during render, instead of in an effect, is React's documented way to adjust state
	// when an input changes: the new period's rows are never rendered under the previous period's
	// selection. It runs above the empty-rows return as well, so the reset commits in every case — a
	// period with no rows still replaces the selection it inherited, and a category the loaded rows no
	// longer carry is cleared instead of only being hidden at render. The module returns the same
	// object while the selection still applies, so this re-renders only when something really changed
	// and cannot loop.
	const currentSelection = reconcileMovementFilterSelection(selection, period, movements);
	if (currentSelection !== selection) setSelection(currentSelection);

	if (movements.length === 0) {
		return (
			<section className="react-financial-empty" role="status">
				<p>No hay gastos reconocidos disponibles para este periodo.</p>
			</section>
		);
	}

	const filteredView = getMovementFilterView(currentSelection, period, movements);

	return (
		<MovementsTableView
			filteredView={filteredView}
			sort={sort}
			editableMovements={editableMovements}
			onActivate={(key) => setSort(cycleMovementSort(sort, key))}
			onSelect={(category) => setSelection(selectMovementFilterCategory(category, period))}
			onClear={() => setSelection(createMovementFilterSelection(period))}
			onEdit={onEdit}
			onRemove={onRemove}
		/>
	);
}
