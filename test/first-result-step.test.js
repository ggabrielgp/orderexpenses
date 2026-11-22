import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Identity B S21 (odd/tasks/identidad-b.md, T23): onboarding step 3 is a real dialog step that follows
// the first cycle save, not an inline card.
const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const firstResult = await vite.ssrLoadModule("/src/client/components/onboarding/firstResult.ts");
const flow = await vite.ssrLoadModule("/src/client/components/onboarding/firstResultFlow.ts");
const dialogModule = await vite.ssrLoadModule("/src/client/components/onboarding/FirstResultDialog.tsx");
const explainer = await vite.ssrLoadModule("/src/client/components/onboarding/FirstResultExplainer.tsx");
const paceModule = await vite.ssrLoadModule("/src/client/components/analytics/dashboardPace.ts");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const memoryStorage = (initial = {}) => {
	const values = new Map(Object.entries(initial));
	return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
};
const cycle = { startDate: "2026-11-01", endDateExclusive: "2026-12-01", today: { year: 2026, month: 11, day: 15 } };
const withIncome = paceModule.getDashboardPace({ ...cycle, incomeAmount: 1_000_000, totalSpending: 300_000 });
const withoutIncome = paceModule.getDashboardPace({ ...cycle, incomeAmount: null, totalSpending: 300_000 });
const noop = () => {};
const render = (props) => renderToStaticMarkup(createElement(dialogModule.FirstResultDialog, {
	phase: "shown", pace: withIncome, onDone: noop, onAddIncome: noop, ...props,
}));

test("step 3 starts only after a first save that was not seen before", () => {
	assert.equal(flow.startFirstResult(false), "waiting");
	assert.equal(flow.startFirstResult(true), "idle");
	assert.equal(flow.isFirstResultOpen("idle"), false);
	for (const phase of ["waiting", "preparing", "shown"]) assert.equal(flow.isFirstResultOpen(phase), true);
});

test("loading becomes the real gauge once the reload yields the ready state", () => {
	let phase = flow.startFirstResult(false);
	// The save has succeeded but the summary has not started reloading: still the same step, still loading.
	assert.equal(flow.observeFirstResult(phase, "unconfigured"), "waiting");
	phase = flow.observeFirstResult(phase, "loading");
	assert.equal(phase, "preparing");
	assert.equal(flow.observeFirstResult(phase, "loading"), "preparing");
	assert.equal(flow.observeFirstResult(phase, "ready"), "shown");
	assert.equal(flow.observeFirstResult("shown", "ready"), "shown");
	// Nothing was started: observing never opens the step (edit of an existing cycle, plain visit).
	assert.equal(flow.observeFirstResult("idle", "ready"), "idle");
	assert.equal(flow.observeFirstResult("idle", "loading"), "idle");
});

test("a failed reload closes step 3 without marking it seen", () => {
	const storage = memoryStorage();
	for (const phase of ["waiting", "preparing"]) {
		assert.equal(flow.observeFirstResult(phase, "failed"), "idle");
		assert.equal(flow.observeFirstResult(phase, "unconfigured") === "idle", phase === "preparing");
	}
	// Nothing in the flow touches storage unless the user dismisses a shown step.
	assert.equal(flow.dismissFirstResult("preparing", storage), "preparing");
	assert.equal(flow.dismissFirstResult("waiting", storage), "waiting");
	assert.equal(storage.values.size, 0);
});

test("dismissing the shown step (Ver mi resumen, Escape or backdrop) closes it and marks it seen", () => {
	const storage = memoryStorage();
	assert.equal(flow.dismissFirstResult("shown", storage), "idle");
	assert.equal(storage.values.get("gc:first-result-seen"), "1");
	assert.equal(flow.dismissFirstResult("idle", memoryStorage()), "idle");
	// Once seen, a later first save never reopens it.
	assert.equal(flow.startFirstResult(firstResult.hasSeenFirstResult(storage)), "idle");
});

