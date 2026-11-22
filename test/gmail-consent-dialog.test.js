import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Identity B S22 (odd/tasks/identidad-b.md, T24, L32): the Gmail consent dialog uses the product dialog
// style (kicker + title, clean points list, normal checkbox with a wrapping label, sticky footer with an
// ink primary whose disabled state says why). The copy itself is S9 and must not change.
const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const consent = await vite.ssrLoadModule("/src/client/components/gmail/gmailConsent.ts");
const dialogModule = await vite.ssrLoadModule("/src/client/components/gmail/GmailConsentDialog.tsx");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const copy = consent.getGmailConsentCopy();
const openState = consent.reduceGmailConsent(consent.createGmailConsentState(), { type: "open", accountConnected: false });
const checkedState = consent.reduceGmailConsent(openState, { type: "acknowledge", acknowledged: true });
const render = (state) =>
	renderToStaticMarkup(
		createElement(dialogModule.GmailConsentDialog, {
			isOpen: true, state, connectUrl: "/auth/google", onAcknowledge() {}, onClose() {},
		}),
	);
const tagOf = (html, pattern) => html.match(pattern)?.[0] ?? "";

/** Flattens `selector { body }` rules (including those nested in @media/@supports). */
function flatRules(css) {
	const rules = [];
	const stack = [];
	let selStart = 0;
	for (let i = 0; i < css.length; i += 1) {
		const char = css[i];
		if (char === "/" && css[i + 1] === "*") {
			i = css.indexOf("*/", i + 2) + 1;
			selStart = i + 1;
		} else if (char === "{") {
			stack.push({ selector: css.slice(selStart, i).trim(), open: i });
			selStart = i + 1;
		} else if (char === "}") {
			const top = stack.pop();
			if (!top.selector.startsWith("@")) {
				rules.push({ selector: top.selector.replace(/\s+/g, " "), body: css.slice(top.open + 1, i), media: stack.map((s) => s.selector).join(" ") });
			}
			selStart = i + 1;
		}
	}
	return rules;
}
const bodyOf = (css, pattern, media = "") =>
	flatRules(css).filter((r) => pattern.test(r.selector) && r.media === media).map((r) => r.body).join("\n");

test("the dialog opens with a kicker, the existing title and the close control in one header row", () => {
	const html = render(openState);
	assert.match(html, /<header[^>]*class="consent-head"[^>]*>[\s\S]*<\/header>/);
	const header = html.match(/<header[\s\S]*?<\/header>/)[0];
	assert.match(header, /<p class="consent-kicker">Antes de conectar<\/p>/);
	assert.match(header, new RegExp(`<h2 id="react-gmail-consent-title" class="consent-title">${copy.title}</h2>`));
	assert.match(header, new RegExp(`<button[^>]*aria-label="${copy.closeLabel}"[^>]*class="[^"]*consent-close|<button[^>]*class="[^"]*consent-close[^"]*"[^>]*aria-label="${copy.closeLabel}"`));
	assert.match(html, /aria-labelledby="react-gmail-consent-title"/);
	assert.match(html, /aria-describedby="react-gmail-consent-description"/);
	assert.match(html, /class="consent-grab"/);
});

test("the three points are a flat list: title on its own line above the body, no cards", () => {
	const html = render(openState);
	const list = html.match(/<ul class="consent-list">[\s\S]*?<\/ul>/)?.[0] ?? "";
	assert.notEqual(list, "");
	assert.equal(list.match(/<li>/g)?.length, 3);
	for (const point of copy.points) {
		assert.ok(list.includes(`<li><h3>${point.title}</h3><p>${point.body}</p></li>`), point.title);
	}
	assert.doesNotMatch(html, /consent-points/);
	// The storage note follows the points inside the described region.
	const description = html.match(/<div id="react-gmail-consent-description"[\s\S]*?<\/div>/)?.[0] ?? "";
	assert.ok(description.includes(copy.storageNote));
	assert.ok(description.indexOf("consent-list") < description.indexOf(copy.storageNote));
});

test("the checkbox is associated with its full acknowledgement label", () => {
	const html = render(openState);
	const label = html.match(/<label[^>]*for="gmail-consent-acknowledgement"[^>]*>[\s\S]*?<\/label>/)?.[0] ?? "";
	assert.notEqual(label, "");
	assert.match(label, /class="consent-ack"/);
	assert.match(label, /<input id="gmail-consent-acknowledgement" type="checkbox"/);
	assert.ok(label.includes(`<span>${copy.acknowledgementLabel}</span>`));
	// It lives in the sticky footer, so the control that gates the primary never scrolls out of view.
	const foot = html.slice(html.indexOf('<div class="consent-foot">'));
	assert.ok(foot.includes(label));
	assert.ok(html.indexOf('class="consent-body"') < html.indexOf('class="consent-list"') && html.indexOf('class="consent-list"') < html.indexOf('<div class="consent-foot">'));
	assert.doesNotMatch(tagOf(label, /<input[^>]*>/), /checked/);
	assert.match(tagOf(render(checkedState), /<input[^>]*>/), /checked/);
});

