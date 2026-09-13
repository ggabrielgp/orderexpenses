const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export class ReviewPeriod {
	constructor(startDate, endDateExclusive) {
		this.startDate = startDate;
		this.endDateExclusive = endDateExclusive;
	}

	static create({ startDate, endDateExclusive } = {}) {
		validateDateOnly(startDate, "startDate");
		validateDateOnly(endDateExclusive, "endDateExclusive");
		if (startDate >= endDateExclusive)
			throw new RangeError("startDate must be before endDateExclusive");
		return new ReviewPeriod(startDate, endDateExclusive);
	}

	static fromInclusive(startDate, endDate) {
		validateDateOnly(startDate, "startDate");
		validateDateOnly(endDate, "endDate");
		return ReviewPeriod.create({
			startDate,
			endDateExclusive: nextCalendarDate(endDate),
		});
	}

	static currentMonth(referenceDate = new Date()) {
		const year = referenceDate.getFullYear();
		const month = referenceDate.getMonth();
		const nextYear = month === 11 ? year + 1 : year;
		const nextMonth = month === 11 ? 1 : month + 2;
		return ReviewPeriod.create({
			startDate: formatDateOnly(year, month + 1, 1),
			endDateExclusive: formatDateOnly(nextYear, nextMonth, 1),
		});
	}

	get visibleEndDate() {
		return previousCalendarDate(this.endDateExclusive);
	}

	get label() {
		return `${this.startDate} – ${this.visibleEndDate}`;
	}

	includes(dateOnly) {
		validateDateOnly(dateOnly, "dateOnly");
		return dateOnly >= this.startDate && dateOnly < this.endDateExclusive;
	}

	toJSON() {
		return {
			startDate: this.startDate,
			endDateExclusive: this.endDateExclusive,
		};
	}
}

function validateDateOnly(value, field) {
	if (value == null || value === "") throw new TypeError(`${field} is required`);
	if (typeof value !== "string" || !isValidDateOnly(value))
		throw new TypeError(`${field} must be a valid YYYY-MM-DD date`);
}

function isValidDateOnly(value) {
	const match = DATE_ONLY_PATTERN.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function nextCalendarDate(dateOnly) {
	return shiftCalendarDate(dateOnly, 1);
}

function previousCalendarDate(dateOnly) {
	return shiftCalendarDate(dateOnly, -1);
}

function shiftCalendarDate(dateOnly, days) {
	const [, year, month, day] = DATE_ONLY_PATTERN.exec(dateOnly);
	const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
	const date = new Date(timestamp + days * DAY_MILLISECONDS);
	return formatDateOnly(
		date.getUTCFullYear(),
		date.getUTCMonth() + 1,
		date.getUTCDate(),
	);
}

function formatDateOnly(year, month, day) {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
