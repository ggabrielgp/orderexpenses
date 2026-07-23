import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
	createIncomeCandidateCache,
	incomeCandidateCacheKey,
} from "../src/income-candidate-cache.js";
const key = {
	userEmail: "Person@Example.com ",
	month: "2026-07",
	payTiming: "VARIES",
	limit: 200,
};
function movement(overrides = {}) {
	return {
		movementKey: "gm_1",
		occurredAt: "2026-07-10T10:00:00.000Z",
		amount: 5000,
		currency: "CLP",
		direction: "inflow",
		kind: "transfer",
		counterparty: "Employer",
		counterpartyKey: "employer",
		description: "Salary",
		category: null,
		confidence: 0.9,
		status: "detected",
		rawPreview: "secret",
		sourceId: "gmail:secret-id",
		arbitrary: "remove",
		...overrides,
	};
}
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
test("normalizes cache keys and separates material parameters", () => {
	assert.equal(
		incomeCandidateCacheKey(key),
		incomeCandidateCacheKey({
			...key,
			userEmail: "person@example.com",
			payTiming: "varies",
		}),
	);
	assert.notEqual(
		incomeCandidateCacheKey(key),
		incomeCandidateCacheKey({ ...key, month: "2026-08" }),
	);
});
test("reuses safe candidates before 30 seconds and expires at the boundary", async () => {
	let now = 0;
	let scans = 0;
	const cache = createIncomeCandidateCache({ clock: () => now });
	await cache.scanPassiveFresh(key, {
		scan: async () => (scans++, [movement()]),
	});
	now = 29_999;
	const hit = await cache.readCandidatesOrScan(key, {
		scan: async () => (scans++, []),
	});
	assert.equal(scans, 1);
	assert.equal(hit[0].id, "gm_1");
	assert.equal(hit[0].rawPreview, undefined);
	assert.equal(hit[0].sourceId, undefined);
	assert.equal(hit[0].arbitrary, undefined);
	now = 30_000;
	await cache.readCandidatesOrScan(key, {
		scan: async () => (scans++, [movement({ movementKey: "gm_2" })]),
	});
	assert.equal(scans, 2);
});

test("transaction scans stay fresh and cached values are isolated copies", async () => {
	let scans = 0;
	const cache = createIncomeCandidateCache();
	const first = await cache.scanPassiveFresh(key, {
		scan: async () => (scans++, [movement()]),
	});
	first[0].amount = 1;
	await cache.scanPassiveFresh(key, {
		scan: async () => (scans++, [movement({ amount: 7000 })]),
	});
	const cached = await cache.readCandidatesOrScan(key, {
		scan: async () => [],
	});
	cached[0].amount = 2;
	const next = await cache.readCandidatesOrScan(key, { scan: async () => [] });
	assert.equal(scans, 2);
	assert.equal(next[0].amount, 7000);
});

test("newer manual completion fences older passive work", async () => {
	const cache = createIncomeCandidateCache();
	const passive = deferred();
	const passiveRun = cache.scanPassiveFresh(key, {
		scan: () => passive.promise,
	});
	const manualRun = cache.scanManualFresh(key, {
		scan: async () => [movement({ movementKey: "gm_manual", amount: 9000 })],
	});
	await manualRun;
	passive.resolve([movement({ movementKey: "gm_old", amount: 1000 })]);
	await passiveRun;

	const cached = await cache.readCandidatesOrScan(key, {
		scan: async () => [],
	});
	assert.equal(cached[0].movementKey, "gm_manual");
});

test("manual completion fences passive and older manual scans", async () => {
	const cache = createIncomeCandidateCache();
	const manual = deferred();
	const passive = deferred();
	const manualRun = cache.scanManualFresh(key, { scan: () => manual.promise });
	const passiveRun = cache.scanPassiveFresh(key, {
		scan: () => passive.promise,
	});
	manual.resolve([movement({ movementKey: "gm_manual" })]);
	await manualRun;
	passive.resolve([movement({ movementKey: "gm_passive" })]);
	await passiveRun;
	assert.equal(
		(await cache.readCandidatesOrScan(key, { scan: async () => [] }))[0]
			.movementKey,
		"gm_manual",
	);

	const oldManual = deferred();
	const oldRun = cache.scanManualFresh(key, { scan: () => oldManual.promise });
	await cache.scanManualFresh(key, {
		scan: async () => [movement({ movementKey: "gm_new_manual" })],
	});
	oldManual.resolve([movement({ movementKey: "gm_old_manual" })]);
	await oldRun;
	assert.equal(
		(await cache.readCandidatesOrScan(key, { scan: async () => [] }))[0]
			.movementKey,
		"gm_new_manual",
	);
});

test("candidate projection failure never returns the raw scan", async () => {
	const cache = createIncomeCandidateCache();
	const unsafe = movement();
	Object.defineProperty(unsafe, "amount", {
		get() {
			throw new Error("projection failed");
		},
	});
	await assert.rejects(
		() => cache.readCandidatesOrScan(key, { scan: async () => [unsafe] }),
		/projection failed/,
	);
});

