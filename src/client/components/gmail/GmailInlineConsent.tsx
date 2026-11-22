import "./gmail-inline-consent.css";
import { getGoogleLoginUrl } from "../../api/googleLogin";
import {
	acceptGmailConsent,
	canAcceptGmailConsent,
	getGmailConsentCopy,
	type GmailConsentNavigator,
	type GmailConsentState,
} from "./gmailConsent";

const INLINE_HINT = "Marca la casilla para continuar";
const HINT_ID = "gmail-inline-consent-hint";

export interface GmailInlineConsentProps {
	/** State produced by `reduceGmailConsent` (an open consent); the control never keeps a second copy. */
	state: GmailConsentState;
	/** Server-owned OAuth entry point, passed unchanged to the pure accept decision. */
	connectUrl: string;
	className?: string;
	/** Acknowledgement intent, answered by the checkbox. */
	onAcknowledge: (acknowledged: boolean) => void;
	/** Navigation boundary; defaults to the same redirect the consent dialog performs on accept. */
	navigate?: GmailConsentNavigator;
}

const redirectToGoogle: GmailConsentNavigator = (url) =>
	window.location.assign(getGoogleLoginUrl(url));

/**
 * The consent on the step-1 screen (S26): the points are already on screen, so the dialog is not
 * needed. The acknowledgement sits right above "Conectar Gmail", which is disabled until it is
 * checked; checking and clicking runs the same accept decision as the dialog (`acceptGmailConsent`),
 * so the redirect target and the return origin are identical. It has no hooks: the owner holds the
 * consent state and passes it in.
 */
export function GmailInlineConsent({
	state,
	connectUrl,
	className,
	onAcknowledge,
	navigate = redirectToGoogle,
}: GmailInlineConsentProps) {
	const copy = getGmailConsentCopy();
	const canAccept = canAcceptGmailConsent(state);

	return (
		<div className="gmail-inline-consent">
			<label className="gmail-inline-consent-ack" htmlFor="gmail-inline-consent-acknowledgement">
				<input
					id="gmail-inline-consent-acknowledgement"
					type="checkbox"
					checked={state.acknowledged}
					onChange={(event) => onAcknowledge(event.target.checked)}
				/>
				<span>{copy.acknowledgementLabel}</span>
			</label>
			{/* Explains the disabled control. It keeps its row once the box is checked (no layout jump). */}
			<p id={HINT_ID} className="gmail-inline-consent-hint" hidden={canAccept}>
				{INLINE_HINT}
			</p>
			<button
				className={className}
				type="button"
				disabled={!canAccept}
				aria-describedby={canAccept ? undefined : HINT_ID}
				onClick={() => {
					acceptGmailConsent(state, connectUrl, navigate);
				}}
			>
				Conectar Gmail
			</button>
		</div>
	);
}
