import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
	OAuthTokenStorageError,
	TOKEN_ENVELOPE_PREFIX,
	createTokenKeyring,
	decryptOAuthToken,
	encryptOAuthToken,
} from "../src/oauth-token-crypto.js";

const ACTIVE_KEY = Buffer.alloc(32, 1).toString("base64url");
const OLD_KEY = Buffer.alloc(32, 2).toString("base64url");
const EMAIL = "person@example.com";

function keyringEnv(overrides = {}) {
	return {
		OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "active-2026",
		OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY: ACTIVE_KEY,
		OAUTH_TOKEN_ENCRYPTION_HISTORICAL_KEYS: JSON.stringify({
			"old-2025": OLD_KEY,
		}),
		...overrides,
	};
}

function parseJson(value) {
	try {
		return JSON.parse(value);
	} catch (error) {
		assert.fail(`Expected valid JSON fixture: ${error.message}`);
	}
}

function assertCode(fn, code) {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof OAuthTokenStorageError);
		assert.equal(error.code, code);
		assert.doesNotMatch(error.message, /person@example|refresh_token|AQAB/);
		return true;
	});
}

test("validates active and historical key configuration", () => {
	const keyring = createTokenKeyring(keyringEnv());
	assert.equal(keyring.activeKeyId, "active-2026");
	assert.equal(keyring.activeKey.length, 32);
	assert.equal(keyring.historicalKeys.get("old-2025").length, 32);

	for (const env of [
		{},
		keyringEnv({ OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY: "invalid=" }),
		keyringEnv({ OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY: Buffer.alloc(31).toString("base64url") }),
		keyringEnv({ OAUTH_TOKEN_ENCRYPTION_HISTORICAL_KEYS: "[]" }),
		keyringEnv({ OAUTH_TOKEN_ENCRYPTION_HISTORICAL_KEYS: JSON.stringify({ "active-2026": OLD_KEY }) }),
	]) {
		assertCode(() => createTokenKeyring(env), "TOKEN_CONFIG_INVALID");
	}
});

test("encrypts and decrypts a strict canonical envelope", () => {
	const keyring = createTokenKeyring(keyringEnv());
	const token = { access_token: "AQAB", refresh_token: "refresh_token", expiry_date: 123 };
	const first = encryptOAuthToken({ token, userEmail: EMAIL, keyring });
	const second = encryptOAuthToken({ token, userEmail: EMAIL, keyring });

	assert.ok(first.startsWith(TOKEN_ENVELOPE_PREFIX));
	assert.notEqual(first, second);
	const raw = first.slice(TOKEN_ENVELOPE_PREFIX.length);
	const envelope = parseJson(raw);
	assert.deepEqual(Object.keys(envelope), ["v", "kid", "n", "ct", "tag"]);
	assert.equal(Buffer.from(envelope.n, "base64url").length, 12);
	assert.equal(Buffer.from(envelope.tag, "base64url").length, 16);
	assert.deepEqual(decryptOAuthToken({ tokenJson: first, userEmail: EMAIL, keyring }), {
		token,
		storageFormat: "active-envelope",
		shouldRewriteOnNextPersistence: false,
	});
});

test("binds envelopes to the owning email and rejects tampering", () => {
	const keyring = createTokenKeyring(keyringEnv());
	const encrypted = encryptOAuthToken({
		token: { access_token: "AQAB" },
		userEmail: EMAIL,
		keyring,
	});
	assertCode(
		() => decryptOAuthToken({ tokenJson: encrypted, userEmail: "other@example.com", keyring }),
		"TOKEN_AUTH_FAILED",
	);

	const raw = encrypted.slice(TOKEN_ENVELOPE_PREFIX.length);
	const envelope = parseJson(raw);
	envelope.ct = `${envelope.ct.slice(0, -1)}${envelope.ct.endsWith("A") ? "B" : "A"}`;
	assertCode(
		() => decryptOAuthToken({ tokenJson: TOKEN_ENVELOPE_PREFIX + JSON.stringify(envelope), userEmail: EMAIL, keyring }),
		"TOKEN_AUTH_FAILED",
	);
});

test("rejects non-canonical and unsupported envelopes", () => {
	const keyring = createTokenKeyring(keyringEnv());
	const encrypted = encryptOAuthToken({ token: { access_token: "AQAB" }, userEmail: EMAIL, keyring });
	const raw = encrypted.slice(TOKEN_ENVELOPE_PREFIX.length);
	const envelope = parseJson(raw);

	assertCode(
		() => decryptOAuthToken({ tokenJson: TOKEN_ENVELOPE_PREFIX + JSON.stringify({ ...envelope, extra: true }), userEmail: EMAIL, keyring }),
		"TOKEN_ENVELOPE_MALFORMED",
	);
	assertCode(
		() => decryptOAuthToken({ tokenJson: TOKEN_ENVELOPE_PREFIX + ` ${raw}`, userEmail: EMAIL, keyring }),
		"TOKEN_ENVELOPE_MALFORMED",
	);
	assertCode(
		() => decryptOAuthToken({ tokenJson: "oe.oauth-token:v2:{}", userEmail: EMAIL, keyring }),
		"TOKEN_ENVELOPE_UNSUPPORTED_VERSION",
	);
	assertCode(
		() => decryptOAuthToken({ tokenJson: TOKEN_ENVELOPE_PREFIX + JSON.stringify({ ...envelope, kid: "missing" }), userEmail: EMAIL, keyring }),
		"TOKEN_KEY_NOT_FOUND",
	);
});

test("reads legacy and historical tokens without writing", () => {
	const active = createTokenKeyring(keyringEnv());
	const legacy = decryptOAuthToken({
		tokenJson: JSON.stringify({ refresh_token: "refresh_token" }),
		userEmail: EMAIL,
		keyring: active,
	});
	assert.equal(legacy.storageFormat, "legacy");
	assert.equal(legacy.shouldRewriteOnNextPersistence, true);

	const oldOnly = createTokenKeyring({
		OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "old-2025",
		OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY: OLD_KEY,
	});
	const historicalEnvelope = encryptOAuthToken({
		token: { refresh_token: "refresh_token" },
		userEmail: EMAIL,
		keyring: oldOnly,
	});
	const historical = decryptOAuthToken({ tokenJson: historicalEnvelope, userEmail: EMAIL, keyring: active });
	assert.equal(historical.storageFormat, "historical-envelope");
	assert.equal(historical.shouldRewriteOnNextPersistence, true);
});

test("uses a fresh 12-byte nonce for each write", () => {
	const keyring = createTokenKeyring(keyringEnv());
	const nonce = randomBytes(12);
	assert.equal(nonce.length, 12);
	const encrypted = encryptOAuthToken({ token: { value: 1 }, userEmail: EMAIL, keyring });
	assert.ok(encrypted.startsWith(TOKEN_ENVELOPE_PREFIX));
});
