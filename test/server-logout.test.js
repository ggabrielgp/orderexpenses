import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The sign-out route is exercised against an isolated database, so the focused run never reads or
// mutates the developer's `data/finance.db`. `VERCEL=1` also keeps the module from binding a port.
process.env.VERCEL = "1";
process.env.TURSO_DATABASE_URL = `file:${join(
	tmpdir(),
	`gastos-controlados-logout-${randomUUID()}.db`,
)}`;

const { default: handleRequest } = await import("../src/server.js");
const { createSession, ensureDbInitialized, getSession, linkSessionToUser } =
	await import("../src/db.js");

function request(pathname, sessionId) {
	return new Promise((resolve, reject) => {
		const headers = { host: "localhost:3000" };
		if (sessionId) headers.cookie = `finance_session=${sessionId}`;

		const response = {
			headers: {},
			setHeader(name, value) {
				this.headers[name.toLowerCase()] = value;
			},
			writeHead(status, responseHeaders = {}) {
				this.status = status;
				Object.assign(this.headers, responseHeaders);
			},
			end(body = "") {
				resolve({
					status: this.status,
					headers: this.headers,
					body: String(body),
				});
			},
		};

		Promise.resolve(
			handleRequest({ url: pathname, method: "GET", headers }, response),
		).catch(reject);
	});
}

test("GET /auth/logout clears the session user and redirects to the unauthenticated app route", async () => {
	await ensureDbInitialized();

	const sessionId = randomUUID();
	await createSession(sessionId, null);
	await linkSessionToUser(sessionId, "owner@example.com");
	assert.equal((await getSession(sessionId)).userEmail, "owner@example.com");

	const response = await request("/auth/logout", sessionId);

	// A same-origin GET is enough: no client state is invented, and the browser lands on the
	// unauthenticated dashboard/login the app already serves at `/app`.
	assert.equal(response.status, 302);
	assert.equal(response.headers.location, "/app");
	assert.equal(response.body, "");

	// Only the user association is dropped; the session row and its cookie infrastructure survive.
	assert.equal((await getSession(sessionId)).userEmail, null);
	assert.match(
		String(response.headers["set-cookie"]),
		/^finance_session=[^;]+;.*HttpOnly/,
	);
});

test("private JSON responses prohibit HTTP caching, including session and financial data", async () => {
	await ensureDbInitialized();
	const sessionId = randomUUID();
	await createSession(sessionId, null);
	for (const path of ["/api/session/profile", "/api/transactions", "/api/income-candidates", "/api/gmail/status"]) {
		const response = await request(path, sessionId);
		assert.equal(response.status, 200, path);
		assert.equal(response.headers["cache-control"], "no-store", path);
		assert.match(response.headers["content-type"], /application\/json/, path);
	}
	const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
	assert.match(source, /function sendJson\(res, payload, status = 200\)[\s\S]*?"cache-control": "no-store"/);
});

test("the logout route reuses clearSessionUser without deleting finance data or Google credentials", async () => {
	const source = await readFile(
		new URL("../src/server.js", import.meta.url),
		"utf8",
	);
	const routeStart = source.indexOf('url.pathname === "/auth/logout"');
	assert.notEqual(routeStart, -1, "the logout route must be registered");
	const routeBlock = source.slice(routeStart, routeStart + 260);

	assert.match(routeBlock, /req\.method === "GET"/);
	assert.match(routeBlock, /clearSessionUser\(session\.sessionId\)/);
	assert.match(routeBlock, /location: "\/app"/);
	// The route never disconnects Google or destroys the session/data stores.
	assert.doesNotMatch(routeBlock, /disconnectGoogle|deleteSession|delete.*Credential/);

	// The existing Gmail disconnect and settings routes are untouched and still present.
	assert.match(source, /url\.pathname === "\/api\/gmail\/disconnect"/);
	assert.match(source, /disconnectGoogle\(session\.userEmail\)/);
	assert.match(source, /url\.pathname === "\/api\/categories" && req\.method === "PUT"/);
	assert.match(source, /url\.pathname === "\/api\/financial-cycle"/);
});
