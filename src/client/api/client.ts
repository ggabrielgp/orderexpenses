import type {
	CategoriesResponse,
	CompleteFinancialCycleResponse,
	CounterpartyRule,
	CounterpartyRulesResponse,
	CreateManualExpenseRequest,
	DeleteCategoryResponse,
	FinancialCycleResponse,
	FinancialDashboardData,
	FinancialPeriod,
	GmailDisconnectResponse,
	GmailStatusResponse,
	GmailSyncResponse,
	MovementUpdateTarget,
	SessionResponse,
	TransactionsResponse,
	UpdateFinancialCycleRequest,
	UpdateTransactionRequest,
	UpsertCategoryRequest,
	UpsertCategoryResponse,
	UpsertCounterpartyRuleRequest,
	UpsertCounterpartyRuleResponse,
} from "./types";

export class ApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ApiError";
	}
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
	const response = await fetch(path, { signal, credentials: "same-origin" });
	if (!response.ok) {
		throw new ApiError(`Request to ${path} failed (${response.status})`);
	}
	return (await response.json()) as T;
}

export function getSessionProfile(signal?: AbortSignal) {
	return getJson<SessionResponse>("/api/session/profile", signal);
}

export function getGmailStatus(signal?: AbortSignal) {
	return getJson<GmailStatusResponse>("/api/gmail/status", signal);
}

export function getFinancialCycle(signal?: AbortSignal) {
	return getJson<FinancialCycleResponse>("/api/financial-cycle", signal);
}

export async function updateFinancialCycle(
	cycle: UpdateFinancialCycleRequest,
	signal?: AbortSignal,
) {
	const response = await fetch("/api/financial-cycle", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(cycle),
		signal,
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new ApiError(`Request to /api/financial-cycle failed (${response.status})`);
	}
	return (await response.json()) as FinancialCycleResponse;
}

/** Body `POST /api/financial-cycle/complete` answers with; only the documented keys are read. */
type ClosureResponseBody = {
	outcome?: unknown; scanned?: unknown; transactions?: unknown; failedCount?: unknown;
	completedAt?: unknown; retryable?: unknown; action?: { label?: unknown; href?: unknown };
};

/** A count the server is expected to report; anything else is not a count. */
function readClosureCount(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function unusableClosure(): never {
	throw new ApiError("The server did not report a usable closure outcome for /api/financial-cycle/complete.");
}

/**
 * Closes the configured period: the server synchronizes Gmail first and writes the closure only if that
 * synchronization completes (`src/server.js:408-472`). The body key is `period`, not the `selectedPeriod` that
 * `PUT /api/financial-cycle` takes, and it is the only field this endpoint reads (`src/server.js:415`). The four
 * outcomes are returned as data, never thrown, because a partial synchronization or a disconnected account would
 * otherwise have no way to reach the user.
 *
 * The status picks the branch and the body has to corroborate it, so the outcomes cannot be confused: a 200 without a
 * closure timestamp, a 207 that claims one, or an outcome word that contradicts the status throws an `ApiError`. A
 * refused request throws through the same reader the other mutations use; a network failure rejects the `fetch` before
 * any outcome exists, and a body this client cannot read throws instead of being reported as one. There is no
 * `AbortSignal`, because aborting would not stop the sequential Gmail work.
 */
export async function completeFinancialCycle(
	period: FinancialPeriod,
): Promise<CompleteFinancialCycleResponse> {
	const path = "/api/financial-cycle/complete";
	const response = await fetch(path, { method: "POST", credentials: "same-origin",
		headers: { "content-type": "application/json" }, body: JSON.stringify({ period }) });
	if (![200, 207, 409, 502].includes(response.status)) {
		await throwServerError(response, `Request to ${path} failed (${response.status})`);
	}
	const body = (await response.json().catch(() => null)) as ClosureResponseBody | null;
	const scanned = readClosureCount(body?.scanned);
	const transactions = readClosureCount(body?.transactions);

	if (response.status === 200) {
		const completedAt = body?.completedAt;
		if (body?.outcome !== "success" || scanned === null || transactions === null) unusableClosure();
		if (typeof completedAt !== "string" || !completedAt.trim()) unusableClosure();
		return { outcome: "success", scanned, transactions, completedAt };
	}

	// Every non-success outcome carries the documented `retryable: true` with `completedAt: null`; a body
	// missing either is not readable as one of them. That is a shape corroborating the status, not a
	// guarantee that nothing was written: two of them are answered before the write, and the 502's catch
	// also wraps the upsert and the read-back behind it.
	if (body?.retryable !== true || body?.completedAt !== null) unusableClosure();

	if (response.status === 207) {
		const failedCount = readClosureCount(body?.failedCount);
		if (body?.outcome !== "partial" || scanned === null || transactions === null) unusableClosure();
		if (failedCount === null) unusableClosure();
		return { outcome: "partial", scanned, transactions, failedCount, retryable: true, completedAt: null };
	}
	if (response.status === 409) {
		const label = body?.action?.label;
		const href = body?.action?.href;
		if (body?.outcome !== "disconnected" || typeof label !== "string" || typeof href !== "string") unusableClosure();
		return { outcome: "disconnected", action: { label, href }, retryable: true, completedAt: null };
	}
	if (body?.outcome !== "error") unusableClosure();
	return { outcome: "error", retryable: true, completedAt: null };
}

export function getTransactionsForPeriod(period: FinancialPeriod, signal?: AbortSignal) {
	const params = new URLSearchParams({
		startDate: period.startDate,
		endDateExclusive: period.endDateExclusive,
	});
	return getJson<TransactionsResponse>(`/api/transactions?${params}`, signal);
}

/** Returns the HTTP status so the caller can tell a created expense from a rejected one. */
export async function createManualExpense(expense: CreateManualExpenseRequest) {
	const response = await fetch("/api/transactions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(expense),
		credentials: "same-origin",
	});
	return response.status;
}

