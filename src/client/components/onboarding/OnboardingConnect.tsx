import type { ReactNode } from "react";
import { getGmailConsentCopy } from "../gmail/gmailConsent";
import "./consent-points.css";
import "./onboarding.css";

export interface OnboardingConnectProps {
	/** The existing connect control; it keeps its own class and label. */
	children?: ReactNode;
}

/**
 * Onboarding step 1 (unauthenticated): trust in three points plus a way to try the demo first.
 *
 * The points come from the consent copy, so what this screen promises can never diverge from what
 * the consent dialog asks the user to acknowledge. The connect action is a slot because the real
 * control owns the consent flow and the server-provided OAuth URL.
 */
export function OnboardingConnect({ children }: OnboardingConnectProps) {
	const copy = getGmailConsentCopy();

	return (
		<main className="onboarding-connect" aria-labelledby="onboarding-connect-title">
			<div className="onboarding-connect-nav">
				<ol className="onboarding-connect-steps" aria-hidden="true">
					<li aria-current="step" />
					<li />
					<li />
				</ol>
				<a className="onboarding-connect-demo" href="/app/demo">
					Ver la demo
				</a>
			</div>
			<span className="onboarding-connect-step">Paso 1 de 3 · Conectar</span>
			<h1 id="onboarding-connect-title">Conectemos tu Gmail, con reglas claras</h1>
			<p className="onboarding-connect-subtitle">
				Leemos los avisos de compra de Banco de Chile para armar tu mes. Nada más.
			</p>
			<ul className="consent-points">
				{copy.points.map((point) => (
					<li key={point.title}>
						<h2>{point.title}</h2>
						<p>{point.body}</p>
					</li>
				))}
			</ul>
			<p className="onboarding-connect-fine">{copy.storageNote}</p>
			<div className="onboarding-connect-cta">{children}</div>
		</main>
	);
}
