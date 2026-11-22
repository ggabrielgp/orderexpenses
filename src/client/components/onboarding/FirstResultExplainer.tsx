import "./onboarding.css";

/**
 * How to read the month gauge, as one compact row (gauge icon, bold title and the sentence on the same
 * line, wrapping naturally on narrow screens). It has no button of its own: the step it sits in owns the
 * action, so no empty corner is left around the text.
 */
export function FirstResultExplainer({ withIncome = true }: { withIncome?: boolean }) {
	return (
		<p className="first-result-explainer">
			<svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
				<circle cx="14" cy="14" r="10" fill="none" stroke="#e3e1dc" strokeWidth="4" />
				<path d="M14 4a10 10 0 0 1 8.7 15" fill="none" stroke="#0b7a6b" strokeWidth="4" strokeLinecap="round" />
				<path d="M14 1v6" stroke="#131b2e" strokeWidth="2.5" strokeLinecap="round" transform="rotate(240 14 14)" />
			</svg>
			<span>
				<strong>Así se lee tu medidor</strong>{" "}
				{withIncome
					? "El color es lo que gastaste de tu ingreso; la raya, cuánto del período pasó. Si el color no alcanza la raya, vas en ritmo."
					: "Con tu ingreso, el color será lo que gastaste de él; la raya, cuánto del período pasó. Si el color no alcanza la raya, vas en ritmo."}
			</span>
		</p>
	);
}
