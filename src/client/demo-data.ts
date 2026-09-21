export type DemoMovement = {
	id: string;
	occurredAt: string;
	amount: number;
	direction: "inflow" | "outflow";
	kind: string;
	counterparty: string;
	category: string | null;
};

export type DemoDashboardData = {
	period: { startDate: string; endDateExclusive: string };
	movements: DemoMovement[];
	currentPeriodSpending: number;
	currentPeriodInflow: number;
};

/**
 * A read-only projection of the demo movements shaped like the server's transaction rows, so the demo
 * dashboard can reuse the authenticated pure analytics without an API client. It is a pure adapter:
 * no import from the API layer, no request, no endpoint. Only the fields the analytics read are kept.
 */
export type DemoDashboardTransaction = {
	id: string;
	amount: number;
	direction: DemoMovement["direction"];
	kind: string;
	occurredAt: string;
	counterparty: string;
	category: string | null;
};

export function getDemoTransactions(data: DemoDashboardData): DemoDashboardTransaction[] {
	return data.movements.map((movement) => ({
		id: movement.id,
		amount: movement.amount,
		direction: movement.direction,
		kind: movement.kind,
		occurredAt: movement.occurredAt,
		counterparty: movement.counterparty,
		category: movement.category,
	}));
}

type DateParts = {
	year: number;
	month: number;
	day: number;
	time: string;
};

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}:\d{2})$/;

/** Loads the public synthetic fixture; it deliberately has no account or API dependency. */
export async function loadDemoDashboardData(signal?: AbortSignal): Promise<DemoDashboardData> {
	const response = await fetch("/demo-data.json", { signal });
	if (!response.ok) throw new Error("Demo fixture could not be loaded");
	return createDemoDashboardData(await response.json());
}

export function createDemoDashboardData(value: unknown, now = new Date()): DemoDashboardData {
	if (!Array.isArray(value) || value.length === 0) {
		throw new TypeError("Demo fixture must contain movements");
	}
	if (Number.isNaN(now.getTime())) throw new TypeError("Demo fixture requires a valid current date");

	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const movements = value.map((movement) => rebaseMovement(validateMovement(movement), year, month));
	const currentPeriodSpending = sumAmounts(movements, "outflow");
	const currentPeriodInflow = sumAmounts(movements, "inflow");

	return {
		period: {
			startDate: formatDate(year, month, 1),
			endDateExclusive: formatDate(year, month + 1, 1),
		},
		movements,
		currentPeriodSpending,
		currentPeriodInflow,
	};
}

function validateMovement(value: unknown): DemoMovement {
	if (!value || typeof value !== "object") throw new TypeError("Demo fixture movement must be an object");
	const movement = value as Record<string, unknown>;
	if (typeof movement.id !== "string" || !movement.id.trim()) {
		throw new TypeError("Demo fixture movement id is required");
	}
	if (parseLocalDateTime(movement.occurredAt) === null) {
		throw new TypeError("Demo fixture movement occurredAt must be a valid local date-time");
	}
	if (typeof movement.amount !== "number" || !Number.isFinite(movement.amount) || movement.amount < 0) {
		throw new TypeError("Demo fixture movement amount must be a finite non-negative number");
	}
	if (movement.direction !== "inflow" && movement.direction !== "outflow") {
		throw new TypeError("Demo fixture movement direction must be inflow or outflow");
	}
	if (typeof movement.kind !== "string" || !movement.kind.trim()) {
		throw new TypeError("Demo fixture movement kind is required");
	}
	if (typeof movement.counterparty !== "string" || !movement.counterparty.trim()) {
		throw new TypeError("Demo fixture movement counterparty is required");
	}
	if (movement.category !== null && typeof movement.category !== "string") {
		throw new TypeError("Demo fixture movement category must be text or null");
	}
	return {
		id: movement.id,
		occurredAt: movement.occurredAt as string,
		amount: movement.amount,
		direction: movement.direction,
		kind: movement.kind,
		counterparty: movement.counterparty,
		category: movement.category,
	};
}

function rebaseMovement(movement: DemoMovement, year: number, month: number): DemoMovement {
	const date = parseLocalDateTime(movement.occurredAt)!;
	const day = Math.min(date.day, daysInMonth(year, month));
	return { ...movement, occurredAt: `${formatDate(year, month, day)}${date.time}` };
}

function parseLocalDateTime(value: unknown): DateParts | null {
	if (typeof value !== "string") return null;
	const match = localDateTimePattern.exec(value);
	if (!match) return null;
	const [, yearText, monthText, dayText, time] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
		return null;
	}
	return { year, month, day, time };
}

function sumAmounts(movements: DemoMovement[], direction: DemoMovement["direction"]) {
	return movements.reduce(
		(total, movement) => total + (movement.direction === direction ? movement.amount : 0),
		0,
	);
}

function daysInMonth(year: number, month: number) {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(year: number, month: number, day: number) {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
