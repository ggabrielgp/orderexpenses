import { RevealOnScroll } from "./RevealOnScroll";

export function LandingSecuritySection() {
	return (
		<section className="landing-security-section" id="seguridad" aria-labelledby="security-title">
			<div className="landing-shell">
				<RevealOnScroll>
					<div className="landing-security-content">
						<div>
							<p className="landing-eyebrow">Seguridad y datos</p>
							<h2 id="security-title">Acceso autorizado y acotado.</h2>
						</div>
						<div className="landing-security-details">
							<p>
								<span className="material-symbols-outlined landing-security-icon" aria-hidden="true">mark_email_read</span>
								<span>Se consultan mensajes compatibles de Banco de Chile para el periodo seleccionado.</span>
							</p>
							<p>
								<span className="material-symbols-outlined landing-security-icon" aria-hidden="true">settings</span>
								<span>Correcciones, reglas, movimientos manuales, categorías y presupuesto pueden persistir.</span>
							</p>
						</div>
					</div>
				</RevealOnScroll>
			</div>
		</section>
	);
}
