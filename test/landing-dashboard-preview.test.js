import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer, loadConfigFromFile } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8"));
const clp = (amount) => new Intl.NumberFormat("es-CL", {
  style: "currency", currency: "CLP", maximumFractionDigits: 0,
}).format(amount);

async function modules(t) {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" },
    fileURLToPath(new URL("../vite.config.ts", import.meta.url)));
  const vite = await createServer({ ...loaded?.config, envFile: false, configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom", server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  t.after(() => vite.close());
  return Promise.all([
    vite.ssrLoadModule("/src/client/demo-data.ts"),
    vite.ssrLoadModule("/src/client/components/landing/LandingHero.tsx"),
  ]);
}

function renderWithoutFetch(Component, props) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Landing illustration must not fetch"); };
  try { return renderToStaticMarkup(React.createElement(Component, props)); }
  finally { globalThis.fetch = originalFetch; }
}

// S25: the phone is the real demo in an iframe (see landing-phones.test.js); the hero keeps its chrome,
// links, floating cards and caption, and the cards still read the one example fixture.
test("hero preserves links, phone chrome, floating cards and example caption", async (t) => {
  const [demo, hero] = await modules(t);
  const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
  const before = structuredClone(data);
  const markup = renderWithoutFetch(hero.LandingHero, { data });
  for (const name of ["landing-phone", "landing-phone-island", "landing-phone-home", "landing-connected", "landing-budget", "landing-sync-note"]) {
    assert.ok(markup.includes(`class="${name}"`) || markup.includes(` ${name}"`), name);
  }
  assert.doesNotMatch(markup, /landing-stage-topbar/, "the real app header is inside the screen");
  assert.match(markup, /<figure class="landing-stage" aria-label="Vista ilustrativa/);
  assert.match(markup, /<figcaption class="landing-stage-caption">Vista ilustrativa · datos de ejemplo<\/figcaption>/);
  assert.match(markup, /<a class="landing-primary-button" href="\/app">Comenzar ahora/);
  assert.match(markup, /href="\/app\/demo"/);
  assert.ok(markup.includes(`${data.movements.length} movimientos`));
  assert.ok(markup.includes(clp(data.currentPeriodInflow - data.currentPeriodSpending)), "Te quedan card");
  assert.doesNotMatch(markup, /68% utilizado|Presupuesto|Sincronizados|Agosto 2026|landing-bars/);
  assert.doesNotMatch(markup, /Cargando datos de ejemplo/);
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(data, before);
  for (const file of ["LandingHero.tsx", "LandingPhoneScreen.tsx"]) {
    const source = await readFile(new URL(`../src/client/components/landing/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|api\/client|loadDemoDashboardData|createManualExpense|syncGmail/);
  }
});

test("loading and failed example states keep the hero cards truthful while the phone still renders", async (t) => {
  const [, hero] = await modules(t);
  const loading = renderWithoutFetch(hero.LandingHero, { data: null });
  assert.match(loading, /Cargando ejemplo…/);
  assert.doesNotMatch(loading, /\$|Agosto 2026/);
  assert.match(loading, /<iframe/);
  const failed = renderWithoutFetch(hero.LandingHero, { data: null, previewError: "No pudimos cargar los datos de ejemplo. Puedes abrir la demo." });
  assert.match(failed, /Ejemplo no disponible/);
  assert.match(failed, /href="\/app\/demo"/);
});
