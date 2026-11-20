import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Identity B (odd/tasks/identidad-b.md, T6, S4): on narrow screens the view navigation becomes a
// bottom bar with a central "Agregar gasto" button; the header navigation keeps existing (S1).
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const noop = () => {};
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
let vite, cache, tabbar, page, data;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "mobile-tabbar-"));
	vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	tabbar = await vite.ssrLoadModule("/src/client/components/shell/MobileTabBar.tsx");
	page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	const { createDemoDashboardData } = await vite.ssrLoadModule("/src/client/demo-data.ts");
	data = createDemoDashboardData(JSON.parse(await read("public/demo-data.json")), new Date(2026, 4, 10, 12));
});
test.after(async () => {
	await vite?.close();
	await rm(cache, { recursive: true, force: true });
});

test("the bar names both views and marks only the active one", () => {
	const html = render(tabbar.MobileTabBar, { view: "movements", onViewChange: noop, onAddExpense: noop });
	assert.match(html, /<nav class="react-mobile-tabbar" aria-label="Navegación principal">/);
	assert.match(html, /<button[^>]*aria-pressed="false"[^>]*>[\s\S]*?Resumen<\/span><\/button>/);
	assert.match(html, /<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Movimientos<\/span><\/button>/);
	assert.match(html, /<button[^>]*class="react-mobile-tabbar-add"[^>]*aria-label="Agregar gasto"/);
});

test("without a create handler the bar shows no add button", () => {
	const html = render(tabbar.MobileTabBar, { view: "summary", onViewChange: noop });
	assert.doesNotMatch(html, /react-mobile-tabbar-add|Agregar gasto/);
	assert.match(html, /Resumen/);
	assert.match(html, /Movimientos/);
});

test("the read-only demo mounts the bar without the add button", () => {
	const html = render(page.DemoDashboardView, { data, view: "summary", onViewChange: noop, onRequestedCategoryChange: noop, today: { year: 2026, month: 5, day: 10 } });
	assert.match(html, /class="react-mobile-tabbar"/);
	assert.doesNotMatch(html, /react-mobile-tabbar-add/);
	// The header navigation is still rendered (S1).
	assert.match(html, /<nav class="react-app-navigation"[^>]*aria-label="Vistas del panel">/);
});

test("the authenticated page wires the add button to the existing create flow", async () => {
	const source = await read("src/client/pages/DashboardPage.tsx");
	assert.match(source, /<MobileTabBar\s+view=\{view\}\s+onViewChange=\{setView\}\s+onAddExpense=\{financialDashboard\?\.period \? financialDashboard\.onCreateExpense : undefined\}/);
});

test("the bar only shows on narrow screens, where it replaces the header navigation", async () => {
	const css = await read("src/client/identity-b.css");
	assert.match(css, /\.react-mobile-tabbar \{\s*display: none;/);
	const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
	assert.ok(narrow.length > 0 && css.includes("@media (max-width: 760px)"));
	assert.match(narrow, /\.react-mobile-tabbar \{[^}]*display: grid;[^}]*position: fixed;/);
	assert.match(narrow, /\.react-app-navigation \{[^}]*display: none;/);
	assert.match(narrow, /min-height: 48px/);
});
