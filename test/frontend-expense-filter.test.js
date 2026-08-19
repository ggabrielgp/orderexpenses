import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadRecognizedExpensePredicate() {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	const match = source.match(
		/function isRecognizedExpense\(transaction\) \{[\s\S]*?\n\}/,
	);
	assert.ok(match, "isRecognizedExpense must remain directly testable");
	return vm.runInNewContext(`(${match[0]})`);
}

test("requires recognized expense semantics without excluding partial real expenses", async () => {
	const isRecognizedExpense = await loadRecognizedExpensePredicate();

	assert.equal(
		isRecognizedExpense({
			kind: "unknown",
			direction: "outflow",
			status: "needs_review",
		}),
		false,
	);
	assert.equal(
		isRecognizedExpense({
			kind: "purchase",
			direction: "outflow",
			status: "needs_review",
		}),
		true,
	);
	assert.equal(
		isRecognizedExpense({
			kind: "transfer",
			direction: "outflow",
			status: "detected",
		}),
		true,
	);
	assert.equal(
		isRecognizedExpense({
			kind: "income",
			direction: "inflow",
			status: "detected",
		}),
		false,
	);
});

test("wires the recognized expense predicate into monthly expense derivation", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	assert.match(
		source,
		/function selectedMonthExpenseTransactions\(transactions\) \{[\s\S]*?\.filter\(\s*isRecognizedExpense,\s*\);/,
	);
});
