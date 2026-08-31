import assert from "node:assert/strict";
import test from "node:test";
import {
	calculatePeriodSummary,
	filterTransactionsForReviewPeriod,
	periodLabel,
	resolveReviewPeriod,
} from "../public/dashboard-period.js";

const selectedPeriod = {
	startDate: "2026-12-30",
	endDateExclusive: "2027-01-02",
};

test("filters totals and labels with the selected exclusive-end review period", () => {
	const period = resolveReviewPeriod(selectedPeriod);
	const transactions = [
		{ id: "inside-start", occurredAt: "2026-12-30T10:00:00", amount: 1000 },
		{ id: "inside-end", occurredAt: "2027-01-01T23:59:59", amount: 2500 },
		{ id: "outside", occurredAt: "2027-01-02T00:00:00", amount: 9000 },
	];

	assert.deepEqual(
		filterTransactionsForReviewPeriod(transactions, period).map((transaction) => transaction.id),
		["inside-start", "inside-end"],
	);
	assert.equal(periodLabel(period), "2026-12-30 – 2027-01-01");
	assert.deepEqual(calculatePeriodSummary([transactions[0], transactions[1]], 10000), {
		totalSpent: 3500,
		remaining: 6500,
	});
});

test("keeps remaining unavailable for skipped income and rejects invalid transaction dates", () => {
	const period = resolveReviewPeriod({
		startDate: "2028-02-29",
		endDateExclusive: "2028-03-02",
	});
	const transactions = [
		{ id: "leap-day", occurredAt: "2028-02-29", amount: 700 },
		{ id: "invalid", occurredAt: "not-a-date", amount: 900 },
		{ id: "outside", occurredAt: "2028-03-02", amount: 800 },
	];

	assert.deepEqual(
		filterTransactionsForReviewPeriod(transactions, period).map((transaction) => transaction.id),
		["leap-day"],
	);
	assert.deepEqual(calculatePeriodSummary([transactions[0]], null), {
		totalSpent: 700,
		remaining: null,
	});
});
