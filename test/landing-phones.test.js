import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// S25 (odd/tasks/identidad-b.md, T27): the landing phones show the real read-only demo at 390px, embedded,
// non-interactive and lazy-loaded, with a text alternative. They never draw a hand-built mock again.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => access(new URL(`../${path}`, import.meta.url)).then(() => true, () => false);
let vite, Hero, Tour, Page, preview, data;

before(async () => {
	vite = await createServer({
		envFile: false, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	Hero = (await vite.ssrLoadModule("/src/client/components/landing/LandingHero.tsx")).LandingHero;
	Tour = (await vite.ssrLoadModule("/src/client/components/landing/LandingTourSection.tsx")).LandingTourSection;
	Page = (await vite.ssrLoadModule("/src/client/pages/LandingPage.tsx")).LandingPage;
	preview = await vite.ssrLoadModule("/src/client/components/demo/demoPreview.ts");
	const demo = await vite.ssrLoadModule("/src/client/demo-data.ts");
	data = demo.createDemoDashboardData(JSON.parse(await read("public/demo-data.json")), new Date(2026, 4, 20));
});
after(async () => { await vite?.close(); });

const iframes = (html) => [...html.matchAll(/<iframe\b[^>]*>/g)].map((match) => match[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
const hero = (props = { data }) => renderToStaticMarkup(React.createElement(Hero, props));
const tour = () => renderToStaticMarkup(React.createElement(Tour, {}));

test("hero phone embeds the real demo summary on Ajustado, eager, with the accessibility contract", () => {
	const html = hero();
	const frames = iframes(html);
	assert.equal(frames.length, 1);
	const [frame] = frames;
	assert.equal(attr(frame, "src"), attr(frame, "data-src"), "the eager phone loads at once");
	const url = new URL(attr(frame, "src"), "http://localhost");
	assert.equal(url.pathname, "/app/demo");
	assert.deepEqual(preview.parseDemoPreview(url.search), { view: "summary", scenario: "tight", focus: "top" });
	assert.equal(attr(frame, "loading"), "eager");
	assert.equal(attr(frame, "tabindex"), "-1");
	assert.equal(attr(frame, "aria-hidden"), "true");
	assert.ok((attr(frame, "title") ?? "").length > 10, "iframe has a title");
	assert.equal(attr(frame, "width"), "390");
	assert.ok(Number(attr(frame, "height")) > 600, "reserved height");
	// Hidden from keyboard and pointer by the wrapper as well; the text alternative stays outside it.
	assert.match(html, /<div class="landing-phone-live-viewport" inert="">\s*<iframe/);
	const alt = html.match(/<p class="landing-phone-live-alt">([^<]+)<\/p>/)?.[1] ?? "";
	assert.match(alt, /Ajustado/);
	assert.match(alt, /Datos de ejemplo|solo lectura/i);
	assert.ok(html.indexOf("landing-phone-live-alt") < html.indexOf('class="landing-phone-live-viewport"'));
	// The phone chrome and the page-level caption/cards stay (S1, S16).
	for (const name of ["landing-phone", "landing-phone-island", "landing-phone-home", "landing-connected", "landing-budget", "landing-sync-note"]) assert.ok(html.includes(name), name);
	assert.match(html, /Vista ilustrativa · datos de ejemplo/);
	assert.doesNotMatch(html, /landing-dashboard-preview|react-pace-gauge|landing-stage-topbar/);
});

test("the hero no longer depends on the example fixture to show its phone", () => {
	for (const props of [{ data: null }, { data: null, previewError: "No pudimos cargar los datos de ejemplo. Puedes abrir la demo." }]) {
		const html = hero(props);
		assert.equal(iframes(html).length, 1);
		assert.doesNotMatch(html, /Cargando datos de ejemplo/);
	}
});

test("tour phones are five different lazy-loaded previews of the real demo", () => {
	const html = tour();
	const frames = iframes(html);
	assert.equal(frames.length, 5);
	const seen = new Set();
	const kinds = [];
	for (const frame of frames) {
		assert.equal(attr(frame, "loading"), "lazy");
		assert.equal(attr(frame, "src"), undefined, "a lazy phone has no src until its section is near the viewport");
		assert.equal(attr(frame, "tabindex"), "-1");
		assert.equal(attr(frame, "aria-hidden"), "true");
		assert.ok((attr(frame, "title") ?? "").length > 10);
		assert.equal(attr(frame, "width"), "390");
		const url = new URL(attr(frame, "data-src"), "http://localhost");
		assert.equal(url.pathname, "/app/demo");
		const parsed = preview.parseDemoPreview(url.search);
		assert.ok(parsed, "valid preview params");
		seen.add(JSON.stringify(parsed));
		kinds.push(parsed);
	}
	assert.equal(seen.size, 5, "a different screen per phone");
	assert.ok(kinds.some((item) => item.view === "movements"));
	assert.ok(kinds.some((item) => item.scenario === "calm") && kinds.some((item) => item.scenario === "over"));
	assert.equal((html.match(/<p class="landing-phone-live-alt">[^<]{40,}<\/p>/g) ?? []).length, 5);
	assert.equal((html.match(/class="landing-phone-live-viewport" inert=""/g) ?? []).length, 5);
	assert.equal((html.match(/data-workflow=/g) ?? []).length, 5);
	assert.doesNotMatch(html, /<form|<input|<select|landing-tour-modal|react-cycle-calendar|react-movements-view|Nuevo gasto|landing-dashboard-preview/);
	// The slider controls keep working (S1).
	assert.match(html, /aria-label="Pantalla anterior"/);
	assert.match(html, /aria-label="Pantalla siguiente"/);
	assert.equal((html.match(/class="landing-tour-dot"/g) ?? []).length, 5);
	assert.match(html, /href="\/app\/demo"/);
});

test("the whole landing loads one iframe eagerly and the rest lazily, with unique ids", () => {
	const html = renderToStaticMarkup(React.createElement(Page));
	const frames = iframes(html);
	assert.equal(frames.length, 6);
	assert.equal(frames.filter((frame) => attr(frame, "loading") === "eager").length, 1);
	assert.equal(frames.filter((frame) => attr(frame, "loading") === "lazy").length, 5);
	assert.equal(frames.filter((frame) => attr(frame, "src") !== undefined).length, 1, "only the hero phone has a src at first");
	assert.equal(new Set(frames.map((frame) => attr(frame, "data-src"))).size, 6, "six different screens");
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
	assert.equal(ids.length, new Set(ids).size);
	assert.match(html, /href="\/app"[^>]*>Comenzar ahora/);
	assert.match(html, /href="\/app\/demo"[^>]*>Probar demo/);
	for (const id of ["producto", "como-funciona", "compatibilidad", "seguridad", "recorrido"]) assert.ok(html.includes(`id="${id}"`), id);
});

test("the phone screen is a fixed 390px viewport scaled to the frame, non-interactive and size-reserved", async () => {
	const css = await read("src/client/components/landing/landing-phone-live.css");
	assert.match(css, /\.landing-phone-live-viewport\s*\{[^}]*position:\s*absolute/);
	assert.match(css, /\.landing-phone-live-viewport iframe\s*\{[^}]*width:\s*390px/);
	assert.match(css, /\.landing-phone-live-viewport iframe\s*\{[^}]*transform:\s*scale\(var\(--live-scale/);
	assert.match(css, /\.landing-phone-live-viewport iframe\s*\{[^}]*pointer-events:\s*none/);
	assert.match(css, /\.landing-phone-live-alt\s*\{[^}]*clip-path:\s*inset\(50%\)/);
	const source = await read("src/client/components/landing/LandingPhoneScreen.tsx");
	assert.match(source, /ResizeObserver/);
	assert.match(source, /tabIndex=\{-1\}/);
	assert.match(source, /sandbox=/);
	assert.doesNotMatch(source, /\bfetch\s*\(|api\/client|loadDemoDashboardData/);
	// Lazy phones are gated on their section nearing the viewport, not only on the native attribute.
	assert.match(source, /new IntersectionObserver\(/);
	assert.match(source, /closest\("section"\)/);
	assert.match(source, /src=\{near \? path : undefined\}/);
});

test("the hand-built mock markup and its CSS are gone", async () => {
	assert.equal(await exists("src/client/components/landing/LandingDashboardPreview.tsx"), false);
	assert.equal(await exists("src/client/components/landing/landing-dashboard-preview.css"), false);
	const tourCss = await read("src/client/components/landing/landing-tour.css");
	assert.doesNotMatch(tourCss, /react-cycle-calendar|react-movements|react-create-expense|landing-tour-modal|landing-tour-period-fields/);
	const tourSource = await read("src/client/components/landing/LandingTourSection.tsx");
	assert.doesNotMatch(tourSource, /ExpenseFormPreview|CycleCalendar|MovementsTableView|demo-data/);
});
