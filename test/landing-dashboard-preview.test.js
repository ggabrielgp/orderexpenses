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
    vite.ssrLoadModule("/src/client/components/landing/LandingDashboardPreview.tsx"),
    vite.ssrLoadModule("/src/client/components/landing/LandingHero.tsx"),
    vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
    vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts"),
    vite.ssrLoadModule("/src/client/components/analytics/categoryRanking.ts"),
  ]);
}

function renderWithoutFetch(Component, props) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Landing illustration must not fetch"); };
  try { return renderToStaticMarkup(React.createElement(Component, props)); }
  finally { globalThis.fetch = originalFetch; }
}

test("phone renders the real weekday bars and category donut from one fixture period", async (t) => {
  const [demo, preview, , page, spending, categories] = await modules(t);
  const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
  const before = structuredClone(data);
  const movements = page.getRecognizedExpenseMovements(demo.getDemoTransactions(data));
  const chart = spending.getSpendingChart(movements, data.period, 0);
  const series = spending.getSpendingChartSeries(chart, spending.FULL_PERIOD_TAB_ID);
  const ranking = categories.getCategoryRanking(movements, 0);
  const markup = renderWithoutFetch(preview.LandingDashboardPreview, { data });
  for (const label of ["Total gastado", "Saldo disponible", "Gasto por día de la semana", "Dónde se fue tu plata", page.formatPeriodLabel(data.period)]) {
    assert.ok(markup.includes(label), label);
  }
  assert.ok(markup.includes(clp(data.currentPeriodSpending)));
  assert.ok(markup.includes(clp(data.currentPeriodInflow - data.currentPeriodSpending)));
  assert.equal((markup.match(/class="react-spending-chart-bar"/g) ?? []).length, 7);
  for (const day of series.days) {
    assert.ok(markup.includes(`>${day.label}</strong>`));
    if (day.total > 0) assert.ok(markup.includes(`height:${day.heightPercent}%`));
  }
  assert.match(markup, /class="react-category-donut" role="img"/);
  assert.match(markup, /class="react-category-donut-chart"/);
  assert.equal((markup.match(/class="react-category-legend-item"/g) ?? []).length, ranking.rows.length);
  for (const row of ranking.rows) {
    assert.ok(markup.includes(row.category));
    assert.ok(markup.includes(`${clp(row.total)} · ${row.share}%`));
  }
  assert.match(markup, /inert=""/);
  assert.doesNotMatch(markup, /<form|Nuevo gasto|Sincronizar|Editar gasto/);
  assert.deepEqual(data, before);
  const css = await readFile(new URL("../src/client/components/landing/landing-dashboard-preview.css", import.meta.url), "utf8");
  assert.match(css, /\.landing-dashboard-preview \.react-spending-chart-bars\s*\{[^}]*display: grid;[^}]*repeat\(7,/);
  assert.match(css, /\.landing-dashboard-preview \.react-spending-chart-bar\s*\{[^}]*grid-template-rows: 112px auto;/);
  assert.match(css, /\.landing-dashboard-preview \.react-category-donut\s*\{[^}]*width: 232px;[^}]*zoom: \.7155;/);
  assert.doesNotMatch(css, /\.landing-stage \.landing-phone\s*\{/);
  assert.match(css, /\.landing-dashboard-preview \.react-spending-chart-track\s*\{[^}]*height: 112px;/);
  assert.match(css, /\.landing-dashboard-preview \.react-spending-chart-fill\s*\{[^}]*transform: scaleY\(\.86\);[^}]*transform-origin: bottom;/);
  assert.match(css, /\.landing-dashboard-preview \.react-category-legend-item\s*\{[^}]*min-height: 0;/);
  assert.match(css, /\.landing-dashboard-preview \.react-category-distribution-copy\s*\{[^}]*margin: 0;/);
  for (const selector of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)) {
    for (const branch of selector[1].split(",")) {
      assert.match(branch.trim(), /^\.landing-(?:dashboard-preview|stage)/, "Keep compact styles local");
    }
  }
});

test("loading is truthful and hero preserves links, phone chrome and example caption", async (t) => {
  const [demo, preview, hero] = await modules(t);
  const loading = renderWithoutFetch(preview.LandingDashboardPreview, { data: null });
  assert.match(loading, /Cargando datos de ejemplo/);
  assert.doesNotMatch(loading, /\$|Agosto 2026|react-category-donut-chart/);
  const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
  const markup = renderWithoutFetch(hero.LandingHero, { data });
  for (const name of ["landing-phone", "landing-phone-island", "landing-stage-topbar", "landing-phone-home", "landing-connected", "landing-budget", "landing-sync-note"]) {
    assert.ok(markup.includes(`class="${name}"`) || markup.includes(` ${name}"`), name);
  }
  assert.match(markup, /<figure class="landing-stage" aria-label="Vista ilustrativa/);
  assert.match(markup, /<figcaption class="landing-stage-caption">Vista ilustrativa · datos de ejemplo<\/figcaption>/);
  assert.match(markup, /<a class="landing-primary-button" href="\/app">Comenzar ahora/);
  assert.match(markup, /href="\/app\/demo"/);
  assert.ok(markup.includes(`${data.movements.length} movimientos`));
  assert.doesNotMatch(markup, /68% utilizado|Presupuesto|Sincronizados|Agosto 2026|landing-bars/);
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const file of ["LandingHero.tsx", "LandingDashboardPreview.tsx"]) {
    const source = await readFile(new URL(`../src/client/components/landing/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|api\/client|loadDemoDashboardData|createManualExpense|syncGmail/);
  }
});