test("the loading state keeps the stepper on step 3 and offers no action", () => {
	const html = render({ phase: "preparing", pace: null });
	assert.match(html, /<dialog[^>]*class="[^"]*cycle-dialog[^"]*"/);
	assert.ok(html.includes("Paso 3 de 3 · Tu medidor"));
	assert.ok(html.includes("Preparando tu medidor…"));
	assert.match(html, /role="status"/);
	assert.ok(!html.includes("Ver mi resumen"));
	assert.match(html, /<li aria-current="step">(?:(?!<\/li>).)*Paso 3, Tu medidor, paso actual/);
	assert.match(html, /<li class="is-done">(?:(?!<\/li>).)*Paso 2, Tu ciclo, hecho/);
});

test("the ready state shows the real gauge, the one-line reading and Ver mi resumen", () => {
	const html = render({});
	assert.ok(html.includes("Paso 3 de 3 · Tu medidor"));
	assert.ok(html.includes("Tu medidor está listo"));
	assert.match(html, /class="react-pace-gauge react-pace-gauge--calm[^"]*react-pace-gauge--compact|react-pace-gauge--compact[^"]*react-pace-gauge--calm/);
	assert.ok(html.includes("En ritmo"));
	assert.ok(html.includes("Así se lee tu medidor"));
	assert.ok(html.includes(
		"El color es lo que gastaste de tu ingreso; la raya, cuánto del ciclo pasó. Si el color no alcanza la raya, vas en ritmo.",
	));
	assert.match(html, /<button[^>]*class="[^"]*cycle-btn-primary[^"]*"[^>]*>Ver mi resumen<\/button>/);
	assert.ok(!html.includes("Agregar ingreso"));
	// The compact gauge drops the figures grid: the dialog is a step, not the summary.
	assert.ok(!html.includes("react-pace-gauge-facts"));
});

test("without income the gauge shows its no-income variant, how to add it and Ver mi resumen", () => {
	const html = render({ pace: withoutIncome });
	assert.ok(html.includes("react-pace-gauge--none"));
	assert.ok(!html.includes("En ritmo"));
	assert.match(html, /<button[^>]*>Agregar ingreso<\/button>/);
	assert.match(html, /<button[^>]*class="[^"]*cycle-btn-primary[^"]*"[^>]*>Ver mi resumen<\/button>/);
	assert.ok(html.includes("Así se lee tu medidor"));
});

test("an idle step renders nothing", () => {
	assert.equal(render({ phase: "idle", pace: null }), "");
});

test("the reading hint is one compact row with no button of its own", () => {
	const html = renderToStaticMarkup(createElement(explainer.FirstResultExplainer));
	assert.ok(html.includes("Así se lee tu medidor"));
	assert.ok(html.includes("El color es lo que gastaste de tu ingreso; la raya, cuánto del ciclo pasó. Si el color no alcanza la raya, vas en ritmo."));
	assert.ok(!html.includes("<button"));
	assert.match(html, /<svg[^>]*aria-hidden="true"/);
});

test("the summary mounts step 3 as a dialog, not as the inline card", async () => {
	const source = await read("src/client/pages/DashboardPage.tsx");
	assert.doesNotMatch(source, /showFirstResult|dismissFirstResult\b.*useCallback/);
	assert.doesNotMatch(source, /<FirstResultExplainer/);
	assert.match(source, /startFirstResult\(hasSeenFirstResult\(browserStorage\(\)\)\)/);
	assert.match(source, /observeFirstResult\(/);
	const summary = source.slice(source.indexOf("function FinancialSummary("), source.indexOf("function FinancialCycleSetupForm"));
	assert.match(summary, /<FirstResultDialog/);
	assert.match(summary, /onAddIncome=\{/);
	// Only the authenticated summary mounts it: never the demo.
	const demo = source.slice(source.indexOf("function DemoDashboardPage"), source.indexOf("function DemoDashboardPage") + 20000);
	assert.doesNotMatch(demo.slice(0, demo.indexOf("\nfunction ", 10)), /FirstResultDialog/);
	// Editing an existing cycle never starts it.
	assert.doesNotMatch(summary.slice(summary.indexOf("const handleCycleEdited"), summary.indexOf("const handleCycleEdited") + 400), /FirstResult/);
});
