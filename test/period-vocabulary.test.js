import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// S24 (odd/tasks/identidad-b.md, T26): one word for the user's range ("período"), the pay day option
// shows its reasoning, and the gauge says when the period closes. Calculations are untouched (S10).
const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
after(() => vite.close());

const presets = await vite.ssrLoadModule("/src/client/components/financial-cycle/CyclePresets.tsx");
const gauge = await vite.ssrLoadModule("/src/client/components/analytics/DashboardPaceGauge.tsx");
const pace = await vite.ssrLoadModule("/src/client/components/analytics/dashboardPace.ts");
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

const renderPayDay = (payDay, range) =>
	text(renderToStaticMarkup(createElement(presets.CyclePresets, {
		option: "payDay", payDay, range, onOptionChange() {}, onPayDayChange() {},
	})));

test("the pay day option shows the reasoning from the computed range: pay day 25", () => {
	const plain = renderPayDay(25, { startDate: "2026-10-25", endDate: "2026-11-24" });
	assert.ok(plain.includes("Cobras el 25 oct · próximo pago 25 nov"), plain);
	assert.ok(plain.includes("Tu período: 25 oct al 24 nov (31 días)"), plain);
});

test("pay day 31 on a 30-day month explains the end the user asked about (31 oct → 29 nov)", () => {
	const plain = renderPayDay(31, { startDate: "2026-10-31", endDate: "2026-11-29" });
	assert.ok(plain.includes("Cobras el 31 oct · próximo pago 30 nov"), plain);
	assert.ok(plain.includes("Tu período: 31 oct al 29 nov (30 días)"), plain);
});

test("Último día says it means the last day of each month, and short months follow it", () => {
	const plain = renderPayDay(31, { startDate: "2026-02-28", endDate: "2026-03-30" });
	assert.ok(plain.includes("Cobras el 28 feb · próximo pago 31 mar"), plain);
	assert.ok(plain.includes("Tu período: 28 feb al 30 mar (31 días)"), plain);
	assert.ok(plain.includes("Último día de cada mes; en meses más cortos, su último día."), plain);
	assert.ok(!plain.includes("En los meses más cortos usamos su último día."));
});

test("pay day 1 reasons from the 1st to the last day of the month", () => {
	const plain = renderPayDay(1, { startDate: "2026-11-01", endDate: "2026-11-30" });
	assert.ok(plain.includes("Cobras el 1 nov · próximo pago 1 dic"), plain);
	assert.ok(plain.includes("Tu período: 1 al 30 de noviembre (30 días)"), plain);
	assert.ok(!plain.includes("Último día de cada mes"), "only the last-day choice explains itself");
});

// A 27 oct – 26 nov period: [2026-10-27, 2026-11-27).
const period = { startDate: "2026-10-27", endDateExclusive: "2026-11-27" };
const gaugeAt = (month, d, extra = {}) => text(renderToStaticMarkup(createElement(gauge.DashboardPaceGauge, {
	pace: pace.getDashboardPace({ ...period, incomeAmount: 1_000_000, totalSpending: 400_000, today: { year: 2026, month, day: d } }),
	periodEndExclusive: period.endDateExclusive,
	...extra,
})));

test("the gauge says how many days are left and when the period closes", () => {
	const plain = gaugeAt(11, 21);
	assert.ok(plain.includes("Quedan 6 días"), plain);
	assert.ok(plain.includes("el período cierra el 26 nov"), plain);
	assert.ok(!plain.includes("Días que quedan"));
	assert.ok(!/Día \d+ de \d+/.test(plain));
	assert.ok(plain.includes("Ingreso del período"));
	assert.match(plain, /Llevas 40% del ingreso y pasó el 84% del período\./);
});

test("one day left is singular and the last day says so", () => {
	const plain = gaugeAt(11, 26);
	assert.ok(plain.includes("Queda 1 día"), plain);
	assert.ok(plain.includes("Último día del período"), plain);
	assert.ok(!plain.includes("Quedan 1 días"));
});

test("after the end the period reads as closed", () => {
	const plain = gaugeAt(11, 28);
	assert.ok(plain.includes("Período cerrado"), plain);
	assert.ok(plain.includes("cerró el 26 nov"), plain);
	assert.ok(!plain.includes("Ciclo cerrado"));
	assert.ok(!/Quedan \d+ días/.test(plain));
});

test("without income the gauge uses the same word", () => {
	const plain = text(renderToStaticMarkup(createElement(gauge.DashboardPaceGauge, {
		pace: pace.getDashboardPace({ ...period, incomeAmount: null, totalSpending: 0, today: { year: 2026, month: 11, day: 21 } }),
	})));
	assert.ok(plain.includes("Gastado en el período"), plain);
	assert.ok(plain.includes("Agrega tu ingreso del período para saber si vas en ritmo."), plain);
});

test("the pace model keeps its calculations (daysLeft and no new fields)", () => {
	const result = pace.getDashboardPace({ ...period, incomeAmount: null, totalSpending: 0, today: { year: 2026, month: 11, day: 21 } });
	assert.deepEqual(Object.keys(result).sort(), ["daysLeft", "elapsed", "kind", "totalSpending"]);
	assert.equal(result.daysLeft, 6);
});

// Code identifiers and comments may keep "cycle"/"ciclo"; user-facing copy may not.
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const TARGETS = [
	"src/client/pages/DashboardPage.tsx",
	"src/client/components/onboarding/OnboardingConnect.tsx",
	"src/client/components/onboarding/FirstResultExplainer.tsx",
	"src/client/components/onboarding/FirstResultDialog.tsx",
	"src/client/components/analytics/DashboardPaceGauge.tsx",
	"src/client/components/analytics/dashboardLead.ts",
	"src/client/components/analytics/spendingChart.ts",
	"src/client/components/analytics/dashboardInsights.ts",
	"src/client/components/analytics/periodAnalytics.ts",
	"src/client/components/analytics/categoryRanking.ts",
	"src/client/components/analytics/categoryDistribution.ts",
	"src/client/components/analytics/CategoryDistributionPanel.tsx",
	"src/client/components/financial-cycle/CyclePresets.tsx",
	"src/client/components/financial-cycle/CyclePeriodSummary.tsx",
	"src/client/components/financial-cycle/FinancialCycleEditDialog.tsx",
	"src/client/components/financial-cycle/FinancialCycleCalendar.tsx",
	"src/client/components/financial-cycle/CompleteCycleDialog.tsx",
	"src/client/components/financial-cycle/cycleSettings.ts",
	"src/client/components/financial-cycle/cycleCompletion.ts",
	"src/client/components/gmail/gmailConsent.ts",
	"src/client/components/gmail/gmailSync.ts",
	"src/client/components/gmail/gmailConnection.ts",
	"src/client/components/movements/MovementsStates.tsx",
	"src/client/components/movements/EditMovementDialog.tsx",
	"src/client/components/movements/CreateManualExpenseDialog.tsx",
	"src/client/components/settings/CounterpartyRulesDialog.tsx",
];

test("no user-facing 'ciclo', unaccented 'periodo' or 'tu mes' remains in the app, demo and onboarding copy", async () => {
	for (const file of TARGETS) {
		const source = stripComments(await readFile(new URL(`../${file}`, import.meta.url), "utf8"));
		const hits = source.match(/\b[Cc]iclo\b|\b[Pp]eriodo\b|\b[Tt]u mes\b|\bdel mes\b|Días que quedan/g) ?? [];
		assert.deepEqual(hits, [], `${file} still has ${hits.join(", ")}`);
	}
});
