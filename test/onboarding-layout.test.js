import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const onboarding = await vite.ssrLoadModule("/src/client/components/onboarding/OnboardingConnect.tsx");
const consent = await vite.ssrLoadModule("/src/client/components/gmail/gmailConsent.ts");
const css = await readFile(new URL("../src/client/components/onboarding/onboarding.css", import.meta.url), "utf8");

const CONTROL = '<button class="button" type="button">Conectar Gmail</button>';
const html = renderToStaticMarkup(
	createElement(onboarding.OnboardingConnect, null, createElement("button", { className: "button", type: "button" }, "Conectar Gmail")),
);

function rule(selector) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
	assert.ok(match, `missing CSS rule ${selector}`);
	return match[1];
}
function fontSize(selector) {
	const match = rule(selector).match(/font-size:\s*([\d.]+)(px|rem)/);
	assert.ok(match, `${selector} needs a px/rem font-size`);
	return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
}

test("named steps list the three steps with step 1 as the only current step", () => {
	const list = html.match(/<ol[^>]*aria-label="Pasos para empezar"[^>]*>([\s\S]*?)<\/ol>/);
	assert.ok(list, "steps ordered list is named");
	const items = [...list[1].matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)];
	assert.equal(items.length, 3);
	const text = items.map((item) => item[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
	assert.match(text[0], /^1\s*Conectar/);
	assert.match(text[1], /^2\s*Tu período/);
	assert.match(text[2], /^3\s*Tu medidor/);
	assert.match(items[0][1], /aria-current="step"/);
	assert.doesNotMatch(items[1][1] + items[2][1], /aria-current/);
	assert.ok(html.includes("Paso 1 de 3 · Conectar"));
});

test("the page has one h1 followed by the three trust h2 and nothing hidden is a heading", () => {
	assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
	const headings = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => [Number(m[1]), m[2]]);
	assert.deepEqual(headings, [
		[1, "Conectemos tu Gmail, con reglas claras"],
		[2, "Qué leemos"],
		[2, "Qué nunca hacemos"],
		[2, "Cómo salir"],
	]);
});

test("the example gauge is decorative: aria-hidden, with its own svg and no focusable content", () => {
	const example = html.match(/<aside[^>]*class="onboarding-connect-example"[^>]*>([\s\S]*?)<\/aside>/);
	assert.ok(example, "example gauge aside exists");
	assert.match(example[0], /^<aside[^>]*aria-hidden="true"/);
	assert.match(example[1], /<svg/);
	assert.ok(example[1].includes("Te quedan"));
	assert.ok(example[1].includes("En ritmo"));
	assert.doesNotMatch(example[1], /<(a|button|input|h[1-6])[\s>]/);
});

test("the logo, the demo link and the consent copy are rendered and the control is passed through unchanged", () => {
	assert.match(html, /<svg[^>]*class="brand-mark"/);
	assert.equal(html.split(CONTROL).length - 1, 1, "control rendered exactly once, unchanged");
	assert.match(html, /<a[^>]*href="\/app\/demo"[^>]*>Ver la demo<\/a>/);
	const copy = consent.getGmailConsentCopy();
	for (const point of copy.points) assert.ok(html.includes(point.body), point.title);
	assert.ok(html.includes(copy.storageNote));
	assert.ok(html.includes("Leemos los avisos de compra de Banco de Chile para armar tu período. Nada más."));
	assert.ok(html.indexOf(CONTROL) < html.indexOf("Ver la demo"));
	assert.doesNotMatch(html, /localmente|presupuesto mensual/);
});

test("the decorative Google G is aria-hidden and not part of the control text", () => {
	const g = html.match(/<span[^>]*class="onboarding-connect-g"[^>]*>[\s\S]*?<\/span>/);
	assert.ok(g, "Google G wrapper exists");
	assert.match(g[0], /aria-hidden="true"/);
	assert.match(g[0], /<svg/);
	assert.ok(!html.slice(html.indexOf(CONTROL), html.indexOf(CONTROL) + CONTROL.length).includes("<svg"));
});

test("typography: h1 is larger than every h2 and body copy is 16px", () => {
	const h1 = fontSize(".onboarding-connect h1");
	assert.ok(h1 >= 28);
	for (const selector of [".onboarding-connect .consent-points h2", ".onboarding-connect-example h2"]) {
		if (css.includes(`${selector} {`)) assert.ok(h1 > fontSize(selector), selector);
	}
	assert.equal(fontSize(".onboarding-connect .consent-points p"), 16);
	assert.equal(fontSize(".onboarding-connect .onboarding-connect-subtitle"), 16);
});

test("layout: two columns from 900px, single column below, control is ink", () => {
	assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
	assert.match(css, /@media \(max-width:\s*900px\)/);
	assert.match(rule(".onboarding-connect .onboarding-connect-cta .button"), /background:\s*var\(--color-ink/);
});
