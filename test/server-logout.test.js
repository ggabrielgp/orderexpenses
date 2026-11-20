import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/isolation.js";
import { request as handlerRequest } from "./helpers/request.js";

const { default: handleRequest } = await import("../src/server.js");
const { createSession, ensureDbInitialized, getSession, linkSessionToUser } =
	await import("../src/db.js");

const request = (pathname, sessionId) => handlerRequest(handleRequest, pathname, { sessionId });

test("GET /auth/logout clears the session user and redirects to the unauthenticated app route", async () => {
	await ensureDbInitialized();

	const sessionId = randomUUID();
	await createSession(sessionId, new Date(Date.now() + 86_400_000).toISOString());
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

test("GET /api/auth/logout (the Vercel /auth/* rewrite destination) clears only the requesting session user", async () => {
	await ensureDbInitialized();

	const sessionId = randomUUID();
	const otherSessionId = randomUUID();
	const deadline = new Date(Date.now() + 86_400_000).toISOString();
	await createSession(sessionId, deadline);
	await createSession(otherSessionId, deadline);
	await linkSessionToUser(sessionId, "owner@example.com");
	await linkSessionToUser(otherSessionId, "owner@example.com");

	const response = await request("/api/auth/logout", sessionId);

	assert.equal(response.status, 302);
	assert.equal(response.headers.location, "/app");
	assert.equal(response.body, "");
	assert.equal((await getSession(sessionId)).userEmail, null);
	assert.equal((await getSession(otherSessionId)).userEmail, "owner@example.com");
});

test("private JSON responses prohibit HTTP caching, including session and financial data", async () => {
	await ensureDbInitialized();
	const sessionId = randomUUID();
	await createSession(sessionId, new Date(Date.now() + 86_400_000).toISOString());
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
	const routeStart = source.indexOf('isAuthPath(url.pathname, "/logout")');
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
