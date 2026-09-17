import { useEffect, useRef } from "react";
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
	 * Server-owned OAuth entry point, passed straight to the pure accept decision. The dialog never
	 * builds, parses, or rewrites it, so the server's `state` contract is preserved.
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
	state,
	connectUrl,
	onAcknowledge,
	onClose,
}: GmailConsentDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	if (!isOpen) return null;

	const copy = getGmailConsentCopy();
	const canAccept = canAcceptGmailConsent(state);

	const handleAccept = () => {
		// The only navigation in this flow, and its target is the pure decision's output: the exact
		// server-provided URL, or nothing at all when acceptance has not been given.
		acceptGmailConsent(state, connectUrl, (url) => window.location.assign(url));
	};

	return (
		<dialog
			ref={dialogRef}
			className="react-gmail-consent-dialog"
			aria-labelledby="react-gmail-consent-title"
			aria-describedby="react-gmail-consent-description"
			onClose={onClose}
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
				{copy.descriptionParagraphs.map((paragraph, index) => (
					<p key={index}>{paragraph}</p>
				))}
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
