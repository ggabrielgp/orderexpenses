const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const compactFormatter = new Intl.DateTimeFormat("es-CL", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

const readableFormatter = new Intl.DateTimeFormat("es-CL", {
	dateStyle: "long",
	timeZone: "UTC",
});

export function formatCompactDateOnly(value) {
	return compactFormatter.format(parseDateOnly(value));
}

export function formatReadableDateOnly(value) {
	return readableFormatter.format(parseDateOnly(value));
}

function parseDateOnly(value) {
	const match = DATE_ONLY_PATTERN.exec(value);
	if (!match) throw new TypeError("value must be a valid YYYY-MM-DD date");
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	)
		throw new TypeError("value must be a valid YYYY-MM-DD date");
	return date;
}
