import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import "./helpers/isolation.js";
import { configureGoogleFixtures, googleCalls } from "./helpers/fixtures.js";
import { request } from "./helpers/request.js";

const vite = await createServer({
	configFile: false, envFile: false, appType: "custom", optimizeDeps: { noDiscovery: true },
	server: { middlewareMode: true, hmr: false, ws: false },
});
test.after(() => vite.close());
const client = await vite.ssrLoadModule("/src/client/api/client.ts");
const syncModule = await vite.ssrLoadModule("/src/client/components/gmail/gmailSync.ts");
const { default: handler } = await import("../src/server.js");
const db = await import("../src/db.js");
const period = { startDate: "2026-01-01", endDateExclusive: "2026-02-01" };
const email = "sync-reuse@example.com";
const cycle = { selectedPeriod: period, incomeAmount: 900000, completedAt: "2026-02-01T00:00:00Z" };
const row = { id: "gm_new", amount: 1200, direction: "outflow", kind: "purchase", occurredAt: "2026-01-15" };
const complete = { outcome: "success", failedCount: 0, scanned: 1, transactions: [row] };
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const storage = new Map();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
	getItem: (key) => storage.get(key) ?? null,
	setItem: (key, value) => storage.set(key, value),
	removeItem: (key) => storage.delete(key),
} });
test.after(() => {
	if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
	else delete globalThis.sessionStorage;
});
test.beforeEach(() => { storage.clear(); client.clearFinancialDashboardCache(); });

function initialData() {
	return { cycle: structuredClone(cycle), transactions: [{ ...row, id: "old" }], warning: "Previous Gmail warning" };
}
function snapshot(data = initialData()) {
	return { data, loadEpoch: 1, mounted: true, stale: false, loading: false };
}
function prepareReuse(data, readSnapshot = () => snapshot(data)) {
	return client.prepareFinancialDashboardSyncReuse(email, period, readSnapshot);
}
function mockFetch(t, callback) {
	const original = globalThis.fetch;
	globalThis.fetch = callback;
	t.after(() => { globalThis.fetch = original; });
}
function submitter(overrides = {}) {
	return syncModule.createGmailSyncSubmitter({
		period, lock: { current: false }, sync: async () => structuredClone(complete),
		reload: async () => { throw new Error("Unexpected duplicate reload"); }, ...overrides,
	});
}

test("manual sync reuses complete assembled rows with exactly one POST and keeps the cycle and F5 cache", async (t) => {
	const calls = [];
	mockFetch(t, async (path, options) => {
		calls.push({ path, method: options.method, body: JSON.parse(options.body) });
		return { ok: true, json: async () => structuredClone(complete) };
	});
	const initial = initialData();
	let displayed = initial;
	let reloads = 0;
	const outcome = await submitter({
		sync: client.syncGmail,
		prepareResultReuse: () => {
			const reuse = prepareReuse(initial);
			return (payload) => {
				const merged = reuse(payload);
				if (!merged) return false;
				displayed = merged;
				return true;
			};
		},
		reload: async () => { reloads++; return true; },
	})();
	assert.deepEqual(outcome, { status: "success", scanned: 1, reloadFailed: false });
	assert.deepEqual(calls, [{ path: "/api/gmail/sync", method: "POST", body: { period } }]);
	assert.equal(reloads, 0);
	assert.deepEqual(displayed, { cycle: initial.cycle, transactions: [row], warning: null });
	assert.equal(displayed.cycle, initial.cycle);
	assert.deepEqual(await client.loadFinancialDashboardWithCache(email), displayed);
	assert.equal(calls.length, 1);
	assert.deepEqual(initial, initialData());
});

