/**
 * Cycle pace model for the dashboard month gauge (identity B, spec S3).
 *
 * Compares how much of the income the cycle has consumed (`spent`) with how much of the cycle has gone
 * by (`elapsed`) and decides a state, the money left per remaining day and a straight-line projection.
 * No request, no React and no currency formatting: these are decisions; the gauge owns rendering.
 *
 * ISO dates are parsed manually and day counts use `Date.UTC`: `new Date("YYYY-MM-DD")` is parsed as UTC
 * and shifts the calendar day in negative-offset zones such as America/Santiago.
 */

export type DashboardPaceState = "calm" | "tight" | "over";

/** State words. Never "En control": the gauge only claims a pace, not control. */
export const PACE_STATE_LABELS: Record<DashboardPaceState, string> = {
	calm: "En ritmo",
	tight: "Ajustado",
	over: "Pasado",
};

/** Spending above the elapsed share of the cycle by more than this margin is "over". */
export const PACE_OVER_MARGIN = 0.1;

export const PACE_TIME_ZONE = "America/Santiago";

export interface PaceToday {
	year: number;
	month: number;
	day: number;
}

export interface DashboardPaceInput {
	startDate: string;
	endDateExclusive: string;
	incomeAmount: number | null;
	totalSpending: number;
	today: PaceToday;
}

export interface DashboardPaceNoIncome {
	kind: "no-income";
	totalSpending: number;
	/** Share of the cycle gone by, 0..1. */
	elapsed: number;
	daysLeft: number;
}

export interface DashboardPaceWithIncome {
	kind: "income";
	state: DashboardPaceState;
	incomeAmount: number;
	totalSpending: number;
	/** Income minus spending; negative when the cycle is overspent. */
	remaining: number;
	/** Share of the income spent (not capped), 0..n. */
	spent: number;
	/** Share of the cycle gone by, 0..1. */
	elapsed: number;
	totalDays: number;
	elapsedDays: number;
	daysLeft: number;
	/** Whole CLP available per remaining day; 0 when nothing is left or the cycle is closed. */
	perDay: number;
	projectedSpending: number;
	projectedBalance: number;
}

export type DashboardPace = DashboardPaceNoIncome | DashboardPaceWithIncome;

const MS_PER_DAY = 86_400_000;

const parseIsoDay = (value: string): number => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) throw new RangeError(`Expected a YYYY-MM-DD date, received "${value}"`);
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
};

/** Calendar day of `now` in the America/Santiago zone, independent of the machine's zone. */
export const todayInSantiago = (now: Date): PaceToday => {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: PACE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
	}).formatToParts(now);
	const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
	return { year: read("year"), month: read("month"), day: read("day") };
};

export const getDashboardPace = (input: DashboardPaceInput): DashboardPace => {
	const start = parseIsoDay(input.startDate);
	const totalDays = Math.max(parseIsoDay(input.endDateExclusive) - start, 1);
	const { year, month, day } = input.today;
	// Days from the cycle start through today, inclusive: the start day itself is day 1.
	const rawElapsedDays = Date.UTC(year, month - 1, day) / MS_PER_DAY - start + 1;
	const elapsedDays = Math.min(Math.max(rawElapsedDays, 0), totalDays);
	const elapsed = elapsedDays / totalDays;
	const insidePeriod = rawElapsedDays >= 1 && rawElapsedDays <= totalDays;
	const daysLeft = insidePeriod ? totalDays - elapsedDays + 1 : rawElapsedDays < 1 ? totalDays : 0;
	const { incomeAmount, totalSpending } = input;

	if (incomeAmount === null || !(incomeAmount > 0)) {
		return { kind: "no-income", totalSpending, elapsed, daysLeft };
	}

	const remaining = incomeAmount - totalSpending;
	const spent = totalSpending / incomeAmount;
	// Boundaries are compared by cross-multiplying so `spent == elapsed` is exact, not a float guess:
	// spent > elapsed            <=>  spending * totalDays > elapsedDays * income
	// spent > elapsed + 0.10     <=>  10 * spending * totalDays > (10 * elapsedDays + totalDays) * income
	const aboveElapsed = totalSpending * totalDays > elapsedDays * incomeAmount;
	const aboveMargin = 10 * totalSpending * totalDays > (10 * elapsedDays + totalDays) * incomeAmount;
	const state: DashboardPaceState = remaining < 0 || aboveMargin ? "over" : aboveElapsed ? "tight" : "calm";
	const projectedSpending = elapsed > 0 ? Math.round(totalSpending / elapsed) : totalSpending;

	return {
		kind: "income",
		state,
		incomeAmount,
		totalSpending,
		remaining,
		spent,
		elapsed,
		totalDays,
		elapsedDays,
		daysLeft,
		perDay: daysLeft > 0 ? Math.floor(Math.max(remaining, 0) / daysLeft) : 0,
		projectedSpending,
		projectedBalance: incomeAmount - projectedSpending,
	};
};
