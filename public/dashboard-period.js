import { ReviewPeriod } from "./review-period.js";

export function resolveReviewPeriod(value, fallback = ReviewPeriod.currentMonth()) {
	return value ? ReviewPeriod.create(value) : fallback;
}

export function filterTransactionsForReviewPeriod(transactions, period) {
	return transactions.filter((transaction) => {
		const date = String(transaction.occurredAt ?? "").slice(0, 10);
		try {
			return period.includes(date);
		} catch {
			return false;
		}
	});
}

export function calculatePeriodSummary(transactions, incomeAmount) {
	const totalSpent = transactions.reduce(
		(total, transaction) => total + Number(transaction.amount || 0),
		0,
	);
	return {
		totalSpent,
		remaining: incomeAmount === null ? null : incomeAmount - totalSpent,
	};
}

export function periodLabel(period) {
	return period.label;
}
