import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import "./helpers/isolation.js";

const repo = await import("../src/db.js");
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const iso = (time) => new Date(time).toISOString();
const deadline = iso(NOW + 60_000);
const freshDeadline = iso(NOW + 30 * 86_400_000);

async function setup(t, email = null) {
	t.mock.method(Date, "now", () => NOW);
	await repo.ensureDbInitialized();
	const sessionId = randomUUID();
	await repo.createSession(sessionId, deadline);
	if (email) await repo.linkSessionToUser(sessionId, email);
	return sessionId;
}
async function pending(sessionId, createdAt = NOW) {
	const state = randomUUID();
	await repo.saveOAuthState(state, sessionId, createdAt);
	return state;
}
async function claimed(sessionId) {
	return repo.claimOAuthState(await pending(sessionId), sessionId);
}
function target(email = `${randomUUID()}@example.com`, sessionId = randomUUID()) {
	return { sessionId, expiresAt: freshDeadline, profile: { email, name: "Synthetic target" }, tokens: { access_token: "synthetic-access" } };
}
async function account(email) {
	return {
		token: await repo.getGoogleToken(email), profile: await repo.getGoogleProfile(email),
		movements: await repo.listManualMovements(email, "2030-01"),
		categories: await repo.listUserCategories(email), rules: await repo.listCounterpartyCategoryRules(email),
		overrides: await repo.getOverrides(email), cycle: await repo.getFinancialCycleSettings(email),
		period: await repo.getFinancialCyclePeriod(email, { startDate: "2030-01-01", endDateExclusive: "2030-02-01" }),
	};
}
async function seedAccount(email) {
	await repo.upsertGoogleToken(email, { refresh_token: "synthetic-refresh", access_token: "synthetic-old" });
	await repo.upsertGoogleProfile(email, { email, name: "Synthetic stored profile" });
	await repo.insertManualMovement({ occurredAt: "2030-01-05T00:00:00.000Z", amount: 100, counterparty: "Synthetic", description: "Synthetic", category: "Synthetic" }, email);
	await repo.upsertUserCategory(email, { name: "Synthetic", color: "#123456" });
	await repo.upsertCounterpartyCategoryRule(email, { counterpartyKey: "synthetic", displayName: "Synthetic", category: "Synthetic" });
	await repo.upsertMovementOverride(email, "synthetic-movement", { category: "Synthetic" });
	await repo.upsertFinancialCycleSettings(email, { selectedPeriod: { startDate: "2030-01-01", endDateExclusive: "2030-02-01" }, incomeAmount: 1000 });
}

for (const kind of ["missing", "expired", "invalid", "rotated"]) {
	test(`state creation rejects a ${kind} session without resurrecting its ID`, async (t) => {
		const oldId = await setup(t);
		let id = oldId;
		if (kind === "missing") id = randomUUID();
		if (kind === "expired" || kind === "invalid") {
			id = randomUUID();
			await repo.createSession(id, kind === "expired" ? iso(NOW) : "broken");
		}
		if (kind === "rotated") await repo.completeOAuthAuthentication(await claimed(id), target());
		const state = randomUUID();
		assert.equal(await repo.saveOAuthState(state, id, NOW), null);
		assert.equal(await repo.consumeOAuthState(state), null);
		assert.equal(await repo.getSession(id), null);
	});
}

test("valid state creation retains the original session deadline and legacy consumption shape", async (t) => {
	const id = await setup(t);
	const state = await pending(id);
	assert.deepEqual(await repo.consumeOAuthState(state), { state, sessionId: id, createdAt: NOW });
	assert.equal(await repo.consumeOAuthState(state), null);
	assert.equal((await repo.getSession(id)).expiresAt, deadline);
	assert.equal((await repo.touchSession(id)).expiresAt, deadline);
	assert.equal((await repo.createSession(id, freshDeadline)).expiresAt, deadline);
});

test("public state creation rejects reserved keys and invalid timestamps", async (t) => {
	const id = await setup(t);
	for (const state of ["", null, "\u0000oauth:claim:synthetic", "\u0000oauth:complete:synthetic"]) {
		assert.equal(await repo.saveOAuthState(state, id, NOW), null);
	}
	for (const createdAt of [NaN, Infinity, -1, "2030"]) {
		const state = randomUUID();
		assert.equal(await repo.saveOAuthState(state, id, createdAt), null);
		assert.equal(await repo.consumeOAuthState(state), null);
	}
});

