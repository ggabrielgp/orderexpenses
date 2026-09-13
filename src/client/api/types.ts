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
	amount: unknown;
	direction: unknown;
	kind: unknown;
	occurredAt?: unknown;
	counterparty?: unknown;
	description?: unknown;
	category?: unknown;
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
