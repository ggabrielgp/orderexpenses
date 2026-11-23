import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Identity B phase 3 (odd/tasks/identidad-b.md, T16, S17): the demo reads the same data on another day
// of the cycle. The day is computed from the data, never hardcoded, and the control is demo-only.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const noop = () => {};
let vite, cache, scenarios, control, page, pace, data, demo;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "demo-scenarios-"));
	vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	scenarios = await vite.ssrLoadModule("/src/client/components/demo/demoScenarios.ts");
	control = await vite.ssrLoadModule("/src/client/components/demo/DemoScenarioControl.tsx");
	page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	pace = await vite.ssrLoadModule("/src/client/components/analytics/dashboardPace.ts");
	demo = await vite.ssrLoadModule("/src/client/demo-data.ts");
	data = demo.createDemoDashboardData(JSON.parse(await read("public/demo-data.json")), new Date(2026, 4, 10, 12));
});
test.after(async () => {
	await vite?.close();
	await rm(cache, { recursive: true, force: true });
});

const WORDS = { calm: "En ritmo", tight: "Ajustado", over: "Vas rápido" };
const pillOf = (html) => html.match(/react-pace-gauge-pill-icon[^>]*>[^<]*<\/span><span>([^<]+)<\/span>/)?.[1];
const view = (props = {}) => renderToStaticMarkup(createElement(page.DemoDashboardView, {
	data, view: "summary", onViewChange: noop, onRequestedCategoryChange: noop, ...props,
}));

test("the three scenarios are named like the gauge states and open on Ajustado", () => {
	assert.deepEqual(scenarios.DEMO_SCENARIOS.map((item) => [item.id, item.label]), [["calm", "En ritmo"], ["tight", "Ajustado"], ["over", "Vas rápido"]]);
	assert.equal(scenarios.DEFAULT_DEMO_SCENARIO, "tight");
});

test("each scenario yields its own state for the demo data, by the S3 rules", () => {
	for (const scenario of ["calm", "tight", "over"]) {
		const html = view({ scenario });
		assert.equal(pillOf(html), WORDS[scenario], scenario);
		// The sentence and the figures come from the same pace: the pill word is never alone.
		assert.match(html, /Llevas <b>\d+%<\/b> del ingreso y pasó el <b>\d+%<\/b> del período/);
		assert.match(html, new RegExp(`react-pace-gauge--${scenario}`));
	}
});

test("the demo opens on Ajustado and marks it as the pressed scenario", () => {
	const html = renderToStaticMarkup(createElement(page.DemoDashboardPage, { data }));
	assert.equal(pillOf(html), "Ajustado");
	assert.match(html, /Ver la demo como:/);
	const buttons = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*class="demo-scenario-option"[^>]*>([^<]+)<\/button>|<button[^>]*class="demo-scenario-option"[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/g)];
	assert.deepEqual(buttons.map((m) => (m[2] ?? m[4])), ["En ritmo", "Ajustado", "Vas rápido"]);
	assert.deepEqual(buttons.map((m) => (m[1] ?? m[3])), ["false", "true", "false"]);
	// Next to the read-only badge, which keeps its exact markup.
	assert.match(html, /<span class="demo-read-only-badge">Datos de ejemplo · Solo lectura<\/span><div class="demo-scenario"/);
});

