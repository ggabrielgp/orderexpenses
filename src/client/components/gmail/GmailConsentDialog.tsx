import { useEffect, useRef } from "react";
import { getGoogleLoginUrl } from "../../api/googleLogin";
import "../onboarding/consent-points.css";
import { useRetainedWhileClosing } from "../feedback/motion";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import {
	acceptGmailConsent,
	canAcceptGmailConsent,
	getGmailConsentCopy,
	type GmailConsentState,
} from "./gmailConsent";

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
			className="react-gmail-consent-dialog"
			aria-labelledby="react-gmail-consent-title"
			aria-describedby="react-gmail-consent-description"
			inert={!isOpen}
			onClose={isOpen ? onClose : undefined}
			onTransitionEnd={shown.onTransitionEnd}
		>
			{/* Both dismissal controls close through the same path, and neither navigates. */}
			<button
				type="button"
				className="react-gmail-consent-close"
				aria-label={copy.closeLabel}
				onClick={onClose}
			>
				✕
			</button>
			<h2 id="react-gmail-consent-title">{copy.title}</h2>
			<div id="react-gmail-consent-description" className="react-gmail-consent-terms">
				<ul className="consent-points">
					{copy.points.map((point) => (
						<li key={point.title}>
							<h3>{point.title}</h3>
							<p>{point.body}</p>
						</li>
					))}
				</ul>
				<p className="consent-storage-note">{copy.storageNote}</p>
			</div>
			<label className="react-gmail-consent-acknowledgement" htmlFor="gmail-consent-acknowledgement">
				<input
					id="gmail-consent-acknowledgement"
					type="checkbox"
					checked={state.acknowledged}
					onChange={(event) => onAcknowledge(event.target.checked)}
				/>
				<span>{copy.acknowledgementLabel}</span>
			</label>
			<div className="react-shell-actions">
				<button type="button" className="secondary" onClick={onClose}>
					{copy.cancelLabel}
				</button>
				{/* Mirrors the legacy modal's disabled accept control: agreeing is impossible before
				    the acknowledgement is checked. */}
				<button
					type="button"
					className="react-gmail-consent-accept"
					onClick={handleAccept}
					disabled={!canAccept}
				>
					{copy.acceptLabel}
				</button>
			</div>
		</dialog>
	);
}
