import type { ReactNode } from "react";

/**
 * Shared phone chrome (bezel, island, home indicator) for the hero and the tour. The screen it frames is
 * `LandingPhoneScreen`, the real demo, which brings its own app header, so the frame draws no header.
 */
export function LandingPhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
	return <div className={`landing-phone ${className}`.trim()}>
		<div className="landing-stage-window">
			<div className="landing-phone-island" aria-hidden="true" />
			<div className="landing-stage-body">{children}</div>
			<div className="landing-phone-home" aria-hidden="true" />
		</div>
	</div>;
}
