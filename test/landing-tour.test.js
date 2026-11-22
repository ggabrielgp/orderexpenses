import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let Tour;
let data;
before(async () => {
	server = await createServer({
		envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		appType: "custom",
	});
	const demo = await server.ssrLoadModule("/src/client/demo-data.ts");
	data = demo.createDemoDashboardData(JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8")), new Date(2026, 4, 20));
	Tour = (await server.ssrLoadModule("/src/client/components/landing/LandingTourSection.tsx")).LandingTourSection;
});
after(async () => { await server?.close(); });
const render = () => renderToStaticMarkup(React.createElement(Tour, {}));
const screen = (html, workflow) => {
	const match = html.match(new RegExp(`<article[^>]*data-workflow="${workflow}"[^>]*>([\\s\\S]*?)</article>\\s*</li>`));
	assert.ok(match, `Missing ${workflow} phone`);
	return match[1];
};
const frameOf = (markup) => markup.match(/<iframe\b[^>]*>/)?.[0] ?? "";

// S25: the five phones are the real read-only demo at mobile width (landing-phones.test.js pins the
// iframe contract); this file pins the tour composition, its names and the slider.
test("tour offers five named screens of the real demo and preserves the public demo destination", () => {
	const html = render();
	assert.match(html, /class="[^"]*tour[^"]*landing-tour/);
	assert.match(html, /id="recorrido"/);
	for (const heading of ["Recorrido por la app", "Un período. Cada gasto en su lugar.", "Medidor del mes: En ritmo", "Medidor del mes: Vas rápido", "Gasto por día de la semana", "Dónde se fue tu plata", "Movimientos del período"]) assert.ok(html.includes(heading), heading);
	assert.equal((html.match(/data-workflow=/g) ?? []).length, 5);
	assert.doesNotMatch(html, /Datos de ejemplo · vista de solo lectura|Desliza para recorrer|landing-tour-help|landing-tour-disclaimer/);
	assert.match(html, /href="\/app\/demo"/);
	assert.equal((html.match(/<iframe\b/g) ?? []).length, 5);
	for (const frame of ["landing-phone-island", "landing-phone-home"]) {
		assert.equal((html.match(new RegExp(`class="${frame}"`, "g")) ?? []).length, 5);
	}
	assert.doesNotMatch(html, /landing-stage-topbar|<dialog|id="(?:manual-expense|edit-movement|react-create-expense)/);
});

test("tour omits visible captions while retaining an accessible name and a text alternative per phone", () => {
	const html = render();
	assert.doesNotMatch(html, /landing-tour-caption|landing-tour-step|<h3[^>]*>(?:Agregar un gasto|Categorizar un gasto|Resumen de tu periodo)/);
	for (const name of ["Medidor del mes: En ritmo", "Medidor del mes: Vas rápido", "Gasto por día de la semana", "Dónde se fue tu plata", "Movimientos del período"]) {
		assert.ok(html.includes(`<article data-workflow=`) && html.includes(`aria-label="${name}"`), name);
	}
	for (const workflow of ["gauge-calm", "gauge-over", "spending", "categories", "movements"]) {
		const markup = screen(html, workflow);
		assert.match(markup, /<p class="landing-phone-live-alt">Pantalla de ejemplo/);
		assert.match(markup, /Datos de ejemplo, solo lectura\./);
	}
});

test("each phone embeds its own screen of the demo", () => {
	const html = render();
	const expected = {
		"gauge-calm": "preview=summary&amp;scenario=calm",
		"gauge-over": "preview=summary&amp;scenario=over",
		spending: "preview=summary&amp;scenario=tight&amp;focus=spending",
		categories: "preview=summary&amp;scenario=tight&amp;focus=categories",
		movements: "preview=movements",
	};
	for (const [workflow, query] of Object.entries(expected)) {
		const frame = frameOf(screen(html, workflow));
		assert.ok(frame.includes(`src="/app/demo?${query}"`), `${workflow}: ${frame}`);
		assert.match(frame, /loading="lazy"/);
	}
});

test("slider exposes arrows and five position buttons linked to its scroll region", () => {
	const html = render();
	assert.match(html, /aria-label="Pantalla anterior"/);
	assert.match(html, /aria-label="Pantalla siguiente"/);
	assert.equal((html.match(/class="landing-tour-dot"/g) ?? []).length, 5);
	assert.equal((html.match(/class="landing-tour-dot"[^>]*aria-current="true"/g) ?? []).length, 1);
	assert.match(html, /aria-live="off"/);
	assert.doesNotMatch(html, /Pausar recorrido|Reanudar recorrido|landing-tour-playback/);
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
	for (const match of html.matchAll(/aria-controls="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
});

test("carousel hides the scrollbar while retaining native swipe and centers cyclic neighbors without moving iframes", async () => {
	const css = await readFile(new URL("../src/client/components/landing/landing-tour.css", import.meta.url), "utf8");
	assert.match(css, /scrollbar-width:\s*none/);
	assert.match(css, /\.landing-tour \.tour-track::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
	assert.match(css, /\.landing-tour \.tour-track\s*\{[^}]*margin-inline:\s*auto/);
	const html = render();
	// The DOM order is fixed (a moved iframe reloads); the visual order is each slide's CSS `order`.
	const slides = [...html.matchAll(/<li class="tour-item" style="order:(\d+)"><article[^>]*data-workflow="([^"]+)"/g)].map((match) => [Number(match[1]), match[2]]);
	assert.deepEqual(slides.map(([, workflow]) => workflow), ["gauge-calm", "gauge-over", "spending", "categories", "movements"]);
	assert.deepEqual(slides.sort((a, b) => a[0] - b[0]).map(([, workflow]) => workflow), ["categories", "movements", "gauge-calm", "gauge-over", "spending"]);
	assert.deepEqual(slides.map(([position]) => position), [0, 1, 2, 3, 4]);
	assert.equal(slides.find(([, workflow]) => workflow === "gauge-calm")[0], 2, "the first screen opens in the center");
	const source = await readFile(new URL("../src/client/components/landing/LandingTourSlider.tsx", import.meta.url), "utf8");
	assert.match(source, /cloneElement\(screen, \{/);
	assert.doesNotMatch(source, /screens\[mod\(/, "recycling must not reorder the DOM");
});

test("carousel supports mouse dragging without losing native touch scrolling", async () => {
	const css = await readFile(new URL("../src/client/components/landing/landing-tour.css", import.meta.url), "utf8");
	assert.match(css, /\.landing-tour \.tour-track\s*\{[^}]*cursor:\s*grab/);
	assert.match(css, /\.landing-tour \.tour-track\[data-dragging\]\s*\{[^}]*cursor:\s*grabbing/);
	assert.match(css, /overflow-x:\s*auto/);
});

test("tour phones remain upright without obsolete caption styling or hero changes", async () => {
	const css = await readFile(new URL("../src/client/components/landing/landing-tour.css", import.meta.url), "utf8");
	assert.match(css, /\.landing-tour \.landing-tour-phone\s*\{[^}]*rotate:\s*0deg;[^}]*margin:\s*0;/);
	assert.doesNotMatch(css, /landing-tour-caption|landing-tour-step/);
});

test("gallery is a keyboard-focusable labelled native scroll region with reduced-motion-safe CSS", async () => {
	const html = render();
	assert.match(html, /role="region"[^>]*aria-label="Pantallas de la app"[^>]*tabindex="0"/);
	assert.doesNotMatch(html, /aria-describedby="landing-tour-help"/);
	const css = await readFile(new URL("../src/client/components/landing/landing-tour.css", import.meta.url), "utf8");
	assert.match(css, /overflow-x:\s*auto/);
	assert.match(css, /scroll-snap-type:\s*x proximity/);
	assert.match(css, /scroll-snap-align:\s*center/);
	assert.match(css, /\.landing-tour \.tour-track:focus-visible/);
	assert.match(css, /@media\s*\(prefers-reduced-motion: no-preference\)/);
	assert.match(css, /@media\s*\(prefers-reduced-motion: reduce\)/);
	assert.match(css, /min\(\s*276px,\s*100%\s*\)/);
	assert.match(css, /\.landing-tour \.landing-tour-list\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/);
	assert.match(css, /transform:\s*scale\(var\(--tour-phone-scale\)\)/);
});

test("the slider plays only while on screen, with the tab visible and without reduced motion", async () => {
	const source = await readFile(new URL("../src/client/components/landing/LandingTourSlider.tsx", import.meta.url), "utf8");
	assert.match(source, /new IntersectionObserver\(/);
	assert.match(source, /if \(!onScreen\) return;/);
	assert.match(source, /!document\.hidden/);
	assert.match(source, /prefers-reduced-motion: reduce\)"\)\.matches\) goTo\(activeRef\.current \+ 1, true\)/);
});