test("explicit future-clock state timestamps remain unclaimable before their creation time", async (t) => {
	const id = await setup(t);
	const state = await pending(id, NOW + 1);
	assert.equal(await repo.claimOAuthState(state, id), null);
	t.mock.method(Date, "now", () => NOW + 1);
	assert.ok(await repo.claimOAuthState(state, id));
});

test("saving an existing public state cannot rebind it to another browser", async (t) => {
	const owner = await setup(t);
	const other = await setup(t);
	const state = await pending(owner);
	assert.equal(await repo.saveOAuthState(state, other, NOW), null);
	assert.equal((await repo.claimOAuthState(state, owner)).sessionId, owner);
});

for (const kind of ["missing state", "missing browser", "mismatched browser", "missing session", "expired session", "expired state", "future state", "replayed state", "private state"]) {
	test(`browser-bound claim rejects ${kind} without affecting stored identities`, async (t) => {
		const id = await setup(t);
		const other = await setup(t, "synthetic-other@example.com");
		const state = await pending(id, kind === "expired state" ? NOW - 600_000 : NOW);
		const before = await repo.getSession(other);
		let receivedState = state;
		let browser = id;
		if (kind === "missing state") receivedState = randomUUID();
		if (kind === "missing browser") browser = null;
		if (kind === "mismatched browser") browser = other;
		if (kind === "missing session") await repo.deleteSession(id);
		if (kind === "expired session") t.mock.method(Date, "now", () => NOW + 60_000);
		if (kind === "future state") t.mock.method(Date, "now", () => NOW - 1);
		if (kind === "replayed state" || kind === "private state") {
			const claim = await repo.claimOAuthState(state, id);
			if (kind === "private state") receivedState = `\u0000oauth:claim:${claim.claimId}`;
		}
		assert.equal(await repo.claimOAuthState(receivedState, browser), null);
		t.mock.method(Date, "now", () => NOW);
		assert.deepEqual(await repo.getSession(other), before);
		if (["missing state", "missing browser", "mismatched browser", "future state"].includes(kind)) {
			assert.ok(await repo.claimOAuthState(state, id), "rejection must not consume another browser's usable state");
		}
	});
}

test("atomic claims and legacy consumes each admit exactly one concurrent consumer", async (t) => {
	const id = await setup(t);
	let state = await pending(id);
	const claims = await Promise.all(Array.from({ length: 8 }, () => repo.claimOAuthState(state, id)));
	assert.equal(claims.filter(Boolean).length, 1);
	assert.equal(await repo.consumeOAuthState(state), null);
	assert.equal(await repo.consumeOAuthState(`\u0000oauth:claim:${claims.find(Boolean).claimId}`), null);
	state = await pending(id);
	const consumes = await Promise.all(Array.from({ length: 8 }, () => repo.consumeOAuthState(state)));
	assert.equal(consumes.filter(Boolean).length, 1);
});

test("state claim remains valid just before the maximum state age", async (t) => {
	const id = await setup(t);
	assert.ok(await repo.claimOAuthState(await pending(id, NOW - 599_999), id));
});

test("authentication completes atomically into a fresh ID and preserves other sessions and all finance records", async (t) => {
	const owner = `${randomUUID()}@example.com`;
	const input = target();
	const id = await setup(t, owner);
	await seedAccount(owner);
	await seedAccount(input.profile.email);
	const ownerBefore = await account(owner);
	const targetBefore = await account(input.profile.email);
	const sameAccountSession = await setup(t, owner);
	const targetSession = await setup(t, input.profile.email);
	const retainedState = await pending(sameAccountSession);
	const competing = await claimed(id);
	const claim = await claimed(id);
	const pendingState = await pending(id);
	const fresh = await repo.completeOAuthAuthentication(claim, input);
	assert.equal(fresh.sessionId, input.sessionId);
	assert.equal(fresh.userEmail, input.profile.email);
	assert.equal(fresh.expiresAt, freshDeadline);
	assert.equal(await repo.getSession(id), null);
	assert.equal(await repo.consumeOAuthState(pendingState), null);
	assert.equal(await repo.completeOAuthAuthentication(competing, target()), null);
	assert.equal(await repo.completeOAuthAuthentication(claim, target()), null);
	assert.equal((await repo.getSession(sameAccountSession)).userEmail, owner);
	assert.equal((await repo.getSession(targetSession)).userEmail, input.profile.email);
	assert.ok(await repo.claimOAuthState(retainedState, sameAccountSession));
	assert.deepEqual(await account(owner), ownerBefore);
	const after = await account(input.profile.email);
	assert.deepEqual(after.token, { refresh_token: "synthetic-refresh", access_token: "synthetic-access" });
	assert.deepEqual(after.profile, input.profile);
	assert.deepEqual({ ...after, token: targetBefore.token, profile: targetBefore.profile }, targetBefore);
	assert.equal((await repo.touchSession(input.sessionId)).expiresAt, freshDeadline);
});

