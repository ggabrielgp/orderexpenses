/** Persistence for the one-time "how to read the gauge" card shown after the first cycle setup. */

export const FIRST_RESULT_SEEN_KEY = "gc:first-result-seen";

/** The subset of `Storage` this helper needs, so tests can pass a fake. */
export interface FirstResultStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** True once the card was dismissed. Unavailable storage (private mode) counts as not seen. */
export function hasSeenFirstResult(storage: FirstResultStorage | null | undefined): boolean {
	try {
		return storage?.getItem(FIRST_RESULT_SEEN_KEY) === "1";
	} catch {
		return false;
	}
}

/** Remembers the dismissal; a storage failure is ignored because the card is only a hint. */
export function markFirstResultSeen(storage: FirstResultStorage | null | undefined): void {
	try {
		storage?.setItem(FIRST_RESULT_SEEN_KEY, "1");
	} catch {
		// Private mode or a full quota: the card may reappear, which is harmless.
	}
}
