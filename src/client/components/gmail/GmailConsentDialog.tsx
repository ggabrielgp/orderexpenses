import { useEffect, useRef } from "react";
import { getGoogleLoginUrl } from "../../api/googleLogin";
import "./gmail-consent.css";
import { useRetainedWhileClosing } from "../feedback/motion";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import {
	acceptGmailConsent,
	canAcceptGmailConsent,
	getGmailConsentCopy,
	type GmailConsentState,
} from "./gmailConsent";

/** Dialog chrome around the consent copy (S22); the consent wording itself lives in `gmailConsent`. */
const CONSENT_KICKER = "Antes de conectar";
const CONSENT_HINT = "Marca la casilla para continuar";
const HINT_ID = "gmail-consent-hint";

export interface GmailConsentDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** State produced by `reduceGmailConsent`; the dialog never keeps a second copy. */
	state: GmailConsentState;
	/**
	 * Server-owned OAuth entry point, passed unchanged to the pure accept decision. After consent,
	 * the navigation boundary adds the browser origin; only the server issues OAuth state.
	 */
	connectUrl: string;
	/** Acknowledgement intent, answered by the checkbox. */
	onAcknowledge: (acknowledged: boolean) => void;
	/** Dismiss intent. It never navigates. */
	onClose: () => void;
}

/**
 * Consent dialog that gates connecting Gmail.
 *
 * It exists because the previous UI linked straight to the OAuth entry point, so the user
 * authorized email reading without the app explaining anything. The copy and the accept rule come
 * from `gmailConsent`, so the explanation cannot drift from the decisions.
 *
 * It is a real modal, using the same `syncNativeModalDialog` helper as the movement dialogs: a
 * consent that explains access to the user's email deserves no less protection (focus trap, inert
 * `::backdrop`) than the reversible expense dialogs.
 *
 * `Esc` is safe here and is therefore not prevented: nothing is in flight, and dismissing the
 * consent only returns the user to the dashboard, where the connect control is still available.
 * Navigation happens exclusively on accept, so no dismissal can leave the app halfway.
 */
export function GmailConsentDialog({
	isOpen,
	state: liveState,
	connectUrl,
	onAcknowledge,
	onClose,
}: GmailConsentDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	// Closing resets the live state (acknowledgement unchecked); the exit keeps the last open one.
	const shown = useRetainedWhileClosing(isOpen ? { state: liveState } : null);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	if (!shown.value) return null;
	const { state } = shown.value;

	const copy = getGmailConsentCopy();
	const canAccept = canAcceptGmailConsent(state);

	const handleAccept = () => {
		// Consent remains unchanged; only an accepted navigation carries the browser return origin.
		acceptGmailConsent(state, connectUrl, (url) => window.location.assign(getGoogleLoginUrl(url)));
	};

	return (
		<dialog
			ref={dialogRef}
			className="react-gmail-consent-dialog consent-dialog"
			aria-labelledby="react-gmail-consent-title"
			aria-describedby="react-gmail-consent-description"
			inert={!isOpen}
			onClose={isOpen ? onClose : undefined}
			onTransitionEnd={shown.onTransitionEnd}
		>
			<div className="consent-body">
				<div className="consent-grab" aria-hidden="true" />
				<header className="consent-head">
					<div className="consent-head-text">
						<p className="consent-kicker">{CONSENT_KICKER}</p>
						<h2 id="react-gmail-consent-title" className="consent-title">
							{copy.title}
						</h2>
					</div>
					{/* Both dismissal controls close through the same path, and neither navigates. */}
					<button
						type="button"
						className="consent-close"
						aria-label={copy.closeLabel}
						onClick={onClose}
					>
						<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
							<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
						</svg>
					</button>
				</header>
				<div id="react-gmail-consent-description" className="react-gmail-consent-terms">
					<ul className="consent-list">
						{copy.points.map((point) => (
							<li key={point.title}>
								<h3>{point.title}</h3>
								<p>{point.body}</p>
							</li>
						))}
					</ul>
					<p className="consent-storage-note">{copy.storageNote}</p>
				</div>
			</div>
			<div className="consent-foot">
				{/* The acknowledgement lives in the sticky footer so the control that gates the primary is
				    always visible, even when the points scroll on a short screen. */}
				<label className="consent-ack" htmlFor="gmail-consent-acknowledgement">
					<input
						id="gmail-consent-acknowledgement"
						type="checkbox"
						checked={state.acknowledged}
						onChange={(event) => onAcknowledge(event.target.checked)}
					/>
					<span>{copy.acknowledgementLabel}</span>
				</label>
				{/* Explains the disabled primary. It keeps its row once the box is checked (no layout
				    jump) but is then hidden, and the primary stops pointing at it. */}
				<p id={HINT_ID} className="consent-hint" hidden={canAccept}>
					{CONSENT_HINT}
				</p>
				<div className="consent-actions">
					<button type="button" className="secondary consent-btn consent-btn-ghost" onClick={onClose}>
						{copy.cancelLabel}
					</button>
					{/* Mirrors the legacy modal's disabled accept control: agreeing is impossible before
					    the acknowledgement is checked. */}
					<button
						type="button"
						className="consent-btn consent-btn-primary react-gmail-consent-accept"
						aria-describedby={canAccept ? undefined : HINT_ID}
						onClick={handleAccept}
						disabled={!canAccept}
					>
						{copy.acceptLabel}
					</button>
				</div>
			</div>
		</dialog>
	);
}
