import type { DashboardPace } from "./dashboardPace";

export interface PaceCurveMovement {
	amount: number;
	counterparty?: string | null;
	occurredAt?: string | null;
	date?: string | null;
	hasTime?: boolean;
}

export interface PaceCurveDayMovement {
	counterparty: string;
	amount: number;
	timeLabel: string | null;
}

export interface PaceCurvePoint {
	dayIndex: number;
	dateLabel: string;
	x: number;
	y: number;
	barHeight: number;
	dailySpend: number;
	cumulative: number;
	idealAtDay: number | null;
	movements: PaceCurveDayMovement[];
}

export interface PaceCurveYTick {
	y: number;
	label: string;
	isCap?: boolean;
}

export interface PaceCurveModel {
	hasCurve: boolean;
	startLabel: string;
	todayLabel: string;
	endLabel: string;
	plotLeft: number;
	plotRight: number;
	plotTop: number;
	plotBottom: number;
	yTicks: PaceCurveYTick[];
	idealLine: { x1: number; y1: number; x2: number; y2: number } | null;
	actualPoints: PaceCurvePoint[];
	actualPolyline: string;
	actualAreaPath: string;
	todayPoint: PaceCurvePoint | null;
	deviationAmount: number | null;
	deviationLabel: string | null;
	deviationTone: "calm" | "tight" | "over";
	actualAtToday: number;
}

const MS_PER_DAY = 86_400_000;
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function parseIsoDay(iso: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
	if (!match) return null;
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
}

function extractTimeLabel(movement: PaceCurveMovement): string | null {
	if (movement.hasTime === false) return null;
	if (!movement.occurredAt) return null;
	const match = /T(\d{2}:\d{2})/.exec(movement.occurredAt);
	return match ? match[1] : null;
}

function formatShortDay(utcDay: number): string {
	const d = new Date(utcDay * MS_PER_DAY);
	return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

function formatCompactClp(amount: number): string {
	const abs = Math.abs(amount);
	if (abs === 0) return "$0";
	if (abs >= 1_000_000) {
		const m = abs / 1_000_000;
		const formatted = m >= 10 ? Math.round(m).toString() : m.toFixed(1).replace(".", ",").replace(/,0$/, "");
		return `$${formatted}M`;
	}
	if (abs >= 1_000) {
		return `$${Math.round(abs / 1_000)}k`;
	}
	return `$${Math.round(abs)}`;
}

function extractMovementDay(movement: PaceCurveMovement, startDay: number, endDay: number): number | null {
	if (movement.occurredAt) {
		const parsed = parseIsoDay(movement.occurredAt);
		if (parsed !== null) return parsed;
	}
	if (movement.date && movement.date !== "—") {
		const iso = parseIsoDay(movement.date);
		if (iso !== null) return iso;
		const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(movement.date.trim());
		if (dmy) {
			return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) / MS_PER_DAY;
		}
		const short = /^(\d{1,2})\s+([a-záéíóú]{3})/i.exec(movement.date.trim());
		if (short) {
			const mIdx = MONTHS_SHORT.indexOf(short[2].toLowerCase());
			if (mIdx >= 0) {
				const startDate = new Date(startDay * MS_PER_DAY);
				const candidate = Date.UTC(startDate.getUTCFullYear(), mIdx, Number(short[1])) / MS_PER_DAY;
				if (candidate >= startDay && candidate < endDay) return candidate;
				const nextYear = Date.UTC(startDate.getUTCFullYear() + 1, mIdx, Number(short[1])) / MS_PER_DAY;
				if (nextYear >= startDay && nextYear < endDay) return nextYear;
			}
		}
	}
	return null;
}

function formatShortClp(amount: number): string {
	return `$${Math.round(Math.abs(amount)).toLocaleString("es-CL")}`;
}