test("the footer hint is wired to the disabled primary and is gone once the box is checked", () => {
	const unchecked = render(openState);
	const accept = tagOf(unchecked, /<button[^>]*react-gmail-consent-accept[^>]*>/);
	assert.match(accept, /disabled/);
	assert.match(accept, /aria-describedby="gmail-consent-hint"/);
	assert.match(accept, /class="[^"]*consent-btn-primary[^"]*"/);
	assert.match(unchecked, /<p id="gmail-consent-hint" class="consent-hint"[^>]*>Marca la casilla para continuar<\/p>/);
	assert.ok(unchecked.includes(`>${copy.acceptLabel}</button>`));

	const checked = render(checkedState);
	const enabled = tagOf(checked, /<button[^>]*react-gmail-consent-accept[^>]*>/);
	assert.doesNotMatch(enabled, /disabled/);
	assert.doesNotMatch(enabled, /aria-describedby/);
	// The hint keeps its row (no layout jump) but is no longer announced or shown.
	assert.match(checked, /<p id="gmail-consent-hint" class="consent-hint" hidden="">/);
});

test("Cancelar is the secondary action and sits before the primary in a sticky footer", () => {
	const html = render(openState);
	const foot = html.match(/<div class="consent-foot">[\s\S]*<\/div>/)?.[0] ?? "";
	assert.notEqual(foot, "");
	const cancel = tagOf(foot, /<button[^>]*>Cancelar<\/button>/);
	assert.match(cancel, /class="[^"]*secondary[^"]*consent-btn-ghost[^"]*"|class="[^"]*consent-btn-ghost[^"]*secondary[^"]*"/);
	assert.ok(foot.indexOf("Cancelar") < foot.indexOf(copy.acceptLabel));
});

test("every consent string from gmailConsent.ts still renders unchanged", () => {
	const html = render(openState);
	for (const text of [copy.title, copy.storageNote, copy.acknowledgementLabel, copy.acceptLabel, copy.cancelLabel]) {
		assert.ok(html.includes(text), text);
	}
	for (const point of copy.points) assert.ok(html.includes(point.title) && html.includes(point.body));
	assert.equal(copy.acceptLabel, "Aceptar y conectar Gmail");
	assert.equal(copy.acknowledgementLabel, "Entiendo qué lee la app y qué se guarda.");
	assert.deepEqual(copy.points.map((p) => p.title), ["Qué leemos", "Qué nunca hacemos", "Cómo salir"]);
	assert.doesNotMatch(html, /localmente|presupuesto mensual/);
});

const COBALT =
	/#003594|#0b2f8a|#174ea6|#1f4fa0|#2457c6|#e3ecff|#e8efff|#edf3ff|#004ac6|#2878e5|#e7f1ff|#0d3f91|#1d4ed8|#2563eb|#3b82f6|#eff6ff|#dbeafe|#bfdbfe|rgba?\(\s*0,\s*53,\s*148|rgba?\(\s*0,\s*74,\s*198|var\(--(?:marketing-primary|primary|accent|focus|color-blue|color-focus)/i;
const CSS = "src/client/components/gmail/gmail-consent.css";

test("the consent stylesheet is loaded by the dialog and paints no cobalt", async () => {
	const css = await read(CSS);
	assert.match(await read("src/client/components/gmail/GmailConsentDialog.tsx"), /import "\.\/gmail-consent\.css"/);
	assert.doesNotMatch(css, COBALT);
	assert.doesNotMatch(await read("src/client/components/gmail/GmailConsentDialog.tsx"), /consent-points/);
});

test("the dialog is a single column of at most 560px with a scrolling body and a sticky footer", async () => {
	const css = await read(CSS);
	const shell = bodyOf(css, /^dialog\.consent-dialog\[class\]$/);
	assert.match(shell, /width:\s*min\(35rem,\s*calc\(100vw - 32px\)\)/);
	assert.match(shell, /overflow:\s*hidden/);
	assert.doesNotMatch(css, /overflow-x/);
	assert.match(bodyOf(css, /^dialog\.consent-dialog \.consent-body$/), /overflow-y:\s*auto/);
	assert.match(bodyOf(css, /^dialog\.consent-dialog \.consent-foot$/), /flex:\s*none/);
	assert.match(bodyOf(css, /^dialog\.consent-dialog \.consent-foot$/), /border-top:/);
});

