import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Structural motion checks: this repository has no browser animation runner.
test("dashboard navigation uses one sliding indicator for both views", async () => {
	const css = await read("src/client/dashboard-motion.css");
	assert.match(css, /\.react-app-navigation::before\s*\{[^}]*transition:\s*transform 220ms/);
	assert.match(css, /\.react-app-navigation\[data-view="movements"\]::before\s*\{[^}]*transform:\s*translateX\(calc\(100% \+ 34px\)\)/);
	assert.match(css, /\.react-app-navigation-link::after\s*\{\s*content:\s*none;/);
	const vite = await createServer({
		configFile: false,
		envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false },
	});
	try {
		const { AppHeader } = await vite.ssrLoadModule("/src/client/components/shell/AppHeader.tsx");
		const { createElement } = await import("react");
		const { renderToStaticMarkup } = await import("react-dom/server");
		for (const view of ["summary", "movements"]) {
			const html = renderToStaticMarkup(createElement(AppHeader, { view, onViewChange() {} }));
			assert.ok(html.includes(`data-view="${view}"`));
			assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
			assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 1);
			assert.ok(html.includes("Resumen") && html.includes("Movimientos"));
			assert.ok(html.includes('href="/"') && html.includes('aria-label="Vistas del panel"'));
		}
	} finally {
		await vite.close();
	}
});

test("spending selections use a shared decorative surface without removing static active styling", async () => {
	const css = await read("src/client/styles.css");
	assert.match(css, /\.react-spending-chart-selection-indicator\s*\{[^}]*display: none;[^}]*position: absolute;[^}]*pointer-events: none;/);
	assert.match(css, /\[data-selection-motion="true"\] > \.react-spending-chart-selection-indicator\s*\{\s*display: block;/);
	assert.match(css, /\.react-spending-chart-summary-row-active\s*\{[^}]*background: var\(--accent\);/);
	assert.match(css, /\.react-spending-chart-tab\[aria-pressed="true"\]\s*\{[^}]*background: #e3ecff;/);
});

test("press feedback is subtle and excludes disabled actions", async () => {
	const css = await read("src/client/dashboard-motion.css");
	assert.match(css, /:not\(:disabled\):not\(\[aria-disabled="true"\]\):active\s*\{[^}]*scale:\s*0\.98;/);
	assert.match(css, /:is\(:disabled, \[aria-disabled="true"\]\):active\s*\{[^}]*scale:\s*1;/);
	assert.doesNotMatch(css, /pointer-events|outline:\s*(?:none|0)/);
});

test("dialog and detail entrance is short, scoped and respects reduced motion", async () => {
	const css = await read("src/client/dashboard-motion.css");
	assert.match(css, /dialog\[class\*="react-"\]\[open\][^]*animation:\s*dashboard-surface-in 220ms/);
	assert.match(css, /\.react-category-detail/);
	assert.match(css, /\.react-spending-chart-day-panel/);
	assert.match(css, /\.react-movements-view/);
	assert.match(css, /@keyframes dashboard-surface-in\s*\{[^]*translateY\(6px\)/);
	const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /transition:\s*none\s*!important/);
	assert.match(reduced, /animation:\s*none\s*!important/);
	assert.match(reduced, /scale:\s*1\s*!important/);
	assert.doesNotMatch(css, /infinite|animation-delay/);
	const entry = await read("src/client/main.tsx");
	assert.ok(entry.indexOf('"./dashboard-motion.css"') > entry.indexOf('"./styles.css"'));
});
