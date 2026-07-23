import test from "node:test";
import assert from "node:assert/strict";
import {
	FINANCE_PREFERENCE_KEYS,
	createDefaultFinancePreferences,
	parseFinancePreferences,
	readFinancePreferences,
	resetAllFinancePreferences,
	resetFinancePreferenceMonth,
	updateFinancePreferences,
} from "../public/finance-preferences.js";

const month = "2026-07";
const defaults = createDefaultFinancePreferences();
const july = {
	salary: "$1.500.000",
	actualRemaining: "$500.000",
	autoDetectIncome: true,
	payTiming: "last_week",
	confirmedIncomeId: "manual",
};

test("treats missing storage as silent defaults", () => {
	const session = parseFinancePreferences(null, { currentMonth: month });
	assert.equal(session.kind, "empty");
	assert.deepEqual(readFinancePreferences(session, { month }).preferences, defaults);
	assert.equal(readFinancePreferences(session, { month }).notice, null);
});

test("accepts valid v2 months including future months and ignores unknown fields", () => {
	const raw = JSON.stringify({
		version: 2,
		unknownEnvelope: "ignored",
		months: {
			[month]: { ...july, unknownEntry: "ignored" },
			"2030-01": { salary: "$2.000.000" },
		},
	});
	const session = parseFinancePreferences(raw, { currentMonth: month });

	assert.equal(session.kind, "v2");
	assert.deepEqual(readFinancePreferences(session, { month }).preferences, july);
	assert.deepEqual(
		readFinancePreferences(session, { month: "2030-01" }).preferences,
		{ ...defaults, salary: "$2.000.000" },
	);
	assert.equal("unknownEnvelope" in session.model, false);
	assert.equal("unknownEntry" in session.model.months[month], false);
});

test("rejects malformed, unsupported, and structurally invalid persisted data", () => {
	const invalidValues = [
		"not-json",
		"[]",
		"null",
		JSON.stringify({ version: 3, months: {} }),
		JSON.stringify({ version: 2, months: [] }),
		JSON.stringify({ version: 2, months: { "2026-13": july } }),
		JSON.stringify({ version: 2, months: { [month]: [] } }),
		JSON.stringify({ version: 2, months: { [month]: { autoDetectIncome: "yes" } } }),
	];
	for (const raw of invalidValues) {
		const session = parseFinancePreferences(raw, { currentMonth: month });
		assert.ok(["invalid", "unsupported"].includes(session.kind));
		const read = readFinancePreferences(session, { month });
		assert.deepEqual(read.preferences, defaults);
		assert.equal(read.notice, "recovery");
	}
});

test("reads recognized flat legacy data only for the current month", () => {
	const session = parseFinancePreferences(JSON.stringify(july), {
		currentMonth: month,
	});
	assert.equal(session.kind, "legacy");
	assert.deepEqual(readFinancePreferences(session, { month }).preferences, july);
	assert.deepEqual(
		readFinancePreferences(session, { month: "2026-08" }).preferences,
		defaults,
	);
});

test("explicit update recovers invalid storage with a fresh v2 envelope", () => {
	const invalid = parseFinancePreferences("not-json", { currentMonth: month });
	const updated = updateFinancePreferences(invalid, {
		month,
		preferences: july,
	});

	assert.equal(updated.operation, "write");
	assert.equal(updated.recovery, true);
	assert.deepEqual(updated.session.model, {
		version: 2,
		months: { [month]: july },
	});
	assert.deepEqual(readFinancePreferences(updated.session, { month }).preferences, july);
});

test("explicit legacy update migrates and preserves later sibling updates", () => {
	const legacy = parseFinancePreferences(JSON.stringify(july), {
		currentMonth: month,
	});
	const migrated = updateFinancePreferences(legacy, {
		month,
		preferences: { ...july, salary: "$1.600.000" },
	});
	const withSibling = updateFinancePreferences(migrated.session, {
		month: "2026-08",
		preferences: { ...defaults, salary: "$1.700.000" },
	});

	assert.equal(migrated.recovery, true);
	assert.deepEqual(Object.keys(withSibling.session.model.months).sort(), [
		"2026-07",
		"2026-08",
	]);
});

test("month reset preserves siblings and removes empty budget storage", () => {
	let session = updateFinancePreferences(
		parseFinancePreferences(null, { currentMonth: month }),
		{ month, preferences: july },
	).session;
	session = updateFinancePreferences(session, {
		month: "2026-08",
		preferences: { ...defaults, salary: "$1.700.000" },
	}).session;

	const firstReset = resetFinancePreferenceMonth(session, { month });
	assert.equal(firstReset.operation, "write");
	assert.deepEqual(Object.keys(firstReset.session.model.months), ["2026-08"]);
	const finalReset = resetFinancePreferenceMonth(firstReset.session, {
		month: "2026-08",
	});
	assert.equal(finalReset.operation, "remove");
	assert.equal(finalReset.serialized, null);
});

test("month reset removes invalid bytes and full reset owns only finance keys", () => {
	const invalid = parseFinancePreferences("not-json", { currentMonth: month });
	assert.equal(resetFinancePreferenceMonth(invalid, { month }).operation, "remove");
	assert.deepEqual(resetAllFinancePreferences(), {
		budgetOperation: "remove",
		viewOperation: "remove",
		budgetKey: FINANCE_PREFERENCE_KEYS.budget,
		viewKey: FINANCE_PREFERENCE_KEYS.view,
		budgetSession: parseFinancePreferences(null, { currentMonth: null }),
		viewPreferences: { budgetEnabled: false },
	});
});
