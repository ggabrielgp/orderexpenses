import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// S25 (odd/tasks/identidad-b.md, T27): the landing speaks like the app. One word for the user's range
// ("período"), the month gauge and its three states, the onboarding steps, the honest Gmail scope (S9),
// and no promise about something the product does not do.
let vite, html, text, sources;

before(async () => {
	vite = await createServer({
		envFile: false, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	const Page = (await vite.ssrLoadModule("/src/client/pages/LandingPage.tsx")).LandingPage;
	html = renderToStaticMarkup(React.createElement(Page));
	// Visible text plus the text-bearing attributes a reader or a screen reader meets.
	const attributes = [...html.matchAll(/\s(?:aria-label|title|alt)="([^"]*)"/g)].map((match) => match[1]).join("\n");
	text = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, "\n") + "\n" + attributes;
	const dir = new URL("../src/client/components/landing/", import.meta.url);
	sources = await Promise.all((await readdir(dir)).filter((name) => name.endsWith(".tsx"))
		.map(async (name) => [name, await readFile(new URL(name, dir), "utf8")]));
});
after(async () => { await vite?.close(); });

test("vocabulary: always 'período' with accent, never 'periodo' nor 'ciclo' for the range", () => {
	assert.doesNotMatch(text, /\bperiodos?\b/i, "unaccented periodo");
	assert.doesNotMatch(text, /\bciclos?\b/i, "ciclo names the range in the old copy");
	for (const [name, source] of sources) {
		assert.doesNotMatch(source, /\bperiodos?\b/i, `${name} has an unaccented periodo`);
		assert.doesNotMatch(source, /["'`>][^"'`<]*\bciclos?\b/i, `${name} has ciclo in copy`);
	}
	assert.match(text, /Tu período, más claro/);
	assert.match(text, /Elige tu período y sincroniza/);
	assert.match(text, /Un período\. Cada gasto en su lugar\./);
});

test("the month gauge and its three states are described where the product is", () => {
	const product = html.match(/id="producto"[\s\S]*?<\/section>/)?.[0] ?? "";
	for (const word of ["medidor", "En ritmo", "Ajustado", "Vas rápido"]) assert.ok(product.includes(word), `product: ${word}`);
	const hero = html.match(/class="landing-hero"[\s\S]*?<\/section>/)?.[0] ?? "";
	assert.ok(hero.includes("medidor"), "hero mentions the gauge");
	assert.match(hero, /Te quedan/);
	assert.doesNotMatch(text, /Al límite|En peligro|Pasado\b/);
});

test("the how-it-works steps are the onboarding steps: Conectar · Tu período · Tu medidor", () => {
	const steps = html.match(/id="como-funciona"[\s\S]*?<\/section>/)?.[0] ?? "";
	const titles = [...steps.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]);
	assert.deepEqual(titles, ["Conectar", "Tu período", "Tu medidor"]);
	for (const option of ["Mes calendario", "Desde mi día de pago", "Otro rango"]) assert.ok(steps.includes(option), option);
	assert.match(steps, /qué leemos/i);
});

test("Gmail scope is honest and consistent with the consent copy (S9)", () => {
	const security = html.match(/id="seguridad"[\s\S]*?<\/section>/)?.[0] ?? "";
	for (const phrase of ["solo lectura de Gmail", "no se limita a los correos del banco", "no permite enviar ni modificar mensajes", "filtra", "Banco de Chile", "servidor", "asociados a tu cuenta"]) {
		assert.ok(security.includes(phrase), phrase);
	}
	assert.doesNotMatch(text, /localmente|en tu dispositivo|presupuesto/i);
});

test("no promise about a feature the product does not have", () => {
	assert.doesNotMatch(text, /presupuesto|Próximamente|próximamente|topes?\b|alertas? (?:por|de)|notificaci/i);
	assert.match(text, /Banco de Chile/);
	assert.match(html, /Compatibilidad bancaria/);
});

test("S1: sections, anchors, sign-in, entry and demo links keep working", () => {
	for (const id of ["contenido", "producto", "como-funciona", "compatibilidad", "seguridad", "recorrido"]) {
		assert.ok(html.includes(`id="${id}"`), `section ${id}`);
	}
	for (const id of ["producto", "como-funciona", "compatibilidad", "seguridad"]) assert.ok(html.includes(`href="#${id}"`), `anchor ${id}`);
	assert.match(html, /href="\/auth\/google" aria-label="Acceder con Google"/);
	assert.match(html, /href="\/app"[^>]*>Comenzar ahora/);
	assert.match(html, /href="\/app\/demo"[^>]*>Probar demo/);
	assert.match(html, /href="\/app\/demo"[^>]*>Explorar la demo/);
	assert.match(html, /aria-label="Controles del recorrido"/);
});
