import type { FinancialPeriod } from "../../api/types";
import { formatPeriodLabel } from "../movements/manualExpense";
import type { RecognizedExpenseMovement } from "../movements/manualExpense";

/**
 * Daily/weekly spending chart decisions for the authenticated summary: the Monday-to-Sunday week
 * buckets, the full-period weekday aggregate, and the disclosure of the summarized outflows the
 * chart had to leave out.
 *
 * Legacy rendered this through `renderMonthlyDailyChart` (`public/app.js:2232-2324`), fed by
 * `buildMonthlyDailySpending` (`:2156-2193`). The decisions live here as pure functions for the same
 * reason the ranking decisions do: the test harness has no DOM, and what the bars may claim is worth
 * proving without rendering a card.
 *
 * The rows it receives are the recognized expenses the summary already projected and loaded for the
 * configured period, so this module issues no request and adds no endpoint, and it uses no chart
 * library. The bars are proportional with no minimum height: legacy floored every non-zero fill at
 * 12% (`:2291`), so a small day looked like a sixth of the largest one, and this port must not
 * reproduce that.
 *
 * All date arithmetic is UTC/date-string based. Legacy mixed local `Date` methods with the passed
 * dates, which can shift a day under a non-local timezone; the buckets here cannot.
 *
 * No React import: these are decisions, not rendering.
 */

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The full-period tab id and label; the legacy default was `chartTab: "month"` (`public/app.js:145`). */
export const FULL_PERIOD_TAB_ID = "period";
export const FULL_PERIOD_LABEL = "Periodo completo";

/** Legacy labelled each week with a running counter (`buildMonthlyDailySpending`, `public/app.js:2169`). */
const WEEK_LABEL_PREFIX = "Semana";

// Fixed formatters with an explicit UTC time zone: the day a movement lands on must not depend on
// the runner's locale timezone.
const shortDateFormatter = new Intl.DateTimeFormat("es-CL", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});
const shortWeekdayFormatter = new Intl.DateTimeFormat("es-CL", {
	weekday: "short",
	timeZone: "UTC",
});

export interface SpendingChartDay {
	/** Calendar key `YYYY-MM-DD` for a week day, or `weekday-N` for the period aggregate. */
	key: string;
	/** Short Spanish weekday label, always Monday first. */
	label: string;
	/** Short date detail inside the period; empty for a padded day. */
	detail: string;
	/** False for the padding days a Monday-to-Sunday week adds around the period. */
	isInPeriod: boolean;
	/** Raw sum of the recognizable movements that landed on this day. */
	total: number;
}

export interface SpendingChartBar extends SpendingChartDay {
	/**
	 * Proportional height against the selected series maximum, 0..100, with no minimum floor. The
	 * region renders this directly, so a small day is drawn at its real ratio.
	 */
	heightPercent: number;
}

export interface SpendingChartWeek {
	/** Stable tab id, `week-0`, `week-1`, ... in calendar order. */
	id: string;
	/** Display label, `Semana 1`, `Semana 2`, ... */
	label: string;
	/** Visible range the week covers inside the period, e.g. `1 feb al 1 feb`. */
	range: string;
	/** Seven days, Monday first, including the days that pad the period. */
	days: SpendingChartDay[];
}

export interface SpendingChartTab {
	id: string;
	label: string;
}

export interface SpendingChartSeries {
	id: string;
	label: string;
	detail: string;
	/** Accessible name for the bar region. */
	ariaLabel: string;
	/** Bars of the selected series, with their proportional heights already decided. */
	days: SpendingChartBar[];
	/** Raw sum of the selected series. */
	total: number;
	/** Largest day total in the selected series; zero when every day is zero. */
	max: number;
}

export interface SpendingChart {
	weeks: SpendingChartWeek[];
	/** Full-period aggregate by weekday, Monday first, from the countable in-period movements. */
	periodDays: SpendingChartDay[];
	/** One tab per week plus the full period. */
	tabs: SpendingChartTab[];
	/** Configured period label, e.g. `2026-02-01 – 2026-02-28`. */
	periodLabel: string;
	/** Raw total of the countable outflows, from raw amounts and never from heights. */
	total: number;
	/** Countable movements that landed in the period. */
	countedCount: number;
	/** True only when at least one countable day has a positive total. */
	hasData: boolean;
	/** Message shown instead of bars while `hasData` is false. */
	emptyMessage: string | null;
	/** Recognized outflows excluded because they carry no known amount. */
	unknownAmountCount: number;
	/** Recognized outflows with an amount but no usable date. */
	unknownDateCount: number;
	/** One statement per excluded fact, present only when that count is nonzero. */
	disclosures: string[];
}