test("partial or malformed responses decline reuse and preserve existing reload outcomes", async () => {
	for (const payload of [
		{ ...complete, outcome: "partial", failedCount: 1, completedAt: null },
		{ ...complete, failedCount: 1 },
		{ ...complete, failedCount: undefined },
		{ ...complete, transactions: null },
		{ ...complete, transactions: [null] },
		{ ...complete, scanned: -1 },
	]) {
		const initial = initialData();
		client.writeFinancialDashboardCache(email, initial);
		const reuse = prepareReuse(initial);
		assert.equal(reuse(payload), null);
		assert.deepEqual(client.readFinancialDashboardCache(email), initial);
		let reloads = 0;
		const outcome = await submitter({
			sync: async () => payload,
			prepareResultReuse: () => (result) => reuse(result) !== null,
			reload: async () => { reloads++; return false; },
		})();
		assert.equal(reloads, 1);
		assert.equal(outcome.reloadFailed, true);
		assert.equal(outcome.status, syncModule.readGmailSyncResult(payload).status);
	}
});

test("intervening reload, period/income change or unmount declines reuse without overwriting newer data", async () => {
	for (const change of [
		{ loadEpoch: 2 }, { loading: true }, { stale: true },
		{ data: { ...initialData(), cycle: { ...cycle, incomeAmount: 123 } } },
		{ data: { ...initialData(), cycle: { ...cycle, selectedPeriod: { ...period, startDate: "2026-01-02" } } } },
	]) {
		const initial = initialData();
		let current = snapshot(initial);
		const reuse = prepareReuse(initial, () => current);
		const newer = { ...initial, transactions: [{ ...row, id: "newer" }] };
		client.writeFinancialDashboardCache(email, newer);
		current = { ...current, ...change };
		assert.equal(reuse(complete), null);
		assert.deepEqual(client.readFinancialDashboardCache(email), newer);
	}
});

test("sync prepares before POST and an intervening refresh falls back without publishing or caching old rows", async () => {
	const initial = initialData();
	let current = snapshot(initial);
	const newer = { ...initial, transactions: [{ ...row, id: "newer" }] };
	let displayed = initial;
	let reloads = 0;
	let applies = 0;
	const calls = [];
	const outcome = await submitter({
		prepareResultReuse: (requested) => {
			calls.push("prepare");
			assert.deepEqual(requested, period);
			const reuse = prepareReuse(initial, () => current);
			return (payload) => {
				const merged = reuse(payload);
				if (!merged) return false;
				applies++;
				displayed = merged;
				return true;
			};
		},
		sync: async () => {
			calls.push("POST");
			current = { ...current, loadEpoch: 2, data: newer };
			displayed = newer;
			client.writeFinancialDashboardCache(email, newer);
			return complete;
		},
		reload: async () => { calls.push("reload"); reloads++; return true; },
	})();
	assert.deepEqual(outcome, { status: "success", scanned: 1, reloadFailed: false });
	assert.deepEqual(calls, ["prepare", "POST", "reload"]);
	assert.equal(reloads, 1);
	assert.equal(applies, 0);
	assert.deepEqual(displayed, newer);
	assert.deepEqual(client.readFinancialDashboardCache(email), newer);
});

test("unavailable dashboard or mismatched requested period declines response reuse", () => {
	for (const change of [{ data: null }, { mounted: false }, { stale: true }, { loading: true }]) {
		const initial = initialData();
		assert.equal(prepareReuse(initial, () => ({ ...snapshot(initial), ...change }))(complete), change.mounted === false ? "invalidated" : null);
		assert.equal(storage.size, 0);
	}
	assert.equal(client.prepareFinancialDashboardSyncReuse(email, { ...period, startDate: "2026-01-02" }, () => snapshot())(complete), null);
	assert.equal(client.prepareFinancialDashboardSyncReuse("", period, () => snapshot()), null);
	assert.equal(storage.size, 0);
});