for (const action of ["anonymous logout", "logout", "link", "same-user link", "ABA", "delete", "expiry", "state expiry", "cancel", "other completion"]) {
	test(`${action} invalidates pending claims and cannot persist target credentials`, async (t) => {
		const owner = `${randomUUID()}@example.com`;
		const id = await setup(t, action === "anonymous logout" ? null : owner);
		const input = target();
		await seedAccount(input.profile.email);
		const before = await account(input.profile.email);
		const claim = await claimed(id);
		const state = await pending(id);
		if (["anonymous logout", "logout"].includes(action)) await repo.clearSessionUser(id);
		if (action === "link") await repo.linkSessionToUser(id, "synthetic-new@example.com");
		if (action === "same-user link") await repo.linkSessionToUser(id, owner);
		if (action === "ABA") {
			await repo.linkSessionToUser(id, "synthetic-new@example.com");
			await repo.linkSessionToUser(id, owner);
		}
		if (action === "delete") await repo.deleteSession(id);
		if (action === "expiry") t.mock.method(Date, "now", () => NOW + 60_000);
		if (action === "state expiry") {
			// A separate longer-lived session proves the claim's own deadline, not session expiry.
			t.mock.method(Date, "now", () => NOW - 599_999);
			const agedId = randomUUID();
			await repo.createSession(agedId, freshDeadline);
			const agedClaim = await repo.claimOAuthState(await pending(agedId, NOW - 599_999), agedId);
			t.mock.method(Date, "now", () => NOW + 1);
			assert.equal(await repo.completeOAuthAuthentication(agedClaim, input), null);
			assert.deepEqual(await account(input.profile.email), before);
			assert.equal(await repo.getSession(input.sessionId), null);
			return;
		}
		if (action === "cancel") {
			assert.equal(await repo.cancelOAuthClaim(claim), true);
			assert.equal(await repo.cancelOAuthClaim(claim), false);
		}
		if (action === "other completion") assert.ok(await repo.completeOAuthAuthentication(await claimed(id), target()));
		const sourceBefore = await repo.getSession(id);
		assert.equal(await repo.completeOAuthAuthentication(claim, input), null);
		assert.deepEqual(await account(input.profile.email), before);
		assert.equal(await repo.getSession(input.sessionId), null);
		assert.deepEqual(await repo.getSession(id), sourceBefore);
		if (action !== "cancel") assert.equal(await repo.claimOAuthState(state, id), null);
		else assert.ok(await repo.claimOAuthState(state, id), "cancellation is scoped to the failed exchange");
	});
}

test("completion requires the claim's matching browser and rejects fresh-ID collisions without any changes", async (t) => {
	const id = await setup(t);
	const other = await setup(t, "synthetic-collision@example.com");
	const claim = await claimed(id);
	const input = target();
	const original = await repo.getSession(id);
	const existing = await repo.getSession(other);
	assert.equal(await repo.completeOAuthAuthentication({ ...claim, sessionId: other }, input), null);
	assert.equal(await repo.completeOAuthAuthentication(claim, { ...input, sessionId: id }), null);
	assert.equal(await repo.completeOAuthAuthentication(claim, { ...input, sessionId: other }), null);
	assert.deepEqual(await repo.getSession(id), original);
	assert.deepEqual(await repo.getSession(other), existing);
	assert.equal(await repo.getGoogleToken(input.profile.email), null);
	assert.equal(await repo.getGoogleProfile(input.profile.email), null);
	assert.ok(await repo.completeOAuthAuthentication(claim, input), "a collision does not consume a valid claim");
});

