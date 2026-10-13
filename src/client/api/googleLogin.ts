/**
 * Carries the browser's origin to the server-owned OAuth entry point. The server validates and
 * binds it to OAuth state; neither proxy Host headers nor a fixed development port are trusted.
 * SSR and callers without browser location keep the existing URL unchanged.
 */
export function getGoogleLoginUrl(
	connectUrl = "/auth/google",
	origin = globalThis.location?.origin,
): string {
	if (!origin) return connectUrl;
	try {
		const target = new URL(connectUrl, origin);
		if (target.origin !== origin || !["/auth/google", "/api/auth/google"].includes(target.pathname)) {
			return connectUrl;
		}
		target.searchParams.set("returnOrigin", origin);
		return `${target.pathname}${target.search}${target.hash}`;
	} catch {
		return connectUrl;
	}
}
