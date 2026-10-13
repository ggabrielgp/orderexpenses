import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import "./helpers/isolation.js";
import { configureGoogleFixtures, googleCalls } from "./helpers/fixtures.js";
import { request } from "./helpers/request.js";

const { default: handleRequest } = await import("../src/server.js");
const {
	db, ensureDbInitialized, createSession, getSession, touchSession,
	saveOAuthState, upsertGoogleToken, upsertGoogleProfile,
} = await import("../src/db.js");
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const iso = (time) => new Date(time).toISOString();

async function atTime(t, now, run) {
	t.mock.method(Date, "now", () => now);
	try { return await run(); } finally { t.mock.restoreAll(); }
}
async function seedSession(expiresAt, email = null) {
	await ensureDbInitialized();
	const id = randomUUID();
	// Raw inserts intentionally exercise invalid legacy records too.
	await db.execute({ sql: "INSERT INTO sessions (session_id, user_email, expires_at) VALUES (?, ?, ?)", args: [id, email, expiresAt] });
	return id;
}
function cookie(response) {
	const value = String(response.headers["set-cookie"]);
	return { value, id: decodeURIComponent(value.match(/^finance_session=([^;]+)/)[1]), maxAge: Number(value.match(/Max-Age=(\d+)/)[1]) };
}

for (const [label, offset, active] of [["just before", -1, true], ["exactly at", 0, false], ["after", 1, false]]) {
	test(`session lookup is ${active ? "active" : "rejected"} ${label} its persisted deadline`, async (t) => {
		const id = await seedSession(iso(NOW), "boundary@example.com");
		await atTime(t, NOW + offset, async () => {
			const session = await getSession(id);
			assert.equal(session?.userEmail ?? null, active ? "boundary@example.com" : null);
			if (!active) assert.equal(session, null);
		});
	});
}

test("missing, malformed and nonfinite legacy deadlines never return an active identity", async (t) => {
	await atTime(t, NOW, async () => {
		for (const expiry of [null, "", "not-a-date", "NaN", "Infinity", "123", "2030-02-30T00:00:00.000Z", "2030-01-01", "2030-01-01T01:00:00", "2030-01-01T24:00:00Z", "+999999-01-01T00:00:00.000Z"]) {
			const id = await seedSession(expiry, "legacy@example.com");
			assert.equal(await getSession(id), null, String(expiry));
		}
		assert.equal(await getSession(randomUUID()), null);
	});
});

test("touch and session reuse preserve the original absolute deadline", async (t) => {
	await atTime(t, NOW, async () => {
		const original = iso(NOW + 90_500);
		const id = await seedSession(original);
		await db.execute({ sql: "UPDATE sessions SET updated_at = ? WHERE session_id = ?", args: ["2000-01-01", id] });
		assert.equal((await touchSession(id)).expiresAt, original);
		assert.notEqual((await getSession(id)).updatedAt, "2000-01-01");
		assert.equal((await createSession(id, iso(NOW + 30 * 86400_000))).expiresAt, original);
		const response = await request(handleRequest, "/api/session/profile", { sessionId: id });
		assert.equal(response.status, 200);
		assert.equal(cookie(response).id, id);
		assert.equal(cookie(response).maxAge, 90);
		assert.equal((await getSession(id)).expiresAt, original);
	});
});

test("cookie refresh shrinks remaining validity without losing security attributes", async (t) => {
	const id = await seedSession(iso(NOW + 90_500));
	for (const elapsed of [0, 30_000, 90_499]) {
		await atTime(t, NOW + elapsed, async () => {
			const response = await request(handleRequest, "/api/session/profile", { sessionId: id });
			const current = cookie(response);
			assert.equal(current.id, id);
			assert.ok(current.maxAge * 1000 <= 90_500 - elapsed);
			assert.match(current.value, /Path=\/; HttpOnly; SameSite=Lax;/);
		});
	}
	const previous = process.env.COOKIE_SECURE;
	process.env.COOKIE_SECURE = "true";
	try {
		await atTime(t, NOW, async () => {
			assert.match(cookie(await request(handleRequest, "/api/session/profile", { sessionId: id })).value, /; Secure$/);
		});
	} finally { process.env.COOKIE_SECURE = previous; }
	const previousMode = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	try {
		await atTime(t, NOW, async () => {
			assert.match(cookie(await request(handleRequest, "/api/session/profile", { sessionId: id })).value, /; Secure$/);
		});
	} finally { process.env.NODE_ENV = previousMode; }
});

