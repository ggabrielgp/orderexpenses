import type { FinancialPeriod, GmailSyncResponse } from "../../api/types";
import {
	acquireInFlightLock,
	releaseInFlightLock,
	type InFlightLockRef,
} from "../movements/CreateManualExpenseDialog";

/**
 * Manual synchronization decisions for the Gmail card.
 *
 * A sync is a long, opaque request: the server performs up to 200 sequential Gmail fetches
 * (`src/gmail.js:153-171`) and exposes no progress signal at all, so nothing here produces a
 * percentage, an ETA, or a count of downloaded messages. The only facts this module reports are
 * the ones the settled response carries, plus the one honest extra step the card owes the user:
 * whether the financial dashboard could be refreshed afterwards.
 *
 * This repository's panel harness has no DOM, so the rules that keep the control honest — one
 * request in flight, an anonymous session that never syncs, and copy that matches what the server
 * actually confirmed — live in pure exported functions instead of inside the component.
 */

export type GmailSyncPhase = "idle" | "syncing" | "success" | "partial" | "failed";

export type GmailSyncState = {
	phase: GmailSyncPhase;
	/** Messages the server reported as scanned, or `null` when it reported no usable count. */
	scanned: number | null;
	/**
	 * Gmail queries the server could not complete, or `null` when the response did not carry a
	 * usable count. `null` is a fact of its own: it means the failure count was not confirmed, so
	 * it must never be rendered as zero.
	 */
	failedCount: number | null;
	/** True when the sync completed but the follow-up dashboard reload did not. */
	reloadFailed: boolean;
	/** Truthful failure copy; `null` unless the phase is `failed`. */
	errorMessage: string | null;
};

export type GmailSyncEvent =
	| { type: "start" }
	| { type: "settled"; outcome: GmailSyncSubmitOutcome };

export function createGmailSyncState(): GmailSyncState {
	return {
		phase: "idle",
		scanned: null,
		failedCount: null,
		reloadFailed: false,
		errorMessage: null,
	};
}

/**
 * The rule the control mirrors: a sync may start only while none is in flight.
 *
 * The rendered `disabled` attribute can be one tick stale after a same-tick double click, so the
 * submitter's synchronous lock — not this predicate — is what guarantees a single request.
 */
export function canStartGmailSync(state: GmailSyncState): boolean {
	return state.phase !== "syncing";
}

/** Anonymous sessions have no Gmail account to read, so no sync request may start. */
export function shouldSyncGmail(authenticated: boolean): boolean {
	return authenticated === true;
}

/**
 * The rule the control mirrors for being offered at all: the session may send the request, the
 * account it would read exists, and the dashboard published a request to send.
 *
 * `hasRequest` is the dashboard's answer to "is there a configured period?": the request always
 * carries the configured period because the server only reports per-query failures in period mode
 * (`src/movements.js:105-113`), so without one there is no result this card could describe
 * truthfully and no control to offer.
 */
export function canOfferGmailSync(availability: {
	authenticated: boolean;
	connected: boolean;
	hasRequest: boolean;
}): boolean {
	return (
		shouldSyncGmail(availability.authenticated) &&
		availability.connected === true &&
		availability.hasRequest === true
	);
}

/**
 * The in-flight copy. It states what is happening and why no number accompanies it: the server
 * exposes no progress, so an indeterminate state is the only honest one.
 */
export const GMAIL_SYNC_PENDING_MESSAGE =
	"Sincronizando con Gmail... La revisión puede tardar y no es posible mostrar un avance parcial.";

/**
 * Truthful failure copy. It names the failure and the consequence the user can observe — the
 * financial summary was not refreshed — and it never claims anything about movements, in either
 * direction: a request that did not settle proves no import either way.
 */
export const GMAIL_SYNC_FAILURE_MESSAGE =
	"No se pudo completar la sincronización con Gmail, así que el resumen financiero no se actualizó. Puedes reintentarlo.";

/**
 * Copy for a connected account with no request to send. It states the requirement instead of
 * claiming the cycle is missing: while the summary is still loading, or when its read failed, the
 * period is unknown rather than absent, and an unconfigured claim would be wrong in both cases.
 */
export const GMAIL_SYNC_UNAVAILABLE_MESSAGE =
	"Sincronizar con Gmail requiere tu periodo financiero configurado: la sincronización siempre usa ese periodo.";

