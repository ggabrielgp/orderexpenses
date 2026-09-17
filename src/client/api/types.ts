export interface SessionProfile {
	email: string;
	name?: string | null;
	picture?: string | null;
}

export interface SessionResponse {
	authenticated: boolean;
	profile: SessionProfile | null;
	gmail: {
		connected: boolean;
		connectUrl: string;
	};
	features: {
		financialCycleOnboarding: boolean;
	};
}

export interface GmailStatusResponse {
	hasCredentials: boolean;
	connected: boolean;
	activeEmail: string | null;
}

export interface GmailSyncResponse {
	scanned: number;
	transactions: unknown[];
}

export interface FinancialPeriod {
	startDate: string;
	endDateExclusive: string;
}

export interface FinancialCycleResponse {
	selectedPeriod: FinancialPeriod | null;
	incomeAmount: number | null;
	completedAt: string | null;
}

export interface UpdateFinancialCycleRequest {
	selectedPeriod: FinancialPeriod;
	incomeAmount: number | null;
}

export interface FinancialTransaction {
	/** Stable movement identity used by the mutation routes. */
	id?: string;
	source?: string;
	status?: FinancialTransactionStatus;
	/** True for rows stored in the manual ledger; Gmail-derived rows report false. */
	isManual?: boolean;
	amount: unknown;
	direction: unknown;
	kind: unknown;
	occurredAt?: unknown;
	counterparty?: unknown;
	description?: unknown;
	category?: unknown;
}

/**
 * Movement status as the server can emit it. Known values are `manual` (rows stored
 * in the manual ledger), `edited` (Gmail rows overridden through the dashboard),
 * `detected` (parser default) and `needs_review` (parsed email with missing fields,
 * see `src/parser.js`). The space is open-ended rather than a closed union:
 * `sanitizePatch` (`src/server.js`) persists any status string sent through PATCH and
 * maps an empty value to `null`, so this is typed as an open string.
 */
export type FinancialTransactionStatus = string | null;

/**
 * Kind values offered by the manual create form. The legacy `kind` select also
 * offers `unknown` (`public/app.html`); that value is deliberately excluded because
 * a movement with an unknown kind is never a recognized expense and the create form
 * exists to record expenses and income.
 */
export type ManualExpenseKind = "purchase" | "transfer" | "payment" | "income";

/** Kind values that count as a recognized expense. */
export type RecognizedExpenseKind = "purchase" | "transfer" | "payment";

export interface Category {
	name: string;
	color?: string;
	builtin?: boolean;
}

export interface CategoriesResponse {
	categories: Category[];
}

export interface CreateManualExpenseRequest {
	occurredAt: string;
	amount: number;
	kind: ManualExpenseKind;
	direction: "outflow" | "inflow";
	counterparty: string | null;
	category: string | null;
	description: string | null;
}

export interface UpdateTransactionRequest {
	amount: number;
	kind: ManualExpenseKind;
	direction: "outflow" | "inflow";
	counterparty: string | null;
	description: string | null;
	category: string | null;
	/** Manual rows keep `manual`; Gmail overrides are recorded as `edited`. */
	status: "manual" | "edited";
	/** Only manual movements may send a changed date; the original date defines the override month. */
	occurredAt?: string;
}

/**
 * Identifies the original movement record. Its original occurred date determines
 * the single month the server validates Gmail-derived mutations against.
 */
export interface MovementUpdateTarget {
	movementId: string;
	originalOccurredAt: string;
	isManual: boolean;
}

export interface TransactionsResponse {
	transactions: FinancialTransaction[];
	warning: string | null;
}

export interface FinancialDashboardData {
	cycle: FinancialCycleResponse;
	transactions: FinancialTransaction[];
	warning: string | null;
}
