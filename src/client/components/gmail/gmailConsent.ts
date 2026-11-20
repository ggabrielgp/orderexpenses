/**
 * Consent decisions for connecting Gmail.
 *
 * Reading the user's email needs an explanation before the app leaves for the OAuth entry point,
 * so this module owns the decisions and the copy as pure functions. The repository's test harness
 * has no DOM, so the invariants that keep the flow truthful (agreement is impossible until the
 * acknowledgement is checked, an already connected account is refused, and only the
 * server-provided URL is ever used) must be provable without rendering the dialog.
 *
 * The client never builds that URL. The server owns the OAuth `state` contract, so every accepted
 * attempt returns exactly the target it was given, byte for byte.
 */

export type GmailConsentPhase = "closed" | "open" | "refused";

export type GmailConsentState = {
	/** True once the user checked the acknowledgement, and only after this attempt began. */
	acknowledged: boolean;
	phase: GmailConsentPhase;
	/** Truthful refusal message; null unless the phase is `refused`. */
	message: string | null;
};

export type GmailConsentEvent =
	| { type: "open"; accountConnected: boolean }
	| { type: "acknowledge"; acknowledged: boolean }
	| { type: "cancel" };

export type GmailConsentPoint = { title: string; body: string };

export type GmailConsentCopy = {
	title: string;
	/** The three trust points, shared by the consent dialog and the onboarding connect step. */
	points: GmailConsentPoint[];
	/** What is persisted and where; shown as fine print under the points. */
	storageNote: string;
	acknowledgementLabel: string;
	acceptLabel: string;
	cancelLabel: string;
	closeLabel: string;
};

/**
 * The legacy refusal (`public/app.js:447-452`) states the real consequence: the server-provided
 * entry point would replace the account that is already connected, so the user has to disconnect
 * first. The copy names exactly that.
 */
export const GMAIL_CONSENT_ALREADY_CONNECTED_MESSAGE =
	"Ya hay una cuenta Gmail conectada. Desconéctala antes de cambiar de cuenta.";

/**
 * Spanish copy, short and checked against what the code really does:
 *
 * - Scopes (`src/gmail.js:20-23`): `gmail.readonly` plus profile and email. Google therefore
 *   grants read access to the whole mailbox and the app itself filters Banco de Chile emails.
 * - Imported movements are re-derived per period and not kept as history.
 * - Data the user applies (categories, counterparty rules, movement corrections, manual expenses,
 *   financial cycle) lives in the server database keyed by the account email (`src/db.js`
 *   tables `categories`, `counterparty_category_rules`, `movement_overrides`, `manual_movements`,
 *   `financial_periods`, `financial_preferences`). Nothing is kept in the browser.
 * - Disconnecting Gmail (Configuración → Perfil) deletes tokens and profile only
 *   (`disconnectGoogle` in `src/gmail.js`). No "delete my data" path exists, so the copy never
 *   promises one.
 */
const GMAIL_CONSENT_COPY: GmailConsentCopy = {
	title: "Conectar Gmail, con reglas claras",
	points: [
		{
			title: "Qué leemos",
			body: "Google nos da permiso de solo lectura sobre tu Gmail. La app solo busca y procesa los avisos de Banco de Chile del período que revisas.",
		},
		{
			title: "Qué nunca hacemos",
			body: "No enviamos, borramos ni modificamos correos, no publicamos nada y no guardamos tus movimientos de Gmail como historial: se vuelven a leer al revisar un período.",
		},
		{
			title: "Cómo salir",
			body: "Puedes desconectar Gmail cuando quieras desde Configuración; también puedes revocar el acceso en tu cuenta de Google (myaccount.google.com/permissions).",
		},
	],
	storageNote:
		"Lo que tú decides aplicar —categorías, reglas, correcciones, gastos manuales y tu ciclo— se guarda en nuestro servidor asociado a tu cuenta.",
	acknowledgementLabel: "Entiendo qué lee la app y qué se guarda.",
	acceptLabel: "Aceptar y conectar Gmail",
	cancelLabel: "Cancelar",
	closeLabel: "Cerrar",
};

/** Returns a fresh copy, so a caller can never mutate the copy the dialog reads. */
export function getGmailConsentCopy(): GmailConsentCopy {
	return {
		...GMAIL_CONSENT_COPY,
		points: GMAIL_CONSENT_COPY.points.map((point) => ({ ...point })),
	};
}

export function createGmailConsentState(): GmailConsentState {
	return { acknowledged: false, phase: "closed", message: null };
}

/**
 * Pure reducer for the consent lifecycle. Events that cannot legally apply return the identical
 * state, so `reduceGmailConsent(state, event) === state` proves that nothing happened.
 *
 * `open` deliberately drops any previous acknowledgement: the legacy modal clears its checkbox on
 * every attempt, and a consent granted for one attempt must never authorize a later one.
 */
export function reduceGmailConsent(
	state: GmailConsentState,
	event: GmailConsentEvent,
): GmailConsentState {
	switch (event.type) {
		case "open":
			// Defence in depth. The dashboard only offers the connect control while the account is
			// disconnected, but the server-provided entry point would replace an existing account, so
			// the refusal is enforced here too instead of relying on the UI to be correct.
			if (event.accountConnected === true) {
				return {
					acknowledged: false,
					phase: "refused",
					message: GMAIL_CONSENT_ALREADY_CONNECTED_MESSAGE,
				};
			}
			return { acknowledged: false, phase: "open", message: null };
		case "acknowledge":
			// Only an open consent has an acknowledgement control to answer.
			if (state.phase !== "open") return state;
			return { ...state, acknowledged: event.acknowledged === true };
		case "cancel":
			if (state.phase === "closed") return state;
			return createGmailConsentState();
	}
}

/**
 * The rule the disabled accept control mirrors: agreement is impossible until the acknowledgement
 * is checked, and only while the consent is actually open.
 */
export function canAcceptGmailConsent(state: GmailConsentState): boolean {
	return state.phase === "open" && state.acknowledged === true;
}

/**
 * The accept decision. It returns the server-provided URL unchanged, never a value derived from
 * it, and refuses (with `null`) whenever acceptance has not been given or the target is empty.
 *
 * The URL string is returned exactly as received: no normalization, no query rewriting, and no
 * defaults. Building it here would break the server-owned OAuth `state` contract.
 */
export function resolveGmailConnectTarget(
	state: GmailConsentState,
	connectUrl: string,
): string | null {
	if (!canAcceptGmailConsent(state)) return null;
	if (typeof connectUrl !== "string" || !connectUrl.trim()) return null;
	return connectUrl;
}

/** Navigation callback, injected so the accept decision stays testable without a browser. */
export type GmailConsentNavigator = (url: string) => void;

/**
 * Applies the accept decision: navigates to the exact server-provided URL and reports whether it
 * did. Without the acknowledgement nothing is navigated to, so cancel and an unacknowledged accept
 * are indistinguishable to the caller: neither leaves the app.
 */
export function acceptGmailConsent(
	state: GmailConsentState,
	connectUrl: string,
	navigate: GmailConsentNavigator,
): boolean {
	const target = resolveGmailConnectTarget(state, connectUrl);
	if (target === null) return false;
	navigate(target);
	return true;
}
