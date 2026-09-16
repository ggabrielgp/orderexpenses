import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { loadFinancialDashboardData, updateFinancialCycle } from "../api/client";
import type { DemoDashboardData } from "../demo-data";
import type {
	FinancialDashboardData,
	FinancialPeriod,
	FinancialTransaction,
	UpdateFinancialCycleRequest,
	SessionResponse,
} from "../api/types";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../shared/review-period.js";

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

type RecognizedExpenseMovement = {
	counterparty: string;
	amount: number;
	date: string;
	category: string;
};

const recognizedExpenseKinds = new Set(["purchase", "transfer", "payment"]);
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export function isRecognizedExpense(transaction: FinancialTransaction) {
	return (
		transaction.direction === "outflow" &&
		typeof transaction.kind === "string" &&
		recognizedExpenseKinds.has(transaction.kind)
	);
}

function normalizeLocalDateTime(occurredAt: unknown) {
	if (typeof occurredAt !== "string") return null;
	const match = localDateTimePattern.exec(occurredAt);
	if (!match) return null;

	const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}

	const hour = hourText === undefined ? 0 : Number(hourText);
	const minute = minuteText === undefined ? 0 : Number(minuteText);
	const second = secondText === undefined ? 0 : Number(secondText);
	if (hour > 23 || minute > 59 || second > 59) return null;
	return `${yearText}-${monthText}-${dayText}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
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
			counterparty: getRecognizedExpenseIdentity(transaction),
			amount: transaction.amount,
			date: formatMovementDate(transaction.occurredAt),
			category: getMovementCategory(transaction.category),
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

export function formatPeriodLabel(period: FinancialPeriod) {
	const reviewPeriod = ReviewPeriod.create(period);
	return `${reviewPeriod.startDate} – ${reviewPeriod.visibleEndDate}`;
}

function formatClp(amount: number) {
	const formatted = new Intl.NumberFormat("es-CL", {
		style: "currency",
		currency: "CLP",
		maximumFractionDigits: 0,
	}).format(Math.abs(amount));
	return amount < 0 ? `-${formatted}` : formatted;
}

function formatIncomeInput(amount: number) {
	return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(amount);
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
	return (
		<section className="react-financial-summary" aria-labelledby="react-financial-summary-title">
			<div className="react-financial-summary-heading">
				<div>
					<span className="section-kicker">Configured period</span>
					<h2 id="react-financial-summary-title">Financial summary</h2>
					<p>{formatPeriodLabel(selectedPeriod!)}</p>
				</div>
				{state.data.warning && <p className="react-financial-warning" role="status">Warning: {state.data.warning}</p>}
			</div>
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
				<MovementsTable movements={movements} />
			)}
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

function MovementsTable({ movements }: { movements: RecognizedExpenseMovement[] }) {
	if (movements.length === 0) {
		return (
			<section className="react-financial-empty" role="status">
				<p>No recognized expenses are available for this period.</p>
				<a className="button react-secondary-link" href="/legacy-app">Open legacy dashboard</a>
			</section>
		);
	}

	return (
		<div className="react-movements-table-wrapper">
			<table className="react-movements-table">
				<thead>
					<tr>
						<th scope="col">Counterparty</th>
						<th scope="col">Amount</th>
						<th scope="col">Date</th>
						<th scope="col">Category</th>
					</tr>
				</thead>
				<tbody>
					{movements.map((movement, index) => (
						<tr key={`${movement.counterparty}-${movement.date}-${index}`}>
							<td>{movement.counterparty}</td>
							<td>{formatClp(movement.amount)}</td>
							<td>{movement.date}</td>
							<td>{movement.category}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
