import { useId, useLayoutEffect, useState } from "react";
import "./dashboard-pace.css";
import { runGaugeEntrance } from "./gaugeMotion";
import { PACE_STATE_LABELS, type DashboardPace, type DashboardPaceState } from "./dashboardPace";

/**
 * Month gauge hero (identity B, artboards 02/08 and pulido/01): a full-width card whose ring shows the
 * income spent with a tick for the share of the cycle gone by, the money left as the largest number of
 * the summary, a state with word and icon, one sentence, and the figures behind it (income, spent, days
 * left) stated once. Presentational only: `getDashboardPace` owns every decision and the surface owns
 * the add-income action and the notes it wants shown under the figures.
 *
 * On first render the ring sweeps and the number counts up (700ms, ease-out) and the state pill fades in
 * after the ring. The markup rendered on the server, and under `prefers-reduced-motion`, is the final
 * state with no intermediate value.
 */

export interface DashboardPaceGaugeProps {
	pace: DashboardPace;
	formatClp?: (amount: number) => string;
	/** Offered only when income is missing; omitted (e.g. in the demo) the action is not rendered. */
	onAddIncome?: () => void;
	/** Short facts about the figures (e.g. "35 gastos con monto"), shown once under the stats. */
	notes?: readonly string[];
}

const RING_RADIUS = 118;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_CENTER = 150;
/** Formatted amounts longer than this shrink so they stay inside the ring. */
const LONG_AMOUNT_LENGTH = 9;
const STATE_ICONS: Record<DashboardPaceState, string> = { calm: "✓", tight: "!", over: "↑" };

const defaultFormatClp = (amount: number) => new Intl.NumberFormat("es-CL", {
	style: "currency", currency: "CLP", maximumFractionDigits: 0,
}).format(amount);

const percent = (share: number) => Math.round(share * 100);
const roundToThousand = (amount: number) => Math.round(amount / 1000) * 1000;

export function DashboardPaceGauge({ pace, formatClp = defaultFormatClp, onAddIncome, notes = [] }: DashboardPaceGaugeProps) {
	const labelId = useId();
	// 1 = final values (what the server and reduced motion render); the entrance drives it 0 -> 1 once.
	const [progress, setProgress] = useState(1);
	useLayoutEffect(() => runGaugeEntrance(window, setProgress), []);
	const sweeping = progress < 1;
	const noteLine = notes.length > 0 ? <p className="react-pace-gauge-notes">{notes.join(" · ")}</p> : null;

	if (pace.kind === "no-income") {
		const spentText = formatClp(Math.round(pace.totalSpending * progress));
		return (
			<section className="react-pace-gauge react-pace-gauge--none" aria-labelledby={labelId}>
				<div className="react-pace-gauge-body">
					<small id={labelId} className="react-pace-gauge-label">Gastado en el ciclo</small>
					<strong className={`react-pace-gauge-amount${spentText.length > LONG_AMOUNT_LENGTH ? " react-pace-gauge-amount--long" : ""}`}>{spentText}</strong>
					<p className="react-pace-gauge-sentence">Agrega tu ingreso del ciclo para saber si vas en ritmo.</p>
					{onAddIncome ? (
						<button type="button" className="react-pace-gauge-action" onClick={onAddIncome}>Agregar ingreso</button>
					) : null}
					{noteLine}
				</div>
			</section>
		);
	}

	const spentPercent = percent(pace.spent);
	const elapsedPercent = percent(pace.elapsed);
	const arcLength = Math.min(Math.max(pace.spent, 0), 1) * RING_CIRCUMFERENCE * progress;
	const tickDegrees = Math.round(pace.elapsed * 360 * 100) / 100;
	const overspent = pace.remaining < 0;
	const projectedAmount = formatClp(roundToThousand(Math.abs(pace.projectedBalance)));
	const projection = pace.projectedBalance >= 0
		? <>cierras con unos <b>{projectedAmount}</b> de sobra.</>
		: <>terminas unos <b>{projectedAmount}</b> bajo cero.</>;
	const perDayLine = pace.daysLeft === 0 ? "Ciclo cerrado" : overspent ? null : `${formatClp(pace.perDay)} por día`;
	const remainingAmount = progress >= 1 ? Math.abs(pace.remaining) : Math.round(Math.abs(pace.remaining) * progress);
	const remainingText = formatClp(remainingAmount);
	const cycleDay = pace.elapsedDays === 0 ? "Aún no empieza" : `Día ${pace.elapsedDays} de ${pace.totalDays}`;

	return (
		<section
			className={`react-pace-gauge react-pace-gauge--${pace.state}${sweeping ? " react-pace-gauge--sweeping" : ""}`}
			aria-labelledby={labelId}
		>
			<div className="react-pace-gauge-ring">
				<svg viewBox="0 0 300 300" role="img"
					aria-label={`Gastaste ${spentPercent}% de tu ingreso; pasó el ${elapsedPercent}% del ciclo`}>
					<circle className="react-pace-gauge-track" cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" strokeWidth="22" />
					{pace.spent > 0 ? (
						<circle className="react-pace-gauge-arc" cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" strokeWidth="22"
							strokeLinecap="round" strokeDasharray={`${arcLength.toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`}
							style={arcLength < 1 ? { opacity: 0 } : undefined}
							transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`} />
					) : null}
					<g transform={`rotate(${tickDegrees} ${RING_CENTER} ${RING_CENTER})`}>
						<path className="react-pace-gauge-tick" d="M150 10v46" strokeWidth="9" strokeLinecap="round" />
						<path className="react-pace-gauge-tick-core" d="M150 14v38" strokeWidth="3.5" strokeLinecap="round" />
					</g>
				</svg>
				<div className="react-pace-gauge-center">
					<small id={labelId} className="react-pace-gauge-label">{overspent ? "Te pasaste por" : "Te quedan"}</small>
					<strong className={`react-pace-gauge-amount${remainingText.length > LONG_AMOUNT_LENGTH ? " react-pace-gauge-amount--long" : ""}`}>{remainingText}</strong>
					{perDayLine ? <em className="react-pace-gauge-per-day">{perDayLine}</em> : null}
				</div>
			</div>
			<div className="react-pace-gauge-body">
				<span className="react-pace-gauge-pill">
					<span className="react-pace-gauge-pill-icon" aria-hidden="true">{STATE_ICONS[pace.state]}</span>
					<span>{PACE_STATE_LABELS[pace.state]}</span>
				</span>
				<p className="react-pace-gauge-sentence">
					Llevas <b>{spentPercent}%</b> del ingreso y pasó el <b>{elapsedPercent}%</b> del ciclo. A este ritmo {projection}
				</p>
				<dl className="react-pace-gauge-facts">
					<div><dt>Ingreso del ciclo</dt><dd>{formatClp(pace.incomeAmount)}</dd></div>
					<div><dt>Gastado</dt><dd>{formatClp(pace.totalSpending)}</dd></div>
					<div><dt>Días que quedan</dt><dd>{pace.daysLeft}<small>{cycleDay}</small></dd></div>
				</dl>
				<p className="react-pace-gauge-key">
					<span>
						<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle className="react-pace-gauge-key-dot" cx="7" cy="7" r="6" /></svg>
						Color: lo gastado del ingreso
					</span>
					<span>
						<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect className="react-pace-gauge-tick-key" x="2" y="0" width="10" height="14" rx="3" /><rect className="react-pace-gauge-tick-key-core" x="6" y="1" width="2" height="12" /></svg>
						Raya: hoy
					</span>
				</p>
				{noteLine}
			</div>
		</section>
	);
}
