import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
test.after(() => vite.close());
const source = await readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8");

test("signed-out screen is onboarding step 1 with the trust points, demo link and the real connect control", () => {
	const html = renderToStaticMarkup(createElement(page.DashboardPage, {
		session: { authenticated: false, profile: null, gmail: { connected: false, connectUrl: "/auth/google" } },
	}));
	assert.match(html, /class="onboarding-connect"/);
	assert.ok(html.includes("Paso 1 de 3 · Conectar"));
	for (const title of ["Qué leemos", "Qué nunca hacemos", "Cómo salir"]) assert.ok(html.includes(title), title);
	assert.match(html, /href="\/app\/demo"[^>]*>Ver la demo<\/a>|<a[^>]*href="\/app\/demo"/);
	// S26: the real connect control is disabled until the acknowledgement above it is checked.
	assert.match(html, /<button class="button" type="button" disabled="" aria-describedby="gmail-inline-consent-hint">Conectar Gmail<\/button>/);
	assert.equal((html.match(/<main/g) ?? []).length, 1);
});

test("first cycle setup offers the options with the unchanged calendar and date inputs revealed by Otro rango", () => {
	const form = source.slice(source.indexOf("function FinancialCycleSetupForm"), source.indexOf("export interface MovementFilterBarProps"));
	const presets = form.indexOf("<CyclePresets");
	assert.ok(presets > 0);
	assert.ok(presets < form.indexOf("<CycleCalendar"));
	// Every option fills the same start/end state the inputs and the payload read.
	assert.match(form, /onOptionChange=\{handleOptionChange\}/);
	assert.match(form, /const applyRange = [\s\S]*?setStartDate\(range.startDate\);\s*setEndDate\(range.endDate\);/);
	assert.match(form, /id="financial-cycle-start-date"/);
	assert.match(form, /id="financial-cycle-end-date"/);
});

test("onboarding step 3 starts only after the first cycle save and closes through the seen flag", () => {
	// The inline "Así se lee tu medidor" card is gone: step 3 is the dialog of the first-result-step tests.
	assert.match(source, /<FinancialCycleSetupForm onSaved=\{handleFirstCycleSaved\} \/>/);
	assert.match(source, /setFirstResultPhase\(startFirstResult\(hasSeenFirstResult\(browserStorage\(\)\)\)\);\s*retry\(\);/);
	assert.match(source, /dismissFirstResult\(phase, browserStorage\(\)\)/);
	assert.doesNotMatch(source, /<FirstResultExplainer/);
	// The demo body never receives the step.
	const demo = source.slice(source.indexOf("function DemoDashboardPage"), source.indexOf("function DemoDashboardPage") + 20000);
	assert.doesNotMatch(demo.slice(0, demo.indexOf("\nfunction ", 10)), /FirstResultDialog/);
});
