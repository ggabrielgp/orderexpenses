import {
	createCipheriv,
	createDecipheriv,
	randomBytes as nativeRandomBytes,
} from "node:crypto";

export const TOKEN_ENVELOPE_PREFIX = "oe.oauth-token:v1:";
const RESERVED_PREFIX = "oe.oauth-token:";
const VERSION = 1;
const PURPOSE = "google-oauth-token";
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const SAFE_MESSAGES = {
	TOKEN_CONFIG_INVALID: "OAuth token encryption configuration is invalid",
	TOKEN_ENVELOPE_MALFORMED: "OAuth token envelope is malformed",
	TOKEN_ENVELOPE_UNSUPPORTED_VERSION: "OAuth token envelope version is unsupported",
	TOKEN_KEY_NOT_FOUND: "OAuth token encryption key is unavailable",
	TOKEN_AUTH_FAILED: "OAuth token authentication failed",
	TOKEN_PAYLOAD_MALFORMED: "OAuth token payload is malformed",
	TOKEN_LEGACY_MALFORMED: "Legacy OAuth token payload is malformed",
};

export class OAuthTokenStorageError extends Error {
	constructor(code) {
		super(SAFE_MESSAGES[code] ?? "OAuth token storage failed");
		this.name = "OAuthTokenStorageError";
		this.code = code;
	}
}

export function createTokenKeyring(env = process.env) {
	try {
		const activeKeyId = validateKeyId(
			env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
		);
		const activeKey = decodeKey(env.OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY);
		const historicalSource = parseHistoricalKeys(
			env.OAUTH_TOKEN_ENCRYPTION_HISTORICAL_KEYS,
		);
		const historicalKeys = new Map();
		for (const [keyId, encodedKey] of Object.entries(historicalSource)) {
			const validKeyId = validateKeyId(keyId);
			if (validKeyId === activeKeyId || historicalKeys.has(validKeyId)) {
				throw new Error("duplicate key id");
			}
			historicalKeys.set(validKeyId, decodeKey(encodedKey));
		}
		return Object.freeze({ activeKeyId, activeKey, historicalKeys });
	} catch {
		throw new OAuthTokenStorageError("TOKEN_CONFIG_INVALID");
	}
}

export function encryptOAuthToken({
	token,
	userEmail,
	keyring,
	randomBytes = nativeRandomBytes,
}) {
	assertTokenObject(token, "TOKEN_PAYLOAD_MALFORMED");
	const nonce = randomBytes(12);
	if (!Buffer.isBuffer(nonce) || nonce.length !== 12) {
		throw new OAuthTokenStorageError("TOKEN_CONFIG_INVALID");
	}
	const cipher = createCipheriv("aes-256-gcm", keyring.activeKey, nonce, {
		authTagLength: 16,
	});
	cipher.setAAD(createAad(userEmail));
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(token), "utf8"),
		cipher.final(),
	]);
	const envelope = {
		v: VERSION,
		kid: keyring.activeKeyId,
		n: nonce.toString("base64url"),
		ct: ciphertext.toString("base64url"),
		tag: cipher.getAuthTag().toString("base64url"),
	};
	return TOKEN_ENVELOPE_PREFIX + JSON.stringify(envelope);
}

export function decryptOAuthToken({ tokenJson, userEmail, keyring }) {
	if (typeof tokenJson !== "string") {
		throw new OAuthTokenStorageError("TOKEN_LEGACY_MALFORMED");
	}
	if (!tokenJson.startsWith(TOKEN_ENVELOPE_PREFIX)) {
		if (tokenJson.startsWith(RESERVED_PREFIX)) {
			throw new OAuthTokenStorageError(
				"TOKEN_ENVELOPE_UNSUPPORTED_VERSION",
			);
		}
		return {
			token: parseTokenObject(tokenJson, "TOKEN_LEGACY_MALFORMED"),
			storageFormat: "legacy",
			shouldRewriteOnNextPersistence: true,
		};
	}

	const envelope = parseEnvelope(tokenJson.slice(TOKEN_ENVELOPE_PREFIX.length));
	const key =
		envelope.kid === keyring.activeKeyId
			? keyring.activeKey
			: keyring.historicalKeys.get(envelope.kid);
	if (!key) throw new OAuthTokenStorageError("TOKEN_KEY_NOT_FOUND");

	let plaintext;
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			decodeCanonical(envelope.n, 12),
			{ authTagLength: 16 },
		);
		decipher.setAAD(createAad(userEmail));
		decipher.setAuthTag(decodeCanonical(envelope.tag, 16));
		plaintext = Buffer.concat([
			decipher.update(decodeCanonical(envelope.ct)),
			decipher.final(),
		]).toString("utf8");
	} catch (error) {
		if (error instanceof OAuthTokenStorageError) throw error;
		throw new OAuthTokenStorageError("TOKEN_AUTH_FAILED");
	}

	const active = envelope.kid === keyring.activeKeyId;
	return {
		token: parseTokenObject(plaintext, "TOKEN_PAYLOAD_MALFORMED"),
		storageFormat: active ? "active-envelope" : "historical-envelope",
		shouldRewriteOnNextPersistence: !active,
	};
}

function parseEnvelope(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new OAuthTokenStorageError("TOKEN_ENVELOPE_MALFORMED");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new OAuthTokenStorageError("TOKEN_ENVELOPE_MALFORMED");
	}
	const canonical = {
		v: parsed.v,
		kid: parsed.kid,
		n: parsed.n,
		ct: parsed.ct,
		tag: parsed.tag,
	};
	if (
		raw !== JSON.stringify(canonical) ||
		parsed.v !== VERSION ||
		!KEY_ID_PATTERN.test(parsed.kid) ||
		typeof parsed.n !== "string" ||
		typeof parsed.ct !== "string" ||
		typeof parsed.tag !== "string"
	) {
		throw new OAuthTokenStorageError("TOKEN_ENVELOPE_MALFORMED");
	}
	decodeCanonical(parsed.n, 12);
	decodeCanonical(parsed.ct, null, true);
	decodeCanonical(parsed.tag, 16);
	return canonical;
}

function parseHistoricalKeys(value) {
	if (value === undefined || value === "") return {};
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("invalid historical keys");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("invalid historical keys");
	}
	return parsed;
}

function parseTokenObject(value, code) {
	let token;
	try {
		token = JSON.parse(value);
	} catch {
		throw new OAuthTokenStorageError(code);
	}
	assertTokenObject(token, code);
	return token;
}

function assertTokenObject(token, code) {
	if (!token || typeof token !== "object" || Array.isArray(token)) {
		throw new OAuthTokenStorageError(code);
	}
}

function validateKeyId(value) {
	if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
		throw new Error("invalid key id");
	}
	return value;
}

function decodeKey(value) {
	return decodeCanonical(value, 32);
}

function decodeCanonical(value, expectedLength = null, requireNonEmpty = false) {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new OAuthTokenStorageError("TOKEN_ENVELOPE_MALFORMED");
	}
	const decoded = Buffer.from(value, "base64url");
	if (
		decoded.toString("base64url") !== value ||
		(expectedLength !== null && decoded.length !== expectedLength) ||
		(requireNonEmpty && decoded.length === 0)
	) {
		throw new OAuthTokenStorageError("TOKEN_ENVELOPE_MALFORMED");
	}
	return decoded;
}

function createAad(userEmail) {
	return Buffer.from(
		JSON.stringify(["orderexpenses", PURPOSE, VERSION, String(userEmail)]),
		"utf8",
	);
}