export function buildPaceCurve(input: {
	startDate: string;
	endDateExclusive: string;
	pace: DashboardPace;
	movements: readonly PaceCurveMovement[];
	width?: number;
	height?: number;
}): PaceCurveModel {
	const svgWidth = Math.max(180, Math.round(input.width ?? 560));
	const svgHeight = Math.max(100, Math.round(input.height ?? 148));
	const plotLeft = 48;
	const plotRight = svgWidth - 12;
	const plotTop = 14;
	const plotBottom = svgHeight - 12;

	const startDay = parseIsoDay(input.startDate);
	const endDay = parseIsoDay(input.endDateExclusive);
	if (startDay === null || endDay === null || endDay <= startDay) {
		return {
			hasCurve: false,
			startLabel: "",
			todayLabel: "",
			endLabel: "",
			plotLeft,
			plotRight,
			plotTop,
			plotBottom,
			yTicks: [],
			idealLine: null,
			actualPoints: [],
			actualPolyline: "",
			actualAreaPath: "",
			todayPoint: null,
			deviationAmount: null,
			deviationLabel: null,
			deviationTone: "calm",
			actualAtToday: input.pace.totalSpending,
		};
	}

	const totalDays = Math.max(1, Math.round(endDay - startDay));
	const elapsedDays =
		input.pace.kind === "income"
			? Math.min(totalDays, Math.max(1, input.pace.elapsedDays))
			: Math.min(totalDays, Math.max(1, Math.round(input.pace.elapsed * totalDays)));

	const dailySpend = new Array<number>(totalDays).fill(0);
	const dailyMovements: PaceCurveDayMovement[][] = Array.from({ length: totalDays }, () => []);
	let datedSum = 0;

	for (const m of input.movements) {
		if (!Number.isFinite(m.amount) || m.amount <= 0) continue;
		const day = extractMovementDay(m, startDay, endDay);
		if (day === null) continue;
		const idx = Math.floor(day - startDay);
		if (idx >= 0 && idx < totalDays) {
			dailySpend[idx] += m.amount;
			datedSum += m.amount;
			dailyMovements[idx].push({
				counterparty: (m.counterparty ?? "").trim() || "Movimiento",
				amount: m.amount,
				timeLabel: extractTimeLabel(m),
			});
		}
	}

	for (const list of dailyMovements) {
		list.sort((a, b) => (a.timeLabel ?? "99:99").localeCompare(b.timeLabel ?? "99:99"));
	}

	const plotDailySpend = dailySpend.slice(0, elapsedDays);
	if (datedSum === 0 && input.pace.totalSpending > 0) {
		const perDay = input.pace.totalSpending / elapsedDays;
		for (let i = 0; i < elapsedDays; i++) plotDailySpend[i] = perDay;
	}

	const cumulativeByDay: number[] = [];
	let running = 0;
	for (let i = 0; i < elapsedDays; i++) {
		running += plotDailySpend[i];
		cumulativeByDay.push(running);
	}

	const lastRaw = cumulativeByDay[cumulativeByDay.length - 1] ?? 0;
	const plotCumulative = cumulativeByDay.slice();
	if (lastRaw > 0 && Math.abs(lastRaw - input.pace.totalSpending) > 1) {
		const ratio = input.pace.totalSpending / lastRaw;
		for (let i = 0; i < plotCumulative.length; i++) {
			plotCumulative[i] = plotCumulative[i] * ratio;
		}
	}

	const incomeAmount = input.pace.kind === "income" ? input.pace.incomeAmount : null;
	const maxYValue = Math.max(
		incomeAmount ?? 0,
		input.pace.totalSpending,
		...cumulativeByDay,
		1,
	);
	const maxDailySpend = Math.max(...dailySpend.slice(0, elapsedDays), 1);
	const maxBarHeight = Math.round((plotBottom - plotTop) * 0.34);

	const toX = (dayIdx: number) =>
		totalDays === 1
			? plotRight
			: plotLeft + (dayIdx / (totalDays - 1)) * (plotRight - plotLeft);
	const toY = (val: number) =>
		plotBottom - (Math.min(Math.max(val, 0), maxYValue) / maxYValue) * (plotBottom - plotTop);

	const yTicks: PaceCurveYTick[] = [
		{ y: plotBottom, label: "$0" },
		{ y: Math.round(toY(maxYValue * 0.5) * 10) / 10, label: formatCompactClp(maxYValue * 0.5) },
		{
			y: Math.round(toY(incomeAmount ?? maxYValue) * 10) / 10,
			label: formatCompactClp(incomeAmount ?? maxYValue),
			isCap: incomeAmount !== null,
		},
	];

	const actualPoints: PaceCurvePoint[] = plotCumulative.map((cum, idx) => ({
		dayIndex: idx,
		dateLabel: formatShortDay(startDay + idx),
		x: Math.round(toX(idx) * 10) / 10,
		y: Math.round(toY(cum) * 10) / 10,
		barHeight: dailySpend[idx] > 0 ? Math.max(4, Math.round((dailySpend[idx] / maxDailySpend) * maxBarHeight)) : 0,
		dailySpend: Math.round(dailySpend[idx]),
		cumulative: Math.round(cum),
		idealAtDay:
			incomeAmount !== null && incomeAmount > 0
				? Math.round(incomeAmount * ((idx + 1) / totalDays))
				: null,
		movements: dailyMovements[idx],
	}));

	const todayPoint = actualPoints[actualPoints.length - 1] ?? null;
	const actualPolyline = actualPoints.map((p) => `${p.x},${p.y}`).join(" ");
	const actualAreaPath =
		actualPoints.length >= 2
			? `M ${actualPoints[0].x},${plotBottom} L ${actualPoints.map((p) => `${p.x},${p.y}`).join(" L ")} L ${actualPoints[actualPoints.length - 1].x},${plotBottom} Z`
			: "";

	let idealLine: PaceCurveModel["idealLine"] = null;
	let deviationAmount: number | null = null;
	let deviationLabel: string | null = null;
	let deviationTone: "calm" | "tight" | "over" = "calm";

	if (incomeAmount !== null && incomeAmount > 0 && input.pace.kind === "income") {
		idealLine = {
			x1: plotLeft,
			y1: plotBottom,
			x2: plotRight,
			y2: Math.round(toY(incomeAmount) * 10) / 10,
		};
		const idealAtToday = incomeAmount * input.pace.elapsed;
		deviationAmount = Math.round(input.pace.totalSpending - idealAtToday);
		deviationTone = input.pace.state;
		if (Math.abs(deviationAmount) < 1000) {
			deviationLabel = "En ritmo ideal";
		} else if (deviationAmount > 0) {
			deviationLabel = `+${formatShortClp(deviationAmount)} sobre ritmo`;
		} else {
			deviationLabel = `-${formatShortClp(deviationAmount)} bajo ritmo`;
		}
	}

	return {
		hasCurve: actualPoints.length > 0,
		startLabel: formatShortDay(startDay),
		todayLabel: `Hoy · día ${elapsedDays}`,
		endLabel: formatShortDay(endDay - 1),
		plotLeft,
		plotRight,
		plotTop,
		plotBottom,
		yTicks,
		idealLine,
		actualPoints,
		actualPolyline,
		actualAreaPath,
		todayPoint,
		deviationAmount,
		deviationLabel,
		deviationTone,
		actualAtToday: input.pace.totalSpending,
	};
}

/**
 * Horizontal center (px) for a tooltip that is translated -50% on X, clamped so the whole
 * tooltip stays inside [0, chartWidth]. Prevents horizontal page scroll near the edges on mobile.
 * A tooltip wider than the chart is pinned to the chart center.
 */
export function clampTooltipCenter(x: number, tooltipWidth: number, chartWidth: number): number {
	const half = tooltipWidth / 2;
	if (tooltipWidth >= chartWidth) return chartWidth / 2;
	return Math.min(chartWidth - half, Math.max(half, x));
}
