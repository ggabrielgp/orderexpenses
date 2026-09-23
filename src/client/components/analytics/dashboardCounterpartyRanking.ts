import type { FinancialTransaction } from "../../api/types";
import { recognizedExpenseKinds } from "../movements/manualExpense";

export interface DashboardCounterpartyRow {
	name: string;
	count: number;
	total: number;
	/** Share of all recognized quantified period outflows, including unnamed ones. */
	share: number | null;
}

export interface DashboardCounterpartyRanking {
	/** Sum of ALL recognized finite outflows, even those without a named counterparty. */
	allRecognizedQuantifiedSpending: number;
	unnamedCount: number;
	rows: DashboardCounterpartyRow[];
}

function nameKey(name: string): string {
	return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
		.toLowerCase().trim().replace(/\s+/g, " ");
}

function compareNames(a: string, b: string): number {
	return a.localeCompare(b, "es") || (a < b ? -1 : a > b ? 1 : 0);
}

function shareOfAll(total: number, denominator: number): number | null {
	if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(total)) return null;
	const share = (total / denominator) * 100;
	return Number.isFinite(share) ? share : null;
}

/**
 * Rank actual stored counterparties from the period's already loaded transactions. Descriptions
 * and the movement display fallback are not identities. Every recognized finite outflow contributes
 * to the denominator, including transfers, payments and unnamed movements. A nonpositive denominator
 * cannot support a spending share, so shares are unavailable rather than invented.
 */
export function getDashboardCounterpartyRanking(
	transactions: readonly FinancialTransaction[],
): DashboardCounterpartyRanking {
	const groups = new Map<string, { name: string; count: number; total: number }>();
	let allRecognizedQuantifiedSpending = 0;
	let unnamedCount = 0;
	for (const transaction of transactions) {
		if (transaction.direction !== "outflow" ||
			typeof transaction.kind !== "string" || !recognizedExpenseKinds.has(transaction.kind) ||
			typeof transaction.amount !== "number" || !Number.isFinite(transaction.amount)) continue;
		allRecognizedQuantifiedSpending += transaction.amount;
		const name = typeof transaction.counterparty === "string"
			? transaction.counterparty.trim().replace(/\s+/g, " ") : "";
		const key = nameKey(name);
		if (!key) {
			unnamedCount += 1;
			continue;
		}
		const group = groups.get(key) ?? { name, count: 0, total: 0 };
		group.name = compareNames(name, group.name) < 0 ? name : group.name;
		group.count += 1;
		group.total += transaction.amount;
		groups.set(key, group);
	}
	return {
		allRecognizedQuantifiedSpending,
		unnamedCount,
		rows: [...groups.entries()]
			.sort((a, b) => b[1].total - a[1].total || compareNames(a[0], b[0]))
			.map(([, group]) => ({
				...group,
				share: shareOfAll(group.total, allRecognizedQuantifiedSpending),
			})),
	};
}