test("invalid completion input fails before identity writes and leaves the claim usable", async (t) => {
	const id = await setup(t);
	const claim = await claimed(id);
	const input = target();
	for (const expiresAt of [null, "broken", iso(NOW), iso(NOW - 1)]) {
		await assert.rejects(repo.completeOAuthAuthentication(claim, { ...input, expiresAt }), /future.*deadline/i);
	}
	await assert.rejects(repo.completeOAuthAuthentication(claim, { ...input, profile: { email: "" } }), /profile.*email/i);
	await assert.rejects(repo.completeOAuthAuthentication(claim, { ...input, tokens: null }), /tokens/i);
	assert.equal(await repo.getGoogleToken(input.profile.email), null);
	assert.equal(await repo.getGoogleProfile(input.profile.email), null);
	assert.equal(await repo.getSession(input.sessionId), null);
	assert.ok(await repo.completeOAuthAuthentication(claim, input));
});

test("a zero-row completion gate cannot allow later batch mutations after anonymous cancellation", async (t) => {
	const id = await setup(t);
	const claim = await claimed(id);
	const input = target();
	await seedAccount(input.profile.email);
	const before = await account(input.profile.email);
	const batch = repo.db.batch.bind(repo.db);
	let injected = false;
	t.mock.method(repo.db, "batch", async (statements, mode) => {
		if (!injected) {
			injected = true;
			await repo.clearSessionUser(id);
		}
		return batch(statements, mode);
	});
	assert.equal(await repo.completeOAuthAuthentication(claim, input), null);
	assert.equal(injected, true);
	assert.deepEqual(await account(input.profile.email), before);
	assert.equal(await repo.getSession(input.sessionId), null);
	assert.equal((await repo.getSession(id)).userEmail, null);
});

test("a late SQL failure rolls back target writes, rotation and claim consumption", async (t) => {
	const id = await setup(t);
	const claim = await claimed(id);
	const input = target();
	await seedAccount(input.profile.email);
	const before = await account(input.profile.email);
	const sessionBefore = await repo.getSession(id);
	const state = await pending(id);
	const batch = repo.db.batch.bind(repo.db);
	let injected = false;
	t.mock.method(repo.db, "batch", async (statements, mode) => {
		assert.equal(mode, "write");
		injected = true;
		// Controlled memory-only fault: reuse the old primary key after the token
		// and fresh-session statements. No private-table assertions are needed.
		const fail = { sql: "INSERT INTO sessions (session_id, expires_at) VALUES (?, ?)", args: [input.sessionId, freshDeadline] };
		return batch([...statements, fail], mode);
	});
	await assert.rejects(repo.completeOAuthAuthentication(claim, input), /UNIQUE|PRIMARY KEY/i);
	assert.equal(injected, true);
	t.mock.restoreAll();
	t.mock.method(Date, "now", () => NOW);
	assert.deepEqual(await account(input.profile.email), before);
	assert.deepEqual(await repo.getSession(id), sessionBefore);
	assert.equal(await repo.getSession(input.sessionId), null);
	assert.ok(await repo.claimOAuthState(state, id));
	assert.ok(await repo.completeOAuthAuthentication(claim, input), "rollback restores the original claim");
});

test("parallel completions have one winner and never write the losing target", async (t) => {
	const id = await setup(t);
	const first = target();
	const second = target();
	const claims = [await claimed(id), await claimed(id)];
	const results = await Promise.all(claims.map((claim, index) => repo.completeOAuthAuthentication(claim, [first, second][index])));
	assert.equal(results.filter(Boolean).length, 1);
	const loser = results[0] ? second : first;
	assert.equal(await repo.getGoogleToken(loser.profile.email), null);
	assert.equal(await repo.getGoogleProfile(loser.profile.email), null);
	assert.equal(await repo.getSession(loser.sessionId), null);
	assert.equal(await repo.getSession(id), null);
});

test("deletion cancels work even when the same session ID is deliberately recreated", async (t) => {
	const id = await setup(t);
	const claim = await claimed(id);
	const state = await pending(id);
	const input = target();
	await repo.deleteSession(id);
	await repo.createSession(id, freshDeadline);
	const before = await repo.getSession(id);
	assert.equal(await repo.completeOAuthAuthentication(claim, input), null);
	assert.equal(await repo.claimOAuthState(state, id), null);
	assert.deepEqual(await repo.getSession(id), before);
	assert.equal(await repo.getGoogleToken(input.profile.email), null);
	assert.equal(await repo.getGoogleProfile(input.profile.email), null);
	assert.equal(await repo.getSession(input.sessionId), null);
});

