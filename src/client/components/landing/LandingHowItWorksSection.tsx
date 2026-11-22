import { RevealOnScroll } from "./RevealOnScroll";

interface Step {
	number: string;
	title: string;
	description: string;
}

const steps: readonly Step[] = [
	{
		number: "01",
		title: "Conectar",
		description: "Autoriza con Google el acceso de lectura a tu Gmail. Antes verás qué leemos, qué nunca hacemos y cómo salir; el detalle de permisos y datos está en Seguridad y datos.",
	},
	{
		number: "02",
		title: "Tu período",
		description: "Elige cuándo empieza: Mes calendario, Desde mi día de pago u Otro rango. Suma tu ingreso (es opcional) y sincroniza para consultar los comprobantes compatibles de Banco de Chile.",
	},
	{
		number: "03",
		title: "Tu medidor",
		description: "Con tu ingreso, ve cuánto te queda y si vas En ritmo, Ajustado o Vas rápido. Explora el resumen y los movimientos; corrige datos y categorías o agrega gastos manuales.",
	},
];

export function LandingHowItWorksSection() {
	return (
		<section className="landing-how-it-works-section" id="como-funciona" aria-labelledby="steps-title">
			<div className="landing-shell">
				<RevealOnScroll>
					<div className="landing-how-it-works-heading">
						<p className="landing-eyebrow">Cómo funciona</p>
						<h2 id="steps-title">De tu Gmail a tu medidor del mes, en tres pasos.</h2>
						<p>Tú eliges tu período. Gastos Controlados encuentra los comprobantes compatibles, organiza la información y te deja revisar cada resultado.</p>
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
