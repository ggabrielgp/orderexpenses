import {
	getDashboardPace,
	type DashboardPaceState,
	type PaceToday,
} from "../analytics/dashboardPace";

/**
 * Demo scenarios (identity B, S17): "Ver la demo como En ritmo / Ajustado / Vas rápido".
 *
 * A scenario is not a different dataset: it is the same data read on another day of the cycle. The day
 * is found by asking `getDashboardPace` (the S3 rules) which days of the cycle give each state for the
 * demo's own income and spending, so the state always follows the rules and nothing is hardcoded.
 */

export type DemoScenario = DashboardPaceState;

export const DEMO_SCENARIOS: ReadonlyArray<{ id: DemoScenario; label: string }> = [
	{ id: "calm", label: "En ritmo" },
	{ id: "tight", label: "Ajustado" },
	{ id: "over", label: "Vas rápido" },
];

/** The demo opens on Ajustado so the first impression is not alarming. */
export const DEFAULT_DEMO_SCENARIO: DemoScenario = "tight";

export interface DemoScenarioInput {
	startDate: string;
	endDateExclusive: string;
	incomeAmount: number | null;
	totalSpending: number;
}

const MS_PER_DAY = 86_400_000;
const RANK: Record<DemoScenario, number> = { calm: 0, tight: 1, over: 2 };

const parseDay = (value: string): number => {
	const [year, month, day] = value.split("-").map(Number);
	return Date.UTC(year, month - 1, day) / MS_PER_DAY;
};

const toToday = (epochDay: number): PaceToday => {
	const date = new Date(epochDay * MS_PER_DAY);
	return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

/**
 * The calendar day that makes the gauge read `scenario`. Among the days of the cycle that give that
 * state it picks the middle one, so the state is not on the edge of changing. When the data cannot give
 * the state (e.g. spending above the income is always "over"), it uses the nearest state that exists.
 * Without income the gauge has no state, so the middle of the cycle is used.
 */
export function getDemoScenarioToday(input: DemoScenarioInput, scenario: DemoScenario): PaceToday {
	const start = parseDay(input.startDate);
	const totalDays = Math.max(parseDay(input.endDateExclusive) - start, 1);
	const byState: Record<DemoScenario, number[]> = { calm: [], tight: [], over: [] };
	for (let offset = 0; offset < totalDays; offset++) {
		const result = getDashboardPace({ ...input, today: toToday(start + offset) });
		if (result.kind === "income") byState[result.state].push(start + offset);
	}
	const states = (Object.keys(RANK) as DemoScenario[])
		.filter((state) => byState[state].length > 0)
		.sort((a, b) => Math.abs(RANK[a] - RANK[scenario]) - Math.abs(RANK[b] - RANK[scenario]));
	const days = states.length > 0 ? byState[states[0]] : null;
	return toToday(days ? days[Math.floor((days.length - 1) / 2)] : start + Math.floor((totalDays - 1) / 2));
}
