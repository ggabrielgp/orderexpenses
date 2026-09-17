import type { GmailStatusResponse } from "../../api/types";
import {
	acquireInFlightLock,
	releaseInFlightLock,
	type InFlightLockRef,
} from "../movements/CreateManualExpenseDialog";

/**
 * Connection decisions for the Gmail card.
 *
 * The card never invents a connection state: every visible fact comes either from the session
 * snapshot the server already returned (`src/server.js:103-106`) or from a successful
 * `/api/gmail/status` read, and the copy answers exactly what the server can report. This
 * repository's panel test harness has no DOM, so the rules that keep the card honest — the
 * anonymous-session guard, the single in-flight lock, the phase machine and the disconnection
 * consequences — live in pure, exported functions instead of inside the component.
 */

export type GmailConnectionPhase = "loading" | "ready" | "failed";

export type GmailConnectionState = {
	phase: GmailConnectionPhase;
	/**
	 * Effective connection state. It starts from the session snapshot, is replaced by every
	 * successful read, and is forced to `false` by a confirmed disconnection.
	 */
	connected: boolean;
	/** Presence of the server OAuth credentials; `null` until a successful read reports it. */
	hasCredentials: boolean | null;
	/** Account email from the last successful read; `null` while unknown or disconnected. */
	activeEmail: string | null;
};

export type GmailConnectionEvent =
	| { type: "loadStarted" }
	| { type: "loaded"; gmailStatus: GmailStatusResponse }
	| { type: "loadFailed" }
	| { type: "disconnected"; gmailStatus: GmailStatusResponse | null };

export type GmailConnectionView = {
	/** Effective connection state the card's controls follow. */
	connected: boolean;
	/** Short state label, never a claim about the account beyond what is known. */
	title: string;
	/** Account email to show when it is known; `null` renders no account line. */
	activeEmail: string | null;
	message: string;
};

/**
 * The session snapshot is a server-provided connection state, so it is a truthful initial value
 * while the first status read is in flight. `hasCredentials` stays unknown until a read reports it.
 */
export function createGmailConnectionState(sessionConnected: boolean): GmailConnectionState {
	return {
		phase: "loading",
		connected: sessionConnected === true,
		hasCredentials: null,
		activeEmail: null,
	};
}

/**
 * The rule the refresh control mirrors: a read may start only while none is in flight. The
 * rendered attribute can be one tick stale after a fast double click, so the lock below — not this
 * predicate — is what actually guarantees a single request.
 */
export function canRefreshGmailStatus(state: GmailConnectionState): boolean {
	return state.phase !== "loading";
}

/**
 * The rule every Gmail control mirrors: the card offers nothing while the server is not configured.
 *
 * A missing OAuth client is a deployment misconfiguration, not a user problem: the authorization
 * URL cannot even be built without it (`createOAuthClient` -> `loadGoogleClientConfig` throws), and
 * the credentials live in the process environment or in a server-side file (`hasGoogleCredentials`),
 * so no request the browser makes can change them. Offering the connect control there would be a
 * promise the server cannot keep, and offering a retry would present a re-read as the fix for a
 * problem the user does not own.
 */
export function canOfferGmailActions(state: GmailConnectionState): boolean {
	return state.hasCredentials !== false;
}

/**
 * The rule the disconnection control mirrors: the card offers it only once a read is not in flight
 * and the account is known to be connected.
 *
 * Without the first half, a read that started before the disconnection could settle afterwards and
 * bring the pre-disconnection state back, so the card would claim a connection the server already
 * removed. `failed` is safe: a failed phase is only reached by a read that already settled.
 */
export function canOfferGmailDisconnect(state: GmailConnectionState): boolean {
	return canOfferGmailActions(state) && state.phase !== "loading" && state.connected === true;
}

/**
 * Pure reducer for the status lifecycle. Events that cannot legally apply return the identical
 * state, so `reduceGmailConnection(state, event) === state` proves that nothing happened.
 */
