import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = mkdtempSync(resolve(tmpdir(), "orderexpenses-session-test-"));
process.env.VERCEL = "1";
process.env.TURSO_DATABASE_URL = `file:${resolve(tmpDir, "test.db")}`;
process.env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID = "session-test";
process.env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY = Buffer.alloc(32, 9).toString("base64url");

const server = await import("../src/server.js");
const {
	default: handleRequest,
	classifySessionExpiry,
	getOrCreateSession,
	normalizeSessionTtlDays,
	sessionCookieMaxAge,
} = server;
const db = await import("../src/db.js");

const NOW = new Date("2026-01-31T12:00:00.000Z");

test("classifies only a finite future persisted expiry as valid", () => {
	assert.equal(
		classifySessionExpiry({ expiresAt: "2026-01-31T12:00:01.000Z" }, NOW),
		"valid",
	);
	assert.equal(
		classifySessionExpiry({ expiresAt: "2026-01-31T12:00:00.000Z" }, NOW),
		"expired",
	);
	assert.equal(
		classifySessionExpiry({ expiresAt: "2026-01-31T11:59:59.999Z" }, NOW),
		"expired",
	);
});

test("fails closed for missing or malformed persisted expiry", () => {
	for (const expiresAt of [
		null,
		undefined,
		"",
		"not-a-date",
		"Infinity",
		"2026-02-29T00:00:00.000Z",
		"2026-02-30T00:00:00.000Z",
	]) {
		assert.equal(
			classifySessionExpiry({ expiresAt }, NOW),
			"indeterminate",
			`expected ${String(expiresAt)} to fail closed`,
		);
	}
});

test("bounds cookie lifetime to the remaining persisted expiry", () => {
	assert.equal(sessionCookieMaxAge("2026-01-31T12:00:10.900Z", NOW), 10);
	assert.equal(sessionCookieMaxAge(NOW.toISOString(), NOW), 0);
	assert.equal(sessionCookieMaxAge("not-a-date", NOW), 0);
});

test("rejects invalid session TTL configuration", () => {
	assert.throws(
		() => normalizeSessionTtlDays("not-a-number"),
		/SESSION_TTL_DAYS must be a finite number/,
	);
	assert.throws(() => normalizeSessionTtlDays(Infinity), /finite number/);
	assert.throws(() => normalizeSessionTtlDays(1e308), /between 1 and 3650/);
	assert.throws(() => normalizeSessionTtlDays(0), /between 1 and 3650/);
	assert.throws(() => normalizeSessionTtlDays(3651), /between 1 and 3650/);
	assert.equal(normalizeSessionTtlDays(1), 1);
	assert.equal(normalizeSessionTtlDays(3650), 3650);
	assert.equal(normalizeSessionTtlDays("30"), 30);
});

test("reuses a valid session and bounds its HTTP cookie", async () => {
	await db.ensureDbInitialized();
	const now = new Date("2026-02-01T12:00:00.000Z");
	const expiresAt = "2026-02-01T12:00:10.900Z";
	await db.createSession(
		"session_valid_http",
		expiresAt,
		"2026-01-02T12:00:00.000Z",
	);
	const response = createResponseHeaders();

	const session = await getOrCreateSession(
		{ headers: { cookie: "finance_session=session_valid_http" } },
		response,
		now,
	);

	assert.equal(session.sessionId, "session_valid_http");
	assert.match(response.getHeader("Set-Cookie"), /Max-Age=10(?:;|$)/);
	assert.equal((await db.getSession(session.sessionId)).expiresAt, expiresAt);
});

test("replaces an expired HTTP session without retaining its identity", async () => {
	await db.ensureDbInitialized();
	const now = new Date("2026-02-01T12:00:00.000Z");
	await db.createSession(
		"session_expired_http",
		"2026-02-01T12:00:00.000Z",
		"2026-01-02T12:00:00.000Z",
	);
	await db.linkSessionToUser("session_expired_http", "old@example.com");
	const response = createResponseHeaders();

	const session = await getOrCreateSession(
		{ headers: { cookie: "finance_session=session_expired_http" } },
		response,
		now,
	);

	assert.notEqual(session.sessionId, "session_expired_http");
	assert.equal(session.userEmail, null);
	const cookies = response.getHeader("Set-Cookie");
	assert.ok(Array.isArray(cookies));
	assert.match(cookies[0], /finance_session=;.*Max-Age=0/);
	assert.doesNotMatch(cookies[1], /session_expired_http/);
});

test("rejects an expired session at the HTTP boundary", async () => {
	await db.ensureDbInitialized();
	await db.createSession(
		"session_expired_request",
		"2000-01-31T00:00:00.000Z",
		"2000-01-01T00:00:00.000Z",
	);
	await db.linkSessionToUser("session_expired_request", "old@example.com");
	const response = createResponseHeaders();

	await handleRequest(
		{
			method: "GET",
			url: "/api/categories",
			headers: {
				host: "127.0.0.1:3000",
				cookie: "finance_session=session_expired_request",
			},
		},
		response,
	);

	assert.equal(response.status, 401);
	assert.equal(response.body, '{"error":"Connect Gmail first"}');
	const cookies = response.getHeader("Set-Cookie");
	assert.ok(Array.isArray(cookies));
	assert.match(cookies[0], /finance_session=;.*Max-Age=0/);
	assert.doesNotMatch(cookies[1], /session_expired_request/);
});

test("rejects a malformed session expiry at the HTTP boundary", async () => {
	await db.ensureDbInitialized();
	await db.createSession(
		"session_malformed_request",
		"2026-02-30T00:00:00.000Z",
		"2026-01-01T00:00:00.000Z",
	);
	await db.linkSessionToUser("session_malformed_request", "old@example.com");
	const response = createResponseHeaders();

	await handleRequest(
		{
			method: "GET",
			url: "/api/categories",
			headers: {
				host: "127.0.0.1:3000",
				cookie: "finance_session=session_malformed_request",
			},
		},
		response,
	);

	assert.equal(response.status, 401);
	assert.equal(response.body, '{"error":"Connect Gmail first"}');
	const cookies = response.getHeader("Set-Cookie");
	assert.ok(Array.isArray(cookies));
	assert.match(cookies[0], /finance_session=;.*Max-Age=0/);
	assert.doesNotMatch(cookies[1], /session_malformed_request/);
});

test("persists an exact absolute expiry and never slides it on activity", async () => {
	await db.ensureDbInitialized();
	const sessionId = "session_absolute_expiry";
	const createdAt = "2026-01-01T12:00:00.000Z";
	const expiresAt = "2026-01-31T12:00:00.000Z";

	const created = await db.createSession(sessionId, expiresAt, createdAt);
	assert.equal(created.createdAt, createdAt);
	assert.equal(created.expiresAt, expiresAt);

	await db.touchSession(sessionId);
	const touched = await db.getSession(sessionId);
	assert.equal(touched.expiresAt, expiresAt);
});

function createResponseHeaders() {
	const headers = new Map();
	return {
		status: null,
		body: "",
		getHeader(name) {
			return headers.get(name);
		},
		setHeader(name, value) {
			headers.set(name, value);
		},
		writeHead(status, nextHeaders = {}) {
			this.status = status;
			for (const [name, value] of Object.entries(nextHeaders)) {
				headers.set(name, value);
			}
		},
		end(body = "") {
			this.body = body;
		},
	};
}
