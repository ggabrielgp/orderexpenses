/**
 * Cycle presets for the setup wizard: pure date decisions that fill the existing start/end inputs.
 *
 * Dates are ISO `YYYY-MM-DD` strings built by hand and day arithmetic uses `Date.UTC`, so nothing
 * depends on the runner's timezone and no date-only string is ever parsed by `new Date(string)`.
 * The end date is inclusive, matching the `#financial-cycle-end-date` input.
 */

/** A calendar day in the viewer's local date; `month` is 1..12. */
export interface CalendarDay {
	year: number;
	month: number;
	day: number;
}

export interface CyclePresetRange {
	startDate: string;
	endDate: string;
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

const pad = (value: number, length: number) => String(value).padStart(length, "0");

function toIso(year: number, month: number, day: number): string {
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Normalises a month that may have left 1..12 (previous or next year). */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
	const index = year * 12 + (month - 1) + delta;
	return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The pay day of a month, clamped to that month's last day when it is shorter. */
function payDayOf(year: number, month: number, payDay: number): number {
	return Math.min(payDay, daysInMonth(year, month));
}

function dayBefore(year: number, month: number, day: number): string {
	const date = new Date(Date.UTC(year, month - 1, day) - DAY_MILLISECONDS);
	return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** The last Monday-to-Friday day of a month; holidays are not considered. */
export function lastBusinessDayOf(year: number, month: number): number {
	let day = daysInMonth(year, month);
	for (;;) {
		const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
		if (weekday !== 0 && weekday !== 6) return day;
		day -= 1;
	}
}

/**
 * From the most recent last business day of a month on or before today to the day before the next
 * month's last business day. A month that ends on a weekend pays on the previous Friday.
 */
export function lastBusinessDayCycle(today: CalendarDay): CyclePresetRange {
	const thisMonth = lastBusinessDayOf(today.year, today.month);
	const start =
		today.day >= thisMonth
			? { year: today.year, month: today.month, day: thisMonth }
			: (() => {
					const previous = shiftMonth(today.year, today.month, -1);
					return { ...previous, day: lastBusinessDayOf(previous.year, previous.month) };
				})();
	const next = shiftMonth(start.year, start.month, 1);
	return {
		startDate: toIso(start.year, start.month, start.day),
		endDate: dayBefore(next.year, next.month, lastBusinessDayOf(next.year, next.month)),
	};
}

/** The first through the last day of today's month. */
export function calendarMonthCycle(today: CalendarDay): CyclePresetRange {
	return {
		startDate: toIso(today.year, today.month, 1),
		endDate: toIso(today.year, today.month, daysInMonth(today.year, today.month)),
	};
}

/**
 * From the most recent pay day on or before today to the day before the next pay day. A pay day
 * beyond a month's length falls on that month's last day.
 *
 * @throws RangeError when `payDay` is not an integer from 1 to 31.
 */
export function payDayCycle(today: CalendarDay, payDay: number): CyclePresetRange {
	if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) {
		throw new RangeError("payDay must be an integer from 1 to 31");
	}
	const thisMonthPayDay = payDayOf(today.year, today.month, payDay);
	const start =
		today.day >= thisMonthPayDay
			? { year: today.year, month: today.month, day: thisMonthPayDay }
			: (() => {
					const previous = shiftMonth(today.year, today.month, -1);
					return { ...previous, day: payDayOf(previous.year, previous.month, payDay) };
				})();
	const next = shiftMonth(start.year, start.month, 1);
	return {
		startDate: toIso(start.year, start.month, start.day),
		endDate: dayBefore(next.year, next.month, payDayOf(next.year, next.month, payDay)),
	};
}