/**
 * Parses a `YYYY-MM-DD` string into a UTC timestamp, rejecting both an out-of-range string and an
 * impossible calendar date (for example `2026-02-30`), exactly like `ReviewPeriod`.
 */
function parseDateOnly(value: unknown): number | null {
	if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) return null;
	const [year, month, day] = value.split("-").map(Number);
	const timestamp = Date.UTC(year, month - 1, day);
	const date = new Date(timestamp);
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return timestamp;
}

function formatDateOnly(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
		date.getUTCDate(),
	).padStart(2, "0")}`;
}

/** The weekday index Monday-first, so `0` is Monday and `6` is Sunday. */
function getWeekdayIndex(timestamp: number): number {
	return (new Date(timestamp).getUTCDay() + 6) % 7;
}

function buildDay(timestamp: number, startTimestamp: number, visibleEnd: number): SpendingChartDay {
	const isInPeriod = timestamp >= startTimestamp && timestamp <= visibleEnd;
	const date = new Date(timestamp);
	return {
		key: formatDateOnly(timestamp),
		label: shortWeekdayFormatter.format(date),
		detail: isInPeriod ? shortDateFormatter.format(date) : "",
		isInPeriod,
		total: 0,
	};
}

function buildWeekRange(weekStart: number, startTimestamp: number, visibleEnd: number): string {
	const start = Math.max(weekStart, startTimestamp);
	const end = Math.min(weekStart + 6 * DAY_MILLISECONDS, visibleEnd);
	return `${shortDateFormatter.format(new Date(start))} al ${shortDateFormatter.format(new Date(end))}`;
}

function getHeightPercent(total: number, max: number): number {
	// No minimum floor: a zero or negative day draws no bar, and a small day draws its real ratio.
	if (max <= 0 || total <= 0) return 0;
	return Math.round((total / max) * 100);
}

function getExitNoun(count: number): string {
	return count === 1 ? "salida reconocida" : "salidas reconocidas";
}

/**
 * One statement per excluded fact, so the unknown-amount count and the unknown-date count are never
 * folded together. Legacy dropped both silently.
 */
function buildDisclosures(unknownAmountCount: number, unknownDateCount: number): string[] {
	const disclosures: string[] = [];
	if (unknownAmountCount > 0) {
		disclosures.push(
			`${unknownAmountCount} ${getExitNoun(unknownAmountCount)} del periodo ${
				unknownAmountCount === 1 ? "no tiene" : "no tienen"
			} monto conocido y no se ${
				unknownAmountCount === 1 ? "incluye" : "incluyen"
			} en este gráfico.`,
		);
	}
	if (unknownDateCount > 0) {
		disclosures.push(
			`${unknownDateCount} ${getExitNoun(unknownDateCount)} del periodo con monto conocido ${
				unknownDateCount === 1 ? "no tiene" : "no tienen"
			} una fecha válida y no se ${
				unknownDateCount === 1 ? "puede" : "pueden"
			} ubicar en el gráfico.`,
		);
	}
	return disclosures;
}

function getEmptyMessage(countedCount: number): string {
	if (countedCount === 0) {
		return "Aún no hay gastos reconocidos con monto y fecha dentro del periodo para graficar.";
	}
	return "Los gastos reconocidos del periodo no suman un monto positivo: no hay barras que mostrar.";
}

function buildSeries(
	id: string,
	label: string,
	detail: string,
	ariaLabel: string,
	days: SpendingChartDay[],
): SpendingChartSeries {
	const max = days.reduce((highest, day) => Math.max(highest, day.total), 0);
	const total = days.reduce((sum, day) => sum + day.total, 0);
	return {
		id,
		label,
		detail,
		ariaLabel,
		total,
		max,
		days: days.map((day) => ({ ...day, heightPercent: getHeightPercent(day.total, max) })),
	};
}

/**
 * Everything the spending chart needs for one render of the configured period, derived from the
 * recognized expense rows the summary already loaded. One pass over the movements fills both the
 * weekly buckets and the full-period weekday aggregate at once, so no two views of the same period
 * can disagree.
 *
 * - the period `[startDate, endDateExclusive)` is covered by whole Monday-to-Sunday weeks, so the
 *   first and last week carry padded days that show no value claim;
 * - only finite amounts are summed, and only movements whose date falls inside the period are
 *   counted;
 * - a movement whose date is unusable is counted separately and disclosed, never placed on a day;
 * - `unknownAmountCount` is the count of recognized outflows the projection excluded because they
 *   carry no usable amount. It is disclosed, never summed, because an unknown amount is not a zero.
 */
export function getSpendingChart(
	movements: RecognizedExpenseMovement[],
	period: FinancialPeriod,
	unknownAmountCount: number,
): SpendingChart {
	const startTimestamp = parseDateOnly(period?.startDate);
	const endExclusiveTimestamp = parseDateOnly(period?.endDateExclusive);
	const hasValidPeriod =
		startTimestamp !== null && endExclusiveTimestamp !== null && startTimestamp < endExclusiveTimestamp;

	const weeks: SpendingChartWeek[] = [];
	const periodDays: SpendingChartDay[] = [];
	const daysByKey = new Map<string, SpendingChartDay>();
	let periodLabel = "";

	if (hasValidPeriod && startTimestamp !== null && endExclusiveTimestamp !== null) {
		const visibleEnd = endExclusiveTimestamp - DAY_MILLISECONDS;
		const firstWeekStart =
			startTimestamp - getWeekdayIndex(startTimestamp) * DAY_MILLISECONDS;

		for (let index = 0; index < 7; index += 1) {
			const timestamp = firstWeekStart + index * DAY_MILLISECONDS;
			periodDays.push({
				key: `weekday-${index}`,
				label: shortWeekdayFormatter.format(new Date(timestamp)),
				detail: "",
				isInPeriod: true,
				total: 0,
			});
		}

		for (
			let weekStart = firstWeekStart;
			weekStart <= visibleEnd;
			weekStart += 7 * DAY_MILLISECONDS
		) {
			const days = Array.from({ length: 7 }, (_, index) =>
				buildDay(weekStart + index * DAY_MILLISECONDS, startTimestamp, visibleEnd),
			);
			weeks.push({
				id: `week-${weeks.length}`,
				label: `${WEEK_LABEL_PREFIX} ${weeks.length + 1}`,
				range: buildWeekRange(weekStart, startTimestamp, visibleEnd),
				days,
			});
			for (const day of days) {
				if (day.isInPeriod) daysByKey.set(day.key, day);
			}
		}

		periodLabel = formatPeriodLabel(period);
	}

	let countedCount = 0;
	let total = 0;
	let unknownDateCount = 0;

	for (const movement of movements) {
		// The projection already guarantees a finite amount; the guard keeps a caller that bypasses it
		// from turning the totals into `NaN`.
		if (!Number.isFinite(movement?.amount)) continue;
		const amount = Number(movement.amount);
		const timestamp = parseDateOnly(movement?.date);
		if (timestamp === null) {
			unknownDateCount += 1;
			continue;
		}
		const day = daysByKey.get(formatDateOnly(timestamp));
		if (day === undefined) continue;
		day.total += amount;
		periodDays[getWeekdayIndex(timestamp)].total += amount;
		countedCount += 1;
		total += amount;
	}

	const excludedAmountCount =
		Number.isFinite(unknownAmountCount) && unknownAmountCount > 0
			? Math.trunc(unknownAmountCount)
			: 0;

	return {
		weeks,
		periodDays,
		tabs: [
			...weeks.map((week) => ({ id: week.id, label: week.label })),
			{ id: FULL_PERIOD_TAB_ID, label: FULL_PERIOD_LABEL },
		],
		periodLabel,
		total,
		countedCount,
		hasData: total > 0,
		emptyMessage: total > 0 ? null : getEmptyMessage(countedCount),
		unknownAmountCount: excludedAmountCount,
		unknownDateCount,
		disclosures: buildDisclosures(excludedAmountCount, unknownDateCount),
	};
}

/**
 * The series a tab names. An id that matches no week falls back to the full period, exactly like
 * legacy's `selectedChartSeries` (`public/app.js:2529`), so the container can hold a plain tab id
 * without a null path.
 */
export function getSpendingChartSeries(chart: SpendingChart, tabId: string): SpendingChartSeries {
	const week = chart.weeks.find((item) => item.id === tabId);
	if (week !== undefined) {
		return buildSeries(
			week.id,
			week.label,
			week.range,
			`${week.label}, gasto diario de lunes a domingo`,
			week.days,
		);
	}
	return buildSeries(
		FULL_PERIOD_TAB_ID,
		FULL_PERIOD_LABEL,
		chart.periodLabel,
		`${FULL_PERIOD_LABEL}, total gastado por cada día de la semana`,
		chart.periodDays,
	);
}
