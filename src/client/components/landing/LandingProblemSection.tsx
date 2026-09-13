import { RevealOnScroll } from "./RevealOnScroll";

const problemCards = [
	{
		icon: "warning",
		title: "Información dispersa",
		description: "Cada movimiento queda aislado en un correo diferente.",
		tone: "is-warning",
	},
	{
		icon: "schedule",
		title: "Tiempo perdido",
		description: "Buscar, leer y ordenar mensajes uno por uno toma tiempo.",
		tone: "is-time",
	},
	{
		icon: "wifi_off",
		title: "Sin una vista común",
		description: "No existe un resumen mensual dentro de la bandeja de entrada.",
		tone: "is-view",
	},
	{
		icon: "description",
		title: "Difícil de corregir",
		description: "El comprobante no refleja tus categorías ni tu presupuesto.",
		tone: "is-correction",
	},
] as const;

export function LandingProblemSection() {
	return (
		<section className="landing-feature-section landing-problem-section" id="problema" aria-labelledby="problem-title">
			<div className="landing-shell landing-section-content">
				<RevealOnScroll>
					<div className="landing-section-heading">
						<p className="landing-eyebrow">El problema</p>
						<h2 id="problem-title">Tus gastos están ahí. Entenderlos no debería ser difícil.</h2>
						<p>Los correos bancarios contienen información útil, pero revisarlos y ordenar el mes manualmente consume tiempo.</p>
					</div>
				</RevealOnScroll>
				<RevealOnScroll>
					<div className="landing-problem-grid">
						{problemCards.map((card) => (
							<article className="landing-feature-card" key={card.title}>
								<span className={`landing-problem-icon ${card.tone}`}>
									<span className="material-symbols-outlined" aria-hidden="true">{card.icon}</span>
								</span>
								<h3>{card.title}</h3>
								<p>{card.description}</p>
							</article>
						))}
					</div>
				</RevealOnScroll>
			</div>
		</section>
	);
}
