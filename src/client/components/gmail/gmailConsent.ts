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

export type GmailConsentCopy = {
	title: string;
	descriptionParagraphs: string[];
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
 * Spanish copy, aligned with the legacy consent modal (`public/app.html:265-331`) rather than
 * inventing new promises. Every paragraph maps to a claim the legacy modal already makes:
 *
 * 1. Read-only access, used only for Banco de Chile emails inside the reviewed period.
 * 2. Which emails are read, that nothing is sent or published anywhere, and that the mailbox is
 *    neither modified nor used for other purposes.
 * 3. Imported expenses are re-derived per period instead of kept as permanent history.
 * 4. What may persist locally, so the copy never claims that nothing at all is stored.
 * 5. The consequence: decisions are remembered without storing every imported expense.
 */
const GMAIL_CONSENT_COPY: GmailConsentCopy = {
	title: "Cómo se usan tus correos y gastos",
	descriptionParagraphs: [
		"Para detectar tus gastos automáticamente, la app necesita acceso de solo lectura a Gmail. Ese permiso se usa únicamente para leer correos relacionados con Banco de Chile, el banco configurado actualmente, dentro del periodo que estés revisando.",
		"Solo se leen los correos de Banco de Chile y se usan para extraer movimientos, montos, fechas y comercios, y así mostrarte métricas, tablas, gráficos y agrupaciones de gasto. La app no envía correos, no publica nada en ningún lugar, no modifica tu cuenta de Gmail y no usa tus mensajes para otros fines.",
		"Los gastos importados desde Gmail se procesan para construir la vista del periodo seleccionado y no se guardan como una base histórica permanente de movimientos. Si vuelves a revisar o sincronizar un periodo, la app puede volver a leer los correos autorizados para reconstruir esa información.",
		"Lo que sí puede guardarse localmente son las configuraciones y datos que tú decides aplicar: categorías por comercio, reglas de categorización, correcciones a movimientos específicos, gastos ingresados manualmente, preferencias de vista, presupuesto mensual y ajustes similares.",
		"Esto permite que la app recuerde tus decisiones sin almacenar todos tus gastos importados desde Gmail como un historial permanente.",
	],
	acknowledgementLabel:
		"Entiendo que mis gastos importados desde Gmail no se guardan como historial permanente y que solo se almacenan localmente las configuraciones, correcciones o datos que yo aplique.",
	acceptLabel: "Aceptar y conectar Gmail",
	cancelLabel: "Cancelar",
	closeLabel: "Cerrar",
};

/** Returns a fresh copy, so a caller can never mutate the copy the dialog reads. */
export function getGmailConsentCopy(): GmailConsentCopy {
	return { ...GMAIL_CONSENT_COPY, descriptionParagraphs: [...GMAIL_CONSENT_COPY.descriptionParagraphs] };
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