test("stale cookies become new anonymous sessions, preserving all account data and another active user", async (t) => {
	await atTime(t, NOW, async () => {
		const owner = "expired-owner@example.com";
		const other = "active-owner@example.com";
		const activeId = await seedSession(iso(NOW + 600_000), other);
		const ownerActiveId = await seedSession(iso(NOW + 600_000), owner);
		await saveOAuthState(`owner-active-${ownerActiveId}`, ownerActiveId);
		for (const email of [owner, other]) {
			await upsertGoogleToken(email, { refresh_token: `synthetic-${email}` });
			await upsertGoogleProfile(email, { email, name: "Synthetic account" });
			await db.execute({ sql: "INSERT INTO manual_movements (movement_key, user_email, source_id, amount) VALUES (?, ?, ?, ?)", args: [email, email, email, 100] });
			await db.execute({ sql: "INSERT INTO categories (user_email, name, color) VALUES (?, ?, ?)", args: [email, "Synthetic", "#123456"] });
			await db.execute({ sql: "INSERT INTO counterparty_category_rules (user_email, counterparty_key, display_name, category) VALUES (?, ?, ?, ?)", args: [email, "synthetic", "Synthetic", "Synthetic"] });
			await db.execute({ sql: "INSERT INTO movement_overrides (user_email, movement_key) VALUES (?, ?)", args: [email, email] });
			await db.execute({ sql: "INSERT INTO financial_preferences (user_email, selected_start_date, selected_end_date_exclusive) VALUES (?, ?, ?)", args: [email, "2030-01-01", "2030-02-01"] });
			await db.execute({ sql: "INSERT INTO financial_periods (user_email, start_date, end_date_exclusive, income_amount) VALUES (?, ?, ?, ?)", args: [email, "2030-01-01", "2030-02-01", 1000] });
		}
		const tables = ["google_tokens", "manual_movements", "categories", "counterparty_category_rules", "movement_overrides", "financial_preferences", "financial_periods"];
		const snapshots = await Promise.all(tables.map(async (table) => (await db.execute(`SELECT * FROM ${table} ORDER BY user_email`)).rows));
		await saveOAuthState("active-state", activeId);
		for (const expiry of [iso(NOW - 1), iso(NOW), null, "broken"]) {
			const staleId = await seedSession(expiry, owner);
			// Deliberately persisted legacy work must bypass strict public state creation.
			await db.execute({ sql: "INSERT INTO oauth_states (state, session_id, created_at) VALUES (?, ?, ?)", args: [`stale-${staleId}`, staleId, NOW] });
			const response = await request(handleRequest, "/api/session/profile", { sessionId: staleId });
			assert.equal(response.status, 200);
			assert.equal(JSON.parse(response.body).authenticated, false);
			assert.equal(JSON.parse(response.body).profile, null);
			assert.equal(JSON.parse(response.body).gmail.connected, false);
			const fresh = cookie(response);
			assert.notEqual(fresh.id, staleId);
			assert.equal((await getSession(fresh.id)).userEmail, null);
			assert.equal(await getSession(staleId), null);
			assert.equal((await db.execute({ sql: "SELECT * FROM sessions WHERE session_id = ?", args: [staleId] })).rows.length, 0);
			assert.equal((await db.execute({ sql: "SELECT * FROM oauth_states WHERE session_id = ?", args: [staleId] })).rows.length, 0);
		}
		assert.deepEqual(await Promise.all(tables.map(async (table) => (await db.execute(`SELECT * FROM ${table} ORDER BY user_email`)).rows)), snapshots);
		assert.equal((await getSession(activeId)).userEmail, other);
		assert.equal((await getSession(ownerActiveId)).userEmail, owner);
		assert.equal((await db.execute({ sql: "SELECT * FROM oauth_states WHERE session_id = ?", args: [ownerActiveId] })).rows.length, 1);
		assert.equal((await db.execute("SELECT * FROM oauth_states WHERE state = 'active-state'")).rows.length, 1);
		const activeResponse = await request(handleRequest, "/api/session/profile", { sessionId: activeId });
		assert.equal(JSON.parse(activeResponse.body).profile.email, other);
	});
});

test("the existing OAuth callback cookie uses the target session's remaining persisted lifetime", async (t) => {
	await atTime(t, NOW, async () => {
		const id = await seedSession(iso(NOW + 65_500));
		await saveOAuthState("callback-lifetime", id, NOW);
		configureGoogleFixtures({ exchange: { tokens: { access_token: "synthetic" } }, profile: { data: { email: "callback@example.com" } } });
		const response = await request(handleRequest, "/auth/google/callback?code=synthetic&state=callback-lifetime", { sessionId: id });
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, "/app?gmail=connected");
		assert.equal(googleCalls.exchange.length, 1);
		assert.equal(cookie(response).id, id);
		assert.equal(cookie(response).maxAge, 65);
		assert.equal((await getSession(id)).expiresAt, iso(NOW + 65_500));
	});
});

