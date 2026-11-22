import { RevealOnScroll } from "./RevealOnScroll";

interface ProductCard {
	icon: string;
	badge?: string;
	title: string;
	description: string;
	accent?: boolean;
}

const productCards: readonly ProductCard[] = [
	{
		icon: "mail",
		badge: "BANCO DE CHILE",
		title: "Sincronización por período",
		description: "Consulta en el Gmail autorizado los correos de transacciones compatibles para el período que elijas.",
	},
	{
		icon: "auto_awesome",
		title: "Clasificación automática",
		description: "Extrae monto, fecha, contraparte y tipo del comprobante, y aplica categorías compatibles con tus reglas.",
		accent: true,
	},
	{
		icon: "speed",
		badge: "PERÍODO ELEGIDO",
		title: "Medidor del mes y detalle",
		description: "Compara cuánto de tu ingreso llevas gastado con cuánto del período ya pasó: En ritmo, Ajustado o Vas rápido. Revisa categorías y movimientos; corrige datos o agrega gastos manuales.",
	},
];

export function LandingProductSection() {
	return (
		<section className="landing-feature-section landing-product-section" id="producto" aria-labelledby="product-title">
			<div className="landing-shell landing-section-content">
				<RevealOnScroll>
					<div className="landing-section-heading">
						<p className="landing-eyebrow">El producto</p>
						<h2 id="product-title">De tus correos a un período bajo control.</h2>
						<p>Gastos Controlados transforma datos compatibles de Banco de Chile en un medidor que te dice si vas En ritmo, Ajustado o Vas rápido, y en movimientos que puedes revisar y ajustar.</p>
					</div>
				</RevealOnScroll>
				<RevealOnScroll>
					<div className="landing-product-grid">
						{productCards.map((card) => (
							<article className="landing-feature-card landing-product-card" key={card.title}>
								<span className={`landing-product-icon ${card.accent ? "is-accent" : ""}`}>
									<span className="material-symbols-outlined" aria-hidden="true">{card.icon}</span>
								</span>
								{card.badge && <span className="landing-product-badge">{card.badge}</span>}
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
