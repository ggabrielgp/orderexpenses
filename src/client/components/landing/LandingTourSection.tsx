import type { CSSProperties } from "react";
import { LandingPhoneFrame } from "./LandingPhoneFrame";
import { LandingPhoneScreen, type LandingPhoneScreenProps } from "./LandingPhoneScreen";
import { LandingTourSlider } from "./LandingTourSlider";
import "./landing-brand.css";
import "./landing-tour.css";

const READ_ONLY = "Datos de ejemplo, solo lectura.";

interface TourScreen extends Pick<LandingPhoneScreenProps, "view" | "scenario" | "focus"> {
	workflow: string;
	/** Short name: the position buttons and the iframe title. */
	label: string;
	/** Text alternative of the screen. */
	description: string;
}

/**
 * Five different screens of the real demo, each at 390px (S25). The first is the one the slider opens on;
 * the hero phone already shows "Ajustado", so the tour shows the other two states of the gauge, the
 * charts that explain the spending and the movements list.
 */
const TOUR_SCREENS: readonly TourScreen[] = [
	{
		workflow: "gauge-calm", view: "summary", scenario: "calm", label: "Medidor del mes: En ritmo",
		description: `Pantalla de ejemplo del Resumen con el medidor del mes en estado En ritmo: lo que llevas gastado va por debajo de lo que ya pasó del período. Muestra cuánto te queda, cuánto por día y una frase con la proyección de cierre. ${READ_ONLY}`,
	},
	{
		workflow: "gauge-over", view: "summary", scenario: "over", label: "Medidor del mes: Vas rápido",
		description: `Pantalla de ejemplo del Resumen con el medidor del mes en estado Vas rápido: lo que llevas gastado supera en más de diez puntos lo que ya pasó del período, y la frase dice cuánto faltaría al cierre. ${READ_ONLY}`,
	},
	{
		workflow: "spending", view: "summary", scenario: "tight", focus: "spending", label: "Gasto por día de la semana",
		description: `Pantalla de ejemplo del Resumen, en el gráfico de gasto por día de la semana del período, con sus pestañas y el total. ${READ_ONLY}`,
	},
	{
		workflow: "categories", view: "summary", scenario: "tight", focus: "categories", label: "¿A dónde se fue tu dinero?",
		description: `Pantalla de ejemplo del Resumen, en la distribución del gasto por categoría: un gráfico de anillo y la lista de categorías con su monto y su porcentaje. ${READ_ONLY}`,
	},
	{
		workflow: "movements", view: "movements", label: "Movimientos del período",
		description: `Pantalla de ejemplo de Movimientos: las cifras del período, los filtros por categoría y tipo, y la lista de movimientos con comercio, monto, fecha y categoría. ${READ_ONLY}`,
	},
];

const tourLabels = TOUR_SCREENS.map((screen) => screen.label);

/** `style` is the slider's: it sets the slide's visual position (CSS `order`) without moving the node. */
function TourPhone({ screen, style }: { screen: TourScreen; style?: CSSProperties }) {
	return (
		<li className="tour-item" style={style}>
			<article data-workflow={screen.workflow} aria-label={screen.label}>
				<div className="landing-tour-illustration">
					<LandingPhoneFrame className="landing-tour-phone">
						{/* Below the fold: every tour phone loads lazily, none shifts the page. */}
						<LandingPhoneScreen view={screen.view} scenario={screen.scenario} focus={screen.focus}
							title={`${screen.label}, demo de Gastos Controlados`} description={screen.description} />
					</LandingPhoneFrame>
				</div>
			</article>
		</li>
	);
}

export function LandingTourSection() {
	return (
		<section className="tour landing-tour landing-feature-section" id="recorrido" aria-labelledby="landing-tour-title">
			<div className="landing-shell">
				<header className="landing-section-heading">
					<p className="landing-eyebrow">Recorrido por la app</p>
					<h2 id="landing-tour-title">Un período. Cada gasto en su lugar.</h2>
					<p>Mira tu medidor del mes en cada estado (En ritmo, Ajustado y Vas rápido), cómo se reparte tu gasto y tus movimientos.</p>
				</header>
				<p className="landing-tour-notice">Estas son pantallas reales de la demo, con datos de ejemplo: aquí no se pueden usar. Abre la demo para explorarlas.</p>
				<LandingTourSlider labels={tourLabels}>
					{TOUR_SCREENS.map((screen) => <TourPhone key={screen.workflow} screen={screen} />)}
				</LandingTourSlider>
				<div className="landing-tour-footer"><a className="landing-primary-button" href="/app/demo">Explorar la demo <span aria-hidden="true">↗</span></a><p>Sin conectar tu cuenta.</p></div>
			</div>
		</section>
	);
}
