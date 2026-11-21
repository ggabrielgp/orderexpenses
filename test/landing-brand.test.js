import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer, loadConfigFromFile } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// S16 (odd/tasks/identidad-b.md): the landing uses the brand line. Phone/tour previews show the month
// gauge instead of the old lead band, primary CTAs are ink and no cobalt remains in landing colors.

const fixture = JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8"));
const read = (path) => readFile(new URL(`../src/client/${path}`, import.meta.url), "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

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
    vite.ssrLoadModule("/src/client/components/landing/LandingTourSection.tsx"),
  ]);
}

// Cobalt and blue-tinted hues the landing used before the brand line (tokens, accents, soft fills).
const COBALT = ["0b2f8a", "003594", "004ac6", "174ea6", "0d3f91", "2457c6", "2878e5", "286bb5", "e7f1ff", "e3ecff",
  "edf3ff", "f0f5ff", "bfd0ee", "7894ce", "aab9db", "eef2ff", "dfe3f5", "d9dff0", "2563eb", "1d4ed8", "2055b0", "dbeafe", "eff6ff"];
const LANDING_CSS = ["components/landing/landing-tour.css", "components/landing/landing-dashboard-preview.css", "components/landing/landing-brand.css"];

test("the preview renders the month gauge, not the old lead band", async (t) => {
  const [demo, preview, tour] = await modules(t);
  const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
  const markup = renderToStaticMarkup(React.createElement(preview.LandingDashboardPreview, { data }));
  assert.match(markup, /class="react-pace-gauge react-pace-gauge--(?:calm|tight|over)/);
  assert.match(markup, /Te quedan|Te pasaste por/);
  assert.match(markup, /En ritmo|Ajustado|Vas rápido/);
  assert.doesNotMatch(markup, /react-dashboard-lead|react-lead-|Al límite|En peligro/);
  // The accessible summary and the unchanged charts stay (S1).
  for (const label of ["Total gastado", "Saldo disponible", "Gasto por día de la semana", "Dónde se fue tu plata"]) {
    assert.ok(markup.includes(label), label);
  }
  const tourMarkup = renderToStaticMarkup(React.createElement(tour.LandingTourSection, { data, previewError: null }));
  assert.doesNotMatch(tourMarkup, /react-dashboard-lead|Al límite|En peligro/);
  assert.match(tourMarkup, /react-pace-gauge/);
  const source = await read("components/landing/LandingDashboardPreview.tsx");
  assert.doesNotMatch(source, /DashboardLeadView/);
  assert.match(source, /DashboardPaceGauge/);
  assert.match(source, /getDashboardPace/);
});

test("the preview gauge reads the demo's default scenario: Ajustado, whatever day it renders on", async (t) => {
  const [demo, preview] = await modules(t);
  // Different clocks, same data: a clock-driven pace would change state (the old "Vas rápido" in red).
  for (const now of [new Date(2026, 4, 10, 12), new Date(2026, 4, 30, 12), new Date(2026, 5, 20, 12)]) {
    const data = demo.createDemoDashboardData(fixture, now);
    const markup = renderToStaticMarkup(React.createElement(preview.LandingDashboardPreview, { data }));
    assert.match(markup, /react-pace-gauge--tight/);
    assert.match(markup, /Ajustado/);
    assert.doesNotMatch(markup, /react-pace-gauge--(?:calm|over)|Vas rápido/);
  }
  const source = await read("components/landing/LandingDashboardPreview.tsx");
  assert.match(source, /getDemoScenarioToday\([\s\S]*DEFAULT_DEMO_SCENARIO/);
  assert.doesNotMatch(source, /todayInSantiago/);
});

test("landing CTAs and accents resolve to ink/brand tokens, not cobalt", async () => {
  const brand = strip(await read("components/landing/landing-brand.css"));
  const preview = await read("components/landing/LandingDashboardPreview.tsx");
  const hero = await read("components/landing/LandingHero.tsx");
  assert.match(preview + hero, /import "\.\/landing-brand\.css"/);
  const root = /\.landing-page\s*\{([^}]*)\}/.exec(brand)?.[1] ?? "";
  assert.match(root, /--marketing-primary:\s*(?:#131b2e|var\(--color-ink\))\s*;/i);
  assert.match(root, /--marketing-primary-rgb:\s*19 27 46\s*;/);
  assert.match(root, /--marketing-primary-hover:\s*#26324d\s*;/i);
  assert.match(root, /--marketing-featured-kpi-background:\s*(?:#131b2e|var\(--color-ink\))\s*;/i);
  for (const role of ["--color-blue-deep", "--color-blue-standard", "--color-blue-soft", "--color-focus"]) {
    assert.match(root, new RegExp(`${role}:`), `${role} is remapped inside the landing`);
  }
  // The explicit CTA rule wins over the legacy marketing rule.
  assert.match(brand, /\.landing-page \.landing-primary-button\s*\{[^}]*background:\s*(?:#131b2e|var\(--color-ink\))/i);
  assert.match(brand, /\.landing-page \.landing-primary-button:hover\s*\{[^}]*background:\s*#26324d/i);
  assert.match(brand, /\.landing-page :focus-visible[^{]*\{[^}]*outline:[^;}]*(?:#131b2e|var\(--color-ink\)|var\(--marketing-primary\))/i);

  for (const file of LANDING_CSS) {
    const css = strip(await read(file));
    for (const hex of COBALT) assert.doesNotMatch(css, new RegExp(`#${hex}\\b`, "i"), `${file} still uses #${hex}`);
  }

  // Every legacy landing rule in styles.css that hard-codes a cobalt hue is overridden here, same selector.
  const legacy = strip(await read("styles.css"));
  const overridden = [];
  for (const rule of legacy.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().replace(/\s+/g, " ");
    if (!/landing/.test(selector)) continue;
    if (COBALT.some((hex) => new RegExp(`#${hex}\\b`, "i").test(rule[2]))) overridden.push(selector);
  }
  assert.ok(overridden.length >= 5, "the scan finds the legacy cobalt rules");
  // Product rules reused by the tour screens that hard-code a blue are overridden under .landing-page too.
  for (const selector of [".react-movements-view .react-movement-category", ".react-movements-view .react-movement-kind-badge",
    ".react-movements-kind-tab[aria-pressed=\"true\"]", ".react-movements-view .react-movements-bulk-assign",
    ".react-spending-chart-value-positive"]) overridden.push(selector);
  for (const selector of overridden) {
    const flat = brand.replace(/\s+/g, " ");
    assert.ok(flat.includes(`.landing-page ${selector} {`) || flat.includes(`.landing-page ${selector},`), `landing-brand.css overrides ${selector}`);
  }
});

test("the landing keeps its sections, anchors, sign-in link and tour (S1)", async (t) => {
  const [demo, , tour] = await modules(t);
  const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
  const markup = renderToStaticMarkup(React.createElement(tour.LandingTourSection, { data, previewError: null }));
  assert.match(markup, /landing-tour/);
  assert.equal((markup.match(/class="landing-tour-canvas" inert="" aria-hidden="true"/g) ?? []).length, 5);
});
