import { RevealOnScroll } from "./RevealOnScroll";

export function LandingSecuritySection() {
	return (
		<section className="landing-security-section" id="seguridad" aria-labelledby="security-title">
			<div className="landing-shell">
				<RevealOnScroll>
					<div className="landing-security-content">
						<div>
							<p className="landing-eyebrow">Seguridad y datos</p>
							<h2 id="security-title">Tus datos, con las reglas claras.</h2>
						</div>
						<div className="landing-security-details">
							<p>
								<span className="material-symbols-outlined landing-security-icon" aria-hidden="true">mark_email_read</span>
								<span>Google solicita permiso de solo lectura de Gmail y acceso a tu perfil y correo electrónico. El permiso de Gmail no se limita a los correos del banco; no permite enviar ni modificar mensajes. Se consultan mensajes compatibles de Banco de Chile para el periodo seleccionado.</span>
							</p>
							<details>
								<summary>Qué se guarda y por cuánto tiempo</summary>
								<p>Los comprobantes de Gmail se procesan en memoria para mostrar los movimientos, sin guardar un historial completo de esos gastos en la base de datos. La app puede conservar el resumen en la caché de la pestaña.</p>
								<p>Se guardan tokens de acceso y perfil de Google (nombre, correo y foto), además de tus correcciones, movimientos ocultos, movimientos manuales, categorías, reglas, periodos e ingresos informados. No hay un plazo de eliminación automática definido.</p>
							</details>
							<details>
								<summary>Cómo desconectar y revocar el acceso</summary>
								<p>En Configuración → Perfil, Desconectar Gmail elimina los tokens y el perfil guardados por la app; no revoca el permiso en Google y no elimina tus datos manuales, correcciones ni configuración.</p>
								<p>Para revocar el permiso, retira el acceso de Gastos Controlados desde tus <a href="https://myaccount.google.com/connections">conexiones de terceros en Google</a>. Revocar ese permiso tampoco elimina los datos que guardaste en la app.</p>
							</details>
						</div>
					</div>
				</RevealOnScroll>
			</div>
		</section>
	);
}