test("delayed state creation cannot attach work to a session rotated after lookup", async (t) => {
	const id = await setup(t);
	const claim = await claimed(id);
	const state = randomUUID();
	const input = target();
	const execute = repo.db.execute.bind(repo.db);
	let injected = false;
	t.mock.method(repo.db, "execute", async (statement) => {
		if (!injected && statement.sql?.startsWith("INSERT INTO oauth_states")) {
			injected = true;
			assert.ok(await repo.completeOAuthAuthentication(claim, input));
		}
		return execute(statement);
	});
	assert.equal(await repo.saveOAuthState(state, id, NOW), null);
	assert.equal(injected, true);
	assert.equal(await repo.consumeOAuthState(state), null);
	assert.equal(await repo.getSession(id), null);
	assert.equal((await repo.getSession(input.sessionId)).userEmail, input.profile.email);
});

test("a claim loses a race to anonymous logout after session validation", async (t) => {
	const id = await setup(t);
	const state = await pending(id);
	const execute = repo.db.execute.bind(repo.db);
	let injected = false;
	t.mock.method(repo.db, "execute", async (statement) => {
		if (!injected && statement.sql?.startsWith("UPDATE oauth_states SET state")) {
			injected = true;
			await repo.clearSessionUser(id);
		}
		return execute(statement);
	});
	assert.equal(await repo.claimOAuthState(state, id), null);
	assert.equal(injected, true);
	assert.equal((await repo.getSession(id)).userEmail, null);
});

for (const action of ["ABA", "delete", "other completion", "collision"]) {
	test(`completion loses the ${action} race after validation with no target writes`, async (t) => {
		const owner = `${randomUUID()}@example.com`;
		const id = await setup(t, owner);
		const claim = await claimed(id);
		const competing = await claimed(id);
		const input = target();
		await seedAccount(input.profile.email);
		const before = await account(input.profile.email);
		const batch = repo.db.batch.bind(repo.db);
		let injected = false;
		let sourceAfterRace;
		let collided;
		t.mock.method(repo.db, "batch", async (statements, mode) => {
			if (!injected) {
				injected = true;
				if (action === "ABA") {
					await repo.linkSessionToUser(id, "synthetic-intermediate@example.com");
					await repo.linkSessionToUser(id, owner);
				}
				if (action === "delete") await repo.deleteSession(id);
				if (action === "other completion") assert.ok(await repo.completeOAuthAuthentication(competing, target()));
				if (action === "collision") collided = await repo.createSession(input.sessionId, deadline);
				sourceAfterRace = await repo.getSession(id);
			}
			return batch(statements, mode);
		});
		assert.equal(await repo.completeOAuthAuthentication(claim, input), null);
		assert.equal(injected, true);
		assert.deepEqual(await account(input.profile.email), before);
		assert.deepEqual(await repo.getSession(input.sessionId), collided ?? null);
		assert.deepEqual(await repo.getSession(id), sourceAfterRace);
	});
}

test("strict timezone deadlines and last-millisecond validity apply to claims too", async (t) => {
	await setup(t);
	const id = randomUUID();
	const expiresAt = "2030-01-01T03:00:00.001+03:00";
	await repo.createSession(id, expiresAt);
	const state = await pending(id);
	const claim = await repo.claimOAuthState(state, id);
	assert.ok(claim);
	const input = target();
	t.mock.method(Date, "now", () => NOW + 1);
	assert.equal(await repo.completeOAuthAuthentication(claim, input), null);
	assert.equal(await repo.getGoogleToken(input.profile.email), null);
	assert.equal(await repo.getGoogleProfile(input.profile.email), null);
	assert.equal(await repo.getSession(input.sessionId), null);
});

