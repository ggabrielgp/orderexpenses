const RETURN_ORIGIN_ERROR = "Invalid OAuth return origin";

function forbidden(message) {
	const error = new Error(message);
	error.status = 403;
	throw error;
}

/** Only canonical HTTP(S) origins may be destinations, never arbitrary paths or credentials. */
export function normalizeOAuthReturnOrigin(value) {
	if (value === null || value === undefined) return null;
	let parsed;
	try {
		if (typeof value !== "string" || value.length > 2048) forbidden(RETURN_ORIGIN_ERROR);
		parsed = new URL(value);
	} catch {
		forbidden(RETURN_ORIGIN_ERROR);
	}
	if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
		value !== parsed.origin) forbidden(RETURN_ORIGIN_ERROR);

	const allowed = new Set();
	for (const configured of [process.env.APP_BASE_URL, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null]) {
		if (!configured) continue;
		try { allowed.add(new URL(configured).origin); } catch { /* Invalid configuration grants no origin. */ }
	}
	const mode = process.env.NODE_ENV;
	const localDevelopment = mode === "development" || mode === "test" ||
		(mode !== "production" && !process.env.APP_BASE_URL && !process.env.VERCEL_URL);
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
	if (!allowed.has(parsed.origin) && !(localDevelopment && loopback)) {
		forbidden("OAuth return origin is not allowed");
	}
	return parsed.origin;
}

/** Decode only an already-consumed exact state key; the persisted key binds this metadata. */
export function returnOriginFromOAuthState(state) {
	if (!state.includes(".return-v1.")) return null;
	const match = /^[a-f0-9]{64}\.return-v1\.([A-Za-z0-9_-]+)$/.exec(state);
	const origin = match ? Buffer.from(match[1], "base64url").toString("utf8") : null;
	if (!match || Buffer.from(origin).toString("base64url") !== match[1]) {
		const error = new Error("Invalid OAuth state");
		error.status = 400;
		throw error;
	}
	return normalizeOAuthReturnOrigin(origin);
}