function readCount(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export type GmailSyncResultReading = {
	status: "success" | "partial";
	scanned: number | null;
	/** Failed queries as the response reported them; `null` when it reported none to report. */
	failedCount: number | null;
};

/**
 * Reads what the settled response actually proves.
 *
 * Only `outcome: "success"` together with an explicit `failedCount: 0` proves that every query of
 * the range ran, and that shape only exists in period mode — the mode this client always asks for.
 * Everything else is reported as a partial import, including the month-mode shape that drops the
 * failure count entirely (`src/movements.js:112-113`): a reader that turned an unproven response
 * into a complete import would invent a verdict the server never gave.
 */
export function readGmailSyncResult(payload: GmailSyncResponse | undefined): GmailSyncResultReading {
	const response: Partial<GmailSyncResponse> = payload ?? {};
	const scanned = readCount(response.scanned);
	const failedCount = readCount(response.failedCount);
	// A contradictory response (a "success" that also reports failed queries) is read the
	// conservative way: the failure count wins over the word.
	const provenComplete = response.outcome === "success" && failedCount === 0;
	return {
		status: provenComplete ? "success" : "partial",
		scanned,
		failedCount: provenComplete ? 0 : failedCount,
	};
}

export type GmailSyncSource = (
	period: FinancialPeriod,
	signal?: AbortSignal,
) => Promise<GmailSyncResponse>;

/** Re-runs the cycle-first dashboard load; resolves `false` when the reload failed. */
export type GmailFinancialReload = () => Promise<boolean>;

export type GmailSyncSubmitOutcome =
	| { status: "success"; scanned: number | null; reloadFailed: boolean }
	| { status: "partial"; scanned: number | null; failedCount: number | null; reloadFailed: boolean }
	| { status: "failed"; message: string }
	/** No request left: another attempt already holds the single in-flight lock. */
	| { status: "busy" };

export type GmailSyncSubmitter = () => Promise<GmailSyncSubmitOutcome>;

export interface GmailSyncSubmitterDeps {
	/** POSTs the sync for the configured period; rejects when the server refuses it. */
	sync: GmailSyncSource;
	/** Re-runs the cycle-first dashboard load. Resolves `false` when the reload failed. */
	reload: GmailFinancialReload;
	/**
	 * The configured financial period, always sent. Period mode is the only mode that reports
	 * per-query failures, so a request without it could not be described truthfully.
	 */
	period: FinancialPeriod;
	/** The same single in-flight lock the movements slice uses. */
	lock: InFlightLockRef;
}

/**
 * Creates the request the manual sync control awaits.
 *
 * The lock is acquired synchronously, before the first `await`, so two clicks in the same tick can
 * never issue two requests: the second reports `busy` and changes nothing. The lock is released on
 * every settled attempt, so a failed sync stays retryable.
 *
 * A rejected request is a real failure and no reload follows it: nothing was confirmed, so a
 * reload would present the same list as if the sync had worked. A completed request always
 * resolves — a reload that failed (or threw) means the visible financial data may be stale, never
 * that the sync did not happen, so the request is never repeated for it.
 */
export function createGmailSyncSubmitter({
	sync,
	reload,
	period,
	lock,
}: GmailSyncSubmitterDeps): GmailSyncSubmitter {
	return async () => {
		if (!acquireInFlightLock(lock)) return { status: "busy" };
		try {
			let payload: GmailSyncResponse;
			try {
				payload = await sync(period);
			} catch {
				return { status: "failed", message: GMAIL_SYNC_FAILURE_MESSAGE };
			}
			const result = readGmailSyncResult(payload);
			let reloadFailed: boolean;
			try {
				reloadFailed = (await reload()) === false;
			} catch {
				reloadFailed = true;
			}
			return result.status === "success"
				? { status: "success", scanned: result.scanned, reloadFailed }
				: {
						status: "partial",
						scanned: result.scanned,
						failedCount: result.failedCount,
						reloadFailed,
					};
		} finally {
			releaseInFlightLock(lock);
		}
	};
}

/** Pure reducer for the sync lifecycle; illegal events return the identical state. */
export function reduceGmailSync(state: GmailSyncState, event: GmailSyncEvent): GmailSyncState {
	switch (event.type) {
		case "start":
			// An attempt already in flight owns the phase: a repeated start cannot announce a second
			// attempt while the first one has not settled. A settled result is replaced by the new
			// attempt, so the previous outcome never describes it.
			if (state.phase === "syncing") return state;
			return { ...createGmailSyncState(), phase: "syncing" };
		case "settled":
			// Only the attempt in flight can settle, and `busy` means no attempt of this control left
			// at all: that outcome is mapped to nothing, so it can never overwrite a real one.
			if (state.phase !== "syncing" || event.outcome.status === "busy") return state;
			if (event.outcome.status === "failed") {
				return {
					phase: "failed",
					scanned: null,
					failedCount: null,
					reloadFailed: false,
					errorMessage: normalizeSyncFailureMessage(event.outcome.message),
				};
			}
			if (event.outcome.status === "partial") {
				return {
					phase: "partial",
					scanned: event.outcome.scanned,
					failedCount: event.outcome.failedCount,
					reloadFailed: event.outcome.reloadFailed === true,
					errorMessage: null,
				};
			}
			return {
				phase: "success",
				scanned: event.outcome.scanned,
				failedCount: 0,
				reloadFailed: event.outcome.reloadFailed === true,
				errorMessage: null,
			};
	}
}

/**
 * The two sentences a settled result can end with. A completed request whose reload failed is a
 * stale summary, never a failed sync, and the movements convention reports it the same way.
 */
const GMAIL_SYNC_REFRESHED_SUFFIX =
	"El resumen financiero se actualizó con los movimientos detectados.";
const GMAIL_SYNC_STALE_SUFFIX =
	"El resumen financiero no se pudo actualizar y puede estar desactualizado. Actualiza la página para ver el estado real.";

function normalizeSyncFailureMessage(message: unknown) {
	return typeof message === "string" && message.trim()
		? message.trim()
		: GMAIL_SYNC_FAILURE_MESSAGE;
}

export function getGmailSyncErrorMessage(): string {
	return GMAIL_SYNC_FAILURE_MESSAGE;
}

function describeScannedMessages(scanned: number | null): string {
	if (scanned === null) return "se revisaron los mensajes de Gmail del periodo configurado";
	return scanned === 1 ? "se revisó 1 mensaje de Gmail" : `se revisaron ${scanned} mensajes de Gmail`;
}

function describeFailedQueries(failedCount: number): string {
	return failedCount === 1
		? "1 consulta a Gmail no se pudo completar"
		: `${failedCount} consultas a Gmail no se pudieron completar`;
}

/**
 * The fixed part of a settled result. Success and partial cannot read alike: the partial copy
 * names the failures and says the imported list may be incomplete, so a partial import is never
 * presented as a complete one.
 */
function getGmailSyncSummary(state: GmailSyncState): string {
	const scannedClause = describeScannedMessages(state.scanned);
	if (state.phase === "success") {
		return `Sincronización completa: ${scannedClause} y no falló ninguna consulta.`;
	}
	if (state.failedCount !== null && state.failedCount > 0) {
		return `Sincronización parcial: ${scannedClause}, pero ${describeFailedQueries(state.failedCount)}; la lista importada puede estar incompleta.`;
	}
	return `Sincronización parcial: ${scannedClause}, pero no se pudo confirmar que todas las consultas a Gmail se hayan completado; la lista importada puede estar incompleta.`;
}

export type GmailSyncNotice = {
	message: string;
	tone: "success" | "warning" | "error";
};

/**
 * Copy for the outcome the card publishes. It follows the movements convention: a completed
 * request whose follow-up reload failed is reported as stale data with a warning tone, never as a
 * failed sync, and the scanned count is kept in both variants.
 */
export function getGmailSyncNotice(state: GmailSyncState): GmailSyncNotice | null {
	if (state.phase === "idle" || state.phase === "syncing") return null;
	if (state.phase === "failed") {
		return {
			message: state.errorMessage ?? GMAIL_SYNC_FAILURE_MESSAGE,
			tone: "error",
		};
	}
	const suffix = state.reloadFailed ? GMAIL_SYNC_STALE_SUFFIX : GMAIL_SYNC_REFRESHED_SUFFIX;
	return {
		message: `${getGmailSyncSummary(state)} ${suffix}`,
		tone: state.phase === "partial" || state.reloadFailed ? "warning" : "success",
	};
}
