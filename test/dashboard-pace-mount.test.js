import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Identity B (odd/tasks/identidad-b.md, T5): the month gauge leads the summary, and every panel the
// summary already showed keeps its single mount (S1).
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const noop = () => {};
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
let page, vite, cache, data;

// S11 merged the KPI band (lead + income/budget cards) into the gauge hero, so those roots are gone
// from the summary on purpose; every other panel keeps its single mount (S1).
const SUMMARY_INVENTORY = [
	"react-spending-breakdown",
	"react-spending-chart",
	"react-category-distribution",
	"react-counterparty-ranking",
	"react-top-insights",
];

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "dashboard-pace-mount-"));
	vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	const { createDemoDashboardData } = await vite.ssrLoadModule("/src/client/demo-data.ts");
	data = createDemoDashboardData(JSON.parse(await read("public/demo-data.json")), new Date(2026, 4, 10, 12));
});
test.after(async () => {
	await vite?.close();
	await rm(cache, { recursive: true, force: true });
});

test("demo summary leads with the month gauge and keeps every existing panel", () => {
	const html = render(page.DemoDashboardView, {
		data,
		view: "summary",
		onViewChange: noop,
		onRequestedCategoryChange: noop,
		today: { year: 2026, month: 5, day: 10 },
	});
	const gaugeAt = html.indexOf('class="react-pace-gauge');
	assert.ok(gaugeAt > -1, "gauge is mounted");
	assert.ok(gaugeAt < html.indexOf("react-spending-breakdown"), "gauge precedes every other panel");
	for (const root of SUMMARY_INVENTORY) assert.ok(html.includes(root), `${root} still renders`);
	assert.equal(html.split('<section class="react-pace-gauge').length - 1, 1, "single gauge mount");
	assert.match(html, /Te quedan|Te pasaste por|Agrega tu ingreso del ciclo/);
	// The demo has income, so the gauge shows the facts behind it.
	for (const fact of ["Ingreso del ciclo", "Gastado", "Días que quedan"]) assert.ok(html.includes(`<dt>${fact}</dt>`), fact);
	assert.doesNotMatch(html, /En control/);
});

test("demo summary merges the KPI band into the hero: no repeated figure and no Presupuesto card", () => {
	const html = render(page.DemoDashboardView, {
		data,
		view: "summary",
		onViewChange: noop,
		onRequestedCategoryChange: noop,
		today: { year: 2026, month: 5, day: 10 },
	});
	for (const gone of ["react-dashboard-lead", "react-lead-primary", "react-lead-answer", "react-budget-panel", "react-analytics-summary"]) {
		assert.ok(!html.includes(gone), `${gone} is gone`);
	}
	assert.doesNotMatch(html, /Presupuesto|No configurado|Total gastado|Saldo disponible|del ingreso disponible|Ingresos del periodo/);
	// One state vocabulary: the old labels never render in the summary.
	assert.doesNotMatch(html, /Al límite|En peligro|Pasado/);
	assert.match(html, />(?:En ritmo|Ajustado|Vas rápido)</);

	const start = html.indexOf('<section class="react-pace-gauge');
	const hero = html.slice(start, html.indexOf("</section>", start));
	const plain = hero.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
	const amounts = plain.match(/\$\d{1,3}(?:\.\d{3})*/g) ?? [];
	assert.ok(amounts.length >= 3, "income, spent and remaining are in the hero");
	// Income, spent and remaining are each stated exactly once inside the hero (the projection sentence
	// is a rounded estimate, so it is excluded from the comparison).
	const sentenceless = plain.replace(/A este ritmo.*?(?:de sobra|bajo cero)\./, "");
	const stated = sentenceless.match(/\$\d{1,3}(?:\.\d{3})*/g) ?? [];
	assert.equal(new Set(stated).size, stated.length, `no figure repeats in the hero: ${stated.join(", ")}`);
	// The "N gastos con monto" information survives inside the hero.
	assert.match(plain, /\d+ gastos? con monto/);
	// The percentage of income is stated once, in the sentence.
	assert.equal((plain.match(/\d+% del ingreso/g) ?? []).length, 1, "percent of income once");
});

test("demo movements view keeps the table and mounts no gauge", () => {
	const html = render(page.DemoDashboardView, {
		data,
		view: "movements",
		onViewChange: noop,
		onRequestedCategoryChange: noop,
		today: { year: 2026, month: 5, day: 10 },
	});
	assert.doesNotMatch(html, /react-pace-gauge/);
	assert.match(html, /<table class="react-movements-table"/);
});

test("authenticated summary feeds the gauge from the configured cycle and offers empty/failed actions", async () => {
	const source = await read("src/client/pages/DashboardPage.tsx");
	assert.equal(source.split("<DashboardPaceGauge").length - 1, 1, "the gauge mounts once, inside the shared body");
	assert.match(source, /getDashboardPace\(\{[\s\S]*?startDate: selectedPeriod!\.startDate[\s\S]*?incomeAmount,[\s\S]*?\}\)/);
	assert.match(source, /onAddIncome=\{openCycleEdit\}/);
	// Empty summary: the existing copy plus two real actions.
	assert.match(source, /No se encontraron gastos reconocidos para este periodo\./);
	assert.match(source, /react-financial-empty-actions[\s\S]*?onClick=\{openCreateExpense\}[\s\S]*?Agregar gasto[\s\S]*?Actualizar/);
	// Failed summary: says what is safe and keeps the retry.
	assert.match(source, /No se pudo cargar el resumen financiero\./);
	assert.match(source, /Tus categorías, reglas y gastos manuales siguen guardados\./);
	assert.match(source, /Reintentar resumen financiero/);
});
