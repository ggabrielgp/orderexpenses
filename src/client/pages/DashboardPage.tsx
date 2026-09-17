import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
	createManualExpense,
	loadFinancialDashboardData,
	removeTransaction,
	updateFinancialCycle,
	updateTransaction,
} from "../api/client";
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
import {
	formatIncomeInput,
	formatPeriodLabel,
	getMovementUpdateTarget,
	normalizeLocalDateTime,
	recognizedExpenseKinds,
	type EditableRecognizedExpenseMovement,
	type RecognizedExpenseMovement,
} from "../components/movements/manualExpense";
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
	return "Unidentified expense";
}

function formatMovementDate(occurredAt: unknown) {
	const normalizedDateTime = normalizeLocalDateTime(occurredAt);
	return normalizedDateTime === null ? "—" : normalizedDateTime.slice(0, 10);
}

function getMovementCategory(category: unknown) {
	return typeof category === "string" && category.trim()
		? category.trim()
		: "Uncategorized";
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
 *   untouched movement never writes "Unidentified expense"/"Uncategorized" back to the server.
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

function parseIncomeAmount(value: string) {
	const trimmedValue = value.trim();
	if (!trimmedValue) return null;
	const unformattedValue = trimmedValue.replaceAll(".", "");
	const isFormattedClp = /^\d{1,3}(?:\.\d{3})+$/.test(trimmedValue);
	if (
		(!/^\d+$/.test(trimmedValue) && !isFormattedClp) ||
		!/^\d+$/.test(unformattedValue)
	) {
		throw new TypeError("Income must be a positive whole safe CLP integer");
	}
	const incomeAmount = Number(unformattedValue);
	if (!Number.isSafeInteger(incomeAmount) || incomeAmount <= 0) {
		throw new TypeError("Income must be a positive whole safe CLP integer");
	}
	return incomeAmount;
}

export function createFinancialCycleSetupPayload(
	startDate: string,
	endDate: string,
	incomeValue: string,
): UpdateFinancialCycleRequest {
	return {
		selectedPeriod: ReviewPeriod.fromInclusive(startDate, endDate).toJSON(),
		incomeAmount: parseIncomeAmount(incomeValue),
	};
}

export function DashboardPage({ session, onRetry }: DashboardPageProps) {
	if (!session.authenticated) {
		return (
			<main className="shell react-shell">
				<section className="panel product-panel react-message" aria-labelledby="react-sign-in-title">
					<span className="section-kicker">React migration</span>
					<h1 id="react-sign-in-title">Connect your Gmail account</h1>
					<p className="subtitle">
						Sign in to load your profile and connection status. The complete dashboard
						is still available in the legacy application during this migration.
					</p>
					<div className="react-shell-actions">
						<a className="button" href={session.gmail.connectUrl}>
							Connect Gmail
						</a>
						<a className="button react-secondary-link" href="/legacy-app">
							Open legacy dashboard
						</a>
					</div>
				</section>
			</main>
		);
	}

	const profile = session.profile;
	const connected = session.gmail.connected;
	const gmailEmail = profile?.email ?? "No connected account";

	return (
		<main className="shell react-shell">
			<section className="panel product-panel react-dashboard-shell" aria-labelledby="react-dashboard-title">
				<header className="react-dashboard-header">
					<div>
						<span className="section-kicker">React migration</span>
						<h1 id="react-dashboard-title">Account overview</h1>
						<p className="subtitle">
							Your financial summary is read-only. Use the legacy dashboard for setup and
							other account management.
						</p>
					</div>
					<a className="button react-secondary-link" href="/legacy-app">
						Open legacy dashboard
					</a>
				</header>

				<div className="react-status-grid">
					<article className="react-status-card">
						<span className="section-kicker">Current session</span>
						<strong>{profile?.name || "Connected user"}</strong>
						<p>{profile?.email || "No Gmail profile is associated with this session."}</p>
					</article>
					<article className="react-status-card">
						<span className="section-kicker">Gmail connection</span>
						<strong>{connected ? "Connected" : "Not connected"}</strong>
						<p>{connected ? gmailEmail : "Connect Gmail to import and review movements."}</p>
						{!connected && (
							<a className="button" href={session.gmail.connectUrl}>
								Connect Gmail
							</a>
						)}
					</article>
				</div>

				<FinancialSummary />

				<div className="react-shell-actions">
					<button className="secondary" type="button" onClick={onRetry}>
						Refresh connection status
					</button>
					<a href="/">Back to home</a>
				</div>
			</section>
		</main>
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

function FinancialSummary() {
	const [state, setState] = useState<FinancialSummaryState>({ status: "loading" });
	const [view, setView] = useState<"summary" | "movements">("summary");
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
		return <section className="react-financial-state" aria-live="polite">Loading financial summary...</section>;
	}
	if (state.status === "failed") {
		return (
			<section className="react-financial-state" role="alert">
				<p>Financial summary could not be loaded.</p>
				<button className="secondary" type="button" onClick={retry}>Retry financial summary</button>
			</section>
		);
	}
	if (state.status === "unconfigured") {
		return <FinancialCycleSetupForm onSaved={retry} />;
	}

	const { selectedPeriod, incomeAmount } = state.data.cycle;
	const summary = summarizeRecognizedExpenses(state.data.transactions);
	const spendingByKind = summarizeRecognizedExpensesByKind(state.data.transactions);
	const latestExpense = selectLatestRecognizedExpense(state.data.transactions, selectedPeriod!);
	const movements = getRecognizedExpenseMovements(state.data.transactions);
	const editableMovements = getEditableRecognizedExpenseMovements(state.data.transactions);

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
				<div>
					<span className="section-kicker">Configured period</span>
					<h2 id="react-financial-summary-title">Financial summary</h2>
					<p>{formatPeriodLabel(selectedPeriod!)}</p>
				</div>
				<div className="react-financial-summary-actions">
					{state.data.warning && <p className="react-financial-warning" role="status">Warning: {state.data.warning}</p>}
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
			<div className="react-financial-view-toggle" role="group" aria-label="Financial view">
				<button
					className="secondary"
					type="button"
					aria-pressed={view === "summary"}
					onClick={() => setView("summary")}
				>
					Summary
				</button>
				<button
					className="secondary"
					type="button"
					aria-pressed={view === "movements"}
					onClick={() => setView("movements")}
				>
					Movements
				</button>
			</div>
			{view === "summary" ? (
				<>
					<div className="react-financial-grid">
						<article className="react-financial-card">
							<span>Configured income</span>
							<strong>{incomeAmount === null ? "Not configured" : formatClp(incomeAmount)}</strong>
						</article>
						<article className="react-financial-card">
							<span>Recognized expenses</span>
							<strong>{summary.count}</strong>
						</article>
						<article className="react-financial-card">
							<span>Total spending</span>
							<strong>{formatClp(summary.totalSpending)}</strong>
						</article>
						<article className="react-financial-card">
							<span>Pending amounts</span>
							<strong>{summary.pendingAmountCount}</strong>
							<p>Recognized movements awaiting a finite amount.</p>
						</article>
					</div>
					<section className="react-latest-expense" aria-labelledby="react-latest-expense-title">
						<h3 id="react-latest-expense-title">Latest recognized expense</h3>
						{latestExpense ? (
							<dl>
								<div>
									<dt>Merchant</dt>
									<dd>{getRecognizedExpenseIdentity(latestExpense)}</dd>
								</div>
								<div>
									<dt>Amount</dt>
									<dd>{formatClp(latestExpense.amount)}</dd>
								</div>
								<div>
									<dt>When</dt>
									<dd>{latestExpense.occurredAt}</dd>
								</div>
							</dl>
						) : (
							<p>No dated recognized expense is available for this period.</p>
						)}
					</section>
					<section className="react-spending-breakdown" aria-labelledby="react-spending-breakdown-title">
						<h3 id="react-spending-breakdown-title">Recognized spending by type</h3>
						<dl className="react-spending-breakdown">
							<div>
								<dt>Purchases</dt>
								<dd>{formatClp(spendingByKind.purchase)}</dd>
							</div>
							<div>
								<dt>Transfers</dt>
								<dd>{formatClp(spendingByKind.transfer)}</dd>
							</div>
							<div>
								<dt>Payments</dt>
								<dd>{formatClp(spendingByKind.payment)}</dd>
							</div>
						</dl>
					</section>
					{summary.count === 0 && (
						<p className="react-financial-empty" role="status">No recognized expenses were found for this period.</p>
					)}
				</>
			) : (
				<MovementsTable
					movements={movements}
					editableMovements={editableMovements}
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
			setError("Enter a valid date range and a positive whole CLP income, or leave income blank.");
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
			setError("Your financial period could not be saved. Please try again.");
			setIsSaving(false);
		}
	};

	const formatIncomeOnBlur = () => {
		try {
			const incomeAmount = parseIncomeAmount(incomeValue);
			if (incomeAmount !== null) setIncomeValue(formatIncomeInput(incomeAmount));
		} catch {
			// Keep the user's value unchanged so it can be corrected.
		}
	};

	return (
		<section className="react-financial-state" aria-labelledby="react-financial-setup-title">
			<div>
				<span className="section-kicker">Financial setup</span>
				<h2 id="react-financial-setup-title">Set up your financial period</h2>
				<p>Choose the inclusive dates for the period you want to review.</p>
			</div>
			<form className="react-financial-setup-form" onSubmit={handleSubmit}>
				<div className="react-financial-setup-fields">
					<label htmlFor="financial-cycle-start-date">
						<span>Start date</span>
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
						<span>End date (inclusive)</span>
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
						<span>Monthly income (optional)</span>
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
						<small id="financial-cycle-income-help">Whole CLP amount. Example: 900.000</small>
					</label>
				</div>
				{error && <p className="react-financial-setup-error" role="alert">{error}</p>}
				<div className="react-shell-actions">
					<button type="submit" disabled={isSaving}>
						{isSaving ? "Saving financial period..." : "Save financial period"}
					</button>
				</div>
			</form>
			<p aria-live="polite">{isSaving ? "Saving financial period..." : ""}</p>
		</section>
	);
}

/**
 * Movements table with the bounded per-row actions.
 *
 * The action availability is not a second rule: a row is actionable exactly when the editable
 * projection produced a record for it, which already requires a usable identity and a parseable
 * original date. A row outside that projection therefore renders no control at all instead of a
 * control that could only produce a rejected request.
 */
export interface MovementsTableProps {
	/** Read projection: every recognized expense of the period, always visible. */
	movements: RecognizedExpenseMovement[];
	/** Records a mutation may target, from `getEditableRecognizedExpenseMovements`. */
	editableMovements: EditableRecognizedExpenseMovement[];
	onEdit: (movement: EditableRecognizedExpenseMovement) => void;
	onRemove: (movement: EditableRecognizedExpenseMovement) => void;
}

export function MovementsTable({
	movements,
	editableMovements,
	onEdit,
	onRemove,
}: MovementsTableProps) {
	if (movements.length === 0) {
		return (
			<section className="react-financial-empty" role="status">
				<p>No recognized expenses are available for this period.</p>
				<a className="button react-secondary-link" href="/legacy-app">Open legacy dashboard</a>
			</section>
		);
	}

	const editableById = new Map(
		editableMovements.map((movement) => [movement.id, movement] as const),
	);

	return (
		<div className="react-movements-table-wrapper">
			<table className="react-movements-table">
				<thead>
					<tr>
						<th scope="col">Counterparty</th>
						<th scope="col">Amount</th>
						<th scope="col">Date</th>
						<th scope="col">Category</th>
						<th scope="col">Acciones</th>
					</tr>
				</thead>
				<tbody>
					{movements.map((movement, index) => {
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
	);
}
