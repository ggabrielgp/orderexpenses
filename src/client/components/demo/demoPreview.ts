import { DEFAULT_DEMO_SCENARIO, DEMO_SCENARIOS, type DemoScenario } from "./demoScenarios";

/**
 * Demo preview mode (identity B, S25).
 *
 * The landing phones embed the real read-only demo at mobile width: `/app/demo?preview=summary&scenario=tight`.
 * The query params are read by the demo page only, and only through this module, so the demo without
 * `preview` is exactly the demo it always was and the authenticated app never looks at them.
 *
 * - `preview`  the view to show (`summary` | `movements`); without a valid value the mode is off.
 * - `scenario` "Ver la demo como" state (`calm` | `tight` | `over`); the demo default when absent/invalid.
 * - `focus`    where the page starts: `top` (default), or the `spending` / `categories` section.
 */

export type DemoPreviewView = "summary" | "movements";
export type DemoPreviewFocus = "top" | "spending" | "categories";

export interface DemoPreview {
	view: DemoPreviewView;
	scenario: DemoScenario;
	focus: DemoPreviewFocus;
}

const VIEWS: readonly DemoPreviewView[] = ["summary", "movements"];
const FOCUSES: readonly DemoPreviewFocus[] = ["top", "spending", "categories"];

/** The preview described by a URL search string, or `null` when the mode is not requested. */
export function parseDemoPreview(search: string | null | undefined): DemoPreview | null {
	if (!search) return null;
	const params = new URLSearchParams(search);
	const view = VIEWS.find((candidate) => candidate === params.get("preview"));
	if (!view) return null;
	const scenario = DEMO_SCENARIOS.find((candidate) => candidate.id === params.get("scenario"))?.id ?? DEFAULT_DEMO_SCENARIO;
	const focus = FOCUSES.find((candidate) => candidate === params.get("focus")) ?? "top";
	return { view, scenario, focus };
}

/** The path the landing embeds. Parameters equal to their defaults stay out of the URL. */
export function buildDemoPreviewPath({ view, scenario, focus }: { view: DemoPreviewView; scenario?: DemoScenario; focus?: DemoPreviewFocus }): string {
	const params = new URLSearchParams({ preview: view });
	if (scenario) params.set("scenario", scenario);
	if (focus && focus !== "top") params.set("focus", focus);
	return `/app/demo?${params.toString()}`;
}