export function reduceGmailConnection(
	state: GmailConnectionState,
	event: GmailConnectionEvent,
): GmailConnectionState {
	switch (event.type) {
		case "loadStarted":
			// A read already in flight owns the phase, so a repeated start cannot show a second
			// attempt while the first one has not settled.
			if (state.phase === "loading") return state;
			return { ...state, phase: "loading" };
		case "loaded": {
			const { hasCredentials, connected, activeEmail } = event.gmailStatus;
			// The legacy treats missing server credentials as not connected
			// (`public/app.js:718-733`): without them the app cannot refresh an existing token, so
			// promising a connection would be wrong and offering to disconnect it would be worse.
			const isConnected = connected === true && hasCredentials === true;
			return {
				phase: "ready",
				connected: isConnected,
				hasCredentials: hasCredentials === true,
				activeEmail: isConnected ? activeEmail ?? null : null,
			};
		}
		case "loadFailed":
			// The last known state is kept: a transport failure proves nothing about the connection.
			return { ...state, phase: "failed" };
		case "disconnected":
			// When the follow-up read succeeded it is the authority, including for credentials.
			if (event.gmailStatus !== null) {
				return reduceGmailConnection(state, {
					type: "loaded",
					gmailStatus: event.gmailStatus,
				});
			}
			// The server confirmed the authorization removal, so the card must not keep claiming the
			// account is connected. An unknown credentials flag stays unknown: it is never invented.
			return {
				phase: "ready",
				connected: false,
				hasCredentials: state.hasCredentials,
				activeEmail: null,
			};
	}
}

/**
 * The server has no OAuth client configured, so no Gmail connection is possible. That is a
 * deployment problem: the message names who has to fix it and never asks the user for an action
 * they cannot take, nor exposes an internal path or file name.
 */
export const GMAIL_CREDENTIALS_MISSING_MESSAGE =
	"La conexión con Gmail no está disponible porque aún falta completar la configuración de la aplicación. Esto debe resolverlo quien administra el servicio; no hay ninguna acción de tu parte que lo habilite.";
/** The server can authorize, but no account is connected for this session. */
export const GMAIL_NOT_CONNECTED_MESSAGE =
	"Gmail no está conectado. Usa Conectar Gmail para autorizar la lectura de tus correos.";
const GMAIL_CONNECTED_MESSAGE =
	"Puedes revisar los movimientos que la app detecta en los correos de Banco de Chile del periodo configurado.";
const GMAIL_CONNECTED_WITHOUT_EMAIL_MESSAGE =
	"La app puede leer los correos de Banco de Chile, pero la cuenta conectada no informó un correo activo.";
const GMAIL_STATUS_LOADING_MESSAGE = "Revisando el estado de la conexión con Gmail...";
/** Truthful failure copy: a read that could not run says nothing about the account itself. */
export const GMAIL_STATUS_ERROR_MESSAGE =
	"No se pudo revisar el estado de la conexión con Gmail. Puedes reintentar la consulta.";

/**
 * Builds the visible copy for the state the server actually reported. The two disconnected cases
 * the legacy distinguishes (`public/app.js:709-762`) stay distinguishable here, and the
 * distinction always comes from `hasCredentials`, never from an inference.
 */
export function getGmailConnectionView(state: GmailConnectionState): GmailConnectionView {
	// The server configuration dominates every phase: while it is known to be missing there is no
	// Gmail action to describe and no retry that could help, whatever the last read reported.
	if (state.hasCredentials === false) {
		return {
			connected: false,
			title: "Sin conexión",
			activeEmail: null,
			message: GMAIL_CREDENTIALS_MISSING_MESSAGE,
		};
	}
	if (state.phase === "loading") {
		return {
			connected: state.connected,
			title: state.connected ? "Conectado" : "Sin conexión",
			activeEmail: null,
			message: GMAIL_STATUS_LOADING_MESSAGE,
		};
	}
	if (state.phase === "failed") {
		return {
			connected: state.connected,
			title: state.connected ? "Conectado" : "Sin conexión",
			activeEmail: null,
			message: GMAIL_STATUS_ERROR_MESSAGE,
		};
	}
	if (!state.connected) {
		return {
			connected: false,
			title: "Sin conexión",
			activeEmail: null,
			message: GMAIL_NOT_CONNECTED_MESSAGE,
		};
	}
	return {
		connected: true,
		title: "Conectado",
		activeEmail: state.activeEmail,
		message:
			state.activeEmail === null
				? GMAIL_CONNECTED_WITHOUT_EMAIL_MESSAGE
				: GMAIL_CONNECTED_MESSAGE,
	};
}