test("logout or unmount during POST prevents both reuse and a new account reload", async () => {
	for (const reason of ["logout", "unmount", "logout-during-load", "unmount-during-load"]) {
		const initial = initialData();
		let current = { ...snapshot(initial), loading: reason.endsWith("during-load") };
		let reloads = 0;
		let publishes = 0;
		const outcome = await submitter({
			prepareResultReuse: () => {
				const reuse = prepareReuse(initial, () => current);
				return (payload) => {
					const merged = reuse(payload);
					if (merged === "invalidated") return "invalidated";
					if (!merged) return false;
					publishes++;
					return true;
				};
			},
			sync: async () => {
				if (reason.startsWith("logout")) client.clearFinancialDashboardCache();
				else current = { ...current, mounted: false };
				return complete;
			},
			reload: async () => { reloads++; return true; },
		})();
		assert.deepEqual(outcome, { status: "success", scanned: 1, reloadFailed: true });
		assert.equal(reloads, 0);
		assert.equal(publishes, 0);
		assert.equal(storage.size, 0);
	}
});

test("logout invalidation prevents a settled sync from repopulating the account cache", () => {
	const initial = initialData();
	client.writeFinancialDashboardCache(email, initial);
	const reuse = prepareReuse(initial);
	client.clearFinancialDashboardCache();
	assert.equal(reuse(complete), "invalidated");
	assert.equal(client.readFinancialDashboardCache(email), null);
	assert.equal(storage.size, 0);
});

test("storage denial does not prevent a complete sync from updating the visible dashboard", () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
	try {
		const initial = initialData();
		const merged = prepareReuse(initial)(complete);
		assert.deepEqual(merged, { cycle: initial.cycle, transactions: [row], warning: null });
	} finally { Object.defineProperty(globalThis, "sessionStorage", previous); }
});

test("sync locks, rejection and explicit fresh refresh retain previous behavior", async (t) => {
	let resolve;
	let syncs = 0;
	let reloads = 0;
	const pending = new Promise((done) => { resolve = done; });
	const run = submitter({ sync: () => { syncs++; return pending; }, reload: async () => { reloads++; return true; } });
	const first = run();
	assert.deepEqual(await run(), { status: "busy" });
	resolve(complete);
	assert.deepEqual(await first, { status: "success", scanned: 1, reloadFailed: false });
	assert.equal(syncs, 1);
	assert.equal(reloads, 1);
	const lock = { current: false };
	const failed = await submitter({ lock, sync: async () => { throw new Error("Rejected"); }, reload: async () => { reloads++; return true; } })();
	assert.deepEqual(failed, { status: "failed", message: syncModule.GMAIL_SYNC_FAILURE_MESSAGE });
	assert.equal(lock.current, false);
	assert.equal(reloads, 1);
	const calls = [];
	mockFetch(t, async (path) => {
		calls.push(path);
		return { ok: true, json: async () => path === "/api/financial-cycle" ? cycle : { transactions: [row], warning: null } };
	});
	client.writeFinancialDashboardCache(email, initialData());
	assert.deepEqual(await client.refreshFinancialDashboardData(email), { cycle, transactions: [row], warning: null });
	assert.deepEqual(calls, ["/api/financial-cycle", "/api/transactions?startDate=2026-01-01&endDateExclusive=2026-02-01"]);
});

async function session() {
	await db.ensureDbInitialized();
	await db.upsertGoogleToken(email, { access_token: "synthetic-sync-token" });
	await db.upsertGoogleProfile(email, { email, name: "Synthetic sync fixture" });
	const id = randomUUID();
	await db.createSession(id, new Date(Date.now() + 3600_000).toISOString());
	await db.linkSessionToUser(id, email);
	return id;
}
function configureMessages(count) {
	configureGoogleFixtures({
		list: ({ maxResults, pageToken }) => {
			const offset = Number(pageToken ?? 0);
			const size = Math.min(maxResults, count - offset);
			return { data: { messages: Array.from({ length: size }, (_, i) => ({ id: `m${offset + i}` })),
				...(offset + size < count ? { nextPageToken: String(offset + size) } : {}) } };
		},
		get: ({ id }) => ({ data: { id, internalDate: "1768435200000", payload: {
			headers: [{ name: "Subject", value: "Aviso de compra con tarjeta" }],
			body: { data: Buffer.from(`Fecha: 15/01/2026\nComercio: Fixture ${id}\nMonto: $1.200`).toString("base64url") },
		} } }),
	});
}
const periodQuery = "/api/transactions?startDate=2026-01-01&endDateExclusive=2026-02-01";

