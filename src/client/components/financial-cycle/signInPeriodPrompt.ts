import { todayInSantiago } from "../analytics/dashboardPace";
import {
	createCycleEditDraft,
	validateCycleEditDraft,
	type CycleEditDraft,
	type CycleEditSubmitOutcome,
	type CycleEditSubmitter,
} from "./cycleSettings";
import type { FinancialCycleResponse } from "../../api/types";

/**
 * Confirm the period on every sign-in (S27). Pure decisions with injectable storage and date, so the
 * rules are provable without a DOM:
 *
 * - The server's OAuth return lands on `/app?gmail=connected` (`src/server.js`); that marker is the only
 *   signal of a fresh sign-in. It is removed from the URL once handled, so a reload never re-prompts.
 * - A configured period opens the edit-period dialog prefilled with the stored values; an unconfigured
 *   account keeps the first-cycle setup it always had.
 * - "No volver a preguntar hasta que termine este período" stores, per signed-in account, the period's
 *   last day in the browser. Later sign-ins skip the prompt through that day; after it the prompt
 *   returns and the key is cleared. Storage that fails behaves as "ask as normal".
 */

const MARKER_PARAM = "gmail";
const MARKER_VALUE = "connected";
const SKIP_KEY_PREFIX = "gc:skip-period-prompt:";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The subset of `Storage` the preference needs, so tests can pass a fake. */
export interface PeriodPromptStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export const hasSignInMarker = (search: string): boolean =>
	new URLSearchParams(search).get(MARKER_PARAM) === MARKER_VALUE;

/** The query without the marker, in `?a=1` form (or empty); every other parameter is kept. */
export function removeSignInMarker(search: string): string {
	const params = new URLSearchParams(search);
	if (params.get(MARKER_PARAM) !== MARKER_VALUE) return search;
	params.delete(MARKER_PARAM);
	const rest = params.toString();
	return rest ? `?${rest}` : "";
}

export interface SignInWindow {
	location: { pathname: string; search: string; hash: string };
	history?: { state: unknown; replaceState: (state: unknown, unused: string, url: string) => void };
}

/** Removes the marker from the address bar without navigating. True when the URL was rewritten. */
export function clearSignInMarker(win: SignInWindow): boolean {
	if (!hasSignInMarker(win.location.search) || !win.history) return false;
	const { pathname, search, hash } = win.location;
	win.history.replaceState(win.history.state, "", `${pathname}${removeSignInMarker(search)}${hash}`);
	return true;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const skipPeriodPromptKey = (email: string): string => `${SKIP_KEY_PREFIX}${normalizeEmail(email)}`;

/** Today's calendar day in Santiago as `YYYY-MM-DD`, comparable with the period's inclusive end date. */
export function todayIsoSantiago(now: Date): string {
	const { year, month, day } = todayInSantiago(now);
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Stores the period's last day for this account. False when nothing could or should be stored. */
export function rememberPeriodPromptSkip(
	storage: PeriodPromptStorage | null | undefined,
	email: string,
	periodEndDate: string,
): boolean {
	if (!storage || !normalizeEmail(email) || !ISO_DAY.test(periodEndDate)) return false;
	try {
		storage.setItem(skipPeriodPromptKey(email), periodEndDate);
		return true;
	} catch {
		return false;
	}
}

/**
 * True while today is on or before the stored period end. An expired or malformed value is cleared
 * (the prompt is due again); a storage failure is "not skipped".
 */
export function isPeriodPromptSkipped(
	storage: PeriodPromptStorage | null | undefined,
	email: string,
	today: string,
): boolean {
	if (!storage || !normalizeEmail(email)) return false;
	const key = skipPeriodPromptKey(email);
	try {
		const stored = storage.getItem(key);
		if (stored === null) return false;
		if (ISO_DAY.test(stored) && today <= stored) return true;
		storage.removeItem(key);
		return false;
	} catch {
		return false;
	}
}

export type SignInSummaryStatus = "loading" | "ready" | "unconfigured" | "failed";

export interface SignInPromptInput {
	search: string;
	status: SignInSummaryStatus;
	email: string;
	storage: PeriodPromptStorage | null | undefined;
	/** `YYYY-MM-DD`, see `todayIsoSantiago`. */
	today: string;
}

/**
 * `handled`: the marker has been dealt with (the caller removes it from the URL). `open`: the period
 * dialog should open. Without the marker, or while the summary has no outcome yet, nothing happens.
 */
export function decideSignInPrompt(input: SignInPromptInput): { handled: boolean; open: boolean } {
	if (!hasSignInMarker(input.search)) return { handled: false, open: false };
	if (input.status === "loading" || input.status === "failed") return { handled: false, open: false };
	if (input.status === "unconfigured") return { handled: true, open: false };
	return { handled: true, open: !isPeriodPromptSkipped(input.storage, input.email, input.today) };
}

export type SignInConfirmOutcome = CycleEditSubmitOutcome | { status: "unchanged" };

/**
 * "Continuar": saves exactly what the dialog shows through the edit-period submitter, so an emptied
 * income is the same `incomeAmount: null` payload as in the regular edit. When the draft equals the
 * stored period and income nothing is sent. An invalid draft is refused with the existing message.
 */
export async function confirmSignInPeriod({
	cycle,
	draft,
	submitCycle,
}: {
	cycle: FinancialCycleResponse | null;
	draft: CycleEditDraft;
	submitCycle: CycleEditSubmitter;
}): Promise<SignInConfirmOutcome> {
	const shown = validateCycleEditDraft(draft);
	if (!shown.ok) return { status: "failed", message: shown.message };
	const stored = validateCycleEditDraft(createCycleEditDraft(cycle));
	if (
		stored.ok &&
		shown.payload.selectedPeriod.startDate === stored.payload.selectedPeriod.startDate &&
		shown.payload.selectedPeriod.endDateExclusive === stored.payload.selectedPeriod.endDateExclusive &&
		shown.payload.incomeAmount === stored.payload.incomeAmount
	) {
		return { status: "unchanged" };
	}
	return submitCycle(draft);
}