test("explicit timezone offsets and valid leap days have precise absolute boundaries", async (t) => {
	for (const deadline of ["2030-01-01T03:00:00+03:00", "2028-02-29T23:00:00-01:00"]) {
		const id = await seedSession(deadline);
		await atTime(t, Date.parse(deadline) - 1, async () => assert.equal((await getSession(id)).expiresAt, deadline));
		await atTime(t, Date.parse(deadline), async () => assert.equal(await getSession(id), null));
	}
});

test("lookup cleans orphan OAuth states without touching other sessions' states", async (t) => {
	await atTime(t, NOW, async () => {
		const orphanId = randomUUID();
		const activeId = await seedSession(iso(NOW + 60_000));
		await db.execute({ sql: "INSERT INTO oauth_states (state, session_id, created_at) VALUES (?, ?, ?)", args: [`orphan-${orphanId}`, orphanId, NOW] });
		await saveOAuthState(`kept-${activeId}`, activeId);
		assert.equal(await getSession(orphanId), null);
		assert.equal((await db.execute({ sql: "SELECT * FROM oauth_states WHERE session_id = ?", args: [orphanId] })).rows.length, 0);
		assert.equal((await db.execute({ sql: "SELECT * FROM oauth_states WHERE session_id = ?", args: [activeId] })).rows.length, 1);
	});
});

test("orphan cleanup preserves a concurrent session insertion and its pending state", async (t) => {
	await atTime(t, NOW, async () => {
		const id = randomUUID();
		await db.execute({ sql: "INSERT INTO oauth_states (state, session_id, created_at) VALUES (?, ?, ?)", args: [`orphan-replaced-${id}`, id, NOW] });
		const execute = db.execute.bind(db);
		let inserted = false;
		t.mock.method(db, "execute", async (statement) => {
			if (!inserted && statement.sql?.startsWith("DELETE FROM oauth_states") && statement.args[0] === id) {
				inserted = true;
				await execute({ sql: "INSERT INTO sessions (session_id, expires_at) VALUES (?, ?)", args: [id, iso(NOW + 60_000)] });
			}
			return execute(statement);
		});
		assert.equal(await getSession(id), null);
		assert.equal(inserted, true);
		assert.equal((await getSession(id)).expiresAt, iso(NOW + 60_000));
		assert.equal((await db.execute({ sql: "SELECT * FROM oauth_states WHERE session_id = ?", args: [id] })).rows.length, 1);
	});
});

test("lazy cleanup preserves a concurrently replaced deadline and its pending states", async (t) => {
	await atTime(t, NOW, async () => {
		const id = await seedSession(iso(NOW), "replaced@example.com");
		await db.execute({ sql: "INSERT INTO oauth_states (state, session_id, created_at) VALUES (?, ?, ?)", args: [`replaced-${id}`, id, NOW] });
		const batch = db.batch.bind(db);
		let replaced = false;
		t.mock.method(db, "batch", async (statements, mode) => {
			if (!replaced && statements.some((statement) => statement.sql.startsWith("DELETE FROM sessions"))) {
				replaced = true;
				await db.execute({ sql: "UPDATE sessions SET expires_at = ? WHERE session_id = ?", args: [iso(NOW + 60_000), id] });
			}
			return batch(statements, mode);
		});
		assert.equal(await getSession(id), null, "the stale observation is never returned as active");
		assert.equal(replaced, true);
		assert.equal((await getSession(id)).userEmail, "replaced@example.com");
		assert.equal((await db.execute({ sql: "SELECT * FROM oauth_states WHERE session_id = ?", args: [id] })).rows.length, 1);
	});
});

