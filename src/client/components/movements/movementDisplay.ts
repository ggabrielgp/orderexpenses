/**
 * Display decisions of the movements view (identity B, S18): short dates with the full date kept
 * reachable, and the wording of the active filters. Pure functions: the table and the mobile list read
 * the same ones, so they cannot disagree.
 */

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const LONG_MONTHS = [
	"enero", "febrero", "marzo", "abril", "mayo", "junio",
	"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseIsoDate(date: string): { year: number; month: number; day: number } | null {
	const match = ISO_DATE.exec(date);
	if (!match) return null;
	const month = Number(match[2]);
	if (month < 1 || month > 12) return null;
	return { year: Number(match[1]), month, day: Number(match[3]) };
}

/** `2026-11-02` → `2 nov`. A value that is not an ISO date (the `—` placeholder) is returned as it is. */
export function formatMovementShortDate(date: string): string {
	const parsed = parseIsoDate(date);
	return parsed === null ? date : `${parsed.day} ${SHORT_MONTHS[parsed.month - 1]}`;
}

/** `2026-11-02` → `2 de noviembre de 2026`, the text a short date exposes as its title. */
export function formatMovementLongDate(date: string): string {
	const parsed = parseIsoDate(date);
	return parsed === null ? date : `${parsed.day} de ${LONG_MONTHS[parsed.month - 1]} de ${parsed.year}`;
}

export type ActiveMovementFilterKey = "search" | "kind" | "category";

export interface ActiveMovementFilter {
	key: ActiveMovementFilterKey;
	/** Chip text: `Búsqueda: Café`. */
	label: string;
	/** Sentence fragment: `la búsqueda «Café»`. */
	phrase: string;
}

/** The filters currently narrowing the table, in the order the controls appear. */
export function getActiveMovementFilters(input: {
	search: string;
	kindLabel: string | null;
	category: string;
}): ActiveMovementFilter[] {
	const filters: ActiveMovementFilter[] = [];
	if (input.search !== "") {
		filters.push({ key: "search", label: `Búsqueda: ${input.search}`, phrase: `la búsqueda «${input.search}»` });
	}
	if (input.kindLabel !== null) {
		filters.push({ key: "kind", label: `Tipo: ${input.kindLabel}`, phrase: `el tipo ${input.kindLabel}` });
	}
	if (input.category !== "") {
		filters.push({ key: "category", label: `Categoría: ${input.category}`, phrase: `la categoría ${input.category}` });
	}
	return filters;
}

/** `la búsqueda «x», la categoría Y y el tipo Z`. */
export function describeActiveMovementFilters(filters: readonly ActiveMovementFilter[]): string {
	const phrases = filters.map((filter) => filter.phrase);
	if (phrases.length <= 1) return phrases[0] ?? "";
	return `${phrases.slice(0, -1).join(", ")} y ${phrases[phrases.length - 1]}`;
}

/** Accessible name of a row action: it tells the rows apart (`Ver Lider del 2 nov`) and starts with the visible word. */
export function getMovementActionName(verb: string, counterparty: string, date: string): string {
	const short = formatMovementShortDate(date);
	return parseIsoDate(date) === null ? `${verb} ${counterparty}` : `${verb} ${counterparty} del ${short}`;
}
