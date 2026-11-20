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
	assert.match(html, /Cargando datos de ejemplo/);
	assert.match(html, /href="\/app\/demo"/);
	for (const id of ["producto", "como-funciona", "compatibilidad", "seguridad"]) {
		assert.ok(html.includes(`href="#${id}"`));
	}
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
	assert.equal(ids.length, new Set(ids).size, "Landing controls must have unique IDs");
}));

test("failed example loading is announced instead of leaving both previews loading forever", async () => {
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
		for (const Component of [hero.LandingHero, tour.LandingTourSection]) {
			const html = renderToStaticMarkup(React.createElement(Component, { data: null, previewError: error }));
			assert.ok(html.includes(error), "Surface the failed public fixture request");
			assert.doesNotMatch(html, /Cargando/);
			assert.match(html, /href="\/app\/demo"/);
		}
	} finally { await vite.close(); }
});