test("uncapped period POST matches full GET beyond 200, including manual rows, rules, edits and hidden movements", async () => {
	const sessionId = await session();
	configureMessages(205);
	const initial = await request(handler, periodQuery, { sessionId });
	assert.equal(initial.status, 200);
	const rows = JSON.parse(initial.body).transactions;
	assert.equal(rows.length, 205);
	const mutate = (path, method, body) => request(handler, path, { sessionId, method, body, headers: { "content-type": "application/json" } });
	assert.equal((await mutate("/api/transactions", "POST", { amount: 3000, occurredAt: "2026-01-16", counterparty: "Manual fixture" })).status, 201);
	assert.equal((await mutate("/api/counterparty-rules", "PUT", { counterpartyKey: rows[2].counterparty, category: "Fixture rule" })).status, 200);
	assert.equal((await mutate(`/api/transactions/${rows[0].id}?month=2026-01`, "PATCH", { category: "Fixture edit" })).status, 200);
	assert.equal((await mutate(`/api/transactions/${rows[1].id}?month=2026-01`, "DELETE")).status, 200);
	configureMessages(205);
	const synced = await mutate("/api/gmail/sync", "POST", { period });
	assert.equal(synced.status, 200);
	const result = JSON.parse(synced.body);
	assert.equal(result.outcome, "success");
	assert.equal(result.failedCount, 0);
	assert.equal(result.scanned, 205);
	assert.equal(googleCalls.get.length, 205);
	const fresh = await request(handler, periodQuery, { sessionId });
	assert.equal(fresh.status, 200);
	assert.deepEqual(result.transactions, JSON.parse(fresh.body).transactions);
	assert.equal(result.transactions.length, 205);
	assert.equal(result.transactions.some((item) => item.id === rows[1].id), false);
	assert.equal(result.transactions.find((item) => item.id === rows[0].id).category, "Fixture edit");
	assert.equal(result.transactions.find((item) => item.id === rows[2].id).category, "Fixture rule");
	assert.equal(result.transactions.filter((item) => item.isManual).length, 1);
});

test("month-mode default and explicitly limited period POST keep their existing Gmail cap", async () => {
	const sessionId = await session();
	for (const [body, expected] of [[{ month: "2026-01" }, 200], [{ period, limit: 3 }, 3]]) {
		configureMessages(205);
		const response = await request(handler, "/api/gmail/sync", { sessionId, method: "POST", body, headers: { "content-type": "application/json" } });
		assert.equal(response.status, 200);
		assert.equal(JSON.parse(response.body).scanned, expected);
		assert.equal(googleCalls.get.length, expected);
	}
});

test("dashboard publishes prepared reuse with state, active-load, mounted and epoch guards", async () => {
	const source = await readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8");
	for (const expected of [
		/prepareResultReuse: financialDashboard\.prepareSyncResultReuse/,
		/prepareSyncResultReuse: prepareSyncResultReuse/,
		/loadEpoch: dashboardLoadEpoch\.current/,
		/data: current\.status === "ready" \? current\.data : null/,
		/loading: activeLoad\.current !== null/,
		/mounted: mounted\.current/,
		/stale: dashboardStale\.current/,
	]) assert.equal(expected.test(source), true, `Missing integration: ${expected}`);
	assert.ok((source.match(/dashboardLoadEpoch\.current \+= 1/g) ?? []).length >= 2);
});
