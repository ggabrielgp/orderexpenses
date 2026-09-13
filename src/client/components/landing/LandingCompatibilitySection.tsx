import { RevealOnScroll } from "./RevealOnScroll";

const compatibility = {
	eyebrow: "Compatibilidad bancaria",
	title: "Disponible actualmente para Banco de Chile.",
	lead: "Próximamente incorporaremos más bancos.",
	description: "La compatibilidad se agrega banco por banco porque cada institución utiliza plantillas diferentes en sus correos de comprobantes de transacciones.",
} as const;

export function LandingCompatibilitySection() {
	return (
		<section className="landing-compatibility-section" id="compatibilidad" aria-labelledby="compatibility-title">
			<div className="landing-shell">
				<RevealOnScroll>
					<div className="landing-compatibility-panel">
						<div className="landing-compatibility-title">
							<span className="landing-compatibility-icon">
								<span className="material-symbols-outlined" aria-hidden="true">account_balance</span>
							</span>
							<div>
								<p className="landing-eyebrow">{compatibility.eyebrow}</p>
								<h2 id="compatibility-title">{compatibility.title}</h2>
							</div>
						</div>
						<div className="landing-compatibility-copy">
							<p>{compatibility.lead}</p>
							<p>{compatibility.description}</p>
						</div>
					</div>
				</RevealOnScroll>
			</div>
		</section>
	);
}