export async function getCategories(signal?: AbortSignal) {
	const response = await getJson<CategoriesResponse>("/api/categories", signal);
	return response.categories;
}

/**
 * Reads the server's own `{ error }` body for a rejected mutation and throws an `ApiError` that
 * carries it.
 *
 * `getJson` deliberately does not read that body, because its current callers only need a
 * status-bearing error; the category endpoints answer with user-facing Spanish copy
 * (`"name es obligatorio"`, `"color inválido"`, `"Category not found"`, `src/server.js:179-198`),
 * so the mutations need their own scoped reader instead of changing `getJson` for everyone. A body
 * that is missing, empty or not JSON leaves the status-bearing message as the only truth.
 */
async function throwServerError(response: Response, fallbackMessage: string): Promise<never> {
	let message = fallbackMessage;
	try {
		const payload = (await response.json()) as { error?: unknown };
		if (typeof payload?.error === "string" && payload.error.trim()) {
			message = payload.error.trim();
		}
	} catch {
		// Unreadable body: the status message already names what the server answered.
	}
	throw new ApiError(message);
}

/** Creates or overwrites a category, matching on the normalized name. */
export async function upsertCategory(
	category: UpsertCategoryRequest,
): Promise<UpsertCategoryResponse> {
	const response = await fetch("/api/categories", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(category),
		credentials: "same-origin",
	});
	if (!response.ok) {
		await throwServerError(response, `Request to /api/categories failed (${response.status})`);
	}
	return (await response.json()) as UpsertCategoryResponse;
}

/**
 * Deletes a category by name. The server removes only the `categories` row (`src/db.js:507-515`),
 * so stored movement categories and counterparty rules are untouched.
 */
export async function deleteCategory(name: string): Promise<DeleteCategoryResponse> {
	const path = `/api/categories/${encodeURIComponent(name)}`;
	const response = await fetch(path, { method: "DELETE", credentials: "same-origin" });
	if (!response.ok) {
		await throwServerError(response, `Request to ${path} failed (${response.status})`);
	}
	return (await response.json()) as DeleteCategoryResponse;
}

const movementMonthPattern = /^(\d{4}-(?:0[1-9]|1[0-2]))-/;

