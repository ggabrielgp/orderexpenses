import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Identity B S26 (odd/tasks/identidad-b.md, T28, L40): on the signed-out step 1 the acknowledgement sits
// right above "Conectar Gmail", which stays disabled (with a hint) until it is checked, and checking +
// clicking goes straight to the OAuth redirect. The consent dialog (S22) stays for the in-app entry.
const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
const consent = await vite.ssrLoadModule("/src/client/components/gmail/gmailConsent.ts");
const inline = await vite.ssrLoadModule("/src/client/components/gmail/GmailInlineConsent.tsx");
const login = await vite.ssrLoadModule("/src/client/api/googleLogin.ts");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const copy = consent.getGmailConsentCopy();
const tagOf = (html, pattern) => html.match(pattern)?.[0] ?? "";
const signedOut = renderToStaticMarkup(createElement(page.DashboardPage, {
	session: { authenticated: false, profile: null, gmail: { connected: false, connectUrl: "/auth/google" } },
}));

/** Depth-first search through a React element tree (the inline control has no hooks, so it can be called). */
function findElement(node, predicate) {
	if (node === null || typeof node !== "object") return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findElement(child, predicate);
			if (found) return found;
		}
		return null;
	}
	if (predicate(node)) return node;
	return findElement(node.props?.children, predicate);
}

const open = consent.reduceGmailConsent(consent.createGmailConsentState(), { type: "open", accountConnected: false });
const checked = consent.reduceGmailConsent(open, { type: "acknowledge", acknowledged: true });
const renderInline = (state) => renderToStaticMarkup(createElement(inline.GmailInlineConsent, {
	state, connectUrl: "/auth/google", className: "button", onAcknowledge() {},
}));

test("step 1 shows the acknowledgement right above a disabled Conectar Gmail with its hint and no dialog", () => {
	const label = signedOut.match(/<label[^>]*for="gmail-inline-consent-acknowledgement"[^>]*>[\s\S]*?<\/label>/)?.[0] ?? "";
	assert.notEqual(label, "");
	assert.ok(label.includes(`<span>${copy.acknowledgementLabel}</span>`));
	assert.equal(copy.acknowledgementLabel, "Entiendo qué lee la app y qué se guarda.");
	assert.match(tagOf(label, /<input[^>]*>/), /type="checkbox"/);
	assert.doesNotMatch(tagOf(label, /<input[^>]*>/), /checked/);
	const button = tagOf(signedOut, /<button[^>]*>Conectar Gmail<\/button>/);
	assert.match(button, /class="button"/);
	assert.match(button, /disabled/);
	assert.match(button, /aria-describedby="gmail-inline-consent-hint"/);
	assert.match(signedOut, /<p id="gmail-inline-consent-hint"[^>]*>Marca la casilla para continuar<\/p>/);
	// The checkbox is the element right before the control, inside the connect slot.
	assert.ok(signedOut.indexOf(label) < signedOut.indexOf(button));
	assert.ok(signedOut.indexOf(label) > signedOut.indexOf('class="onboarding-connect-connect"'));
	// No dialog on step 1, and the consent points are on screen once (not repeated).
	assert.doesNotMatch(signedOut, /<dialog/);
	assert.doesNotMatch(signedOut, /Aceptar y conectar Gmail/);
	for (const point of copy.points) assert.equal(signedOut.split(point.body).length - 1, 1, point.title);
});

test("checked: the control is enabled, the hint is hidden and clicking goes straight to the OAuth redirect", () => {
	const html = renderInline(checked);
	assert.doesNotMatch(tagOf(html, /<button[^>]*>Conectar Gmail<\/button>/), /disabled|aria-describedby/);
	assert.match(tagOf(html, /<input[^>]*>/), /checked/);
	assert.match(html, /<p id="gmail-inline-consent-hint" class="gmail-inline-consent-hint" hidden="">/);

	const visits = [];
	const element = inline.GmailInlineConsent({
		state: checked, connectUrl: "/auth/google", className: "button", onAcknowledge() {},
		navigate: (url) => visits.push(url),
	});
	const button = findElement(element, (el) => el.type === "button");
	assert.equal(button.props.disabled, false);
	button.props.onClick();
	// Same target as accepting the dialog: the server URL through the return-origin helper.
	assert.deepEqual(visits, [login.getGoogleLoginUrl("/auth/google")]);
});

