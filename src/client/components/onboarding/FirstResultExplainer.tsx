import "./onboarding.css";

export interface FirstResultExplainerProps {
	onDismiss: () => void;
}

/** Onboarding step 3: a dismissible note on how to read the month gauge (artboard 06, phone 3). */
export function FirstResultExplainer({ onDismiss }: FirstResultExplainerProps) {
	return (
		<section className="first-result-explainer" aria-labelledby="first-result-explainer-title">
			<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
				<circle cx="14" cy="14" r="10" fill="none" stroke="#e3e1dc" strokeWidth="4" />
				<path d="M14 4a10 10 0 0 1 8.7 15" fill="none" stroke="#0b7a6b" strokeWidth="4" strokeLinecap="round" />
				<path d="M14 1v6" stroke="#131b2e" strokeWidth="2.5" strokeLinecap="round" transform="rotate(240 14 14)" />
			</svg>
			<div className="first-result-explainer-copy">
				<h2 id="first-result-explainer-title">Así se lee tu medidor</h2>
				<p>
					El color es lo que gastaste de tu ingreso; la raya, cuánto del ciclo pasó. Si el color no alcanza la raya, vas en ritmo.
				</p>
			</div>
			<button className="first-result-explainer-dismiss" type="button" onClick={onDismiss}>
				Entendido
			</button>
		</section>
	);
}