export type GmailStatusSource = (signal?: AbortSignal) => Promise<GmailStatusResponse>;

export type GmailStatusRefreshOutcome =
	| { status: "loaded"; gmailStatus: GmailStatusResponse }
	| { status: "failed" }
	| { status: "busy" };

export type GmailStatusRefresher = (signal?: AbortSignal) => Promise<GmailStatusRefreshOutcome>;

export interface GmailStatusRefresherDeps {
	/** Reads the real status; rejects when the request fails. */
	getStatus: GmailStatusSource;
	/** The same single in-flight lock the movements slice uses. */
	lock: InFlightLockRef;
}

/**
 * Ownership registry for the shared boolean lock.
 *
 * `InFlightLockRef` is a single boolean and cannot tell who acquired it, so a request that settles
 * late could clear a lock a newer request already owns. Every acquisition made here records a
 * unique owner token against the lock; a release only clears the lock while the token still
 * matches. The registry is a `WeakMap`, so a lock nobody owns anymore is garbage collected and no
 * entry survives an attempt.
 */
const gmailStatusLockOwners = new WeakMap<InFlightLockRef, object>();

function tryAcquireOwnedLock(lock: InFlightLockRef, owner: object): boolean {
	if (!acquireInFlightLock(lock)) return false;
	gmailStatusLockOwners.set(lock, owner);
	return true;
}

/**
 * Releases the lock only while `owner` is still the attempt that acquired it. A stale owner — an
 * aborted attempt whose `finally` runs after a replacement acquired the lock — is a no-op, which is
 * exactly what a bare `releaseInFlightLock` cannot express.
 */
function releaseOwnedLock(lock: InFlightLockRef, owner: object): void {
	if (gmailStatusLockOwners.get(lock) !== owner) return;
	gmailStatusLockOwners.delete(lock);
	releaseInFlightLock(lock);
}

export interface GmailStatusAttemptDeps {
	/** Reads the real status; rejects when the request fails. */
	getStatus: GmailStatusSource;
	/** The same single in-flight lock the movements slice uses. */
	lock: InFlightLockRef;
}

/**
 * A started (or refused) status attempt. `started` is known synchronously, before the underlying
 * request is awaited, so a caller can decide whether to announce `loading` and never presents a
 * request that was turned away as one in flight.
 */
export interface GmailStatusAttempt {
	/** True when this attempt acquired the lock, so a request actually left. */
	started: boolean;
	/** The settled outcome; resolves `busy` when `started` is false. */
	outcome: Promise<GmailStatusRefreshOutcome>;
	/** Releases the lock only while this attempt still owns it; safe to call more than once. */
	release: () => void;
}

async function runGmailStatusAttempt(
	getStatus: GmailStatusSource,
	lock: InFlightLockRef,
	owner: object,
	signal?: AbortSignal,
): Promise<GmailStatusRefreshOutcome> {
	try {
		return { status: "loaded", gmailStatus: await getStatus(signal) };
	} catch {
		return { status: "failed" };
	} finally {
		releaseOwnedLock(lock, owner);
	}
}

/**
 * Acquires the lock and starts one read. The acquisition is synchronous, before the first `await`,
 * so two calls in the same tick can never issue two requests: the second reports `busy`.
 */
export function startGmailStatusAttempt(
	{ getStatus, lock }: GmailStatusAttemptDeps,
	signal?: AbortSignal,
): GmailStatusAttempt {
	const owner = {};
	if (!tryAcquireOwnedLock(lock, owner)) {
		return { started: false, outcome: Promise.resolve({ status: "busy" }), release: () => {} };
	}
	return {
		started: true,
		outcome: runGmailStatusAttempt(getStatus, lock, owner, signal),
		release: () => releaseOwnedLock(lock, owner),
	};
}

