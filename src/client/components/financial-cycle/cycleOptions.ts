/**
 * The "¿Cuándo empieza tu mes?" decisions shared by the first-cycle setup and the edit-period dialog
 * (S20). Everything here is pure: which range an option produces, which option an existing range
 * belongs to, and how a range reads aloud. The range itself still lives in the two forms' own
 * start/end state, so validation, the saved payload and the API calls are the ones they always had.
 */
import { parseDateOnly } from "./cycleCalendar";
import { calendarMonthCycle, payDayCycle, type CalendarDay, type CyclePresetRange } from "./cyclePresets";

export type CycleOptionChoice = "calendar" | "payDay" | "custom";

export const DEFAULT_PAY_DAY = 25;

/** Quick pay day choices; 31 is shown as "Último día" and clamps to each month's end (`payDayCycle`). */
export const PAY_DAY_QUICK_CHOICES: readonly number[] = [1, 5, 15, 25, 31];

export const PAY_DAYS: readonly number[] = Array.from({ length: 31 }, (_, index) => index + 1);

export const payDayLabel = (payDay: number): string => (payDay === 31 ? "Último día" : String(payDay));

/** The range an option puts in the start/end state; "Otro rango" keeps whatever is already there. */
export function resolveCycleOption(
	option: CycleOptionChoice,
	today: CalendarDay,
	payDay: number,
	current: CyclePresetRange,
): CyclePresetRange {
	if (option === "calendar") return calendarMonthCycle(today);
	if (option === "payDay") return payDayCycle(today, payDay);
	return current;
}

/**
 * Which option an already configured range belongs to, so the edit dialog opens on the shortcut that
 * produces it. Anything the shortcuts cannot produce (for example a historical month) opens on
 * "Otro rango" with the calendar and both date inputs, as the dialog always showed them.
 */
export function inferCycleOption(
	range: CyclePresetRange,
	today: CalendarDay,
): { option: CycleOptionChoice; payDay: number } {
	const start = parseDateOnly(range.startDate);
	if (start === null || parseDateOnly(range.endDate) === null) {
		return { option: "custom", payDay: DEFAULT_PAY_DAY };
	}
	const month = calendarMonthCycle(today);
	if (range.startDate === month.startDate && range.endDate === month.endDate) {
		return { option: "calendar", payDay: DEFAULT_PAY_DAY };
	}
	const candidate = payDayCycle(today, start.day);
	if (range.startDate === candidate.startDate && range.endDate === candidate.endDate) {
		return { option: "payDay", payDay: start.day };
	}
	return { option: "custom", payDay: DEFAULT_PAY_DAY };
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** "1 al 30 de noviembre", "25 oct al 24 nov", or with the years when the range crosses one. */
export function formatCycleResult(range: CyclePresetRange): string {
	const start = parseDateOnly(range.startDate);
	const end = parseDateOnly(range.endDate);
	if (start === null || end === null) return "";
	if (start.year === end.year && start.month === end.month) {
		return `${start.day} al ${end.day} de ${MONTHS_LONG[end.month - 1]}`;
	}
	const crossesYear = start.year !== end.year;
	return `${start.day} ${MONTHS_SHORT[start.month - 1]}${crossesYear ? ` ${start.year}` : ""} al ${end.day} ${MONTHS_SHORT[end.month - 1]}${crossesYear ? ` ${end.year}` : ""}`;
}

export type CyclePeriodDescription = { tone: "ok" | "pending" | "invalid"; text: string };

/** The footer summary: "1–30 nov · 30 días", or what is still missing or wrong with the dates. */
export function describeCyclePeriod(range: {
	startDate: string;
	endDate: string;
	awaitingEnd?: boolean;
}): CyclePeriodDescription {
	if (range.awaitingEnd) return { tone: "pending", text: "Elige el término" };
	if (!range.startDate || !range.endDate) return { tone: "pending", text: "Elige las fechas" };
	const start = parseDateOnly(range.startDate);
	const end = parseDateOnly(range.endDate);
	if (start === null || end === null) return { tone: "invalid", text: "Revisa las fechas" };
	const startTime = Date.UTC(start.year, start.month - 1, start.day);
	const endTime = Date.UTC(end.year, end.month - 1, end.day);
	if (endTime < startTime) return { tone: "invalid", text: "Revisa las fechas" };
	const days = Math.round((endTime - startTime) / DAY_MILLISECONDS) + 1;
	const sameMonth = start.year === end.year && start.month === end.month;
	let label: string;
	if (sameMonth) {
		label =
			start.day === end.day
				? `${start.day} ${MONTHS_SHORT[start.month - 1]}`
				: `${start.day}–${end.day} ${MONTHS_SHORT[start.month - 1]}`;
	} else {
		const crossesYear = start.year !== end.year;
		label = `${start.day} ${MONTHS_SHORT[start.month - 1]}${crossesYear ? ` ${start.year}` : ""}–${end.day} ${MONTHS_SHORT[end.month - 1]}${crossesYear ? ` ${end.year}` : ""}`;
	}
	return { tone: "ok", text: `${label} · ${days} ${days === 1 ? "día" : "días"}` };
}
