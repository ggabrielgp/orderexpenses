import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import "./helpers/isolation.js";
import { configureGoogleFixtures, googleCalls } from "./helpers/fixtures.js";
import { request } from "./helpers/request.js";

const { listBancoChileEmails } = await import("../src/gmail.js");
const {
	ensureDbInitialized, upsertGoogleToken, upsertGoogleProfile, getGoogleToken,
	createSession, linkSessionToUser,
} = await import("../src/db.js");
const { default: handleRequest } = await import("../src/server.js");
const owner = "performance-fixture@example.com";
const period = { startDate: "2026-01-01", endDateExclusive: "2026-02-01" };
await ensureDbInitialized();
await upsertGoogleToken(owner, { access_token: "synthetic-performance-token" });
await upsertGoogleProfile(owner, { email: owner, name: "Synthetic performance fixture" });

function message(id) {
	return { data: {
		id, threadId: `thread-${id}`, internalDate: "1767225600000",
		payload: {
			headers: [{ name: "Subject", value: `Subject ${id}` }, { name: "From", value: "fixture@example.com" }],
			body: { data: Buffer.from(`Body ${id}`).toString("base64url") },
		},
	} };
}
function expectedEmail(id) {
	return { gmailId: id, threadId: `thread-${id}`, subject: `Subject ${id}`, from: "fixture@example.com", internalDate: "2026-01-01T00:00:00.000Z", body: `Body ${id}` };
}

// Controlled latency evidence only: this does not measure a real Google account.
test("full-message downloads use four bounded workers and preserve deduplicated input order", async (t) => {
	const ids = Array.from({ length: 24 }, (_, i) => `m${i}`);
	let active = 0;
	let peak = 0;
	configureGoogleFixtures({
		list: () => ({ data: { messages: [...ids.map((id) => ({ id })), { id: "m0" }, {}] } }),
		get: async ({ id }) => {
			active++;
			peak = Math.max(peak, active);
			try { await delay(10); return message(id); } finally { active--; }
		},
	});
	const start = performance.now();
	const result = await listBancoChileEmails(owner, { period });
	t.diagnostic(JSON.stringify({ fixture: "24 messages, 10ms simulated detail latency", elapsedMs: Math.round(performance.now() - start), peakInFlight: peak }));
	assert.deepEqual(result.emails, ids.map(expectedEmail));
	assert.equal(result.failedCount, 0);
	assert.equal(googleCalls.get.length, 24);
	assert.deepEqual(googleCalls.get.map(({ id }) => id), ids);
	assert.ok(googleCalls.get.every(({ userId, format }) => userId === "me" && format === "full"));
	assert.equal(active, 0);
	assert.equal(peak, 4);
});

test("out-of-order downloads still return the original order", async () => {
	configureGoogleFixtures({
		list: () => ({ data: { messages: [{ id: "slow" }, { id: "fast" }] } }),
		get: async ({ id }) => { await delay(id === "slow" ? 20 : 1); return message(id); },
	});
	assert.deepEqual((await listBancoChileEmails(owner, { period })).emails, [expectedEmail("slow"), expectedEmail("fast")]);
	assert.equal(googleCalls.get.length, 2);
});

test("selected-period reads exhaust pagination beyond 200 without duplicate downloads", async () => {
	const ids = Array.from({ length: 205 }, (_, i) => `p${i}`);
	configureGoogleFixtures({
		list: ({ pageToken }) => {
			const offset = Number(pageToken ?? 0);
			return { data: { messages: ids.slice(offset, offset + 100).map((id) => ({ id })), ...(offset + 100 < ids.length ? { nextPageToken: String(offset + 100) } : {}) } };
		},
		get: ({ id }) => message(id),
	});
	const result = await listBancoChileEmails(owner, { period });
	assert.deepEqual(result.emails, ids.map(expectedEmail));
	assert.equal(googleCalls.list.length, 6);
	assert.equal(googleCalls.get.length, 205);
	assert.ok(googleCalls.list.every(({ q }) => q.includes("after:2026/1/1") && q.includes("before:2026/2/1")));
});

