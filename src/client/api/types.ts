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

/** Response of `POST /api/gmail/disconnect` (`src/server.js`). */
export interface GmailDisconnectResponse {
	ok: boolean;
}

/**
 * Response of `POST /api/gmail/sync`.
 *
 * The shape depends on what the request asked for (`src/movements.js:95-113`): period mode — the
 * only mode this client asks for — always reports `outcome` and `failedCount`, because that is
 * where per-query failures are counted, while month mode reports neither and drops the failure
 * count entirely. `outcome` and `failedCount` are therefore optional rather than assumed: a reader
 * must never turn a response that cannot carry a partial verdict into a complete import.
 */
export interface GmailSyncResponse {
	query?: string;
	outcome?: "success" | "partial";
	scanned: number;
	transactions: unknown[];
	failedCount?: number;
	completedAt?: string | null;
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

/**
 * One stored counterparty category rule, as `GET /api/counterparty-rules` returns it
 * (`src/db.js:409-423`). The server applies these rules only when it loads movements, so the
 * `counterpartyKey` must be the exact key it computes for them (`normalizeCounterpartyKey`).
 */
export interface CounterpartyRule {
	counterpartyKey: string;
	displayName: string;
	category: string;
	createdAt?: string | null;
	updatedAt?: string | null;
}

export interface CounterpartyRulesResponse {
	rules: CounterpartyRule[];
}

/**
 * Body of `PUT /api/counterparty-rules`. An empty `category` is the documented clearing path: the
 * server deletes the rule instead of storing it (`src/server.js:213-218`).
 */
export interface UpsertCounterpartyRuleRequest {
	counterpartyKey: string;
	displayName: string;
	category: string;
}

/**
 * Response of `PUT /api/counterparty-rules`.
 *
 * The server answers one of two shapes (`src/server.js:205-223`) and they mean different things:
 * `{ rule }` when it stored the rule, and `{ ok: true, deleted: true }` when the empty category
 * cleared it. Modelled as a discriminated union instead of two optional fields, so a cleared rule
 * cannot be read as a saved one: `outcome` has to be narrowed before either payload is reachable,
 * and only the stored branch carries a rule at all.
 */
export type UpsertCounterpartyRuleResponse =
	| { outcome: "saved"; rule: CounterpartyRule }
	| { outcome: "cleared" };

/** Body of `PUT /api/categories`; the server normalizes both fields again on arrival. */
export interface UpsertCategoryRequest {
	name: string;
	color: string;
}

/**
 * Response of `PUT /api/categories`.
 *
 * It carries the single stored row — `{ name, color, createdAt, updatedAt }`
 * (`src/db.js:483-505`) — and never the merged catalog, so it has no `builtin` flag and must not
 * be treated as a catalog entry: only `GET /api/categories` reports provenance.
 */
export interface UpsertCategoryResponse {
	category: {
		name: string;
		color: string;
		createdAt?: string | null;
		updatedAt?: string | null;
	};
}

/**
 * Response of `DELETE /api/categories/:name`. A category that does not exist is a 404 whose body
 * is `{ error: "Category not found" }` (`src/server.js:190-198`), not this shape.
 */
export interface DeleteCategoryResponse {
	ok: true;
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