/**
 * The server validates Gmail-derived mutations against a single month, so the
 * request month always comes from the movement's original occurred date.
 *
 * Known hazard (server-side, out of scope here): `loadMovementsForMonthResult`
 * filters by the original date before applying overrides (`src/movements.js`), so a
 * Gmail row re-dated by the legacy UI can arrive with an `occurredAt` outside the
 * month that produced it and 404 in `runtimeMovementExists` (`src/server.js`). This
 * client already blocks new Gmail date changes; the remaining 404 must surface as an
 * explicit error in MCR-3/MCR-5, never as a silent retry.
 */
function resolveMovementRequest(target: MovementUpdateTarget) {
	const movementId =
		typeof target.movementId === "string" ? target.movementId.trim() : "";
	const originalOccurredAt =
		typeof target.originalOccurredAt === "string" ? target.originalOccurredAt : "";
	const month = movementMonthPattern.exec(originalOccurredAt)?.[1];
	if (!movementId || !month) {
		throw new ApiError(
			"A valid movement id and an original occurred month (YYYY-MM) are required.",
		);
	}
	return { movementId, month };
}

export async function updateTransaction(
	target: MovementUpdateTarget,
	patch: Partial<UpdateTransactionRequest>,
) {
	const { movementId, month } = resolveMovementRequest(target);
	if (!target.isManual && Object.hasOwn(patch, "occurredAt")) {
		throw new ApiError("Gmail movement dates cannot be changed.");
	}

	const response = await fetch(
		`/api/transactions/${encodeURIComponent(movementId)}?${new URLSearchParams({ month })}`,
		{
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(patch),
			credentials: "same-origin",
		},
	);
	if (!response.ok) {
		throw new ApiError(`Request to /api/transactions/${movementId} failed (${response.status})`);
	}
}

export async function removeTransaction(target: MovementUpdateTarget) {
	const { movementId, month } = resolveMovementRequest(target);
	const response = await fetch(
		`/api/transactions/${encodeURIComponent(movementId)}?${new URLSearchParams({ month })}`,
		{ method: "DELETE", credentials: "same-origin" },
	);
	if (!response.ok) {
		throw new ApiError(`Request to /api/transactions/${movementId} failed (${response.status})`);
	}
}

/**
 * Loads the stored counterparty category rules.
 *
 * They are not a catalog: the server applies them only when it loads movements
 * (`applyStoredCounterpartyRules`, `src/movements.js:249-284`), which is why a mutation that stores
 * one has to be followed by a reload of the period to become visible.
 */
export async function getCounterpartyRules(signal?: AbortSignal) {
	const response = await getJson<CounterpartyRulesResponse>("/api/counterparty-rules", signal);
	return response.rules;
}

/**
 * Creates, replaces or clears one counterparty rule.
 *
 * An empty `category` is the documented clearing path: the server deletes the rule and answers
 * `{ ok: true, deleted: true }` (`src/server.js:213-218`), which this function reports as the
 * non-overlapping `cleared` branch of its return type. A 200 that confirms neither outcome is an
 * error, not a save, because nothing would tell the caller which of the two happened.
 *
 * There is deliberately no `deleteCounterpartyRule` here: the dedicated `DELETE` endpoint
 * (`src/server.js:228-242`) has no consumer in this surface, and an exported function nobody calls
 * would be dead code.
 */
export async function upsertCounterpartyRule(
	rule: UpsertCounterpartyRuleRequest,
): Promise<UpsertCounterpartyRuleResponse> {
	const response = await fetch("/api/counterparty-rules", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(rule),
		credentials: "same-origin",
	});
	if (!response.ok) {
		await throwServerError(
			response,
			`Request to /api/counterparty-rules failed (${response.status})`,
		);
	}
	const payload = (await response.json()) as {
		rule?: CounterpartyRule;
		deleted?: unknown;
	};
	if (payload?.deleted === true) return { outcome: "cleared" };
	if (payload?.rule) return { outcome: "saved", rule: payload.rule };
	throw new ApiError(
		"The server did not report whether the counterparty rule was saved or cleared.",
	);
}

