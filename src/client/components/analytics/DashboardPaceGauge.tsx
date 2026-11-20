import { useId } from "react";
import "./dashboard-pace.css";
import { PACE_STATE_LABELS, type DashboardPace, type DashboardPaceState } from "./dashboardPace";

/**
 * Month gauge (identity B, artboards 02/08): a ring of income spent with a tick for the share of the
 * cycle gone by, the money left, the per-day allowance, a state with word and icon, and one sentence.
 * Presentational only: `getDashboardPace` owns every decision and the surface owns the add-income action.
 */

export interface DashboardPaceGaugeProps {
	pace: DashboardPace;
	formatClp?: (amount: number) => string;
	/** Offered only when income is missing; omitted (e.g. in the demo) the action is not rendered. */
	onAddIncome?: () => void;
}

const RING_RADIUS = 80;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_CENTER = 108;
const STATE_ICONS: Record<DashboardPaceState, string> = { calm: "✓", tight: "!", over: "↑" };

const defaultFormatClp = (amount: number) => new Intl.NumberFormat("es-CL", {
	style: "currency", currency: "CLP", maximumFractionDigits: 0,
}).format(amount);

const percent = (share: number) => Math.round(share * 100);
const roundToThousand = (amount: number) => Math.round(amount / 1000) * 1000;

export function DashboardPaceGauge({ pace, formatClp = defaultFormatClp, onAddIncome }: DashboardPaceGaugeProps) {
	const labelId = useId();

	if (pace.kind === "no-income") {
		return (
			<section className="react-pace-gauge react-pace-gauge--none" aria-labelledby={labelId}>
				<div className="react-pace-gauge-body">
					<small id={labelId} className="react-pace-gauge-label">Gastado en el ciclo</small>
					<strong className="react-pace-gauge-amount">{formatClp(pace.totalSpending)}</strong>
					<p className="react-pace-gauge-sentence">Agrega tu ingreso del ciclo para saber si vas en ritmo.</p>
					{onAddIncome ? (
						<button type="button" className="react-pace-gauge-action" onClick={onAddIncome}>Agregar ingreso</button>
					) : null}
				</div>
			</section>
		);
	}

	const spentPercent = percent(pace.spent);
	const elapsedPercent = percent(pace.elapsed);
	const arcLength = Math.min(Math.max(pace.spent, 0), 1) * RING_CIRCUMFERENCE;
	const tickDegrees = Math.round(pace.elapsed * 360 * 100) / 100;
	const overspent = pace.remaining < 0;
	const projectedAmount = formatClp(roundToThousand(Math.abs(pace.projectedBalance)));
	const sentence = pace.projectedBalance >= 0
		? `Llevas ${spentPercent}% del ingreso y pasó el ${elapsedPercent}% del ciclo. Si sigues así, cierras con unos ${projectedAmount} de sobra.`
		: `Llevas ${spentPercent}% del ingreso y pasó el ${elapsedPercent}% del ciclo. Si sigues así, terminas unos ${projectedAmount} bajo cero.`;
	const perDayLine = pace.daysLeft === 0 ? "Ciclo cerrado" : overspent ? null : `${formatClp(pace.perDay)} por día`;

	return (
		<section className={`react-pace-gauge react-pace-gauge--${pace.state}`} aria-labelledby={labelId}>
			<div className="react-pace-gauge-ring">
				<svg width="216" height="216" viewBox="0 0 216 216" role="img"
					aria-label={`Gastaste ${spentPercent}% de tu ingreso; pasó el ${elapsedPercent}% del ciclo`}>
					<circle className="react-pace-gauge-track" cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" strokeWidth="18" />
					{arcLength > 0 ? (
						<circle className="react-pace-gauge-arc" cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" strokeWidth="18"
							strokeLinecap="round" strokeDasharray={`${arcLength.toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`}
							transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`} />
					) : null}
					<g transform={`rotate(${tickDegrees} ${RING_CENTER} ${RING_CENTER})`}>
						<path className="react-pace-gauge-tick" d="M108 16v24" strokeWidth="4" strokeLinecap="round" />
					</g>
				</svg>
				<div className="react-pace-gauge-center">
					<small id={labelId} className="react-pace-gauge-label">{overspent ? "Te pasaste por" : "Te quedan"}</small>
					<strong className="react-pace-gauge-amount">{formatClp(Math.abs(pace.remaining))}</strong>
					{perDayLine ? <em className="react-pace-gauge-per-day">{perDayLine}</em> : null}
				</div>
			</div>
			<div className="react-pace-gauge-body">
				<span className="react-pace-gauge-pill">
					<span className="react-pace-gauge-pill-icon" aria-hidden="true">{STATE_ICONS[pace.state]}</span>
					<span>{PACE_STATE_LABELS[pace.state]}</span>
				</span>
				<p className="react-pace-gauge-sentence">{sentence}</p>
			</div>
		</section>
	);
}
