import { useEffect, useState } from "react";
import { loadDemoDashboardData, type DemoDashboardData } from "../demo-data";
import { LandingTourSection } from "../components/landing/LandingTourSection";
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
	const [previewData, setPreviewData] = useState<DemoDashboardData | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);

	// One public fixture feeds both illustrations; no account data or mutation containers.
	useEffect(() => {
		const controller = new AbortController();
		loadDemoDashboardData(controller.signal).then((data) => {
			if (!controller.signal.aborted) setPreviewData(data);
		}).catch(() => {
			if (!controller.signal.aborted) {
				setPreviewError("No pudimos cargar los datos de ejemplo. Puedes abrir la demo.");
			}
		});
		return () => controller.abort();
	}, []);

	return (
		<div className="landing-page">
			<LandingHeader session={session} />
			<main id="contenido">
				<LandingHero data={previewData} previewError={previewError} />
				<LandingProblemSection />
				<LandingProductSection />
				<LandingTourSection data={previewData} previewError={previewError} />
				<LandingCompatibilitySection />
				<LandingHowItWorksSection />
				<LandingSecuritySection />
			</main>
			<LandingFooter />
		</div>
	);
}