test("source expiry at actual batch execution rejects rotation without target writes", async (t) => {
	const owner = `${randomUUID()}@example.com`;
	const other = `${randomUUID()}@example.com`;
	await setup(t);
	await seedAccount(owner);
	await seedAccount(other);
	const ownerBefore = await account(owner);
	const otherBefore = await account(other);
	const otherId = await setup(t, other);
	const otherSessionBefore = await repo.getSession(otherId);
	const otherState = await pending(otherId);
	const id = randomUUID();
	const sourceDeadline = NOW + 1;
	await repo.createSession(id, iso(sourceDeadline));
	await repo.linkSessionToUser(id, owner);
	const claim = await claimed(id);
	assert.ok(claim, "claim is acquired while the source is active at N");
	const input = target();
	let now = NOW;
	t.mock.method(Date, "now", () => now);
	const batch = repo.db.batch.bind(repo.db);
	let injected = false;
	t.mock.method(repo.db, "batch", async (statements, mode) => {
		if (!injected) {
			injected = true;
			assert.equal(mode, "write");
			// The verifier's boundary: no advance until immediately before the
			// real client executes the already-built completion batch.
			now = sourceDeadline;
		}
		return batch(statements, mode);
	});
	const completion = await repo.completeOAuthAuthentication(claim, input);
	const observed = {
		completion,
		targetToken: await repo.getGoogleToken(input.profile.email),
		targetProfile: await repo.getGoogleProfile(input.profile.email),
		freshSession: await repo.getSession(input.sessionId),
	};
	// Clock diagnostics read only the isolated client's SQL clock, not tables.
	// Date.now mocks do not control SQLite's execution-time 'now' function.
	const sqlClock = await repo.db.execute("SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now");
	t.diagnostic(JSON.stringify({ javascriptNow: now, sourceDeadline, sqliteNow: Number(sqlClock.rows[0].now), observed }));
	assert.equal(injected, true);
	assert.equal(now, sourceDeadline);
	assert.deepEqual(await account(owner), ownerBefore);
	assert.deepEqual(await account(other), otherBefore);
	assert.deepEqual(await repo.getSession(otherId), otherSessionBefore);
	assert.ok(await repo.claimOAuthState(otherState, otherId));
	await repo.cancelOAuthClaim(claim);
	assert.equal(await repo.completeOAuthAuthentication(claim, target()), null, "cancelled work remains unable to complete");
	assert.deepEqual(observed, { completion: null, targetToken: null, targetProfile: null, freshSession: null });
});

test("legacy link, unlink and deletion retain return shapes, deadlines and unrelated account data", async (t) => {
	const email = `${randomUUID()}@example.com`;
	const id = await setup(t);
	await seedAccount(email);
	const before = await account(email);
	assert.equal((await repo.linkSessionToUser(id, email)).userEmail, email);
	assert.equal((await repo.clearSessionUser(id)).userEmail, null);
	assert.equal((await repo.getSession(id)).expiresAt, deadline);
	assert.equal(await repo.deleteSession(id), true);
	assert.equal(await repo.deleteSession(id), false);
	assert.equal(await repo.linkSessionToUser(id, email), null);
	assert.equal(await repo.clearSessionUser(id), null);
	assert.deepEqual(await account(email), before);
});

for (const kind of ["state creation source", "claim source", "claim age", "completion claim age", "completion fresh deadline"]) {
	test(`${kind} expiry at SQL dispatch rejects without identity writes`, async (t) => {
		const id = await setup(t);
		const input = target();
		await seedAccount(input.profile.email);
		const before = await account(input.profile.email);
		const shortSource = ["state creation source", "claim source"].includes(kind);
		let sourceId = id;
		if (shortSource) {
			sourceId = randomUUID();
			await repo.createSession(sourceId, iso(NOW + 1));
		}
		const oldState = ["claim age", "completion claim age"].includes(kind);
		const state = kind === "state creation source" ? randomUUID() : await pending(sourceId, oldState ? NOW - 599_999 : NOW);
		const claim = kind.startsWith("completion") ? await repo.claimOAuthState(state, sourceId) : null;
		if (claim) assert.equal(claim.sessionId, sourceId);
		if (kind === "completion fresh deadline") input.expiresAt = iso(NOW + 1);
		let now = NOW;
		t.mock.method(Date, "now", () => now);
		let dispatched = false;
		const execute = repo.db.execute.bind(repo.db);
		const batch = repo.db.batch.bind(repo.db);
		if (kind.startsWith("completion")) {
			t.mock.method(repo.db, "batch", async (statements, mode) => {
				if (!dispatched) { dispatched = true; now = NOW + 1; }
				return batch(statements, mode);
			});
		} else {
			t.mock.method(repo.db, "execute", async (statement, args) => {
				const prefix = kind === "state creation source" ? "INSERT INTO oauth_states" : "UPDATE oauth_states SET state";
				if (!dispatched && statement.sql?.startsWith(prefix)) { dispatched = true; now = NOW + 1; }
				return execute(statement, args);
			});
		}
		const result = kind === "state creation source"
			? await repo.saveOAuthState(state, sourceId, NOW)
			: kind.startsWith("completion") ? await repo.completeOAuthAuthentication(claim, input) : await repo.claimOAuthState(state, sourceId);
		assert.equal(dispatched, true);
		assert.equal(result, null);
		assert.deepEqual(await account(input.profile.email), before);
		assert.equal(await repo.getSession(input.sessionId), null);
		if (kind === "state creation source") assert.equal(await repo.consumeOAuthState(state), null);
		else if (!kind.startsWith("completion")) assert.deepEqual(await repo.consumeOAuthState(state), {
			state, sessionId: sourceId, createdAt: oldState ? NOW - 599_999 : NOW,
		}, "rejected claim does not consume public state");
		else {
			assert.equal(await repo.cancelOAuthClaim(claim), true, "rejected completion leaves its claim cancellable");
			assert.equal(await repo.completeOAuthAuthentication(claim, target()), null);
			assert.equal((await repo.getSession(sourceId)).expiresAt, deadline);
		}
	});
}

