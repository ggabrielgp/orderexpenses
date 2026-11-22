import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const withVite = async (t) => {
	const vite = await createServer({
		configFile: false, envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false },
		appType: "custom",
	});
	t.after(() => vite.close());
	return vite;
};
const anchor = (html, label) => html.match(new RegExp(`<a [^>]*>${label}`))?.[0] ?? "";

// S23 (a)
test("S23a: the hero's Comenzar ahora is a plain link to /app; the other landing entries keep their targets", async (t) => {
	const vite = await withVite(t);
	const { LandingHero } = await vite.ssrLoadModule("/src/client/components/landing/LandingHero.tsx");
	const { LandingHeader } = await vite.ssrLoadModule("/src/client/components/landing/LandingHeader.tsx");
	const hero = renderToStaticMarkup(createElement(LandingHero, {}));
	assert.match(anchor(hero, "Comenzar ahora"), /href="\/app"/);
	assert.doesNotMatch(anchor(hero, "Comenzar ahora"), /auth\/google/);
	assert.match(anchor(hero, "Probar demo"), /href="\/app\/demo"/);
	const header = renderToStaticMarkup(createElement(LandingHeader, { session: null }));
	assert.match(header, /href="\/auth\/google"/, "header sign-in still goes to Google");
	assert.match(header, /Acceder con Google/);
});

// S23 (b)
test("S23b: the authenticated header never renders the period context line; the button keeps the full-range name", async () => {
	const page = await read("src/client/pages/DashboardPage.tsx");
	const start = page.indexOf("export function DashboardPage(");
	const end = page.indexOf("export function DemoDashboardView", start) === -1 ? page.length : page.indexOf("export function DemoDashboardView", start);
	const authenticated = page.slice(start, end);
	assert.doesNotMatch(authenticated, /<DashboardPeriodContext/);
	assert.match(authenticated, /aria-label=\{`Editar periodo: \$\{formatPeriodLabel\(financialDashboard\.period\)\}`\}/);
	assert.match(authenticated, /className="react-dashboard-period"/);
});

test("S23b: the read-only demo (no period button) keeps the period visible", async (t) => {
	const vite = await withVite(t);
	const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	const { createDemoDashboardData } = await vite.ssrLoadModule("/src/client/demo-data.ts");
	const fixture = JSON.parse(await read("public/demo-data.json"));
	const data = createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
	for (const view of ["summary", "movements"]) {
		const html = renderToStaticMarkup(createElement(page.DemoDashboardView, { data, view, onViewChange() {}, onRequestedCategoryChange() {} }));
		assert.ok(html.includes(`Periodo: ${page.formatPeriodLabel(data.period)}`), view);
		assert.doesNotMatch(html, /react-dashboard-period"/);
	}
});

// S23 (c)
test("S23c: no compact period range remains; mobile shows the full range on its own full-width 44px row", async () => {
	const page = await read("src/client/pages/DashboardPage.tsx");
	const source = await read("src/client/dashboard-mobile-ergonomics.css");
	assert.doesNotMatch(page, /react-dashboard-period-range-compact/);
	assert.doesNotMatch(source, /react-dashboard-period-range-compact/);
	assert.doesNotMatch(page, /replace\(\/\\\/\\d\{4\}\/g/);
	assert.match(page, /className="react-dashboard-period-range react-dashboard-period-range-full"/);
	const mobile = source.slice(source.indexOf("@media (max-width: 800px)"));
	assert.doesNotMatch(mobile, /react-dashboard-period-range-full[^{]*\{\s*display:\s*none/);
	assert.match(mobile, /\.react-shell \.react-dashboard-controls\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
	assert.match(mobile, /\.react-shell \.react-dashboard-period\s*\{[^}]*grid-column: 1 \/ -1/s);
	assert.match(mobile, /\.react-shell \.react-dashboard-period\s*\{[^}]*min-height: 44px/s);
	assert.match(mobile, /\.react-shell \.react-dashboard-period-range\s*\{[^}]*white-space: nowrap/s);
	assert.match(mobile, /\.react-shell \.react-dashboard-period-range\s*\{[^}]*font-size: \.875rem/s);
	assert.doesNotMatch(mobile, /\.react-dashboard-refresh-label\s*\{\s*display:\s*none/);
	assert.match(mobile, /\.react-shell \.react-dashboard-refresh\s*\{[^}]*min-height: 44px/s);
});

test("S23c: with the period line gone, the mobile movements heading stays left-aligned with the full-width controls", async () => {
	const polish = await read("src/client/movements-polish.css");
	const mobile = polish.slice(polish.indexOf("@media (max-width: 640px)"));
	assert.match(mobile, /\.react-movements-page \.react-dashboard-header\s*\{[^}]*align-items: stretch/s);
});
