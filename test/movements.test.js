import test from "node:test";
import assert from "node:assert/strict";

import {
	applyCounterpartyCategoryRules,
	applyMovementOverrides,
	computeMovementKey,
	filterMovementsForPeriod,
	normalizeCounterpartyKey,
	toRangeSyncResult,
} from "../src/movements.js";

test("computes stable movement keys from source and source id", () => {
	const first = computeMovementKey({
		source: "gmail_banco_chile",
		sourceId: "banco-chile:ABC123",
		occurredAt: "2026-05-10T10:00:00",
		amount: 1000,
		counterparty: "Comercio",
	});
	const second = computeMovementKey({
		source: "gmail_banco_chile",
		sourceId: "banco-chile:ABC123",
		occurredAt: "2026-05-11T12:00:00",
		amount: 2000,
		counterparty: "Otro comercio",
	});
	assert.equal(first, second);
	assert.match(first, /^gm_[a-f0-9]{32}$/);
});

test("normalizes counterparty keys consistently", () => {
	assert.equal(
		normalizeCounterpartyKey("STA  ISABEL  CASAS"),
		"sta isabel casas",
	);
	assert.equal(normalizeCounterpartyKey("José Pérez"), "jose perez");
});

test("applies counterparty category rules", () => {
	const movements = [
		{
			id: "gm_1",
			movementKey: "gm_1",
			counterparty: "STA ISABEL CASAS",
			amount: 1000,
			category: null,
		},
		{
			id: "gm_2",
			movementKey: "gm_2",
			counterparty: "JUMBO",
			amount: 2000,
			category: "Comida",
		},
	];
	const withRules = applyCounterpartyCategoryRules(movements, [
		{ counterpartyKey: "sta isabel casas", category: "Supermercado" },
	]);
	assert.equal(withRules[0].category, "Supermercado");
	assert.equal(withRules[1].category, "Comida");
});

test("applies overrides and hides runtime movements", () => {
	const visible = {
		id: "gm_visible",
		movementKey: "gm_visible",
		amount: 1000,
		category: null,
		status: "detected",
	};
	const hidden = {
		id: "gm_hidden",
		movementKey: "gm_hidden",
		amount: 2000,
		category: null,
		status: "detected",
	};
	const result = applyMovementOverrides(
		[visible, hidden],
		[
			{
				movementKey: "gm_visible",
				patch: { category: "Comida", status: "edited" },
				hidden: false,
			},
			{ movementKey: "gm_hidden", patch: {}, hidden: true },
		],
	);
	assert.equal(result.length, 1);
	assert.equal(result[0].category, "Comida");
	assert.equal(result[0].status, "edited");
	assert.equal(result[0].movementKey, "gm_visible");
});

test("attributes stable date-only and timestamp movements with an inclusive start and exclusive end", () => {
	const movements = [
		{ movementKey: "dec", occurredAt: "2026-12-31" },
		{ movementKey: "late-dec", occurredAt: "2026-12-31T23:59:59" },
		{ movementKey: "jan", occurredAt: "2027-01-01" },
	];

	assert.deepEqual(
		filterMovementsForPeriod(movements, {
			startDate: "2026-12-31",
			endDateExclusive: "2027-01-01",
		}).map((movement) => movement.movementKey),
		["dec", "late-dec"],
	);
});

test("reports failed range pages as provisional partial results without completion metadata", () => {
	const result = toRangeSyncResult({
		scanned: 3,
		transactions: [{ movementKey: "stable-key" }],
		failedCount: 1,
	});

	assert.deepEqual(result, {
		outcome: "partial",
		scanned: 3,
		transactions: [{ movementKey: "stable-key" }],
		failedCount: 1,
		completedAt: null,
	});
});
