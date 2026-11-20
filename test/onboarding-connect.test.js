import assert from "node:assert/strict";
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

const consent = await vite.ssrLoadModule("/src/client/components/gmail/gmailConsent.ts");
const onboarding = await vite.ssrLoadModule("/src/client/components/onboarding/OnboardingConnect.tsx");
const dialogModule = await vite.ssrLoadModule("/src/client/components/gmail/GmailConsentDialog.tsx");

const TITLES = ["Qué leemos", "Qué nunca hacemos", "Cómo salir"];
const allText = (copy) => JSON.stringify(copy);

test("consent copy is three titled points with honest wording", () => {
	const copy = consent.getGmailConsentCopy();
	assert.deepEqual(copy.points.map((point) => point.title), TITLES);
	for (const point of copy.points) assert.ok(point.body.length > 0);
	const text = allText(copy);
	for (const expected of ["solo lectura", "Banco de Chile", "servidor", "myaccount.google.com/permissions", "Configuración"]) {
		assert.ok(text.includes(expected), expected);
	}
	assert.doesNotMatch(text, /localmente/);
	assert.doesNotMatch(text, /presupuesto mensual/);
	assert.doesNotMatch(text, /descriptionParagraphs/);
	// No deletion feature exists, so the copy must not promise one.
	assert.doesNotMatch(text, /elimin|borra tus|borraremos/i);
	assert.equal(copy.storageNote.includes("servidor"), true);
	assert.ok(copy.acknowledgementLabel.length < 80);
	assert.equal(copy.acceptLabel, "Aceptar y conectar Gmail");
	assert.equal(copy.cancelLabel, "Cancelar");
	assert.equal(copy.closeLabel, "Cerrar");
});

test("getGmailConsentCopy returns a fresh copy on every call", () => {
	const first = consent.getGmailConsentCopy();
	first.points[0].title = "mutated";
	first.points.push({ title: "extra", body: "extra" });
	first.title = "mutated";
	const second = consent.getGmailConsentCopy();
	assert.deepEqual(second.points.map((point) => point.title), TITLES);
	assert.notEqual(second.title, "mutated");
	assert.notEqual(first.points, second.points);
});

test("OnboardingConnect renders step, headline, points, children and the demo link", () => {
	const html = renderToStaticMarkup(
		createElement(onboarding.OnboardingConnect, null, createElement("button", { className: "button", type: "button" }, "Conectar Gmail")),
	);
	assert.ok(html.includes("Paso 1 de 3 · Conectar"));
	assert.match(html, /<h1[^>]*>Conectemos tu Gmail, con reglas claras<\/h1>/);
	for (const title of TITLES) assert.ok(html.includes(title), title);
	const copy = consent.getGmailConsentCopy();
	for (const point of copy.points) assert.ok(html.includes(point.body), point.title);
	assert.ok(html.includes(copy.storageNote));
	assert.ok(html.includes('<button class="button" type="button">Conectar Gmail</button>'));
	assert.ok(html.includes('href="/app/demo"'));
	assert.ok(html.includes("Ver la demo"));
	assert.doesNotMatch(html, /localmente|presupuesto mensual/);
});

test("consent dialog still renders title, points as a list, gated checkbox and actions", () => {
	const copy = consent.getGmailConsentCopy();
	const state = consent.reduceGmailConsent(consent.createGmailConsentState(), { type: "open", accountConnected: false });
	const render = (current) =>
		renderToStaticMarkup(
			createElement(dialogModule.GmailConsentDialog, {
				isOpen: true,
				state: current,
				connectUrl: "/auth/google",
				onAcknowledge() {},
				onClose() {},
			}),
		);
	const html = render(state);
	assert.ok(html.includes('aria-labelledby="react-gmail-consent-title"'));
	assert.ok(html.includes('id="react-gmail-consent-title"'));
	assert.ok(html.includes('id="react-gmail-consent-description"'));
	assert.ok(html.includes('id="gmail-consent-acknowledgement"'));
	assert.match(html, /<ul[^>]*>[\s\S]*<li[\s\S]*<h3[^>]*>Qué leemos<\/h3>/);
	for (const point of copy.points) assert.ok(html.includes(point.title) && html.includes(point.body));
	assert.ok(html.includes(copy.storageNote));
	assert.ok(html.includes(copy.acknowledgementLabel));
	assert.match(html, /react-gmail-consent-accept"[^>]*disabled/);
	assert.doesNotMatch(
		render(consent.reduceGmailConsent(state, { type: "acknowledge", acknowledged: true })),
		/react-gmail-consent-accept"[^>]*disabled/,
	);
});