test("native SQL completion rejects elapsed source, claim and fresh deadlines despite a frozen application clock", async (t) => {
	const { createNativeClockMemoryClient } = await import("./helpers/isolation.js");
	const { setTimeout: delay } = await import("node:timers/promises");
	const native = createNativeClockMemoryClient();
	t.after(() => native.close());
	// Redirect only the exported repository client's public methods. The real
	// guarded native client executes production SQL unchanged, without the fixture.
	t.mock.method(repo.db, "execute", (statement, args) => native.execute(statement, args));
	t.mock.method(repo.db, "batch", (statements, mode) => native.batch(statements, mode));
	await repo.initDb();
	const owner = `${randomUUID()}@example.com`;
	await seedAccount(owner);
	const accountBefore = await account(owner);
	const clockSql = "CAST(ROUND(unixepoch('now', 'subsec') * 1000) AS INTEGER) /* oauth-clock-ms */";
	const base = Number((await native.execute(`SELECT ${clockSql} AS ms`)).rows[0].ms);
	t.mock.method(Date, "now", () => base);
	const retainedId = randomUUID();
	await repo.createSession(retainedId, iso(base + 60_000));
	await repo.linkSessionToUser(retainedId, owner);
	const retainedSession = await repo.getSession(retainedId);
	const cases = [];
	for (const kind of ["source", "claim", "fresh"]) {
		const id = randomUUID();
		await repo.createSession(id, iso(base + (kind === "source" ? 1000 : 60_000)));
		const state = randomUUID();
		await repo.saveOAuthState(state, id, kind === "claim" ? base - 599_000 : base);
		const claim = await repo.claimOAuthState(state, id);
		assert.ok(claim, "the claim starts valid before its native boundary");
		const input = target();
		input.expiresAt = iso(base + (kind === "fresh" ? 1000 : 60_000));
		cases.push({ kind, id, claim, input });
	}
	const delayedState = randomUUID();
	await delay(1300); // Generous bounded native-clock margin; never a 1ms sleep.
	assert.ok(Number((await native.execute(`SELECT ${clockSql} AS ms`)).rows[0].ms) >= base + 1000);
	for (const { kind, id, claim, input } of cases) {
		assert.equal(await repo.completeOAuthAuthentication(claim, input), null, kind);
		assert.equal(await repo.getGoogleToken(input.profile.email), null, kind);
		assert.equal(await repo.getGoogleProfile(input.profile.email), null, kind);
		assert.equal(await repo.getSession(input.sessionId), null, kind);
		assert.equal(await repo.cancelOAuthClaim(claim), true, `${kind} retains cancellation continuity`);
		assert.equal(await repo.completeOAuthAuthentication(claim, input), null, `${kind} cannot replay`);
		if (kind === "source") {
			assert.equal(await repo.saveOAuthState(delayedState, id, base), null);
			assert.equal(await repo.consumeOAuthState(delayedState), null);
		}
	}
	assert.deepEqual(await account(owner), accountBefore);
	assert.deepEqual(await repo.getSession(retainedId), retainedSession);
});