/**
 * Creates the read the refresh control, the mount effect and the disconnection's follow-up share.
 *
 * The lock is acquired synchronously before the first `await`, so two calls in the same tick can
 * never issue two requests: the second one reports `busy` and leaves the state untouched. The lock
 * is released on every settled attempt, including a failed one, so a retry stays possible, and the
 * release is ownership-checked so an aborted attempt can never free a replacement's lock.
 */
export function createGmailStatusRefresher({
	getStatus,
	lock,
}: GmailStatusRefresherDeps): GmailStatusRefresher {
	return (signal) => startGmailStatusAttempt({ getStatus, lock }, signal).outcome;
}

/**
 * Applies a settled read. `busy` means the attempt never left, so the state is returned identical
 * and the read already in flight remains the only owner of the phase.
 */
export function applyGmailStatusOutcome(
	state: GmailConnectionState,
	outcome: GmailStatusRefreshOutcome,
): GmailConnectionState {
	if (outcome.status === "loaded") {
		return reduceGmailConnection(state, { type: "loaded", gmailStatus: outcome.gmailStatus });
	}
	if (outcome.status === "failed") return reduceGmailConnection(state, { type: "loadFailed" });
	return state;
}

/**
 * The synchronous half of a refresh click: `startGmailStatusAttempt` already knows whether a
 * request actually left, so a started attempt announces `loading` while a refused (`busy`) attempt
 * announces nothing and leaves the state reference-identical.
 */
export function reduceGmailStatusRefreshStart(
	state: GmailConnectionState,
	started: boolean,
): GmailConnectionState {
	return started ? reduceGmailConnection(state, { type: "loadStarted" }) : state;
}

/** Anonymous sessions have no Gmail account to report, so they never read the status. */
export function shouldLoadGmailStatus(authenticated: boolean): boolean {
	return authenticated === true;
}

export interface GmailStatusLoadOptions {
	authenticated: boolean;
	getStatus: GmailStatusSource;
	lock: InFlightLockRef;
	/** Runs synchronously when a read actually starts. */
	onStarted: () => void;
	/** Receives the settled outcome; never called for an anonymous session or an aborted read. */
	onOutcome: (outcome: GmailStatusRefreshOutcome) => void;
}

/**
 * Starts the read the card's mount effect performs and returns its cleanup.
 *
 * The anonymous-session guard lives here instead of in the component because this harness has no
 * DOM: the invariant that an anonymous session never asks for a Gmail status has to be provable
 * without rendering anything.
 */
export function startGmailStatusLoad(options: GmailStatusLoadOptions): () => void {
	if (!shouldLoadGmailStatus(options.authenticated)) return () => {};
	const controller = new AbortController();
	const attempt = startGmailStatusAttempt(
		{ getStatus: options.getStatus, lock: options.lock },
		controller.signal,
	);
	// A refused attempt never left, so it must not announce a read that is not happening.
	if (attempt.started) options.onStarted();
	void attempt.outcome.then((outcome) => {
		// A completion that arrives after the cleanup belongs to a read nobody is waiting for.
		if (controller.signal.aborted) return;
		options.onOutcome(outcome);
	});
	return () => {
		controller.abort();
		// Release only while this attempt still owns the lock: React re-runs this effect in
		// development (StrictMode), and the replacement read must be admitted — while this aborted
		// attempt's own late `finally` must never release the replacement's lock.
		attempt.release();
	};
}

export type GmailDisconnectPhase =
	| "closed"
	| "confirming"
	| "disconnecting"
	| "failed"
	| "disconnected";

export type GmailDisconnectState = {
	phase: GmailDisconnectPhase;
	/** Truthful failure copy; null unless the phase is `failed`. */
	errorMessage: string | null;
	/** True when the disconnection succeeded but the follow-up status read did not. */
	statusRefreshFailed: boolean;
};

export type GmailDisconnectEvent =
	| { type: "open" }
	| { type: "cancel" }
	| { type: "confirm" }
	| { type: "succeeded"; gmailStatus: GmailStatusResponse | null }
	| { type: "failed"; message: string };