/**
 * Tab-scoped key for the loaded financial dashboard. `sessionStorage` gives each browser tab its own
 * copy and drops it when the tab closes, so a reload (F5) can reuse the response the tab already
 * fetched while a new tab always starts clean. Versioned so a future shape change is not read as this
 * one; the stored response is only trusted after the shape check below.
 */
const LEGACY_FINANCIAL_DASHBOARD_CACHE_KEY = "gastos-controlados:financial-dashboard:v1";
const FINANCIAL_DASHBOARD_CACHE_KEY = "gastos-controlados:financial-dashboard:v2";
// A logout invalidates even a request that resolves before navigation unmounts the page.
let cacheGeneration = 0;

/** The session profile's email is the sole cache identity. Empty identities are never cacheable. */
function normalizeDashboardEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Evicts only dashboard entries, leaving other tab storage untouched. */
export function clearFinancialDashboardCache(): void {
	cacheGeneration += 1;
	const storage = getFinancialDashboardStorage();
	if (!storage) return;
	for (const key of [FINANCIAL_DASHBOARD_CACHE_KEY, LEGACY_FINANCIAL_DASHBOARD_CACHE_KEY]) {
		try {
			storage.removeItem(key);
		} catch {
			// Storage can be denied even after it was obtained.
		}
	}
}

/** Returns the tab's storage, or `null` when the browser denies access (private mode, policy). */
function getFinancialDashboardStorage(): Storage | null {
	try {
		return globalThis.sessionStorage ?? null;
	} catch {
		return null;
	}
}

function isFinancialPeriodValue(value: unknown): value is FinancialPeriod {
	if (typeof value !== "object" || value === null) return false;
	const period = value as Record<string, unknown>;
	return typeof period.startDate === "string" && typeof period.endDateExclusive === "string";
}

function isFinancialCycleValue(value: unknown): value is FinancialCycleResponse {
	if (typeof value !== "object" || value === null) return false;
	const cycle = value as Record<string, unknown>;
	return (
		(cycle.selectedPeriod === null || isFinancialPeriodValue(cycle.selectedPeriod)) &&
		(cycle.incomeAmount === null || typeof cycle.incomeAmount === "number") &&
		(cycle.completedAt === null || typeof cycle.completedAt === "string")
	);
}

/**
 * A cache entry is trusted only when it still has the shape this client reads. A truncated or
 * hand-edited entry, or one written by an older build, fails the check and is treated as a cache miss
 * instead of being rendered as data.
 */
function isFinancialDashboardDataValue(value: unknown): value is FinancialDashboardData {
	if (typeof value !== "object" || value === null) return false;
	const data = value as Record<string, unknown>;
	return (
		isFinancialCycleValue(data.cycle) &&
		Array.isArray(data.transactions) &&
		(data.warning === null || typeof data.warning === "string")
	);
}

/**
 * Reads the tab's cached dashboard, or `null` when it is absent, unreadable, or not a valid response.
 * Every failure mode (missing storage, denied read, invalid JSON, unexpected shape) degrades to `null`
 * so the caller falls back to the normal request instead of failing.
 */
export function readFinancialDashboardCache(email: string): FinancialDashboardData | null {
	const storage = getFinancialDashboardStorage();
	if (storage === null) return null;
	const identity = normalizeDashboardEmail(email);
	let serialized: string | null;
	try {
		// An older entry has no owner and cannot safely be assigned to this session.
		storage.removeItem(LEGACY_FINANCIAL_DASHBOARD_CACHE_KEY);
		serialized = storage.getItem(FINANCIAL_DASHBOARD_CACHE_KEY);
	} catch {
		return null;
	}
	if (serialized === null) return null;
	try {
		const parsed: unknown = JSON.parse(serialized);
		if (typeof parsed === "object" && parsed !== null) {
			const entry = parsed as Record<string, unknown>;
			if (identity && typeof entry.userEmail === "string" &&
				normalizeDashboardEmail(entry.userEmail) === identity &&
				isFinancialDashboardDataValue(entry.data)) return entry.data;
		}
	} catch {
		// Invalid JSON is an untrusted entry too.
	}
	cacheGeneration += 1;
	try { storage.removeItem(FINANCIAL_DASHBOARD_CACHE_KEY); } catch { /* Storage denied. */ }
	return null;
}

