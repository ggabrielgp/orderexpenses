import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// S25 (odd/tasks/identidad-b.md, T27): the landing phones embed the real read-only demo through
// `/app/demo?preview=…`. The preview mode lives in the demo page only and is never active without the param.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
let vite, cache, preview, page, demo, data;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "demo-preview-"));
	vite = await createServer({
		configFile: false, envFile: false, cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	preview = await vite.ssrLoadModule("/src/client/components/demo/demoPreview.ts");
	page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	demo = await vite.ssrLoadModule("/src/client/demo-data.ts");
	data = demo.createDemoDashboardData(JSON.parse(await read("public/demo-data.json")), new Date(2026, 4, 10, 12));
});
test.after(async () => {
	await vite?.close();
	await rm(cache, { recursive: true, force: true });
});

const pillOf = (html) => html.match(/react-pace-gauge-pill-icon[^>]*>[^<]*<\/span><span>([^<]+)<\/span>/)?.[1];
const render = (search) => renderToStaticMarkup(createElement(page.DemoDashboardPage, { data, search }));

test("query params choose the view, the scenario and where the preview starts", () => {
	assert.deepEqual(preview.parseDemoPreview("?preview=summary"), { view: "summary", scenario: "tight", focus: "top" });
	assert.deepEqual(preview.parseDemoPreview("?preview=summary&scenario=calm"), { view: "summary", scenario: "calm", focus: "top" });
	assert.deepEqual(preview.parseDemoPreview("preview=movements&scenario=over"), { view: "movements", scenario: "over", focus: "top" });
	assert.deepEqual(preview.parseDemoPreview("?preview=summary&focus=categories"), { view: "summary", scenario: "tight", focus: "categories" });
	assert.deepEqual(preview.parseDemoPreview("?preview=summary&focus=spending"), { view: "summary", scenario: "tight", focus: "spending" });
	// Unknown values fall back to the demo defaults instead of failing.
	assert.deepEqual(preview.parseDemoPreview("?preview=summary&scenario=nope&focus=nope"), { view: "summary", scenario: "tight", focus: "top" });
});

test("the preview is never active without a valid preview param", () => {
	for (const search of ["", "?", "?scenario=over", "?focus=categories", "?preview=", "?preview=other", "?demo=1", undefined]) {
		assert.equal(preview.parseDemoPreview(search), null, String(search));
	}
});

test("builds the path the landing embeds, readable back by the parser", () => {
	const path = preview.buildDemoPreviewPath({ view: "summary", scenario: "calm", focus: "categories" });
	assert.equal(path, "/app/demo?preview=summary&scenario=calm&focus=categories");
	assert.equal(preview.buildDemoPreviewPath({ view: "movements" }), "/app/demo?preview=movements");
	assert.deepEqual(preview.parseDemoPreview(new URL(path, "http://x").search), { view: "summary", scenario: "calm", focus: "categories" });
});

test("preview summary shows the chosen scenario without the scenario control or the footer call to action", () => {
	for (const [scenario, word] of [["calm", "En ritmo"], ["tight", "Ajustado"], ["over", "Vas rápido"]]) {
		const html = render(`?preview=summary&scenario=${scenario}`);
		assert.equal(pillOf(html), word, scenario);
		assert.doesNotMatch(html, /Ver la demo como|demo-scenario/);
		assert.doesNotMatch(html, /demo-dashboard-footer|Inicia sesión para editar|Esta demo no guarda cambios/);
		assert.match(html, /data-demo-preview="summary"/);
		// The real read-only product stays: badge, gauge and the mobile tab bar.
		assert.match(html, /Datos de ejemplo · Solo lectura/);
		assert.match(html, /react-pace-gauge/);
	}
});

test("preview movements renders the real movements view", () => {
	const html = render("?preview=movements");
	assert.match(html, /react-movements-page/);
	assert.match(html, /<h1[^>]*>Movimientos<\/h1>/);
	assert.match(html, /data-demo-preview="movements"/);
	assert.doesNotMatch(html, /demo-dashboard-footer|Ver la demo como/);
	assert.doesNotMatch(html, /react-pace-gauge/);
});

test("without the param the demo is exactly as before: Ajustado, control and footer", () => {
	for (const search of [undefined, "", "?scenario=over", "?preview=other"]) {
		const html = render(search);
		assert.equal(pillOf(html), "Ajustado", String(search));
		assert.match(html, /Ver la demo como:/);
		assert.match(html, /demo-dashboard-footer/);
		assert.match(html, /Inicia sesión para editar/);
		assert.doesNotMatch(html, /data-demo-preview/);
	}
});

test("preview runs only in the demo page, scrolls without stealing focus and hides its scrollbar", async () => {
	const hook = (await read("src/client/components/demo/useDemoPreview.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	assert.match(hook, /window\.scrollTo\(/);
	assert.doesNotMatch(hook, /scrollIntoView|\.focus\(/, "scrolling the iframe must not scroll the parent or take focus");
	assert.match(hook, /behavior: "instant"/);
	const css = await read("src/client/components/demo/demo-preview.css");
	assert.match(css, /html\.demo-preview\s*\{[^}]*scrollbar-width:\s*none/);
	const source = await read("src/client/pages/DashboardPage.tsx");
	const demoSource = await read("src/client/components/demo/DemoDashboardPage.tsx");
	const authStart = source.indexOf("export function DashboardPage");
	const demoStart = demoSource.indexOf("export function DemoDashboardPage");
	assert.ok(authStart > 0 && demoStart > 0);
	assert.ok(!/parseDemoPreview|useDemoPreview/.test(source.slice(authStart)), "authenticated page never reads preview params");
});
