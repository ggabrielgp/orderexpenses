import { RevealOnScroll } from "./RevealOnScroll";
import type { DemoDashboardData } from "../../demo-data";
import { LandingDashboardPreview } from "./LandingDashboardPreview";
import { LandingPhoneFrame } from "./LandingPhoneFrame";

export function LandingHero({ data = null, previewError = null }: { data?: DemoDashboardData | null; previewError?: string | null }) {
	const available = data && data.currentPeriodInflow > 0
		? new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })
			.format(data.currentPeriodInflow - data.currentPeriodSpending)
		: null;
	return (
		<section className="landing-hero" aria-labelledby="hero-title">
			<div className="landing-shell landing-hero-grid">
				<RevealOnScroll className="landing-hero-copy">
					<p className="landing-hero-badge"><span className="material-symbols-outlined" aria-hidden="true">bolt</span>Tu periodo, más claro</p>
					<h1 id="hero-title"><span>Tus comprobantes, convertidos</span><span>en un resumen claro.</span></h1>
					<p className="landing-hero-description">Organiza los comprobantes de Banco de Chile que llegan a tu Gmail. Elige un periodo y sincroniza para revisar tus gastos, organizados por categoría y con datos que puedes corregir.</p>
					<div className="landing-hero-actions">
						<a className="landing-primary-button" href="/app">Comenzar ahora<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></a>
						<div className="landing-demo-action"><a className="landing-secondary-button" href="/app/demo">Probar demo</a><span>Sin conectar tu cuenta</span></div>
					</div>
					<dl className="landing-hero-facts">
						<div><dt>Fuente actual</dt><dd>Banco de Chile</dd></div>
						<div><dt>Vista</dt><dd>Resumen mensual</dd></div>
						<div><dt>Control</dt><dd>Siempre editable</dd></div>
					</dl>
				</RevealOnScroll>
				<RevealOnScroll className="landing-stage-reveal">
					<figure className="landing-stage" aria-label="Vista ilustrativa del dashboard mensual de Gastos Controlados">
						<LandingPhoneFrame>
							<LandingDashboardPreview data={data} previewError={previewError} />
						</LandingPhoneFrame>
						<div className="landing-info-card landing-connected">
							<span className="landing-info-icon material-symbols-outlined" aria-hidden="true">mail</span>
							<div className="landing-info-copy"><h3>Gmail</h3><p><i aria-hidden="true" />Conectado</p></div>
						</div>
						<div className="landing-info-card landing-budget">
							<span className="landing-info-icon material-symbols-outlined" aria-hidden="true">account_balance_wallet</span>
							<div className="landing-info-copy"><h3>Saldo disponible</h3><p><span>{data ? available ?? "Sin ingreso informado" : previewError ? "Ejemplo no disponible" : "Cargando ejemplo…"}</span><span>Datos de ejemplo</span></p></div>
						</div>
						<div className="landing-info-card landing-sync-note">
							<span className="landing-info-icon material-symbols-outlined" aria-hidden="true">sync</span>
							<div className="landing-info-copy"><h3>{data ? `${data.movements.length} movimientos` : "Movimientos"}</h3><p>Datos de ejemplo</p></div>
						</div>
						<figcaption className="landing-stage-caption">Vista ilustrativa · datos de ejemplo</figcaption>
					</figure>
				</RevealOnScroll>
			</div>
		</section>
	);
}
