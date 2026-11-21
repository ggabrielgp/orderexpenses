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

test("the bar names both views and marks only the active one with aria-current", () => {
	const html = render(tabbar.MobileTabBar, { view: "movements", onViewChange: noop, onAddExpense: noop });
	assert.match(html, /<nav class="react-mobile-tabbar" aria-label="Navegación principal">/);
	assert.match(html, /<button type="button" class="react-mobile-tabbar-link"[^>]*>[\s\S]*?Resumen<\/span><\/button>/);
	assert.match(html, /<button[^>]*aria-current="page"[^>]*>[\s\S]*?Movimientos<\/span><\/button>/);
	assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
	assert.doesNotMatch(html, /aria-pressed/);
	assert.doesNotMatch(html.match(/<button[^>]*>(?=[\s\S]*?Resumen<\/span>)/)[0], /aria-current/);
	assert.match(html, /<button[^>]*class="react-mobile-tabbar-add"[^>]*aria-label="Agregar gasto"/);
	// Summary active: the mark moves to the other button.
	const summary = render(tabbar.MobileTabBar, { view: "summary", onViewChange: noop, onAddExpense: noop });
	assert.match(summary, /<button[^>]*aria-current="page"[^>]*>[\s\S]*?Resumen<\/span><\/button>/);
	assert.equal((summary.match(/aria-current="page"/g) ?? []).length, 1);
});

test("the demo bar is two items that share the width, with no empty middle slot", async () => {
	const html = render(tabbar.MobileTabBar, { view: "summary", onViewChange: noop });
	assert.match(html, /<nav class="react-mobile-tabbar react-mobile-tabbar-two"/);
	assert.doesNotMatch(html, /react-mobile-tabbar-spacer/);
	assert.equal((html.match(/<button/g) ?? []).length, 2);
	const withAdd = render(tabbar.MobileTabBar, { view: "summary", onViewChange: noop, onAddExpense: noop });
	assert.doesNotMatch(withAdd, /react-mobile-tabbar-two/);
	const css = await read("src/client/identity-b.css");
	const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
	assert.match(narrow, /\.react-mobile-tabbar-two \{[^}]*grid-template-columns: 1fr 1fr;/);
	assert.match(narrow, /\.react-mobile-tabbar \{[^}]*grid-template-columns: 1fr 72px 1fr;/);
});

test("the content keeps clear of the fixed bar on narrow screens", async () => {
	const css = await read("src/client/identity-b.css");
	const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
	const rule = narrow.match(/\.react-shell \{[^}]*padding-bottom: calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/);
	assert.ok(rule, "the shell reserves space for the bar plus the safe area");
	// Bar height (56px button + padding) plus the 26px the central button rises above it.
	assert.ok(Number(rule[1]) >= 96);
});

test("without a create handler the bar shows no add button", () => {
	const html = render(tabbar.MobileTabBar, { view: "summary", onViewChange: noop });
	assert.doesNotMatch(html, /react-mobile-tabbar-add|Agregar gasto/);
	assert.match(html, /Resumen/);
	assert.match(html, /Movimientos/);
});

test("the read-only demo mounts the bar without the add button", () => {
	const html = render(page.DemoDashboardView, { data, view: "summary", onViewChange: noop, onRequestedCategoryChange: noop, today: { year: 2026, month: 5, day: 10 } });
	assert.match(html, /class="react-mobile-tabbar react-mobile-tabbar-two"/);
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
	assert.match(narrow, /min-height: 52px/);
});
