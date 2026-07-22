import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const tmpDir = mkdtempSync(resolve(tmpdir(), "orderexpenses-oauth-token-"));
process.env.TURSO_DATABASE_URL = `file:${resolve(tmpDir, "test.db")}`;
process.env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID = "test-active";
process.env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY = Buffer.alloc(32, 7).toString("base64url");

const db = await import("../src/db.js");
const { TOKEN_ENVELOPE_PREFIX } = await import("../src/oauth-token-crypto.js");
const { mergeOAuthTokens } = await import("../src/gmail.js");

await db.ensureDbInitialized();
db.configureOAuthTokenEncryption(process.env);

test("stores encrypted tokens and returns the logical token", async () => {
	const email = "encrypted@example.com";
	const token = { access_token: "access", refresh_token: "refresh" };
	await db.upsertGoogleToken(email, token);

	const raw = await rawToken(email);
	assert.ok(raw.startsWith(TOKEN_ENVELOPE_PREFIX));
	assert.doesNotMatch(raw, /access|refresh/);
	assert.deepEqual(await db.getGoogleToken(email), token);
});

test("reads legacy data without writing and migrates on normal persistence", async () => {
	const email = "legacy@example.com";
	const legacy = JSON.stringify({ access_token: "old-access", refresh_token: "old-refresh" });
	await writeRawToken(email, legacy);

	assert.deepEqual(await db.getGoogleToken(email), {
		access_token: "old-access",
		refresh_token: "old-refresh",
	});
	assert.equal(await rawToken(email), legacy);

	await db.upsertGoogleToken(email, { access_token: "new-access", refresh_token: "old-refresh" });
	assert.ok((await rawToken(email)).startsWith(TOKEN_ENVELOPE_PREFIX));
});

test("leaves unreadable token storage unchanged", async () => {
	const email = "broken@example.com";
	const broken = `${TOKEN_ENVELOPE_PREFIX}{"v":1}`;
	await writeRawToken(email, broken);

	await assert.rejects(() => db.getGoogleToken(email));
	assert.equal(await rawToken(email), broken);
});

test("profile persistence does not rewrite token storage", async () => {
	const email = "profile@example.com";
	const legacy = JSON.stringify({ refresh_token: "keep-me" });
	await writeRawToken(email, legacy);

	await db.upsertGoogleProfile(email, { email, name: "Person" });
	assert.equal(await rawToken(email), legacy);
});

test("server startup fails safely without encryption configuration", () => {
	const env = { ...process.env };
	delete env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID;
	delete env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY;
	delete env.OAUTH_TOKEN_ENCRYPTION_HISTORICAL_KEYS;
	const result = spawnSync(
		process.execPath,
		["--input-type=module", "--eval", "import('./src/server.js')"],
		{
			cwd: process.cwd(),
			env: {
				...env,
				VERCEL: "1",
				TURSO_DATABASE_URL: `file:${resolve(tmpDir, "startup.db")}`,
			},
			encoding: "utf8",
		},
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /OAuth token encryption configuration is invalid/);
	assert.doesNotMatch(result.stderr, /access_token|refresh_token/);
});

test("preserves an existing refresh token during merge", () => {
	assert.deepEqual(
		mergeOAuthTokens(
			{ access_token: "old", refresh_token: "keep" },
			{ access_token: "new" },
		),
		{ access_token: "new", refresh_token: "keep" },
	);
});

async function rawToken(email) {
	const result = await db.db.execute({
		sql: "SELECT token_json AS tokenJson FROM google_tokens WHERE user_email = ?",
		args: [email],
	});
	return result.rows[0]?.tokenJson ?? null;
}

async function writeRawToken(email, tokenJson) {
	await db.db.execute({
		sql: `INSERT INTO google_tokens (user_email, token_json)
		 VALUES (?, ?)
		 ON CONFLICT(user_email) DO UPDATE SET token_json = excluded.token_json`,
		args: [email, tokenJson],
	});
}