test("the checkbox is 20px with ink accent and its label wraps instead of overflowing", async () => {
	const css = await read(CSS);
	const box = bodyOf(css, /^dialog\.consent-dialog \.consent-ack input\[type="checkbox"\]$/);
	assert.match(box, /width:\s*20px/);
	assert.match(box, /height:\s*20px/);
	assert.match(box, /min-height:\s*0/);
	assert.match(box, /accent-color:\s*var\(--color-ink/);
	const label = bodyOf(css, /^dialog\.consent-dialog \.consent-ack$/);
	assert.match(label, /display:\s*flex/);
	assert.match(label, /min-width:\s*0/);
	assert.match(label, /min-height:\s*(4[4-9]|[5-9]\d)px/);
	const text = bodyOf(css, /^dialog\.consent-dialog \.consent-ack span$/);
	assert.match(text, /min-width:\s*0/);
	assert.match(text, /overflow-wrap:\s*anywhere/);
	for (const rule of flatRules(css)) assert.doesNotMatch(rule.body, /white-space:\s*nowrap/, rule.selector);
});

test("the points list has dividers instead of nested cards", async () => {
	const css = await read(CSS);
	const items = flatRules(css).filter((r) => /consent-list/.test(r.selector)).map((r) => r.body).join("\n");
	assert.match(items, /border-top:\s*1px solid/);
	assert.doesNotMatch(items, /background/);
	assert.doesNotMatch(items, /border-radius/);
});

test("the primary is ink, its disabled state is neutral and not-allowed, and hover stays readable", async () => {
	const css = await read(CSS);
	const primary = bodyOf(css, /^dialog\.consent-dialog \.consent-actions \.consent-btn-primary$/);
	assert.match(primary, /background:\s*var\(--color-ink/);
	assert.match(primary, /color:\s*#ffffff/);
	const disabled = bodyOf(css, /^dialog\.consent-dialog \.consent-actions \.consent-btn-primary:disabled$/);
	assert.match(disabled, /cursor:\s*not-allowed/);
	assert.match(disabled, /opacity:\s*1/);
	assert.match(disabled, /background:\s*var\(--color-surface-pressed/);
	assert.match(disabled, /color:\s*var\(--color-ink-muted/);
	const hover = bodyOf(css, /^dialog\.consent-dialog \.consent-actions \.consent-btn-primary:hover:not\(:disabled\)$/);
	assert.match(hover, /background:\s*#26324d/);
	assert.match(hover, /color:\s*#ffffff/);
	const ghost = bodyOf(css, /^dialog\.consent-dialog \.consent-actions \.consent-btn-ghost:hover:not\(:disabled\)$/);
	assert.match(ghost, /color:\s*var\(--color-ink/);
	assert.match(ghost, /background:\s*var\(--color-surface-subtle/);
});

test("at 760px and below it is a bottom sheet with a sticky footer and targets of at least 44px", async () => {
	const css = await read(CSS);
	const media = "@media (max-width: 760px)";
	const sheet = bodyOf(css, /^dialog\.consent-dialog\[class\]$/, media);
	assert.match(sheet, /width:\s*100%/);
	assert.match(sheet, /margin:\s*auto 0 0/);
	assert.match(sheet, /border-radius:[^;]*0 0/);
	assert.match(bodyOf(css, /^dialog\.consent-dialog \.consent-grab$/, media), /display:\s*block/);
	assert.match(bodyOf(css, /^dialog\.consent-dialog \.consent-foot$/, media), /env\(safe-area-inset-bottom\)/);
	const sizes = [
		...bodyOf(css, /consent-btn$/).matchAll(/min-height:\s*(\d+)px/g),
		...bodyOf(css, /consent-close$/).matchAll(/min-height:\s*(\d+)px/g),
		...bodyOf(css, /consent-ack$/).matchAll(/min-height:\s*(\d+)px/g),
	].map((m) => Number(m[1]));
	assert.equal(sizes.length, 3);
	for (const size of sizes) assert.ok(size >= 44, String(size));
});

test("the legacy consent dialog rules are gone from styles.css (the refusal notice keeps its own)", async () => {
	const styles = await read("src/client/styles.css");
	for (const selector of [
		".react-gmail-consent-dialog", ".react-gmail-consent-close", ".react-gmail-consent-terms",
		".react-gmail-consent-acknowledgement", ".react-gmail-consent-accept",
	]) {
		assert.ok(!flatRules(styles).some((r) => r.selector.split(",").some((part) => part.trim().startsWith(selector))), selector);
	}
	assert.ok(flatRules(styles).some((r) => r.selector === ".react-gmail-consent-refused"));
});
