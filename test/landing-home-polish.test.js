import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

let vite;
let scratch;
let components;
let data;
const render = (name, props = {}) => renderToStaticMarkup(React.createElement(components[name], props));
before(async () => {
	scratch = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "landing-home-polish-"));
	vite = await createServer({ configFile: false, envFile: false, plugins: [react()],
		cacheDir: scratch, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
	components = {};
	for (const name of ["LandingHero", "LandingHeader", "LandingProductSection", "LandingHowItWorksSection", "LandingSecuritySection", "LandingTourSection"]) {
		components[name] = (await vite.ssrLoadModule(`/src/client/components/landing/${name}.tsx`))[name];
	}
	const demo = await vite.ssrLoadModule("/src/client/demo-data.ts");
	data = demo.createDemoDashboardData(JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8")), new Date(2026, 4, 20));
});
after(async () => { await vite?.close(); if (scratch) await rm(scratch, { recursive: true, force: true }); });

test("hero explains the manual period sync and offers an account-free demo", () => {
	const html = render("LandingHero", { data });
	assert.match(html, /<h1[^>]*><span>Tus comprobantes, convertidos/);
	assert.ok(html.includes("en un resumen claro."));
	assert.ok(html.includes("Elige tu período y sincroniza"));
	assert.match(html, /Tu período, más claro/);
	assert.match(html, /medidor del mes/);
	assert.match(html, /href="\/app\/demo"[^>]*>Probar demo<\/a>/);
	assert.match(html, /Sin conectar tu cuenta/);
	assert.doesNotMatch(html, /sin mover un dedo|automáticamente/);
	assert.match(html, /href="\/app"[^>]*>Comenzar ahora/);
	assert.doesNotMatch(html, /\/auth\/google/);
	assert.match(html, /Vista ilustrativa · datos de ejemplo/);
	assert.match(html, /<iframe[^>]*src="\/app\/demo\?preview=summary&amp;scenario=tight"/);
	assert.match(html, /landing-phone/);
});

test("product and exactly three process steps promise available editing only", () => {
	const product = render("LandingProductSection");
	const steps = render("LandingHowItWorksSection");
	assert.doesNotMatch(product + steps, /presupuesto|cinco pasos/);
	assert.match(product, /id="producto"/);
	assert.match(product, /Sincronización por período/);
	assert.match(product, /Medidor del mes y detalle/);
	assert.match(steps, /id="como-funciona"/);
	assert.match(steps, /en tres pasos/);
	assert.equal((steps.match(/<li>/g) ?? []).length, 3);
	for (const label of ["Conectar", "Tu período", "Tu medidor"]) assert.ok(steps.includes(`<h3>${label}</h3>`));
});

test("security distinguishes broad consent, filtered consultation, persistence and revocation", () => {
	const html = render("LandingSecuritySection");
	assert.match(html, /id="seguridad"/);
	for (const copy of ["solo lectura de Gmail", "no se limita a los correos del banco", "perfil y correo electrónico", "La app filtra y procesa solo los avisos de Banco de Chile del período que eliges.", "tokens de acceso", "correcciones", "movimientos manuales", "categorías", "reglas", "períodos", "ingresos informados", "asociados a tu cuenta", "se procesan en memoria", "No hay un plazo de eliminación automática definido.", "Desconectar Gmail", "elimina los tokens y el perfil", "no revoca el permiso en Google", "no elimina tus datos manuales"]) assert.ok(html.includes(copy), copy);
	assert.match(html, /href="https:\/\/myaccount.google.com\/connections"/);
	assert.match(html, /<details[^>]*>\s*<summary>/);
	assert.doesNotMatch(html, /presupuesto|Acceso autorizado y acotado/);
});

test("gallery has one visible notice and preserves all five inert, non-focusable demo screens", () => {
	const html = render("LandingTourSection");
	assert.equal((html.match(/class="landing-tour-notice"/g) ?? []).length, 1);
	assert.match(html, /Estas son pantallas reales de la demo, con datos de ejemplo: aquí no se pueden usar\./);
	assert.equal((html.match(/data-workflow=/g) ?? []).length, 5);
	assert.equal((html.match(/class="landing-phone-live-viewport" inert=""/g) ?? []).length, 5);
	assert.equal((html.match(/<iframe\b[^>]*tabindex="-1"[^>]*aria-hidden="true"/g) ?? []).length, 5);
	assert.match(html, /id="recorrido"/);
	assert.match(html, /href="\/app\/demo"/);
	assert.doesNotMatch(html, /Cargando vista de ejemplo/);
});

test("header preserves authenticated destinations, identity and all native section anchors", () => {
	const anonymous = render("LandingHeader", { session: null });
	assert.match(anonymous, /href="\/auth\/google" aria-label="Acceder con Google"/);
	const authenticated = render("LandingHeader", { session: { authenticated: true, profile: { name: "Cuenta de prueba", email: "test@example.invalid" } } });
	assert.match(authenticated, /href="\/app" aria-label="Ir al dashboard"/);
	assert.match(authenticated, /Cuenta de prueba/);
	assert.doesNotMatch(authenticated, /landing-google-badge/);
	assert.match(authenticated, /landing-session-action-icon/);
	for (const id of ["contenido", "producto", "como-funciona", "compatibilidad", "seguridad"]) assert.ok(anonymous.includes(`href="#${id}"`));
});

test("landing-only responsive rules compact the header early and expose the fixed phone beside tablet copy", async () => {
	const css = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
	assert.match(css, /@media \(max-width: 1023px\)\s*\{\s*\.landing-nav[^}]*display: none/);
	assert.match(css, /\.landing-header \.landing-primary-button\s*\{[^}]*white-space: nowrap/);
	assert.match(css, /\.landing-nav a\s*\{[^}]*white-space: nowrap/);
	assert.match(css, /@media \(min-width: 820px\) and \(max-width: 1023px\)[\s\S]*?\.landing-hero-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 360px/);
	assert.match(css, /\.landing-hero h1\s*\{[^}]*font-size: clamp\(2rem, 8\.5vw, 2\.65rem\)/);
	assert.match(css, /\.landing-hero h1\s*\{[^}]*font-size: clamp\(2rem, 4vw, 3\.65rem\)/);
	assert.match(css, /\.landing-phone\s*\{[^}]*width: min\(328px, calc\(100% - 8px\)\);[^}]*aspect-ratio: 20 \/ 41;/);
	assert.match(css, /\.landing-steps\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});
