import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import "./pace-curve.css";
import type { RecognizedExpenseMovement } from "../movements/manualExpense";
import { formatClp } from "../movements/movementSummary";
import type { DashboardPace } from "./dashboardPace";
import { buildPaceCurve, type PaceCurvePoint } from "./paceCurve";

export interface PaceCurvePanelProps {
	pace: DashboardPace;
	periodStartDate: string;
	periodEndExclusive: string;
	movements: readonly RecognizedExpenseMovement[];
}

const DEFAULT_WIDTH = 560;

function findNearestPointIndex(points: readonly PaceCurvePoint[], svgX: number): number {
	let bestIdx = 0;
	let bestDist = Infinity;
	for (let i = 0; i < points.length; i++) {
		const d = Math.abs(points[i].x - svgX);
		if (d < bestDist) {
			bestDist = d;
			bestIdx = i;
		}
	}
	return bestIdx;
}

export function PaceCurvePanel({
	pace,
	periodStartDate,
	periodEndExclusive,
	movements,
}: PaceCurvePanelProps) {
	const [activeIdx, setActiveIdx] = useState<number | null>(null);
	const [chartWidth, setChartWidth] = useState(DEFAULT_WIDTH);
	const svgWrapRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const el = svgWrapRef.current;
		if (!el) return;
		const updateWidth = () => {
			const next = Math.round(el.getBoundingClientRect().width);
			if (next > 0) setChartWidth(next);
		};
		updateWidth();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(updateWidth);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const chartHeight = chartWidth < 480 ? 132 : 164;

	const curve = useMemo(
		() =>
			buildPaceCurve({
				startDate: periodStartDate,
				endDateExclusive: periodEndExclusive,
				pace,
				movements,
				width: chartWidth,
				height: chartHeight,
			}),
		[periodStartDate, periodEndExclusive, pace, movements, chartWidth, chartHeight],
	);

	if (!curve.hasCurve) return null;

	const activePoint =
		activeIdx !== null && activeIdx >= 0 && activeIdx < curve.actualPoints.length
			? curve.actualPoints[activeIdx]
			: null;

	const dotFill =
		curve.deviationTone === "over"
			? "var(--state-over)"
			: curve.deviationTone === "tight"
				? "var(--state-tight)"
				: "var(--state-calm)";

	const barWidth = Math.max(
		3,
		Math.min(12, Math.floor((curve.plotRight - curve.plotLeft) / Math.max(14, curve.actualPoints.length * 1.9))),
	);

	function pointFromPointer(e: PointerEvent<HTMLDivElement>): number | null {
		const rect = svgWrapRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return null;
		const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left));
		return findNearestPointIndex(curve.actualPoints, (x / rect.width) * chartWidth);
	}

	function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
		const idx = pointFromPointer(e);
		if (idx !== null) setActiveIdx(idx);
	}

	function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
		const idx = pointFromPointer(e);
		if (idx !== null) setActiveIdx(idx);
	}

	function handlePointerLeave(e: PointerEvent<HTMLDivElement>) {
		if (e.pointerType === "mouse") setActiveIdx(null);
	}

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const last = curve.actualPoints.length - 1;
		const current = activeIdx ?? last;
		if (e.key === "ArrowLeft") {
			e.preventDefault();
			setActiveIdx(Math.max(0, current - 1));
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			setActiveIdx(Math.min(last, current + 1));
		} else if (e.key === "Home") {
			e.preventDefault();
			setActiveIdx(0);
		} else if (e.key === "End") {
			e.preventDefault();
			setActiveIdx(last);
		} else if (e.key === "Escape") {
			setActiveIdx(null);
		}
	}

	const tooltipLeftPct = activePoint
		? Math.min(82, Math.max(22, (activePoint.x / chartWidth) * 100))
		: 50;

	return (
		<section className="react-pace-curve" aria-labelledby="react-pace-curve-title">
			<div className="react-pace-curve-head">
				<div>
					<h3 id="react-pace-curve-title" className="react-pace-curve-title">
						Curva de ritmo acumulado
					</h3>
					<p className="react-pace-curve-sub">
						Línea continua: acumulado real · Barras: gasto de cada día · Punteada: ritmo parejo.
					</p>
				</div>
				{curve.deviationLabel && (
					<span className={`react-pace-curve-badge react-pace-curve-badge--${curve.deviationTone}`}>
						{curve.deviationLabel}
					</span>
				)}
			</div>

			<div className="react-pace-curve-frame">
				<div
					ref={svgWrapRef}
					className="react-pace-curve-interactive"
					tabIndex={0}
					role="slider"
					aria-label="Explorar gasto diario en la curva"
					aria-valuemin={1}
					aria-valuemax={curve.actualPoints.length}
					aria-valuenow={(activeIdx ?? curve.actualPoints.length - 1) + 1}
					aria-valuetext={
						activePoint
							? `${activePoint.dateLabel}: ${formatClp(activePoint.dailySpend)} en el día, ${formatClp(activePoint.cumulative)} acumulado`
							: `${curve.todayLabel}: ${formatClp(curve.actualAtToday)}`
					}
					onPointerMove={handlePointerMove}
					onPointerDown={handlePointerDown}
					onPointerLeave={handlePointerLeave}
					onBlur={() => setActiveIdx(null)}
					onKeyDown={handleKeyDown}
				>
					{activePoint && (
						<div
							className="react-pace-curve-tooltip"
							style={{ left: `${tooltipLeftPct}%` }}
							role="status"
							aria-live="polite"
						>
							<span className="react-pace-curve-tooltip-date">{activePoint.dateLabel}</span>
							<strong className="react-pace-curve-tooltip-amt">
								{formatClp(activePoint.dailySpend)}
							</strong>
							<span className="react-pace-curve-tooltip-cum">
								(acum. {formatClp(activePoint.cumulative)})
							</span>
						</div>
					)}

					<svg
						className="react-pace-curve-svg"
						width={chartWidth}
						height={chartHeight}
						viewBox={`0 0 ${chartWidth} ${chartHeight}`}
						aria-hidden="true"
					>
						{/* Horizontal Y-axis reference grid + short CLP labels */}
						{curve.yTicks.map((tick) => (
							<g key={`${tick.label}-${tick.y}`}>
								<line
									x1={curve.plotLeft}
									y1={tick.y}
									x2={curve.plotRight}
									y2={tick.y}
									stroke="var(--color-line-strong)"
									strokeOpacity={tick.isCap ? "0.7" : "0.4"}
									strokeWidth="1"
									strokeDasharray={tick.isCap ? "4 3" : undefined}
								/>
								<text
									x={curve.plotLeft - 6}
									y={tick.y + 3}
									textAnchor="end"
									className="react-pace-curve-ytick"
								>
									{tick.label}
								</text>
							</g>
						))}

						{/* Subtle daily spend bars along baseline so spending jumps are obvious */}
						{curve.actualPoints.map((p) => {
							if (p.barHeight <= 0) return null;
							const isSelected = activePoint?.dayIndex === p.dayIndex;
							return (
								<rect
									key={p.dayIndex}
									x={p.x - barWidth / 2}
									y={curve.plotBottom - p.barHeight}
									width={barWidth}
									height={p.barHeight}
									rx="2"
									fill={dotFill}
									fillOpacity={isSelected ? "0.52" : "0.18"}
								/>
							);
						})}

						{/* Soft area fill under cumulative curve */}
						{curve.actualAreaPath && (
							<path d={curve.actualAreaPath} fill={dotFill} fillOpacity="0.07" />
						)}

						{/* Ideal linear pace dashed line */}
						{curve.idealLine && (
							<line
								x1={curve.idealLine.x1}
								y1={curve.idealLine.y1}
								x2={curve.idealLine.x2}
								y2={curve.idealLine.y2}
								stroke="var(--color-ink-muted)"
								strokeOpacity="0.65"
								strokeWidth="1.75"
								strokeDasharray="6 5"
							/>
						)}

						{/* Actual cumulative spending curve */}
						<polyline
							fill="none"
							stroke={dotFill}
							strokeWidth="2.75"
							strokeLinecap="round"
							strokeLinejoin="round"
							points={curve.actualPolyline}
						/>

						{/* Today vertical marker when not scrubbing */}
						{!activePoint && curve.todayPoint && (
							<g>
								<line
									x1={curve.todayPoint.x}
									y1={curve.todayPoint.y}
									x2={curve.todayPoint.x}
									y2={curve.plotBottom}
									stroke={dotFill}
									strokeOpacity="0.35"
									strokeWidth="1.5"
									strokeDasharray="3 3"
								/>
								<circle
									cx={curve.todayPoint.x}
									cy={curve.todayPoint.y}
									r="5"
									fill={dotFill}
									stroke="var(--color-surface)"
									strokeWidth="2.5"
								/>
							</g>
						)}

						{/* Active hover/touch crosshair + dot */}
						{activePoint && (
							<g>
								<line
									x1={activePoint.x}
									y1={curve.plotTop}
									x2={activePoint.x}
									y2={curve.plotBottom}
									stroke="var(--color-ink-muted)"
									strokeOpacity="0.55"
									strokeWidth="1.5"
									strokeDasharray="3 3"
								/>
								<circle cx={activePoint.x} cy={activePoint.y} r="9" fill={dotFill} fillOpacity="0.2" />
								<circle
									cx={activePoint.x}
									cy={activePoint.y}
									r="5"
									fill={dotFill}
									stroke="var(--color-surface)"
									strokeWidth="2.5"
								/>
							</g>
						)}
					</svg>
				</div>

				<div className="react-pace-curve-legend">
					<span>{curve.startLabel}</span>
					<span>{curve.todayLabel}</span>
					<span>{curve.endLabel}</span>
				</div>
			</div>
		</section>
	);
}
