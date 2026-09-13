import { RevealOnScroll } from "./RevealOnScroll";

interface Step {
	number: string;
	title: string;
	description: string;
}

const steps: readonly Step[] = [
	{
		number: "01",
		title: "Autoriza Gmail",
		description: "Conecta Google y concede acceso de lectura para consultar mensajes compatibles de Banco de Chile.",
	},
	{
		number: "02",
		title: "Elige el periodo",
		description: "Selecciona el mes o periodo que quieres revisar antes de iniciar la consulta.",
	},
	{
		number: "03",
		title: "Sincroniza comprobantes",
		description: "Busca en Gmail los correos de transacciones compatibles para el periodo seleccionado.",
	},
	{
		number: "04",
		title: "Organiza el mes",
		description: "Extrae campos compatibles y agrupa compras, transferencias, pagos e ingresos.",
	},
	{
		number: "05",
		title: "Revisa y ajusta",
		description: "Explora el dashboard y detalle; corrige datos, categorías, presupuesto o gastos manuales.",
	},
];

export function LandingHowItWorksSection() {
	return (
		<section className="landing-how-it-works-section" id="como-funciona" aria-labelledby="steps-title">
			<div className="landing-shell">
				<RevealOnScroll>
					<div className="landing-how-it-works-heading">
						<p className="landing-eyebrow">Cómo funciona</p>
						<h2 id="steps-title">De tu Gmail a un mes ordenado, en cinco pasos.</h2>
						<p>Tú eliges qué periodo consultar. Gastos Controlados encuentra los comprobantes compatibles, organiza la información y te deja revisar cada resultado.</p>
					</div>
				</RevealOnScroll>
				<RevealOnScroll>
					<ol className="landing-steps">
						{steps.map((step) => (
							<li key={step.number}>
								<span className="landing-step-number">{step.number}</span>
								<div>
									<h3>{step.title}</h3>
									<p>{step.description}</p>
								</div>
							</li>
						))}
					</ol>
				</RevealOnScroll>
			</div>
		</section>
	);
}