test("expiry crossing between lookup and touch creates a fresh anonymous identity", async (t) => {
	await ensureDbInitialized();
	const id = await seedSession(iso(NOW + 1), "crossing@example.com");
	await upsertGoogleProfile("crossing@example.com", { email: "crossing@example.com" });
	await saveOAuthState(`crossing-${id}`, id);
	let now = NOW;
	let crossed = false;
	const execute = db.execute.bind(db);
	t.mock.method(Date, "now", () => now);
	t.mock.method(db, "execute", async (statement) => {
		if (statement.sql?.startsWith("UPDATE sessions SET updated_at") && statement.args[0] === id) {
			now = NOW + 1;
			crossed = true;
		}
		return execute(statement);
	});
	try {
		const response = await request(handleRequest, "/api/session/profile", { sessionId: id });
		assert.equal(crossed, true);
		assert.equal(response.status, 200);
		assert.equal(JSON.parse(response.body).authenticated, false);
		assert.notEqual(cookie(response).id, id);
		assert.equal((await getSession(cookie(response).id)).userEmail, null);
		assert.equal((await db.execute({ sql: "SELECT * FROM oauth_states WHERE session_id = ?", args: [id] })).rows.length, 0);
	} finally { t.mock.restoreAll(); }
});

test("a session expiring after touch but before cookie refresh is not reused", async (t) => {
	const id = await seedSession(iso(NOW + 1), "cookie-crossing@example.com");
	await upsertGoogleProfile("cookie-crossing@example.com", { email: "cookie-crossing@example.com" });
	let checks = 0;
	t.mock.method(Date, "now", () => ++checks < 3 ? NOW : NOW + 1);
	try {
		const response = await request(handleRequest, "/api/session/profile", { sessionId: id });
		assert.equal(response.status, 200);
		assert.equal(JSON.parse(response.body).authenticated, false);
		assert.notEqual(cookie(response).id, id);
	} finally { t.mock.restoreAll(); }
});

test("callback completion cannot refresh an identity that expired during the exchange", async (t) => {
	const id = await seedSession(iso(NOW + 10));
	await saveOAuthState(`callback-crossing-${id}`, id, NOW);
	let now = NOW;
	t.mock.method(Date, "now", () => now);
	configureGoogleFixtures({
		exchange: () => { now = NOW + 10; return { tokens: { access_token: "synthetic" } }; },
		profile: { data: { email: "callback-crossing@example.com" } },
	});
	try {
		const response = await request(handleRequest, `/auth/google/callback?code=synthetic&state=callback-crossing-${id}`, { sessionId: id });
		assert.equal(response.status, 401);
		assert.equal(response.headers.location, undefined);
		assert.equal(cookie(response).maxAge, 0, "only the initial subsecond cookie was set");
		assert.equal(await getSession(id), null);
	} finally { t.mock.restoreAll(); }
});

function configProbe(ttl) {
	return spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "./test/helpers/isolation.js", "--input-type=module", "--eval", `
		import assert from 'node:assert/strict';
		import { request } from './test/helpers/request.js';
		${ttl === undefined ? "delete process.env.SESSION_TTL_DAYS;" : `process.env.SESSION_TTL_DAYS = ${JSON.stringify(ttl)};`}
		Date.now = () => ${NOW};
		const { default: handler } = await import('./src/server.js');
		const response = await request(handler, '/api/session/profile');
		assert.equal(response.status, 200, response.body);
		const cookie = response.headers['set-cookie'];
		const id = decodeURIComponent(cookie.match(/^finance_session=([^;]+)/)[1]);
		const { getSession } = await import('./src/db.js');
		const session = await getSession(id);
		assert.equal(Date.parse(session.expiresAt) - Date.now(), ${new Date(NOW + Number(ttl ?? 30) * 86400_000).getTime() - NOW});
		assert.ok(Number(cookie.match(/Max-Age=(\\d+)/)[1]) * 1000 <= Date.parse(session.expiresAt) - Date.now());
	`], { cwd: new URL("../", import.meta.url), env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: "C.UTF-8", TZ: "UTC" }, encoding: "utf8", timeout: 10_000 });
}

test("absent TTL defaults to 30 days; positive fractional and large representable lifetimes remain valid", async (t) => {
	for (const ttl of [undefined, "0.5", " 0.5 ", "0.00000002", "1e6", "1000000", "99978084"]) {
		await t.test(String(ttl), () => {
			const result = configProbe(ttl);
			assert.equal(result.status, 0, result.stderr || result.stdout);
		});
	}
});

test("invalid or unrepresentable TTL fails at module configuration with an actionable error", async (t) => {
	for (const ttl of ["", " ", "broken", "30days", "0x10", "NaN", "Infinity", "-Infinity", "0", "-1", "1e309", "1e20", "1e-20", "99978086", "100000000"]) {
		await t.test(JSON.stringify(ttl), () => {
			const result = configProbe(ttl);
			assert.notEqual(result.status, 0, ttl);
			assert.match(result.stderr, /Invalid SESSION_TTL_DAYS.*finite positive.*representable future deadline/, ttl);
		});
	}
});
