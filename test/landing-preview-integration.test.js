import assert from "node:assert/strict";
import test from "node:test";
import { createServer, loadConfigFromFile } from "vite";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function withLanding(run) {
	const loaded = await loadConfigFromFile({ command: "serve", mode: "test" },
		fileURLToPath(new URL("../vite.config.ts", import.meta.url)));
	const vite = await createServer({ ...loaded?.config, configFile: false, envFile: false, appType: "custom",
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
	try {
		const page = await vite.ssrLoadModule("/src/client/pages/LandingPage.tsx");
		await run(renderToStaticMarkup(React.createElement(page.LandingPage)));
	} finally { await vite.close(); }
}

test("home contains the phone and screen tour while preserving navigation and demo links", () => withLanding((html) => {
	assert.match(html, /class="landing-phone"/);
	assert.ok(html.includes('class="tour landing-tour'), "Mount the screen tour on the home");
	assert.match(html, /id="recorrido"/);
	assert.match(html, /<iframe[^>]*src="\/app\/demo\?preview=summary/);
	assert.match(html, /Cargando ejemplo…/);
	assert.match(html, /href="\/app\/demo"/);
	for (const id of ["producto", "como-funciona", "compatibilidad", "seguridad"]) {
		assert.ok(html.includes(`href="#${id}"`));
	}
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
	assert.equal(ids.length, new Set(ids).size, "Landing controls must have unique IDs");
}));

test("failed example loading is announced on the hero cards while the phones still embed the demo", async () => {
	const loaded = await loadConfigFromFile({ command: "serve", mode: "test" },
		fileURLToPath(new URL("../vite.config.ts", import.meta.url)));
	const vite = await createServer({ ...loaded?.config, configFile: false, envFile: false, appType: "custom",
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
	try {
		const error = "No pudimos cargar los datos de ejemplo. Puedes abrir la demo.";
		const [hero, tour] = await Promise.all([
			vite.ssrLoadModule("/src/client/components/landing/LandingHero.tsx"),
			vite.ssrLoadModule("/src/client/components/landing/LandingTourSection.tsx"),
		]);
		const heroHtml = renderToStaticMarkup(React.createElement(hero.LandingHero, { data: null, previewError: error }));
		assert.match(heroHtml, /Ejemplo no disponible/, "Surface the failed public fixture request on the cards");
		assert.doesNotMatch(heroHtml, /Cargando/);
		assert.match(heroHtml, /<iframe/);
		assert.match(heroHtml, /href="\/app\/demo"/);
		// The tour does not depend on the fixture at all: it always renders its five screens.
		const tourHtml = renderToStaticMarkup(React.createElement(tour.LandingTourSection, {}));
		assert.equal((tourHtml.match(/<iframe\b/g) ?? []).length, 5);
		assert.doesNotMatch(tourHtml, /Cargando/);
		assert.match(tourHtml, /href="\/app\/demo"/);
	} finally { await vite.close(); }
});
