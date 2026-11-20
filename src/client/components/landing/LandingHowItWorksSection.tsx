import { RevealOnScroll } from "./RevealOnScroll";

interface Step {
	number: string;
	title: string;
	description: string;
}

const steps: readonly Step[] = [
	{
		number: "01",
		title: "Conecta Gmail",
		description: "Autoriza el acceso de lectura con Google. Revisa los permisos y el uso de tus datos en Seguridad y datos.",
	},
	{
		number: "02",
		title: "Elige y sincroniza el periodo",
		description: "Selecciona las fechas e inicia la sincronización para consultar los comprobantes compatibles de Banco de Chile.",
	},
	{
		number: "03",
		title: "Revisa tus gastos",
		description: "Explora el resumen y los movimientos; corrige datos y categorías o agrega gastos manuales.",
	},
];

export function LandingHowItWorksSection() {
	return (
		<section className="landing-how-it-works-section" id="como-funciona" aria-labelledby="steps-title">
			<div className="landing-shell">
				<RevealOnScroll>
					<div className="landing-how-it-works-heading">
						<p className="landing-eyebrow">Cómo funciona</p>
						<h2 id="steps-title">De tu Gmail a un mes ordenado, en tres pasos.</h2>
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
