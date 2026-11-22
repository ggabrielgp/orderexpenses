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
const render = (value = data) => renderToStaticMarkup(React.createElement(Tour, { data: value }));
const screen = (html, workflow) => {
	const match = html.match(new RegExp(`<article[^>]*data-workflow="${workflow}"[^>]*>([\\s\\S]*?)</article>\\s*</li>`));
	assert.ok(match, `Missing ${workflow} phone`);
	return match[1];
};

test("tour offers five named read-only workflows and preserves the public demo destination", () => {
	const html = render();
	assert.match(html, /class="[^"]*tour[^"]*landing-tour/);
	assert.match(html, /id="recorrido"/);
	for (const heading of ["Recorrido por la app", "Resumen de tu periodo", "Elegir periodo", "Tabla de gastos", "Agregar un gasto", "Categorizar un gasto"]) assert.ok(html.includes(heading));
	assert.equal((html.match(/data-workflow=/g) ?? []).length, 5);
	assert.doesNotMatch(html, /Datos de ejemplo · vista de solo lectura|Desliza para recorrer|landing-tour-help|landing-tour-disclaimer/);
	assert.match(html, /href="\/app\/demo"/);
	assert.equal((html.match(/class="landing-tour-illustration" role="img"/g) ?? []).length, 5);
	assert.equal((html.match(/class="landing-tour-canvas" inert=""/g) ?? []).length, 5);
	for (const frame of ["landing-phone-island", "landing-stage-topbar", "landing-phone-home"]) {
		assert.equal((html.match(new RegExp(`class="${frame}"`, "g")) ?? []).length, 5);
	}
	assert.doesNotMatch(html, /<dialog|<iframe|id="(?:manual-expense|edit-movement|react-create-expense)/);
});

test("tour omits visible captions while retaining accessible names and every phone", () => {
	const html = render();
	assert.doesNotMatch(html, /landing-tour-caption|landing-tour-step|<h3[^>]*>(?:Agregar un gasto|Categorizar un gasto|Resumen de tu periodo)/);
	for (const description of ["Tu total, saldo disponible y los gráficos que explican tus gastos.", "Registra también lo que no llegó por correo, con los datos del gasto.", "Desde Editar movimiento, revisa su categoría y los demás datos."]) assert.ok(!html.includes(description));
	for (const name of ["Resumen de tu periodo", "Elegir periodo", "Tabla de gastos", "Agregar un gasto", "Categorizar un gasto"]) assert.ok(html.includes(`aria-label="${name}. Vista de solo lectura.`));
	assert.equal((html.match(/data-workflow=/g) ?? []).length, 5);
});

test("dashboard phone reuses the same daily bars and category donut", () => {
	const html = screen(render(), "dashboard");
	assert.match(html, /landing-dashboard-preview/);
	assert.equal((html.match(/class="react-spending-chart-bar"/g) ?? []).length, 7);
	assert.match(html, /react-category-donut-chart/);
	assert.ok(html.includes("Total gastado") && html.includes("Saldo disponible"));
});

test("period phone renders the actual calendar with fixture-derived selected dates", () => {
	const html = screen(render(), "period");
	assert.match(html, /react-cycle-calendar-grid/);
	assert.match(html, /data-date="2026-05-01"[^>]*aria-pressed="true"[^>]*disabled/);
	assert.match(html, /data-date="2026-05-31"[^>]*aria-pressed="true"[^>]*disabled/);
	assert.ok(html.includes("Inicio") && html.includes("Término"));
	for (const value of ["Cambiar período", "Fecha de inicio", "Fecha de término (inclusive)", "Ingreso mensual (opcional)", "Guardar cambios"]) assert.ok(html.includes(value), value);
	for (const control of html.match(/<(?:input|button)\b[^>]*>/g) ?? []) assert.match(control, /disabled=""/);
	assert.doesNotMatch(html, /data-date="2026-06-/);
});

test("expense phone renders shared movement view with real fixture amounts and categories", () => {
	const html = screen(render(), "expenses");
	assert.match(html, /react-movements-view/);
	assert.match(html, /react-mobile-movement-card/);
	for (const value of ["Actividad del período", "Detalle de movimientos", "Lider", "$45.990", "Supermercado", "Uber", "$12.990", "Transporte", "Rappi", "$32.500", "Comida"]) assert.ok(html.includes(value), value);
});

test("create and categorize phones mirror real form labels without writable controls or colliding IDs", () => {
	const html = render();
	for (const [workflow, title, action, className] of [
		["create", "Nuevo gasto", "Guardar gasto", "react-create-expense-form"],
		["categorize", "Editar movimiento", "Guardar cambios", "react-edit-movement-form"],
	]) {
		const markup = screen(html, workflow);
		for (const value of [title, action, className, "Fecha y hora", "Monto CLP", "Tipo", "Categoría", "Comercio o persona", "Descripción", "Lider", "Supermercado"]) assert.ok(markup.includes(value), value);
		for (const control of markup.match(/<(?:input|select|button)\b[^>]*>/g) ?? []) assert.match(control, /disabled=""/);
		assert.doesNotMatch(markup, /type="submit"/);
	}
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
	assert.equal(new Set(ids).size, ids.length);
	for (const match of html.matchAll(/for="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
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
	assert.doesNotMatch(render(null), /landing-tour-dot|Pantalla siguiente/);
});

test("carousel hides the scrollbar while retaining native swipe and centers cyclic neighbors", async () => {
	const css = await readFile(new URL("../src/client/components/landing/landing-tour.css", import.meta.url), "utf8");
	assert.match(css, /scrollbar-width:\s*none/);
	assert.match(css, /\.landing-tour \.tour-track::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
	assert.match(css, /\.landing-tour \.tour-track\s*\{[^}]*margin-inline:\s*auto/);
	const html = render();
	const order = [...html.matchAll(/data-workflow="([^"]+)"/g)].map(match => match[1]);
	assert.deepEqual(order, ["create", "categorize", "dashboard", "period", "expenses"]);
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

test("null data stays truthful instead of generating fixture screens", () => {
	const html = render(null);
	assert.ok(html.includes("Cargando vista de ejemplo"));
	assert.match(html, /role="status"/);
	assert.doesNotMatch(html, /react-cycle-calendar-grid|react-movements-view|Lider|45\.990|<input|<select/);
	assert.match(html, /href="\/app\/demo"/);
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