test("unchecked: clicking (even if forced) never navigates, and the checkbox reports the acknowledgement", () => {
	const visits = [];
	const answers = [];
	const element = inline.GmailInlineConsent({
		state: open, connectUrl: "/auth/google", className: "button", onAcknowledge: (v) => answers.push(v),
		navigate: (url) => visits.push(url),
	});
	const button = findElement(element, (el) => el.type === "button");
	assert.equal(button.props.disabled, true);
	button.props.onClick();
	assert.deepEqual(visits, []);
	findElement(element, (el) => el.type === "input").props.onChange({ target: { checked: true } });
	assert.deepEqual(answers, [true]);
});

test("the in-app entry keeps the consent dialog flow and its plain control", async () => {
	const plain = renderToStaticMarkup(createElement(page.GmailConnectControl, {
		connectUrl: "/auth/google", accountConnected: false, className: "button",
	}));
	assert.ok(plain.includes('<button class="button" type="button">Conectar Gmail</button>'));
	assert.doesNotMatch(plain, /gmail-inline-consent/);
	const source = await read("src/client/pages/DashboardPage.tsx");
	const control = source.slice(source.indexOf("export function GmailConnectControl"), source.indexOf("const DEMO_PROFILE"));
	assert.match(control, /<GmailConsentDialog/);
	assert.match(control, /onClick=\{openConsent\}/);
	// Only the signed-out step 1 asks for the inline variant; the account settings entry does not.
	const step1 = source.slice(source.indexOf("if (!session.authenticated)"), source.indexOf("const profile = session.profile"));
	assert.match(step1, /inlineConsent/);
	const settings = source.slice(source.indexOf("connectControl={(accountConnected)"), source.indexOf("submitSync={submitGmailSync}"));
	assert.doesNotMatch(settings, /inlineConsent/);
});

test("an already connected account keeps the refusal flow instead of the inline control", () => {
	const html = renderToStaticMarkup(createElement(page.GmailConnectControl, {
		connectUrl: "/auth/google", accountConnected: true, className: "button", inlineConsent: true,
	}));
	assert.ok(html.includes('<button class="button" type="button">Conectar Gmail</button>'));
	assert.doesNotMatch(html, /gmail-inline-consent/);
	const state = consent.reduceGmailConsent(consent.createGmailConsentState(), { type: "open", accountConnected: true });
	assert.equal(state.message, consent.GMAIL_CONSENT_ALREADY_CONNECTED_MESSAGE);
});

test("the inline stylesheet has no cobalt, a 20px ink checkbox and a wrapping label", async () => {
	const css = await read("src/client/components/gmail/gmail-inline-consent.css");
	assert.doesNotMatch(css, /#003594|#0b2f8a|#174ea6|#2457c6|#004ac6|#1d4ed8|#2563eb|var\(--(?:marketing-primary|primary|accent|focus)/i);
	assert.match(css, /accent-color:\s*var\(--color-ink/);
	assert.match(css, /width:\s*20px/);
	assert.match(css, /overflow-wrap:\s*anywhere/);
	assert.match(css, /\.gmail-inline-consent-hint\[hidden\]\s*\{[^}]*visibility:\s*hidden/);
	assert.doesNotMatch(css, /white-space:\s*nowrap/);
	assert.match(await read("src/client/components/gmail/GmailInlineConsent.tsx"), /import "\.\/gmail-inline-consent\.css"/);
});