export function createGmailDisconnectState(): GmailDisconnectState {
	return { phase: "closed", errorMessage: null, statusRefreshFailed: false };
}

/**
 * The single in-flight rule: the POST may only leave while the state is `confirming` (first
 * attempt) or `failed` (retry of a disconnection that did not happen).
 */
export function canConfirmGmailDisconnect(state: GmailDisconnectState): boolean {
	return state.phase === "confirming" || state.phase === "failed";
}

const GMAIL_DISCONNECT_FAILURE_MESSAGE = "No se pudo desconectar Gmail. Inténtalo de nuevo.";

export function getGmailDisconnectErrorMessage(): string {
	return GMAIL_DISCONNECT_FAILURE_MESSAGE;
}

/** Pure reducer for the disconnection lifecycle; illegal events return the identical state. */
export function reduceGmailDisconnectState(
	state: GmailDisconnectState,
	event: GmailDisconnectEvent,
): GmailDisconnectState {
	switch (event.type) {
		case "open":
			// A disconnection already on its way owns the lifecycle and cannot be replaced.
			if (state.phase === "disconnecting") return state;
			return { phase: "confirming", errorMessage: null, statusRefreshFailed: false };
		case "cancel":
			// Cancelling is only truthful before the request is sent.
			if (state.phase !== "confirming" && state.phase !== "failed") return state;
			return createGmailDisconnectState();
		case "confirm":
			if (!canConfirmGmailDisconnect(state)) return state;
			return { phase: "disconnecting", errorMessage: null, statusRefreshFailed: false };
		case "succeeded":
			// Only the request that was in flight can complete; a late answer is ignored.
			if (state.phase !== "disconnecting") return state;
			return {
				phase: "disconnected",
				errorMessage: null,
				statusRefreshFailed: event.gmailStatus === null,
			};
		case "failed":
			if (state.phase !== "disconnecting") return state;
			return {
				phase: "failed",
				errorMessage: normalizeDisconnectFailureMessage(event.message),
				statusRefreshFailed: false,
			};
	}
}

/**
 * Dismissal intent mapped to the only truthful transition for the current phase: a confirmation is
 * called off through `cancel`, and a settled result is closed. A disconnection in flight is not
 * dismissible, so its outcome can never be hidden while the POST may already have left.
 */
export function reduceGmailDisconnectDismissal(state: GmailDisconnectState): GmailDisconnectState {
	if (state.phase === "confirming") return reduceGmailDisconnectState(state, { type: "cancel" });
	if (state.phase === "failed" || state.phase === "disconnected") {
		return createGmailDisconnectState();
	}
	return state;
}

export type GmailDisconnectConfirmation = {
	title: string;
	/** One consequence per sentence; every clause is backed by the server code. */
	statements: string[];
	confirmLabel: string;
	cancelLabel: string;
};

/**
 * The confirmation copy. Each consequence maps to code:
 *
 * 1. `disconnectGoogle` deletes the stored token (`src/gmail.js:46-50`, `deleteGoogleToken`).
 * 2. The same call clears the stored profile (`deleteGoogleProfile`), and the endpoint unsets the
 *    session's account link (`clearSessionUser`), so both the profile copy and the link are gone.
 * 3. Without a token the Gmail read fails with a 401 and only manual movements remain
 *    (`src/movements.js:135-153`).
 * 4. Everything else is untouched: the disconnection path only touches `google_tokens` and
 *    `sessions.user_email`, so `manual_movements`, `movement_overrides` (overrides and hides),
 *    `counterparty_category_rules` and `categories` keep their rows.
 */
const GMAIL_DISCONNECT_CONFIRMATION: GmailDisconnectConfirmation = {
	title: "¿Desconectar Gmail?",
	statements: [
		"Se elimina la autorización de Gmail guardada en este servidor.",
		"También se elimina la copia del perfil de Google guardada aquí y tu sesión deja de estar vinculada a esa cuenta.",
		"Los movimientos importados desde Gmail dejan de poder leerse hasta que vuelvas a conectar la cuenta.",
		"Tus datos propios se mantienen: los movimientos manuales, las ediciones y los ocultamientos guardados, las reglas de categorización y las categorías.",
	],
	confirmLabel: "Desconectar Gmail",
	cancelLabel: "Cancelar",
};