/**
 * Stores the loaded dashboard for the next reload. Caching is an enhancement, never a dependency: a
 * browser that denies `sessionStorage`, or a quota error, is swallowed because the caller already has
 * the response it just fetched.
 */
export function writeFinancialDashboardCache(email: string, data: FinancialDashboardData): void {
	const identity = normalizeDashboardEmail(email);
	if (!identity) return;
	const storage = getFinancialDashboardStorage();
	if (storage === null) return;
	try {
		storage.setItem(FINANCIAL_DASHBOARD_CACHE_KEY, JSON.stringify({ userEmail: identity, data }));
	} catch {
		// Storage unavailable or full: the next reload simply fetches again.
	}
}

/** Loads the cycle first so configured users never fall back to a month request. */
export async function loadFinancialDashboardData(
	signal?: AbortSignal,
): Promise<FinancialDashboardData> {
	const cycle = await getFinancialCycle(signal);
	if (!cycle.selectedPeriod) return { cycle, transactions: [], warning: null };

	const { transactions, warning } = await getTransactionsForPeriod(
		cycle.selectedPeriod,
		signal,
	);
	return { cycle, transactions, warning };
}

/**
 * Cache-first dashboard load for a page mount. A reload (F5) reuses the tab's stored response without
 * any request, so the configured period and its movements stay exactly as the tab last saw them. The
 * tab's first load has no stored response and takes the normal cycle-first request, which is then
 * cached for the next reload. Unavailable or corrupted storage degrades to that same normal request.
 */
export async function loadFinancialDashboardWithCache(
	email: string,
	signal?: AbortSignal,
): Promise<FinancialDashboardData> {
	if (signal?.aborted) throw new DOMException("Dashboard load aborted", "AbortError");
	const cached = readFinancialDashboardCache(email);
	if (cached) return cached;
	const generation = cacheGeneration;
	const data = await loadFinancialDashboardData(signal);
	if (signal?.aborted || generation !== cacheGeneration) throw new DOMException("Dashboard load aborted", "AbortError");
	writeFinancialDashboardCache(email, data);
	return data;
}

/**
 * Fresh dashboard load that bypasses the cache and replaces it with the server's current response.
 * Every explicit mutation, Gmail sync, retry, or period change goes through here, so those actions
 * always read and store current data instead of the response the tab loaded earlier.
 */
export async function refreshFinancialDashboardData(
	email: string,
	signal?: AbortSignal,
): Promise<FinancialDashboardData> {
	if (signal?.aborted) throw new DOMException("Dashboard load aborted", "AbortError");
	const generation = cacheGeneration;
	const data = await loadFinancialDashboardData(signal);
	if (signal?.aborted || generation !== cacheGeneration) throw new DOMException("Dashboard load aborted", "AbortError");
	writeFinancialDashboardCache(email, data);
	return data;
}

/**
 * Removes the stored Gmail authorization for this session. The server answers `{ ok: true }` and
 * clears the session's account link, so the next status read reports the account as disconnected.
 */
export async function disconnectGmail(): Promise<GmailDisconnectResponse> {
	const response = await fetch("/api/gmail/disconnect", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new ApiError(`Request to /api/gmail/disconnect failed (${response.status})`);
	}
	return (await response.json()) as GmailDisconnectResponse;
}

/**
 * Synchronizes the configured financial period.
 *
 * `period` is required and always sent: the server only reports `outcome` and `failedCount` in
 * period mode, and in month mode it silently drops the failure count (`src/movements.js:95-113`),
 * which would leave this client unable to tell a partial import from a complete one. `month` and
 * `payTiming` are deliberately absent: the React surface synchronizes the configured period and
 * the server's pay-timing default applies.
 */
export async function syncGmail(period: FinancialPeriod, signal?: AbortSignal) {
	const response = await fetch("/api/gmail/sync", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ limit: 200, period }),
		signal,
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new ApiError(`Request to /api/gmail/sync failed (${response.status})`);
	}
	return (await response.json()) as GmailSyncResponse;
}
