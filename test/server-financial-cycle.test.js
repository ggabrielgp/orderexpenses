import assert from "node:assert/strict";
import test from "node:test";

process.env.VERCEL = "1";
process.env.TURSO_DATABASE_URL = "file:./data/finance.db";
const { createFinancialCycleApi, dispatchFinancialCycleRequest } = await import("../src/server.js");

function createApi({ connected = true, syncResult } = {}) {
	const records = new Map();
	return {
		api: createFinancialCycleApi({
			isConnected: async () => connected,
			syncPeriod: syncResult ?? (async () => ({ scanned: 0, transactions: [] })),
			read: async (email) => records.get(`${email}:selected`) ?? null,
			readPeriod: async (email, selectedPeriod) => records.get(`${email}:${selectedPeriod.startDate}`) ?? null,
			write: async (email, record) => {
				records.set(`${email}:${record.selectedPeriod.startDate}`, record);
				records.set(`${email}:selected`, record);
				return record;
			},
			complete: async (email, record) => {
				records.set(`${email}:${record.selectedPeriod.startDate}`, record);
				return record;
			},
		}),
		records,
	};
}

const period = { startDate: "2026-01-01", endDateExclusive: "2026-02-01" };
const user = { email: "owner@example.com" };

test("rejects malformed, impossible, reversed periods and invalid CLP income", async () => {
	const { api } = createApi();
	for (const [selectedPeriod, incomeAmount, field] of [
		[{ ...period, startDate: "2026-02-30" }, null, "startDate"],
		[{ ...period, startDate: "2026-02-01" }, null, "startDate"],
		[period, 1.5, "incomeAmount"],
		[period, -1, "incomeAmount"],
	]) {
		const response = await api({ method: "PUT", user, body: { selectedPeriod, incomeAmount } });
		assert.equal(response.status, 400);
		assert.equal(response.body.error.field, field);
	}
});

test("rejects anonymous access, cross-origin mutations, and unknown methods", async () => {
	const { api } = createApi();
	assert.equal((await api({ method: "GET", user: null })).status, 401);
	assert.equal((await api({ method: "PUT", user, sameOrigin: false, body: { selectedPeriod: period, incomeAmount: null } })).status, 403);
	assert.equal((await api({ method: "DELETE", user })).status, 405);
});

test("persists selected settings per user and range without cross-user access", async () => {
	const { api } = createApi();
	const saved = await api({ method: "PUT", user, body: { selectedPeriod: period, incomeAmount: 900000 } });
	assert.equal(saved.status, 200);
	assert.equal(saved.body.incomeAmount, 900000);
	assert.equal((await api({ method: "GET", user })).body.incomeAmount, 900000);
	assert.equal((await api({ method: "GET", user: { email: "other@example.com" } })).body.selectedPeriod, null);
});

test("completes empty synchronization and is idempotent across retries", async () => {
	const { api } = createApi();
	await api({ method: "PUT", user, body: { selectedPeriod: period, incomeAmount: null } });
	const first = await api({ method: "POST", user, body: { period } });
	const second = await api({ method: "POST", user, body: { period } });
	assert.equal(first.status, 200);
	assert.equal(first.body.transactions, 0);
	assert.ok(first.body.completedAt);
	assert.equal(second.status, 200);
	assert.equal(second.body.completedAt, first.body.completedAt);
});

test("keeps completion unset for partial, disconnected, and sync error outcomes", async () => {
	for (const [options, expectedStatus, expectedOutcome] of [
		[{ syncResult: async () => ({ outcome: "partial", scanned: 3, transactions: [1], failedCount: 1 }) }, 207, "partial"],
		[{ connected: false }, 409, "disconnected"],
		[{ syncResult: async () => { throw new Error("upstream"); } }, 502, "error"],
	]) {
		const { api } = createApi(options);
		await api({ method: "PUT", user, body: { selectedPeriod: period, incomeAmount: null } });
		const response = await api({ method: "POST", user, body: { period } });
		assert.equal(response.status, expectedStatus);
		assert.equal(response.body.outcome, expectedOutcome);
		assert.equal(response.body.completedAt, null);
		if (expectedStatus === 409) assert.deepEqual(response.body.action, { label: "Connect with Google", href: "/auth/google" });
	}
});

test("production financial-cycle dispatch rejects invalid path and method combinations before reading bodies", async () => {
	const bodyWasRead = () => {
		throw new Error("body must not be read");
	};
	for (const [pathname, method] of [
		["/api/financial-cycle", "POST"],
		["/api/financial-cycle/complete", "GET"],
		["/api/financial-cycle/complete", "PUT"],
	]) {
		const response = await dispatchFinancialCycleRequest({ pathname, method, user, readBody: bodyWasRead, api: async () => assert.fail("API must not run") });
		assert.equal(response.status, 405);
	}
	const rejectedOrigin = await dispatchFinancialCycleRequest({
		pathname: "/api/financial-cycle",
		method: "PUT",
		user,
		sameOrigin: false,
		readBody: bodyWasRead,
		api: async () => assert.fail("API must not run"),
	});
	assert.equal(rejectedOrigin.status, 403);
	for (const [pathname, method] of [["/api/financial-cycle", "GET"], ["/api/financial-cycle", "PUT"], ["/api/financial-cycle/complete", "POST"]]) {
		const response = await dispatchFinancialCycleRequest({ pathname, method, user, readBody: async () => ({}), api: async (input) => ({ status: 200, body: input }) });
		assert.equal(response.body.method, method);
	}
});

test("completion reads and writes exact period metadata without changing the selected period", async () => {
	const { api, records } = createApi();
	const otherPeriod = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const request = (pathname, method, body) => dispatchFinancialCycleRequest({ pathname, method, user, readBody: async () => body, api });
	await request("/api/financial-cycle", "PUT", { selectedPeriod: period, incomeAmount: 900000 });
	await request("/api/financial-cycle/complete", "POST", { period: otherPeriod });
	assert.equal(records.get(`${user.email}:${otherPeriod.startDate}`).incomeAmount, null);
	assert.ok(records.get(`${user.email}:${otherPeriod.startDate}`).completedAt);
	assert.deepEqual(records.get(`${user.email}:selected`).selectedPeriod, period);
	assert.equal(records.get(`${user.email}:selected`).incomeAmount, 900000);
});
