import { LandingHeader } from "../components/landing/LandingHeader";
import { LandingHero } from "../components/landing/LandingHero";
import { LandingProblemSection } from "../components/landing/LandingProblemSection";
import { LandingProductSection } from "../components/landing/LandingProductSection";
import { LandingCompatibilitySection } from "../components/landing/LandingCompatibilitySection";
import { LandingHowItWorksSection } from "../components/landing/LandingHowItWorksSection";
import { LandingSecuritySection } from "../components/landing/LandingSecuritySection";
import { LandingFooter } from "../components/landing/LandingFooter";
import { useLandingSession } from "../hooks/useLandingSession";

export function LandingPage() {
	const session = useLandingSession();

	return (
		<div className="landing-page">
			<LandingHeader session={session} />
			<main id="contenido">
				<LandingHero />
				<LandingProblemSection />
				<LandingProductSection />
				<LandingCompatibilitySection />
				<LandingHowItWorksSection />
				<LandingSecuritySection />
			</main>
			<LandingFooter />
		</div>
	);
}
