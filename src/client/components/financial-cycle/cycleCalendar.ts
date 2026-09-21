import type { FinancialPeriod } from "../../api/types";
import {
	CYCLE_END_BEFORE_START_MESSAGE,
	CYCLE_END_REQUIRED_MESSAGE,
	CYCLE_START_REQUIRED_MESSAGE,
} from "./cycleSettings";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../../shared/review-period.js";

/**
 * Calendar decisions for the financial-cycle setup/edit wizard: the month grid, the bounded month
 * navigation, the start/end range selection and its validation.
 *
 * All arithmetic is date-only and UTC based, so a day never shifts with the runner's timezone; "today"
 * is the viewer's local calendar date, read from the local `Date` components, which is the day the
 * person actually sees. The calendar is bounded by the configured review period: it navigates only
 * across the months that period touches, and every day outside it (or in the future) is disabled. The
 * existing text/date inputs remain authoritative for a range the calendar cannot express, which is why
 * the calendar never mutates the draft on its own.
 *
 * No React import: these are decisions, not rendering.
 */

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
/** A hard cap so a malformed period can never spin the month-key loop forever. */
const MAX_CALENDAR_MONTHS = 600;

/** Monday-first headings, matching the legacy wizard (`["L", "M", "M", "J", "V", "S", "D"]`). */
export const CALENDAR_WEEKDAY_HEADINGS: ReadonlyArray<{ short: string; full: string }> = [
	{ short: "L", full: "lunes" },
	{ short: "M", full: "martes" },
	{ short: "M", full: "miércoles" },
	{ short: "J", full: "jueves" },
	{ short: "V", full: "viernes" },
	{ short: "S", full: "sábado" },
	{ short: "D", full: "domingo" },
];

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("es-CL", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
const READABLE_DATE_FORMATTER = new Intl.DateTimeFormat("es-CL", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

export interface DateParts {
	year: number;
	month: number;
	day: number;
}

/** Parses a `YYYY-MM-DD` string into its parts, rejecting an impossible calendar date. */
export function parseDateOnly(value: unknown): DateParts | null {
	if (typeof value !== "string") return null;
	const match = DATE_ONLY_PATTERN.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return { year, month, day };
}

export function isValidDateOnly(value: unknown): boolean {
	return parseDateOnly(value) !== null;
}

export function formatDateOnly(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The viewer's local calendar date; read from local components, never from a UTC instant slice. */
export function getCurrentDateKey(referenceDate: Date = new Date()): string {
	return formatDateOnly(
		referenceDate.getFullYear(),
		referenceDate.getMonth() + 1,
		referenceDate.getDate(),
	);
}

/** Date-only arithmetic on a UTC timeline, so a day never shifts under a non-UTC timezone. */
export function shiftDateOnly(dateKey: string, days: number): string {
	const parts = parseDateOnly(dateKey);
	if (parts === null) throw new TypeError("dateKey must be a valid YYYY-MM-DD date");
	const timestamp = Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MILLISECONDS;
	const date = new Date(timestamp);
	return formatDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseMonthKey(monthKey: unknown): { year: number; month: number } {
	const match = typeof monthKey === "string" ? MONTH_KEY_PATTERN.exec(monthKey) : null;
	if (!match) throw new TypeError("monthKey must be a valid YYYY-MM value");
	const year = Number(match[1]);
	const month = Number(match[2]);
	if (month < 1 || month > 12) throw new TypeError("monthKey month must be 1..12");
	return { year, month };
}

/** `YYYY-MM` of a `YYYY-MM-DD` date key. */
export function getMonthKey(dateKey: string): string {
	const parts = parseDateOnly(dateKey);
	if (parts === null) throw new TypeError("dateKey must be a valid YYYY-MM-DD date");
	return `${formatDateOnly(parts.year, parts.month, 1)}`.slice(0, 7);
}

/** Shifts a `YYYY-MM` month key by a whole number of months. */
export function shiftMonthKey(monthKey: string, offset: number): string {
	const { year, month } = parseMonthKey(monthKey);
	const total = year * 12 + (month - 1) + offset;
	const nextYear = Math.floor(total / 12);
	const nextMonth = (((total % 12) + 12) % 12) + 1;
	return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export function getMonthLabel(monthKey: string): string {
	const { year, month } = parseMonthKey(monthKey);
	return MONTH_LABEL_FORMATTER.format(Date.UTC(year, month - 1, 1));
}

/** Full Spanish date, the accessible name of a day button and the range summary value. */
export function getReadableDate(dateKey: string): string {
	const parts = parseDateOnly(dateKey);
	if (parts === null) return "";
	return READABLE_DATE_FORMATTER.format(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/**
 * The months the configured review period spans, in calendar order. This is the whole of the
 * calendar's navigation: a month outside the period is not reachable, which is how the surface
 * avoids walking a month axis the period model does not have.
 */
export function getCalendarMonthKeys(period: FinancialPeriod): string[] {
	const reviewPeriod = ReviewPeriod.create(period);
	const first = getMonthKey(reviewPeriod.startDate);
	const last = getMonthKey(reviewPeriod.visibleEndDate);
	const keys: string[] = [];
	let cursor = first;
	while (cursor <= last && keys.length < MAX_CALENDAR_MONTHS) {
		keys.push(cursor);
		cursor = shiftMonthKey(cursor, 1);
	}
	return keys;
}

export interface CalendarRange {
	/** Inclusive first day, as the draft holds it; `""` while unset. */
	startDate: string;
	/** Inclusive last day, as the draft holds it; `""` while the range is still awaiting its end. */
	endDate: string;
	/** True after the first click, while the surface is waiting for the range's end. */
	awaitingEnd: boolean;
}

export function createCalendarRange(startDate: string, endDate: string): CalendarRange {
	return { startDate: startDate ?? "", endDate: endDate ?? "", awaitingEnd: false };
}

/**
 * The two-click range rule the legacy calendar used: the first click sets the start and clears the
 * end, the second sets the end and swaps the two when the user clicked an earlier day. The pure
 * reducer keeps the rule out of React state so the swap is provable without a DOM.
 */
export function selectCalendarDate(range: CalendarRange, dateKey: string): CalendarRange {
	if (!range.awaitingEnd || !range.startDate) {
		return { startDate: dateKey, endDate: "", awaitingEnd: true };
	}
	if (dateKey <= range.startDate) {
		return { startDate: dateKey, endDate: range.startDate, awaitingEnd: false };
	}
	return { startDate: range.startDate, endDate: dateKey, awaitingEnd: false };
}

export interface CalendarDayCell {
	dateKey: string;
	/** Day of month, the button's visible text. */
	day: number;
	/** Full Spanish date, the button's accessible name. */
	label: string;
	/** False for a day outside the configured review period or a padded leading blank cell. */
	inPeriod: boolean;
	/** True when the day is after today; the port disables it (legacy did not). */
	isFuture: boolean;
	/** True while the day is inside the selected range (or is the pending start). */
	selected: boolean;
	/** True when the button must be inert: outside the period, in the future, or saving. */
	disabled: boolean;
}

export interface CalendarMonthGrid {
	monthKey: string;
	label: string;
	weekdayHeadings: ReadonlyArray<{ short: string; full: string }>;
	/** Blank cells before day 1, Monday-first. */
	leadingBlanks: number;
	dayCount: number;
	days: CalendarDayCell[];
}

function isSelected(dateKey: string, startDate: string, endDate: string): boolean {
	if (!startDate) return false;
	if (!endDate) return dateKey === startDate;
	const lower = startDate <= endDate ? startDate : endDate;
	const upper = startDate <= endDate ? endDate : startDate;
	return dateKey >= lower && dateKey <= upper;
}

/**
 * One month of the calendar. A day is disabled when it falls outside the configured review period
 * or after today, so the surface can never offer a day the period model would reject or a future
 * date the data cannot yet describe.
 */
export function buildCalendarMonthGrid(
	monthKey: string,
	options: { period: FinancialPeriod; range: CalendarRange; today: string },
): CalendarMonthGrid {
	const { year, month } = parseMonthKey(monthKey);
	const reviewPeriod = ReviewPeriod.create(options.period);
	const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const leadingBlanks = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
	const { startDate, endDate } = options.range;

	const days: CalendarDayCell[] = [];
	for (let day = 1; day <= dayCount; day += 1) {
		const dateKey = formatDateOnly(year, month, day);
		const inPeriod = reviewPeriod.includes(dateKey);
		const isFuture = dateKey > options.today;
		days.push({
			dateKey,
			day,
			label: getReadableDate(dateKey),
			inPeriod,
			isFuture,
			selected: isSelected(dateKey, startDate, endDate),
			disabled: !inPeriod || isFuture,
		});
	}

	return {
		monthKey,
		label: getMonthLabel(monthKey),
		weekdayHeadings: CALENDAR_WEEKDAY_HEADINGS,
		leadingBlanks,
		dayCount,
		days,
	};
}

export type CalendarRangeValidation = { ok: true } | { ok: false; message: string };

/**
 * The date half of the wizard's validation, with the same copy the text inputs already show. It is
 * owned here so the calendar's inline error and the draft validation cannot disagree about which
 * date the user has to fix first.
 */
export function validateCalendarRange(startDate: string, endDate: string): CalendarRangeValidation {
	const start = String(startDate ?? "").trim();
	const end = String(endDate ?? "").trim();
	if (!start) return { ok: false, message: CYCLE_START_REQUIRED_MESSAGE };
	if (!end) return { ok: false, message: CYCLE_END_REQUIRED_MESSAGE };
	try {
		ReviewPeriod.fromInclusive(start, end);
	} catch {
		return { ok: false, message: CYCLE_END_BEFORE_START_MESSAGE };
	}
	return { ok: true };
}

export interface CalendarRangeSummary {
	/** Readable start, or the pending substitute. */
	startLabel: string;
	/** Readable end, or the pending substitute. */
	endLabel: string;
	/** One sentence stating the current selection or what is still pending. */
	message: string;
}

export function getCalendarRangeSummary(range: CalendarRange): CalendarRangeSummary {
	const startLabel = range.startDate ? getReadableDate(range.startDate) : "Pendiente";
	const endLabel = range.endDate ? getReadableDate(range.endDate) : "Pendiente";
	let message: string;
	if (range.awaitingEnd) {
		message = `Inicio ${startLabel}. Elige la fecha de término en el calendario.`;
	} else if (range.startDate && range.endDate) {
		message = `Desde el ${startLabel} hasta el ${endLabel}.`;
	} else {
		message = "Elige la fecha de inicio y luego la de término en el calendario.";
	}
	return { startLabel, endLabel, message };
}