test("manual failure preserves a good entry", async () => {
	const cache = createIncomeCandidateCache();
	await cache.scanPassiveFresh(key, { scan: async () => [movement()] });
	await assert.rejects(
		() =>
			cache.scanManualFresh(key, {
				scan: async () => {
					throw new Error("gmail failed");
				},
			}),
		/gmail failed/,
	);
	const cached = await cache.readCandidatesOrScan(key, {
		scan: async () => [],
	});
	assert.equal(cached[0].movementKey, "gm_1");
});

test("evicts expired entries before live LRU entries", async () => {
	let now = 0;
	const cache = createIncomeCandidateCache({ clock: () => now, capacity: 2 });
	const first = { ...key, month: "2026-01" };
	const second = { ...key, month: "2026-02" };
	const third = { ...key, month: "2026-03" };
	await cache.scanPassiveFresh(first, { scan: async () => [movement()] });
	now = 30_000;
	await cache.scanPassiveFresh(second, { scan: async () => [movement()] });
	await cache.scanPassiveFresh(third, { scan: async () => [movement()] });
	assert.equal(cache.size(), 2);
	let scans = 0;
	await cache.readCandidatesOrScan(first, { scan: async () => (scans++, []) });
	assert.equal(scans, 1);

	const lru = createIncomeCandidateCache({ capacity: 2 });
	await lru.scanPassiveFresh(first, { scan: async () => [movement()] });
	await lru.scanPassiveFresh(second, { scan: async () => [movement()] });
	await lru.readCandidatesOrScan(first, { scan: async () => [] });
	await lru.scanPassiveFresh(third, { scan: async () => [movement()] });
	let secondScans = 0;
	await lru.readCandidatesOrScan(second, {
		scan: async () => (secondScans++, []),
	});
	assert.equal(secondScans, 1);

	const replacement = createIncomeCandidateCache({ capacity: 2 });
	await replacement.scanPassiveFresh(first, { scan: async () => [movement()] });
	await replacement.scanPassiveFresh(third, { scan: async () => [movement()] });
	await replacement.scanPassiveFresh(third, { scan: async () => [movement()] });
	let firstScans = 0;
	await replacement.readCandidatesOrScan(first, {
		scan: async () => (firstScans++, []),
	});
	assert.equal(firstScans, 0);
});

const movementsTmpDir = mkdtempSync(
	resolve(tmpdir(), "orderexpenses-cache-integration-"),
);
process.env.TURSO_DATABASE_URL = `file:${resolve(movementsTmpDir, "test.db")}`;
const cacheTestDb = await import("../src/db.js");
const {
	loadIncomeCandidateMovements,
	loadMovementsForMonthResult,
	syncRuntimeMovements,
} = await import("../src/movements.js");
await cacheTestDb.ensureDbInitialized();

function integrationScanner(counter, movements = [movement()]) {
	return async () => {
		counter.calls += 1;
		return { movements, query: "query", scanned: movements.length };
	};
}

test("transaction scan warms sequential income candidates", async () => {
	const counter = { calls: 0 };
	const scanGmail = integrationScanner(counter);
	const options = { month: "2026-07", payTiming: "varies", scanGmail };
	const transactions = await loadMovementsForMonthResult(
		"cache-warm@example.com",
		options,
	);
	const candidates = await loadIncomeCandidateMovements(
		"cache-warm@example.com",
		options,
	);
	assert.equal(counter.calls, 1);
	assert.equal(transactions.movements.length, 1);
	assert.equal(candidates[0].movementKey, "gm_1");
});

test("manual sync bypasses and refreshes candidate cache", async () => {
	const counter = { calls: 0 };
	const scanGmail = async () => {
		counter.calls += 1;
		const suffix = counter.calls === 1 ? "before" : "after";
		return {
			movements: [movement({ movementKey: `gm_${suffix}` })],
			query: "query",
			scanned: 1,
		};
	};
	const options = { month: "2026-08", payTiming: "varies", scanGmail };
	await loadMovementsForMonthResult("manual-sync@example.com", options);
	await syncRuntimeMovements("manual-sync@example.com", options);
	const candidates = await loadIncomeCandidateMovements(
		"manual-sync@example.com",
		options,
	);
	assert.equal(counter.calls, 2);
	assert.equal(candidates[0].movementKey, "gm_after");
});

test("passive Gmail failure preserves warning compatibility", async () => {
	const error = new Error("not connected");
	error.status = 401;
	const result = await loadMovementsForMonthResult("failure@example.com", {
		month: "2026-09",
		scanGmail: async () => {
			throw error;
		},
	});
	assert.deepEqual(result.movements, []);
	assert.equal(
		result.warning,
		"Gmail no está conectado; se muestran solo movimientos manuales.",
	);
});
