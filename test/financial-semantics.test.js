import test from "node:test";
import assert from "node:assert/strict";
import {
	calculateFinancialPosition,
	isCountedExpense,
	isKnownAmount,
	legacyConfirmationId,
	resolveConfirmedIncome,
	summarizeMovements,
} from "../public/financial-semantics.js";

test("recognizes finite non-negative amounts including zero", () => {
	for (const value of [0, 1, "0", "1250"]) {
		assert.equal(isKnownAmount(value), true);
	}
	for (const value of [
		null,
		undefined,
		"",
		" ",
		"invalid",
		-1,
		NaN,
		Infinity,
		true,
		false,
		[],
		[25],
		{},
	]) {
		assert.equal(isKnownAmount(value), false);
	}
});

test("counts every known outflow including transfers", () => {
	assert.equal(
		isCountedExpense({ direction: "outflow", kind: "purchase", amount: 500 }),
		true,
	);
	assert.equal(
		isCountedExpense({ direction: "outflow", kind: "transfer", amount: 700 }),
		true,
	);
	assert.equal(
		isCountedExpense({ direction: "inflow", kind: "transfer", amount: 700 }),
		false,
	);
	assert.equal(
		isCountedExpense({ direction: "outflow", kind: "transfer", amount: null }),
		false,
	);
});

test("summarizes expenses and informational inflows separately", () => {
	const summary = summarizeMovements([
		{ direction: "outflow", kind: "purchase", amount: 500 },
		{ direction: "outflow", kind: "transfer", amount: "700" },
		{ direction: "outflow", kind: "purchase", amount: 0 },
		{ direction: "outflow", kind: "purchase", amount: "invalid" },
		{ direction: "inflow", kind: "income", amount: 2_000 },
		{ direction: "inflow", kind: "income", amount: null },
	]);

	assert.deepEqual(summary, {
		expenseTotal: 1_200,
		expenseCount: 3,
		informationalInflowTotal: 2_000,
		informationalInflowCount: 1,
	});
});

test("does not confirm income without a persisted confirmation marker", () => {
	assert.deepEqual(
		resolveConfirmedIncome({
			salaryAmount: 900_000,
			confirmedIncomeId: "",
			incomeCandidates: [{ id: "largest", amount: 2_000_000 }],
		}),
		{ amount: null, source: null, reason: "Ingreso no confirmado." },
	);
});

test("resolves manual and candidate income from the stored salary snapshot", () => {
	assert.deepEqual(
		resolveConfirmedIncome({
			salaryAmount: 1_500_000,
			confirmedIncomeId: "manual",
		}),
		{
			amount: 1_500_000,
			source: "manual",
			reason: "Ingreso manual confirmado.",
		},
	);
	assert.deepEqual(
		resolveConfirmedIncome({
			salaryAmount: 1_750_000,
			confirmedIncomeId: "gm_salary",
			incomeCandidates: [{ id: "gm_salary", amount: 9_999_999 }],
		}),
		{
			amount: 1_750_000,
			source: "candidate",
			reason: "Entrada seleccionada como ingreso principal.",
		},
	);
});

test("candidate confirmation survives disappearance and clearing removes it", () => {
	const persisted = resolveConfirmedIncome({
		salaryAmount: 1_750_000,
		confirmedIncomeId: "gm_missing",
		incomeCandidates: [],
	});
	assert.equal(persisted.amount, 1_750_000);
	assert.equal(persisted.source, "candidate");
	assert.equal(
		resolveConfirmedIncome({ salaryAmount: "", confirmedIncomeId: "" }).amount,
		null,
	);
});

test("calculates expected and unexplained positions only with required inputs", () => {
	assert.deepEqual(
		calculateFinancialPosition({
			confirmedIncome: { amount: 3_000 },
			expenseTotal: 1_200,
			actualRemaining: 1_500,
		}),
		{ expectedRemaining: 1_800, unexplained: 300 },
	);
	assert.deepEqual(
		calculateFinancialPosition({
			confirmedIncome: { amount: 3_000 },
			expenseTotal: 1_200,
			actualRemaining: null,
		}),
		{ expectedRemaining: 1_800, unexplained: null },
	);
	assert.deepEqual(
		calculateFinancialPosition({
			confirmedIncome: { amount: 3_000 },
			expenseTotal: 1_200,
			actualRemaining: 2_000,
		}),
		{ expectedRemaining: 1_800, unexplained: -200 },
	);
	assert.deepEqual(
		calculateFinancialPosition({
			confirmedIncome: { amount: null },
			expenseTotal: 1_200,
			actualRemaining: 500,
		}),
		{ expectedRemaining: null, unexplained: null },
	);
});

test("normalizes legacy confirmation without changing the storage version", () => {
	assert.equal(
		legacyConfirmationId({ salaryAmount: 1_000_000, confirmedIncomeId: "" }),
		"manual",
	);
	assert.equal(
		legacyConfirmationId({
			salaryAmount: 1_000_000,
			confirmedIncomeId: "gm_salary",
		}),
		"gm_salary",
	);
	for (const salaryAmount of [null, "", "invalid", -1, 0]) {
		assert.equal(
			legacyConfirmationId({ salaryAmount, confirmedIncomeId: "" }),
			"",
		);
	}
	assert.equal(
		legacyConfirmationId({
			salaryAmount: "invalid",
			confirmedIncomeId: "gm_stale",
		}),
		"",
	);
});
