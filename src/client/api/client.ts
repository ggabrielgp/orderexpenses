import type {
	FinancialCycleResponse,
	FinancialDashboardData,
	FinancialPeriod,
	GmailStatusResponse,
	GmailSyncResponse,
	SessionResponse,
	TransactionsResponse,
	UpdateFinancialCycleRequest,
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

export async function syncGmail(signal?: AbortSignal) {
	const response = await fetch("/api/gmail/sync", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
		signal,
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new ApiError(`Request to /api/gmail/sync failed (${response.status})`);
	}
	return (await response.json()) as GmailSyncResponse;
}