/** Returns a fresh copy, so a caller can never mutate the copy the dialog reads. */
export function getGmailDisconnectConfirmation(): GmailDisconnectConfirmation {
	return {
		...GMAIL_DISCONNECT_CONFIRMATION,
		statements: [...GMAIL_DISCONNECT_CONFIRMATION.statements],
	};
}

function normalizeDisconnectFailureMessage(message: unknown) {
	return typeof message === "string" && message.trim()
		? message.trim()
		: GMAIL_DISCONNECT_FAILURE_MESSAGE;
}

export type GmailDisconnectSubmitOutcome =
	| { status: "disconnected"; gmailStatus: GmailStatusResponse | null }
	| { status: "failed"; message: string };

export type GmailDisconnectSubmitter = () => Promise<GmailDisconnectSubmitOutcome>;

export interface GmailDisconnectSubmitterDeps {
	/** POSTs the disconnection; rejects when the server refuses it. */
	disconnect: () => Promise<unknown>;
	/** Re-reads the status through the same single in-flight lock. */
	refreshStatus: GmailStatusRefresher;
}

/**
 * Creates the callback the confirmation dialog awaits.
 *
 * A rejected POST is a real failure: the authorization is still there, so nothing is claimed and no
 * status read follows. A successful POST always resolves as a disconnection — a follow-up read that
 * failed (or never ran because another read held the lock) means the visible status may be stale,
 * never that the disconnection did not happen, so the POST is never repeated.
 */
export function createGmailDisconnectSubmitter({
	disconnect,
	refreshStatus,
}: GmailDisconnectSubmitterDeps): GmailDisconnectSubmitter {
	return async () => {
		try {
			await disconnect();
		} catch {
			return { status: "failed", message: GMAIL_DISCONNECT_FAILURE_MESSAGE };
		}
		let outcome: GmailStatusRefreshOutcome;
		try {
			outcome = await refreshStatus();
		} catch {
			// A replacement refresher could reject instead of reporting; the disconnection stands.
			outcome = { status: "failed" };
		}
		return {
			status: "disconnected",
			gmailStatus: outcome.status === "loaded" ? outcome.gmailStatus : null,
		};
	};
}

export const GMAIL_DISCONNECTED_NOTICE_MESSAGE =
	"Gmail se desconectó correctamente. Se eliminó la autorización guardada y los movimientos importados desde Gmail ya no se pueden leer hasta que vuelvas a conectar la cuenta.";
export const GMAIL_DISCONNECT_STALE_NOTICE_MESSAGE =
	"Gmail se desconectó correctamente, pero el estado de la conexión no se pudo actualizar y puede estar desactualizado. Actualiza la página para ver el estado real.";

export type GmailDisconnectNotice = {
	message: string;
	tone: "success" | "warning";
};

/**
 * Copy for the outcome the card publishes once the confirmation dialog is dismissed. Only a
 * completed disconnection publishes anything, and a status refresh that failed is reported as a
 * stale card, never as a disconnection that did not happen.
 */
export function getGmailDisconnectNotice(
	state: GmailDisconnectState,
): GmailDisconnectNotice | null {
	if (state.phase !== "disconnected") return null;
	if (state.statusRefreshFailed) {
		return { message: GMAIL_DISCONNECT_STALE_NOTICE_MESSAGE, tone: "warning" };
	}
	return { message: GMAIL_DISCONNECTED_NOTICE_MESSAGE, tone: "success" };
}

/**
 * Applies a settled disconnection to the connection state, so the card stops claiming a connection
 * the server already removed even when the follow-up read failed.
 */
export function applyGmailDisconnectOutcome(
	state: GmailConnectionState,
	outcome: GmailDisconnectSubmitOutcome,
): GmailConnectionState {
	if (outcome.status === "failed") return state;
	return reduceGmailConnection(state, {
		type: "disconnected",
		gmailStatus: outcome.gmailStatus,
	});
}