test("monthly default cap and explicit selected-period limit retain their previous behavior", async () => {
	for (const [options, count] of [[{ month: "2026-01" }, 200], [{ period, limit: 3 }, 3]]) {
		configureGoogleFixtures({
			list: ({ maxResults, pageToken }) => {
				const offset = Number(pageToken ?? 0);
				return { data: { messages: Array.from({ length: maxResults }, (_, i) => ({ id: `limited-${offset + i}` })), nextPageToken: String(offset + maxResults) } };
			},
			get: ({ id }) => message(id),
		});
		const result = await listBancoChileEmails(owner, options);
		assert.equal(result.emails.length, count);
		assert.equal(googleCalls.get.length, count);
		assert.equal(googleCalls.list.length, count === 200 ? 4 : 2);
	}
});

test("a detail failure stops new dispatch, drains started work and preserves earliest input error", async () => {
	const controls = new Map();
	let active = 0;
	let notifyFirst;
	const firstStarted = new Promise((resolve) => { notifyFirst = resolve; });
	const before = await getGoogleToken(owner);
	configureGoogleFixtures({
		list: () => ({ data: { messages: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}` })) } }),
		get: ({ id }) => {
			active++;
			return new Promise((resolve, reject) => {
				controls.set(id, { resolve, reject });
				notifyFirst();
			}).finally(() => { active--; });
		},
	});
	const pending = listBancoChileEmails(owner, { period });
	// Coordinate fixture calls explicitly; correctness does not depend on elapsed wall time.
	await firstStarted;
	const first = new Error("earliest-input fixture failure");
	controls.get("m3")?.reject(new Error("later-input fixture failure"));
	controls.get("m0").reject(first);
	for (const [id, control] of controls) if (id !== "m0" && id !== "m3") control.resolve(message(id));
	await assert.rejects(pending, (error) => error === first);
	assert.equal(active, 0);
	assert.deepEqual(googleCalls.get.map(({ id }) => id), ["m0", "m1", "m2", "m3"]);
	assert.deepEqual(await getGoogleToken(owner), before);
});

test("timing stages remain isolated across concurrent request contexts", async () => {
	const { withServerTiming, measureTiming } = await import("../src/server-timing.js");
	const [first, second] = await Promise.all([
		withServerTiming(() => measureTiming("gmail-list", async () => { await delay(10); return "first"; })),
		withServerTiming(() => measureTiming("gmail-details", async () => "second")),
	]);
	assert.equal(first.result, "first");
	assert.equal(second.result, "second");
	assert.match(first.serverTiming, /^gmail-list;dur=\d+\.\d, transactions;dur=\d+\.\d$/);
	assert.match(second.serverTiming, /^gmail-details;dur=\d+\.\d, transactions;dur=\d+\.\d$/);
	assert.equal(await measureTiming("gmail-list", async () => 42), 42);
});

async function authenticatedRequest() {
	const id = randomUUID();
	await createSession(id, new Date(Date.now() + 3600_000).toISOString());
	await linkSessionToUser(id, owner);
	return request(handleRequest, `/api/transactions?startDate=${period.startDate}&endDateExclusive=${period.endDateExclusive}`, { sessionId: id });
}

test("transactions expose numeric timing headers without changing JSON or leaking identifiers", async () => {
	configureGoogleFixtures({ list: () => ({ data: { messages: [] } }) });
	const response = await authenticatedRequest();
	assert.equal(response.status, 200);
	assert.equal(response.body, JSON.stringify({ transactions: [], warning: null }));
	assert.match(response.headers["server-timing"], /^gmail-list;dur=\d+\.\d, gmail-details;dur=\d+\.\d, transactions;dur=\d+\.\d$/);
	assert.doesNotMatch(response.headers["server-timing"], /@|synthetic|token|Body|Subject/);
	assert.equal(response.headers["cache-control"], "no-store");
	assert.equal(googleCalls.get.length, 0);
});

test("failed Gmail detail reads retain manual-only fallback and report timing without claiming success", async () => {
	configureGoogleFixtures({
		list: () => ({ data: { messages: [{ id: "failed" }] } }),
		get: new Error("fixture Gmail failure"),
	});
	const response = await authenticatedRequest();
	assert.equal(response.status, 200);
	assert.equal(response.body, JSON.stringify({ transactions: [], warning: "No se pudo leer Gmail; se muestran solo movimientos manuales." }));
	assert.match(response.headers["server-timing"], /gmail-details;dur=\d+\.\d/);
	assert.equal(googleCalls.get.length, 1);
});
