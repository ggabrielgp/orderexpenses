import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
test.after(() => vite.close());
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const session = (connected) => ({
	authenticated: true,
	profile: { email: "loading@example.com", name: "Loading tester" },
	gmail: { connected, connectUrl: "/auth/google" },
});
const renderPage = (connected) => renderToStaticMarkup(createElement(page.DashboardPage, { session: session(connected) }));

test("initial dashboard load reserves the real analytics layout without fabricated financial values", async () => {
	const html = renderPage(true);
	assert.match(html, /Preparando los movimientos de tu período/);
	assert.match(html, /role="status" aria-live="polite"/);
	assert.match(html, /aria-busy="true"/);
	assert.match(html, /aria-hidden="true"[^>]*><div class="react-analytics-body"/);
	// S11: the four KPI skeletons became one hero skeleton, like the gauge that replaced the KPI band.
	assert.doesNotMatch(html, /react-analytics-summary|react-loading-kpi/);
	assert.equal((html.match(/react-loading-hero"/g) ?? []).length, 1);
	assert.match(html, /class="react-analytics-columns"/);
	assert.match(html, /react-loading-chart/);
	assert.doesNotMatch(html, /Cargando resumen financiero|\$0|\d+%|role="progressbar"|Sin movimientos|No se encontraron gastos/);

	// Presentation does not introduce requests, timers or a fabricated progress counter.
	const component = await read("src/client/components/analytics/DashboardLoadingState.tsx");
	assert.doesNotMatch(component, /fetch\(|setInterval|setTimeout|useEffect|progressbar/);
	const source = await read("src/client/pages/DashboardPage.tsx");
	// S21: the loading state renders the same skeleton, beside onboarding step 3 (which is idle unless a first save just happened).
	assert.match(source, /if \(state.status === "loading"\)\s*\{\s*return <><DashboardLoadingState view=\{view\} \/>\{firstResultStep\(null\)\}<\/>;/);
	assert.match(source, /Reintentar resumen financiero/);
	assert.match(source, /state.status === "unconfigured"/);
});

test("connected badge describes authorization, not successful synchronization, and stays absent when disconnected", () => {
	const connected = renderPage(true);
	assert.match(connected, /Gmail conectado/);
	assert.doesNotMatch(connected, /Gmail Sincronizado/);
	assert.match(connected, /aria-label="Vistas del panel"/);
	assert.match(connected, /href="\/auth\/logout"/);
	assert.doesNotMatch(renderPage(false), /react-gmail-connected-badge|Gmail conectado/);
	const signedOut = renderToStaticMarkup(createElement(page.DashboardPage, {
		session: { authenticated: false, profile: null, gmail: { connected: false, connectUrl: "/auth/google" } },
	}));
	assert.match(signedOut, /<button class="button" type="button">Conectar Gmail<\/button>/);
	assert.doesNotMatch(signedOut, /react-dashboard-loading|react-gmail-connected-badge/);
});

test("loading matches the selected view and motion is subtle, responsive and optional", async () => {
	const { DashboardLoadingState } = await vite.ssrLoadModule("/src/client/components/analytics/DashboardLoadingState.tsx");
	const movements = renderToStaticMarkup(createElement(DashboardLoadingState, { view: "movements" }));
	assert.match(movements, /react-loading-movements/);
	assert.doesNotMatch(movements, /react-analytics-summary|react-loading-chart|<button|<input|<a /);
	const summary = renderToStaticMarkup(createElement(DashboardLoadingState, { view: "summary" }));
	assert.doesNotMatch(summary, /react-loading-movements|<button|<input|<a /);
	const css = await read("src/client/dashboard-loading.css");
	assert.match(css, /animation: dashboard-skeleton-shimmer 1\.8s ease-in-out infinite/);
	assert.match(css, /animation: dashboard-content-reveal 180ms ease-out/);
	assert.match(css, /@media \(max-width: 640px\)/);
	const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /\.react-loading-placeholder::after/);
	assert.match(reduced, /animation: none !important/);
	assert.match(reduced, /\.react-financial-summary/);
	assert.doesNotMatch(css, /animation-delay|pointer-events:\s*none/);
	const entry = await read("src/client/main.tsx");
	assert.match(entry, /import "\.\/dashboard-loading\.css"/);
});
