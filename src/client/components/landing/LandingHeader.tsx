import { useEffect, useRef, useState } from "react";
import type { SessionResponse } from "../../api/types";
import { getGoogleLoginUrl } from "../../api/googleLogin";
import { watchLandingSections } from "./landingNavigation";

interface LandingHeaderProps {
	session: SessionResponse | null;
}

export function LandingHeader({ session }: LandingHeaderProps) {
	const profile = session?.authenticated ? session.profile : null;
	const isAuthenticated = Boolean(profile);
	const identity = profile?.name || profile?.email || null;
	const headerRef = useRef<HTMLElement>(null);
	const [activeSection, setActiveSection] = useState<string | null>(null);

	useEffect(() => {
		const header = headerRef.current;
		if (!header) return;
		const sections = Array.from(document.querySelectorAll<HTMLElement>(
			".landing-page section[id]",
		)).filter((section) => header.querySelector(`a[href="#${section.id}"]`));
		return watchLandingSections(
			sections,
			() => header.getBoundingClientRect().bottom + 16,
			setActiveSection,
			window,
			header,
		);
	}, []);

	return (
		<>
			<a className="landing-skip-link" href="#contenido">Ir al contenido</a>
			<header ref={headerRef} className="landing-header">
				<div className="landing-shell landing-header-content">
					<a className="landing-brand" href="/" aria-label="Gastos Controlados, inicio">
						<span className="material-symbols-outlined landing-brand-icon" aria-hidden="true">account_balance_wallet</span>
						<span>Gastos Controlados</span>
					</a>
					<nav className="landing-nav" aria-label="Navegación principal">
						<a className={activeSection === "producto" ? "is-current" : undefined} aria-current={activeSection === "producto" ? "location" : undefined} href="#producto">Producto</a>
						<a className={activeSection === "como-funciona" ? "is-current" : undefined} aria-current={activeSection === "como-funciona" ? "location" : undefined} href="#como-funciona">Cómo funciona</a>
						<a className={activeSection === "compatibilidad" ? "is-current" : undefined} aria-current={activeSection === "compatibilidad" ? "location" : undefined} href="#compatibilidad">Compatibilidad</a>
						<a className={activeSection === "seguridad" ? "is-current" : undefined} aria-current={activeSection === "seguridad" ? "location" : undefined} href="#seguridad">Seguridad</a>
					</nav>
					<a
						className="landing-primary-button"
						href={isAuthenticated ? "/app" : getGoogleLoginUrl()}
						aria-label={isAuthenticated ? "Ir al dashboard" : "Acceder con Google"}
					>
						{!isAuthenticated && <span className="landing-google-badge" aria-hidden="true"><GoogleIcon /></span>}
						<span className="landing-session-action-label">
							{isAuthenticated ? "Ir al dashboard" : "Acceder con Google"}
						</span>
					</a>
					<span className="landing-identity" hidden={!identity}>{identity}</span>
				</div>
			</header>
		</>
	);
}

function GoogleIcon() {
	return (
		<svg className="landing-google-icon" viewBox="0 0 18 18" aria-hidden="true">
			<path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.876 2.684-6.615Z" />
			<path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.909-2.258c-.806.54-1.836.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
			<path fill="#FBBC05" d="M3.963 10.707A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332Z" />
			<path fill="#EA4335" d="M9 3.579c1.321 0 2.507.454 3.441 1.345l2.582-2.582C13.464.891 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.164 6.656 3.579 9 3.579Z" />
		</svg>
	);
}