test("the control reports the chosen scenario and every option is a real button", () => {
	const tree = control.DemoScenarioControl({ scenario: "tight", onChange: (next) => chosen.push(next) });
	const chosen = [];
	const nodes = (element) => !element || typeof element !== "object" ? [] : [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
	const options = nodes(tree).filter((node) => node.type === "button");
	assert.equal(options.length, 3);
	for (const option of options) {
		assert.equal(option.props.type, "button");
		option.props.onClick();
	}
	assert.deepEqual(chosen, ["calm", "tight", "over"]);
});

test("the simulated day is computed from the data and stays inside the cycle", () => {
	const period = { startDate: "2026-05-01", endDateExclusive: "2026-06-01" };
	const input = (totalSpending) => ({ ...period, incomeAmount: 1_000_000, totalSpending });
	for (const spending of [100_000, 450_000, 700_000, 990_000]) {
		for (const scenario of ["calm", "tight", "over"]) {
			const today = scenarios.getDemoScenarioToday(input(spending), scenario);
			const result = pace.getDashboardPace({ ...input(spending), today });
			const day = Date.UTC(today.year, today.month - 1, today.day);
			assert.ok(day >= Date.UTC(2026, 4, 1) && day < Date.UTC(2026, 5, 1), `${spending}/${scenario} inside the cycle`);
			assert.equal(result.kind, "income");
		}
	}
	// 45% spent: the state is reachable on exactly the days the S3 rules give it.
	for (const scenario of ["calm", "tight", "over"]) {
		const today = scenarios.getDemoScenarioToday(input(450_000), scenario);
		assert.equal(pace.getDashboardPace({ ...input(450_000), today }).state, scenario);
	}
	// A different spend moves the day: nothing is hardcoded.
	const a = scenarios.getDemoScenarioToday(input(450_000), "calm");
	const b = scenarios.getDemoScenarioToday(input(150_000), "calm");
	assert.notDeepEqual(a, b);
	// Overspent income: only "over" exists, so every scenario resolves to a day with that state.
	for (const scenario of ["calm", "tight", "over"]) {
		const today = scenarios.getDemoScenarioToday(input(1_200_000), scenario);
		assert.equal(pace.getDashboardPace({ ...input(1_200_000), today }).state, "over");
	}
});

test("a day passed explicitly still wins, and no income still shows no state", () => {
	const html = view({ today: { year: 2026, month: 5, day: 10 }, scenario: "over" });
	assert.match(html, /Quedan 22 días/);
	assert.match(html, /el período cierra el 31 may/);
	const none = renderToStaticMarkup(createElement(page.DemoDashboardView, {
		data: { ...data, currentPeriodInflow: 0, movements: data.movements.filter((movement) => movement.direction !== "inflow") },
		view: "summary", onViewChange: noop, onRequestedCategoryChange: noop,
	}));
	assert.equal(pillOf(none), undefined);
	assert.match(none, /Ver la demo como:/);
});

test("the control is demo-only: the movements view and the authenticated page never render it", async () => {
	assert.doesNotMatch(view({ view: "movements" }), /Ver la demo como/);
	assert.doesNotMatch(renderToStaticMarkup(createElement(page.DashboardPage, { session: { authenticated: true, profile: { email: "a@b.cl", name: "A" }, gmail: { connected: true, connectUrl: "/auth/google" } } })), /Ver la demo como|demo-scenario/);
	const source = await read("src/client/pages/DashboardPage.tsx");
	const demoStart = source.indexOf("export function DemoDashboardPage");
	const demoEnd = source.indexOf("interface DashboardAnalyticsBodyProps");
	assert.ok(demoStart > 0 && demoEnd > demoStart);
	// Past the import block: only the demo composition may use the scenario control and its day.
	const outside = source.slice(source.indexOf("config.autoAddCss"), demoStart) + source.slice(demoEnd);
	assert.ok(!/DemoScenarioControl|demo-scenario|getDemoScenarioToday/.test(outside), "scenario control used outside the demo");
	assert.match(source.slice(demoStart, demoEnd), /<DemoScenarioControl/);
});

test("the control is touch sized on mobile and does not animate under reduced motion", async () => {
	const css = await read("src/client/demo-scenarios.css");
	assert.match(css, /\.demo-scenario-option\s*\{[^}]*min-height:\s*44px/);
	assert.match(css, /\.demo-scenario-option\[aria-pressed="true"\]/);
	assert.match(css, /\.demo-scenario-option:focus-visible/);
	assert.match(css, /@media \(max-width: 760px\)[^]*\.demo-scenario/);
	assert.match(css, /prefers-reduced-motion: reduce[^]*transition:\s*none/);
	const entry = await read("src/client/main.tsx");
	assert.match(entry, /import "\.\/demo-scenarios\.css";/);
});
