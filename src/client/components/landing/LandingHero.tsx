import { RevealOnScroll } from "./RevealOnScroll";

export function LandingHero() {
	return (
		<section className="landing-hero" aria-labelledby="hero-title">
			<div className="landing-shell landing-hero-grid">
				<RevealOnScroll className="landing-hero-copy">
					<p className="landing-hero-badge"><span className="material-symbols-outlined" aria-hidden="true">bolt</span>Tu mes, ordenado automáticamente</p>
					<h1 id="hero-title"><span>Controla tus gastos</span><span>sin mover un dedo.</span></h1>
					<p className="landing-hero-description">Organiza los comprobantes de Banco de Chile que llegan a tu Gmail. Elige un periodo y obtén una vista mensual clara, categorizada y editable.</p>
					<div className="landing-hero-actions">
						<a className="landing-primary-button" href="/auth/google">Comenzar ahora<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></a>
						<a className="landing-secondary-button" href="/app/demo">Ver dashboard</a>
					</div>
					<dl className="landing-hero-facts">
						<div><dt>Fuente actual</dt><dd>Banco de Chile</dd></div>
						<div><dt>Vista</dt><dd>Resumen mensual</dd></div>
						<div><dt>Control</dt><dd>Siempre editable</dd></div>
					</dl>
				</RevealOnScroll>
				<RevealOnScroll className="landing-stage-reveal">
					<figure className="landing-stage" aria-label="Vista ilustrativa del dashboard mensual de Gastos Controlados">
						<div className="landing-phone">
							<div className="landing-stage-window">
								<div className="landing-phone-island" aria-hidden="true" />
								<div className="landing-stage-topbar">
									<strong><span className="material-symbols-outlined" aria-hidden="true">account_balance_wallet</span>Gastos Controlados</strong>
								</div>
								<div className="landing-stage-body">
									<div className="landing-stage-title">
										<span>Resumen mensual</span>
										<h2>Agosto 2026</h2>
										<em>Periodo seleccionado</em>
									</div>
									<div className="landing-kpis">
										<Kpi label="Gastos" value="$684.920" featured />
										<Kpi label="Ingresos" value="$920.000" />
										<Kpi label="Balance" value="+$235.080" success />
									</div>
									<div className="landing-stage-card landing-categories">
										<div className="landing-card-heading"><h3>Distribución por categoría</h3><span>Total del mes</span></div>
										<Bars />
									</div>
									<div className="landing-stage-card landing-movements">
										<div className="landing-card-heading"><h3>Movimientos recientes</h3><span>Ver detalle</span></div>
										<Movement name="Supermercado" detail="Alimentación · 18 ago" value="-$42.580" />
										<Movement name="Transferencia recibida" detail="Ingreso · 16 ago" value="+$120.000" success />
									</div>
								</div>
								<div className="landing-phone-home" aria-hidden="true" />
							</div>
						</div>
						<div className="landing-info-card landing-connected">
							<span className="landing-info-icon material-symbols-outlined" aria-hidden="true">mail</span>
							<div className="landing-info-copy"><h3>Gmail</h3><p><i aria-hidden="true" />Conectado</p></div>
						</div>
						<div className="landing-info-card landing-budget">
							<div className="landing-budget-ring" aria-hidden="true" />
							<div className="landing-info-copy"><h3>Presupuesto</h3><p><span>68% utilizado</span><span>$315.080 disponibles</span></p></div>
						</div>
						<div className="landing-info-card landing-sync-note">
							<span className="landing-info-icon material-symbols-outlined" aria-hidden="true">sync</span>
							<div className="landing-info-copy"><h3>12 movimientos</h3><p>Sincronizados</p></div>
						</div>
						<figcaption className="landing-stage-caption">Vista ilustrativa · datos de ejemplo</figcaption>
					</figure>
				</RevealOnScroll>
			</div>
		</section>
	);
}

function Kpi({ label, value, featured = false, success = false }: { label: string; value: string; featured?: boolean; success?: boolean }) {
	return <div className={`landing-kpi ${featured ? "is-featured" : ""}`}><span>{label}</span><b className={success ? "is-success" : ""}>{value}</b></div>;
}

function Bars() {
	return <div className="landing-bars">
		<Bar label="Alimentación" value="38%" /><Bar label="Hogar" value="27%" /><Bar label="Transporte" value="18%" />
	</div>;
}
function Bar({ label, value }: { label: string; value: string }) {
	return <div><p><span>{label}</span><b>{value}</b></p><i><i style={{ width: value }} /></i></div>;
}
function Movement({ name, detail, value, success = false }: { name: string; detail: string; value: string; success?: boolean }) {
	return <div className="landing-movement"><span><b>{name}</b><small>{detail}</small></span><b className={success ? "is-success" : ""}>{value}</b></div>;
}
