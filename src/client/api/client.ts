import type {
	CategoriesResponse,
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
