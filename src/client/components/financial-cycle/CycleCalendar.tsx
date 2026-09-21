import { useMemo, useState } from "react";
import type { FinancialPeriod } from "../../api/types";
import {
	buildCalendarMonthGrid,
	getCalendarMonthKeys,
	getCalendarRangeSummary,
	getCurrentDateKey,
	type CalendarRange,
} from "./cycleCalendar";

/**
 * The calendar half of the period wizard: a Monday-first month grid bounded by the configured review
 * period, with a two-click start/end range, a range summary and the date validation error.
 *
 * It renders only the decisions the pure module made (`buildCalendarMonthGrid`, `getCalendarRangeSummary`):
 * the parent owns the range state, so the calendar never edits the draft on its own and the existing
 * date/income inputs keep their unchanged submit behaviour. Days outside the review period or after
 * today are disabled; the selected days carry `aria-pressed` and today carries `aria-current`. The
 * visible month is bounded to the period's own months, so navigation never walks past it.
 *
 * Exported so both the setup form and the edit dialog mount the same surface, and so a static render
 * proves the disabled/future/selected states from what the user reads.
 */
export interface CycleCalendarProps {
	/** Configured review period that bounds both navigation and the selectable days. */
	period: FinancialPeriod;
	/** The draft range the calendar reflects. */
	range: CalendarRange;
	/** Selects one day; the parent runs `selectCalendarDate` and owns the result. */
	onSelectDate: (dateKey: string) => void;
	/** Disables every control while a save is in flight. */
	disabled?: boolean;
	/** The date validation error to announce, or `null`. */
	error?: string | null;
	/** Today's date key; injectable so the future/current states are provable without a clock. */
	today?: string;
}

export function CycleCalendar({
	period,
	range,
	onSelectDate,
	disabled = false,
	error = null,
	today,
}: CycleCalendarProps) {
	const resolvedToday = today ?? getCurrentDateKey();
	const monthKeys = useMemo(() => getCalendarMonthKeys(period), [period]);
	// The visible month starts on the range's own month when it is reachable, and on the period's
	// first month otherwise. It never leaves the bounded `monthKeys` list.
	const defaultMonthKey = useMemo(() => {
		const rangeMonthKey = range.startDate ? range.startDate.slice(0, 7) : "";
		if (rangeMonthKey && monthKeys.includes(rangeMonthKey)) return rangeMonthKey;
		return monthKeys[0] ?? period.startDate.slice(0, 7);
	}, [range.startDate, monthKeys, period.startDate]);
	const [requestedMonthKey, setRequestedMonthKey] = useState(defaultMonthKey);
	const activeMonthKey = monthKeys.includes(requestedMonthKey) ? requestedMonthKey : defaultMonthKey;
	const monthIndex = monthKeys.indexOf(activeMonthKey);
	const grid = useMemo(
		() => buildCalendarMonthGrid(activeMonthKey, { period, range, today: resolvedToday }),
		[activeMonthKey, period, range, resolvedToday],
	);
	const summary = getCalendarRangeSummary(range);

	const canGoPrevious = !disabled && monthIndex > 0;
	const canGoNext = !disabled && monthIndex >= 0 && monthIndex < monthKeys.length - 1;
	const goToMonth = (offset: number) => {
		const nextIndex = monthIndex + offset;
		if (nextIndex < 0 || nextIndex >= monthKeys.length) return;
		setRequestedMonthKey(monthKeys[nextIndex]);
	};

	return (
		<section
			className="react-cycle-calendar"
			aria-label="Calendario del periodo"
			aria-invalid={error !== null}
		>
			<div className="react-cycle-calendar-nav">
				<button
					type="button"
					className="react-cycle-calendar-nav-button"
					aria-label="Mes anterior"
					disabled={!canGoPrevious}
					onClick={() => goToMonth(-1)}
				>
					‹
				</button>
				<strong aria-live="polite">{grid.label}</strong>
				<button
					type="button"
					className="react-cycle-calendar-nav-button"
					aria-label="Mes siguiente"
					disabled={!canGoNext}
					onClick={() => goToMonth(1)}
				>
					›
				</button>
			</div>
			<div className="react-cycle-calendar-grid">
				{grid.weekdayHeadings.map((heading, headingIndex) => (
					// The short letter repeats inside a week, so the accessible name lives on each day button
					// and the heading itself is decorative, exactly like the legacy grid.
					<span
						key={`${heading.full}-${headingIndex}`}
						className="react-cycle-calendar-weekday"
						aria-hidden="true"
					>
						{heading.short}
					</span>
				))}
				{Array.from({ length: grid.leadingBlanks }, (_, blankIndex) => (
					<span
						key={`blank-${blankIndex}`}
						className="react-cycle-calendar-blank"
						aria-hidden="true"
					/>
				))}
				{grid.days.map((day) => {
					const className = day.disabled
						? "react-cycle-calendar-day react-cycle-calendar-day-disabled"
						: day.selected
							? "react-cycle-calendar-day react-cycle-calendar-day-selected"
							: "react-cycle-calendar-day";
					return (
						<button
							key={day.dateKey}
							type="button"
							className={className}
							data-date={day.dateKey}
							aria-label={day.label}
							aria-pressed={day.selected}
							aria-current={day.dateKey === resolvedToday ? "date" : undefined}
							disabled={disabled || day.disabled}
							onClick={() => onSelectDate(day.dateKey)}
						>
							{day.day}
						</button>
					);
				})}
			</div>
			<div className="react-cycle-calendar-summary" role="status">
				<p>{summary.message}</p>
				<dl>
					<div>
						<dt>Inicio</dt>
						<dd>{summary.startLabel}</dd>
					</div>
					<div>
						<dt>Término</dt>
						<dd>{summary.endLabel}</dd>
					</div>
				</dl>
			</div>
			{error !== null && (
				<p className="react-cycle-calendar-error" role="alert">
					{error}
				</p>
			)}
		</section>
	);
}
