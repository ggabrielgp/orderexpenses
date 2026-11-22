import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Identity B, S18 (odd/tasks/identidad-b.md, T18; design/identidad-b-pulido/06-movimientos-desktop.html and
// 07-movimientos-mobile.html): the movements view gets the brand line of the summary.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const noop = () => {};
const nodes = (element) => {
	if (!element || typeof element !== "object") return [];
	return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
};
const text = (element) => [element?.props?.children].flat(Infinity).filter((child) => typeof child === "string").join("");
const buttonWithText = (tree, label) =>
	nodes(tree).find((node) => node.type === "button" && text(node).trim() === label);
let vite;
let page;
let colors;
let display;
let ranking;
test.before(async () => {
	vite = await createServer({
		configFile: false,
		envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	colors = await vite.ssrLoadModule("/src/client/components/analytics/categoryDistribution.ts");
	ranking = await vite.ssrLoadModule("/src/client/components/analytics/categoryRanking.ts");
	display = await vite.ssrLoadModule("/src/client/components/movements/movementDisplay.ts");
});
test.after(async () => { await vite?.close(); });

const period = { startDate: "2026-11-01", endDateExclusive: "2026-12-01" };
const row = (id, counterparty, amount, date, category, kind = "purchase") =>
	({ id, counterparty, amount, date, category, kind, description: "" });
const rows = [
	row("1", "Arriendo", 385000, "2026-11-01", "Vivienda", "transfer"),
	row("2", "Lider", 100000, "2026-11-02", "Supermercado"),
	row("3", "Uber", 80000, "2026-11-03", "Transporte"),
	row("4", "Rappi", 50000, "2026-11-05", "Comida"),
	row("5", "Falabella", 30000, "2026-11-08", "Hogar"),
	row("6", "Panadería", 7250, "2026-11-19", "Sin categoría"),
];
const uncategorized = rows.filter((movement) => movement.category === "Sin categoría");
const count = (isActive = false, category = "", message = null) => ({ category, isActive, shown: rows.length, total: rows.length, message });
const viewProps = (over = {}) => ({
	filteredView: { rows, activeCategory: "", options: [{ value: "", label: "Todas las categorías", count: rows.length }], count: count() },
	periodMovements: rows,
	sort: { key: null, direction: null },
	editableMovements: [],
	onActivate: noop, onSelect: noop, onClear: noop, onEdit: noop, onRemove: noop, onView: noop,
	onSearchChange: noop, onKindChange: noop,
	...over,
});
const render = (props) => renderToStaticMarkup(createElement(page.MovementsTableView, props));

test("an uncategorized prompt names how many movements lack a category and classifies them with the existing filter", () => {
	const props = viewProps({ onClassify: () => calls.push("classify") });
	const calls = [];
	const html = render(props);
	assert.match(html, /1 movimiento sin categoría/);
	assert.match(html, /\$7\.250/);
	const prompt = nodes(page.MovementsTableView(props)).find((node) => node.type?.name === "MovementsUncategorizedPrompt");
	assert.ok(prompt, "the prompt is its own component");
	assert.equal(prompt.props.count, 1);
	const action = buttonWithText(prompt.type(prompt.props), "Clasificar");
	assert.ok(action, "the prompt offers Clasificar");
	action.props.onClick();
	assert.deepEqual(calls, ["classify"]);

	const several = render(viewProps({
		periodMovements: [...rows, row("7", "Kiosco", 1000, "2026-11-20", "Sin categoría")],
		onClassify: noop,
	}));
	assert.match(several, /2 movimientos sin categoría/);
	assert.doesNotMatch(several, /Todo clasificado/);
});

test("with nothing left to classify the prompt is a calm note without an action", () => {
	const props = viewProps({
		filteredView: { ...viewProps().filteredView, rows: rows.slice(0, 5) },
		periodMovements: rows.slice(0, 5),
		onClassify: noop,
	});
	const html = render(props);
	assert.match(html, /Todo clasificado/);
	assert.doesNotMatch(html, /\d+ movimientos? sin categoría/);
	const prompt = nodes(page.MovementsTableView(props)).find((node) => node.type?.name === "MovementsUncategorizedPrompt");
	assert.equal(prompt.props.count, 0);
	assert.equal(buttonWithText(prompt.type(prompt.props), "Clasificar"), undefined);
});

test("the four metrics stay, Total gastado leads and nothing keeps the orange or cobalt value colors", async () => {
	const html = render(viewProps({ onClassify: noop }));
	const labels = [...html.matchAll(/<article class="react-movements-metric[^"]*"><span>([^<]+)<\/span>/g)].map((match) => match[1]);
	assert.deepEqual(labels, ["Total gastado", "Gastos reconocidos", "Sin categoría", "Clasificados"]);
	const css = await read("src/client/movements-polish.css");
	assert.doesNotMatch(css, /#(?:2563eb|1d4ed8|dbeafe|eff6ff|bfdbfe|3b82f6|d97706|004ac6|003594|2878e5)\b/i);
	assert.match(css, /react-movements-metric-pending/);
});

test("category chips use the exact colour the donut gives that category, and a stored colour still wins", () => {
	const rankingResult = ranking.getCategoryRanking(rows, 0);
	const catalog = [{ name: "Comida", color: "#123456" }];
	const donut = colors.getCategoryRankingColors(rankingResult.rows, catalog);
	assert.equal(donut.length, rankingResult.rows.length);
	const resolve = colors.createCategoryColorResolver(rankingResult, catalog);
	rankingResult.rows.forEach((entry, index) => {
		assert.equal(donut[index], colors.getCategoryRowColor(entry.category, catalog, index));
		if (!entry.mergesTail) assert.equal(resolve(entry.category), donut[index], entry.category);
	});
	assert.equal(resolve("Vivienda"), "#5a67a0");
	assert.equal(resolve("Supermercado"), "#94678c");
	assert.equal(resolve("Transporte"), "#6f93ad");
	// Categories the donut folds into "Otras categorías" share its swatch; a stored colour is the user's choice.
	assert.equal(resolve("Hogar"), donut.at(-1));
	assert.equal(resolve("Comida"), "#123456");

	const html = render(viewProps({ categoryCatalog: catalog }));
	assert.match(html, /class="react-movement-category"[^>]*style="--category-color:#5a67a0"[^>]*>(?:<span[^>]*><\/span>)?Vivienda</);
	assert.match(html, /style="--category-color:#123456"[^>]*>(?:<span[^>]*><\/span>)?Comida</);
	assert.match(html, /react-movement-category react-movement-category-unassigned"[^>]*>(?:<span[^>]*><\/span>)?Sin categoría</);
});

test("the donut legend and the chips read the same colours (one shared helper)", async () => {
	const panel = await read("src/client/components/analytics/CategoryDistributionPanel.tsx");
	assert.match(panel, /getCategoryRankingColors\(/);
	const rankingResult = ranking.getCategoryRanking(rows, 0);
	const markup = renderToStaticMarkup(createElement(
		(await vite.ssrLoadModule("/src/client/components/analytics/CategoryDistributionPanel.tsx")).CategoryDistributionPanel,
		{ ranking: rankingResult, catalog: [], onJumpToCategory: noop, formatAmount: (amount) => `$${amount}` },
	));
	const legend = [...markup.matchAll(/style="--category-color:(#[0-9a-f]{6})"[^>]*>(?:<span[^>]*><\/span>)<strong>([^<]+)</g)];
	assert.equal(legend.length, rankingResult.rows.length);
	const chips = render(viewProps());
	for (const [, color, name] of legend) {
		if (name === "Otras categorías" || name === "Sin categoría") continue;
		assert.match(chips, new RegExp(`style="--category-color:${color}"[^>]*>(?:<span[^>]*></span>)?${name}<`), name);
	}
});

test("movement dates read short and keep the full date reachable", () => {
	assert.equal(display.formatMovementShortDate("2026-11-02"), "2 nov");
	assert.equal(display.formatMovementShortDate("2026-01-15"), "15 ene");
	assert.equal(display.formatMovementLongDate("2026-11-02"), "2 de noviembre de 2026");
	assert.equal(display.formatMovementShortDate("—"), "—");
	assert.equal(display.formatMovementLongDate("—"), "—");

	const html = render(viewProps());
	assert.match(html, /<time class="react-movement-date" date[Tt]ime="2026-11-02" title="2 de noviembre de 2026">2 nov<\/time>/);
	// Desktop table and mobile list both show it, and the raw ISO date is no longer the visible text.
	assert.equal((html.match(/>2 nov<\/time>/g) ?? []).length, 2);
	assert.doesNotMatch(html, />2026-11-02</);
});

test("row actions keep accessible names that tell the rows apart", () => {
	const editable = { ...rows[1], originalDate: "2026-11-02" };
	const html = render(viewProps({ editableMovements: [editable] }));
	assert.match(html, /aria-label="Ver Lider del 2 nov"[^>]*>Ver<\/button>/);
	assert.match(html, /aria-label="Editar Lider del 2 nov"[^>]*>Editar<\/button>/);
	assert.match(html, /aria-label="Eliminar Lider del 2 nov"[^>]*>Eliminar<\/button>/);
	const tree = page.MovementsTableView(viewProps({ editableMovements: [editable], onEdit: (value) => calls.push(value) }));
	const calls = [];
	nodes(tree).find((node) => node.type === "button" && node.props.children === "Editar").props.onClick();
	assert.strictEqual(calls[0], editable);
});

test("active filters are removable chips and one action clears them all", () => {
	const calls = [];
	const props = viewProps({
		search: "Café", kind: "purchase", filteredView: {
			...viewProps().filteredView, activeCategory: "Comida",
			count: count(true, "Comida", "Filtro: Comida · 1 de 6 movimientos con los filtros actuales."),
		},
		onSearchChange: (value) => calls.push(["search", value]),
		onKindChange: (value) => calls.push(["kind", value]),
		onClear: () => calls.push(["category"]),
	});
	const html = render(props);
	assert.match(html, /role="group" aria-label="Filtros activos"/);
	assert.match(html, /Búsqueda: Café/);
	assert.match(html, /Tipo: Compras/);
	assert.match(html, /Categoría: Comida/);
	assert.match(html, /aria-label="Quitar filtro Búsqueda: Café"/);
	const tree = page.MovementsTableView(props);
	buttonWithText(tree, "Limpiar filtros").props.onClick();
	assert.deepEqual(calls, [["search", ""], ["kind", ""], ["category"]]);
	calls.length = 0;
	nodes(tree).find((node) => node.type === "button" && node.props["aria-label"] === "Quitar filtro Tipo: Compras").props.onClick();
	assert.deepEqual(calls, [["kind", ""]]);

	const idle = render(viewProps());
	assert.doesNotMatch(idle, /Filtros activos|Limpiar filtros/);
});

test("no results shows the active filters and a way to clear them", () => {
	const calls = [];
	const props = viewProps({
		search: "zapatillas", kind: "purchase",
		filteredView: { ...viewProps().filteredView, rows: [], count: count(true, "", "0 de 6 movimientos con los filtros actuales.") },
		onSearchChange: (value) => calls.push(["search", value]),
		onKindChange: (value) => calls.push(["kind", value]),
		onClear: () => calls.push(["category"]),
	});
	const html = render(props);
	assert.match(html, /No hay movimientos con estos filtros/);
	assert.match(html, /No encontramos movimientos con la búsqueda «zapatillas» y el tipo Compras\./);
	const tree = page.MovementsTableView(props);
	// The state is a component: expand it and press its own action.
	const state = nodes(tree).find((node) => node.type?.name === "MovementsNoResults");
	assert.ok(state, "no-results state is its own component");
	buttonWithText(state.type(state.props), "Limpiar filtros").props.onClick();
	assert.ok(calls.some((call) => call[0] === "search" && call[1] === ""));
	assert.ok(calls.some((call) => call[0] === "kind" && call[1] === ""));
	// The table and the filters stay mounted so the user can adjust them.
	assert.match(html, /react-movements-table/);
});

test("an empty period has one clear first action; the demo stays read-only", () => {
	const empty = viewProps({
		filteredView: { ...viewProps().filteredView, rows: [], options: [{ value: "", label: "Todas las categorías", count: 0 }] },
		periodMovements: [],
	});
	const calls = [];
	const props = { ...empty, onCreateExpense: () => calls.push("create"), onRefresh: () => calls.push("refresh") };
	const html = render(props);
	assert.match(html, /Aún no hay movimientos en este período/);
	assert.match(html, /Cuando lleguen avisos de compra a tu Gmail o agregues un gasto a mano, aparecerán aquí con su categoría\./);
	const state = nodes(page.MovementsTableView(props)).find((node) => node.type?.name === "MovementsEmptyPeriod");
	assert.ok(state, "the empty period is its own component");
	const expanded = state.type(state.props);
	buttonWithText(expanded, "Agregar gasto").props.onClick();
	buttonWithText(expanded, "Actualizar").props.onClick();
	assert.deepEqual(calls, ["create", "refresh"]);
	// Nothing to filter or sort in an empty period.
	assert.doesNotMatch(html, /Buscar y filtrar movimientos|<table|Todo clasificado/);

	const demo = render({ ...empty, readOnlyReason: "Edición deshabilitada en la demo" });
	assert.match(demo, /Aún no hay movimientos en este período/);
	assert.doesNotMatch(demo, /Agregar gasto/);
});

test("the table container wires the prompt, the empty period and clear-all without a second filter implementation", async () => {
	const source = await read("src/client/pages/DashboardPage.tsx");
	assert.match(source, /onClassify=\{/);
	assert.match(source, /selectMovementFilterCategory\("Sin categoría", period\)/);
	assert.match(source, /onCreateExpense=\{openCreateExpense\}/);
});

test("the movements layer carries no cobalt and keeps the 28/18/15 type scale", async () => {
	const css = await read("src/client/movements-polish.css");
	assert.match(css, /--type-title/);
	assert.match(css, /--type-section/);
	assert.doesNotMatch(css, /rgb\(\s*(?:0 53 148|0 74 198|37 99 235|29 78 216)/);
	const identity = await read("src/client/identity-b.css");
	assert.match(identity, /@import "\.\/movements-polish\.css"/);
});
