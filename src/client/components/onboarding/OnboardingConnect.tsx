import type { ReactNode } from "react";
import { BrandMark } from "../brand/BrandMark";
import { getGmailConsentCopy } from "../gmail/gmailConsent";
import "./consent-points.css";
import "./onboarding.css";

export interface OnboardingConnectProps {
	/** The existing connect control; it keeps its own class and label. */
	children?: ReactNode;
}

const STEPS = ["Conectar", "Tu período", "Tu medidor"] as const;

/** One icon per trust point, in the order of the consent copy (leemos, nunca hacemos, salir). */
const POINT_ICONS: ReactNode[] = [
	<>
		<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
		<circle cx="12" cy="12" r="3" />
	</>,
	<>
		<circle cx="12" cy="12" r="9" />
		<path d="m5.6 5.6 12.8 12.8" />
	</>,
	<>
		<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
		<path d="m16 17 5-5-5-5" />
		<path d="M21 12H9" />
	</>,
];

/**
 * Onboarding step 1 (unauthenticated), artboards 04 and 05: two columns on desktop (logo, named
 * steps, headline and the connect action on the left; the trust points and an example gauge on
 * the right) and one column on mobile.
 *
 * The points come from the consent copy, so what this screen promises can never diverge from what
 * the consent dialog asks the user to acknowledge. The connect action is a slot because the real
 * control owns the consent flow and the server-provided OAuth URL; its markup is never altered, so
 * the Google "G" is a decorative sibling placed over the button's leading edge.
 */
export function OnboardingConnect({ children }: OnboardingConnectProps) {
	const copy = getGmailConsentCopy();

	return (
		<main className="onboarding-connect" aria-labelledby="onboarding-connect-title">
			<div className="onboarding-connect-top">
				<a className="onboarding-connect-brand" href="/" aria-label="Gastos Controlados, inicio">
					<BrandMark size={32} />
					Gastos Controlados
				</a>
			</div>
			<div className="onboarding-connect-grid">
				<section className="onboarding-connect-intro" aria-labelledby="onboarding-connect-title">
					<ol className="onboarding-connect-steps" aria-label="Pasos para empezar">
						{STEPS.map((label, index) => (
							<li key={label} {...(index === 0 ? { "aria-current": "step" as const } : {})}>
								<span className="onboarding-connect-bar" aria-hidden="true" />
								<span>
									<b>{index + 1}</b>
									{label}
									{index === 0 ? <span className="onboarding-connect-sr"> (paso actual)</span> : null}
								</span>
							</li>
						))}
					</ol>
					<p className="onboarding-connect-step">Paso 1 de 3 · Conectar</p>
					<h1 id="onboarding-connect-title">Conectemos tu Gmail, con reglas claras</h1>
					<p className="onboarding-connect-subtitle">
						Leemos los avisos de compra de Banco de Chile para armar tu período. Nada más.
					</p>
					<div className="onboarding-connect-cta">
						<div className="onboarding-connect-connect">
							<span className="onboarding-connect-g" aria-hidden="true">
								<GoogleG />
							</span>
							{children}
						</div>
						<a className="onboarding-connect-demo" href="/app/demo">
							Ver la demo
						</a>
					</div>
					<p className="onboarding-connect-fine">{copy.storageNote}</p>
				</section>

				<section className="onboarding-connect-trust" aria-label="Cómo cuidamos tu información">
					<ul className="consent-points">
						{copy.points.map((point, index) => (
							<li key={point.title}>
								<span className="onboarding-connect-icon" aria-hidden="true">
									<svg
										width="22"
										height="22"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										{POINT_ICONS[index]}
									</svg>
								</span>
								<div>
									<h2>{point.title}</h2>
									<p>{point.body}</p>
								</div>
							</li>
						))}
					</ul>
					<ExampleGauge />
				</section>
			</div>
		</main>
	);
}

/** Static month gauge sample (55% spent, 70% of the cycle elapsed). Purely decorative. */
function ExampleGauge() {
	return (
		<aside className="onboarding-connect-example" aria-hidden="true">
			<div className="onboarding-connect-gauge">
				<svg viewBox="0 0 300 300" focusable="false">
					<circle cx="150" cy="150" r="118" fill="none" stroke="#efeee9" strokeWidth="22" />
					<circle
						cx="150"
						cy="150"
						r="118"
						fill="none"
						stroke="var(--state-calm, #0b7a6b)"
						strokeWidth="22"
						strokeLinecap="round"
						strokeDasharray="408.7 741.42"
						transform="rotate(-90 150 150)"
					/>
					<g transform="rotate(252 150 150)">
						<path d="M150 10v46" stroke="#131b2e" strokeWidth="9" strokeLinecap="round" />
						<path d="M150 14v38" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
					</g>
				</svg>
				<div className="onboarding-connect-gauge-center">
					<span>Te quedan</span>
					<strong>$620.000</strong>
				</div>
			</div>
			<div>
				<span className="onboarding-connect-chip">Ejemplo</span>
				<p className="onboarding-connect-example-title">Así se verá tu período</p>
				<p className="onboarding-connect-example-text">
					El color es lo que gastaste; la raya, cuánto del período pasó. Si el color no alcanza la raya, vas en ritmo.
				</p>
				<span className="onboarding-connect-pill">
					<span>✓</span>En ritmo
				</span>
			</div>
		</aside>
	);
}

function GoogleG() {
	return (
		<svg width="18" height="18" viewBox="0 0 48 48" focusable="false">
			<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
			<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
			<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
			<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
		</svg>
	);
}
