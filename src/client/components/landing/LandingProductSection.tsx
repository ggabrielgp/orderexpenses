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
		title: "Sincronización por periodo",
		description: "Consulta en el Gmail autorizado los correos de transacciones compatibles para el periodo que elijas.",
	},
	{
		icon: "auto_awesome",
		title: "Clasificación automática",
		description: "Extrae monto, fecha, contraparte y tipo del comprobante, y aplica categorías compatibles con tus reglas.",
		accent: true,
	},
	{
		icon: "receipt_long",
		badge: "PERIODO SELECCIONADO",
		title: "Resumen y detalle mensual",
		description: "Revisa gastos, ingresos, categorías y movimientos; corrige datos, presupuesto o categorías cuando lo necesites.",
	},
];

export function LandingProductSection() {
	return (
		<section className="landing-feature-section landing-product-section" id="producto" aria-labelledby="product-title">
			<div className="landing-shell landing-section-content">
				<RevealOnScroll>
					<div className="landing-section-heading">
						<p className="landing-eyebrow">El producto</p>
						<h2 id="product-title">De tus correos a un mes bajo control.</h2>
						<p>Gastos Controlados transforma datos compatibles de Banco de Chile en una vista que puedes revisar y ajustar.</p>
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
