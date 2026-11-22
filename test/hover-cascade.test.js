import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Hover cascade (odd/tasks/identidad-b.md L18-L19, S1, S2, S11, S18): the legacy global `button:hover`
// painted an ink fill that beat every single-class ghost/secondary rule, leaving dark text on dark. The
// global hover is now zero-extra-specificity; every class-styled button owns its hover, and the
// authenticated screens carry no cobalt.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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
				rules.push({ selector: top.selector.replace(/\s+/g, " "), body: css.slice(top.open + 1, i) });
			}
			selStart = i + 1;
		} else if (char === ";" && stack.length === 0) {
			selStart = i + 1;
		}
	}
	return rules;
}

const ruleFor = (css, selectorPattern) =>
	flatRules(css).filter((rule) => selectorPattern.test(rule.selector)).map((rule) => rule.body).join("\n");

test("the legacy global button hover is a zero-weight :where rule so class-styled buttons keep their own background", async () => {
	const css = await read("src/client/app.css");
	const rules = flatRules(css);
	const bare = rules.filter((rule) => /(^|,)\s*(button|\.button):hover\s*(,|$)/.test(rule.selector));
	assert.deepEqual(bare.map((rule) => rule.selector), [], "bare button:hover / .button:hover must not exist");
	const where = rules.filter((rule) => rule.selector === ":where(button, .button):hover");
	assert.equal(where.length, 2, "both global hover rules use :where(button, .button):hover");
	assert.match(where[0].body, /background:\s*var\(--accent-hover\)/);
	for (const rule of where) assert.doesNotMatch(rule.body, /0,\s*53,\s*148/, "the hover shadow is not cobalt");
});

test("primary ink buttons keep an explicit darker-ink hover now that the global hover no longer outranks them", async () => {
	const css = await read("src/client/identity-b.css");
	const hover = flatRules(css).filter((rule) => /:hover/.test(rule.selector));
	const primary = hover.filter((rule) => /background:\s*(var\(--accent-hover[,)]|#26324d)/i.test(rule.body));
	const selectors = primary.map((rule) => rule.selector).join(" , ");
	// The other ink buttons (movements prompt/bulk actions, gauge action, onboarding CTA) already carry
	// their own hover next to their base rule; these two had none.
	for (const name of [".react-mobile-tabbar-add", ".first-result-explainer-dismiss"]) {
		assert.ok(selectors.includes(name), `${name} has an explicit ink hover`);
	}
	for (const rule of primary) assert.match(rule.body, /color:\s*#ffffff/, `${rule.selector} keeps white text`);
});

test("cycle presets: hover is a subtle surface with ink text, selected has an ink border and a soft fill, focus is visible", async () => {
	const css = await read("src/client/components/onboarding/onboarding.css");
	const hover = ruleFor(css, /^\.cycle-preset:hover(:not\([^)]*\))?$/);
	assert.match(hover, /background:\s*var\(--color-surface-subtle,\s*#f1f0ec\)/);
	assert.match(hover, /color:\s*var\(--color-ink,\s*#131b2e\)/);
	assert.match(hover, /box-shadow:\s*none/);
	const selected = ruleFor(css, /^\.cycle-preset\[aria-checked="true"\]$/);
	assert.match(selected, /border-color:\s*var\(--color-ink,\s*#131b2e\)/);
	assert.match(selected, /background:\s*var\(--color-surface-subtle,\s*#f1f0ec\)/);
	assert.match(selected, /color:\s*var\(--color-ink,\s*#131b2e\)/);
	assert.match(ruleFor(css, /\.cycle-preset:focus-visible/), /outline:\s*3px solid/);
	assert.match(ruleFor(css, /^\.cycle-preset small$/), /color:\s*var\(--color-ink-secondary/);
});

test("cycle calendar: selected range is ink with white text, the middle is a soft neutral, today is marked, nav hover stays light", async () => {
	const css = await read("src/client/styles.css");
	const selected = ruleFor(css, /^\.react-cycle-calendar-day-selected, \.react-cycle-calendar-day-selected:hover:not\(:disabled\)$/);
	assert.match(selected, /border-color:\s*var\(--color-ink\)/);
	assert.match(selected, /background:\s*var\(--color-ink\)/);
	assert.match(selected, /color:\s*#ffffff/);
	assert.doesNotMatch(selected, /marketing-primary/);
	const middle = ruleFor(
		css,
		/^\.react-cycle-calendar-day-selected \+ \.react-cycle-calendar-day-selected:has\(\+ \.react-cycle-calendar-day-selected\)/,
	);
	assert.match(middle, /background:\s*var\(--color-surface-pressed\)/);
	assert.match(middle, /color:\s*var\(--color-ink\)/);
	assert.match(ruleFor(css, /^\.react-cycle-calendar-day\[aria-current="date"\]$/), /(box-shadow|border-color|text-decoration)/);
	assert.match(ruleFor(css, /^\.react-cycle-calendar-day:hover:not\(:disabled\)$/), /background:\s*var\(--color-surface-subtle\)/);
	assert.match(ruleFor(css, /^\.react-cycle-calendar-nav-button:hover:not\(:disabled\)$/), /background:\s*var\(--color-surface-subtle\)/);
	const edit = ruleFor(css, /^\.react-financial-cycle-edit-dialog \.react-cycle-calendar-day-selected:hover:not\(:disabled\)$/);
	assert.match(edit, /background:\s*var\(--color-ink\)/);
	assert.doesNotMatch(edit, /marketing-primary/);
});

// Cobalt family: the deep/standard/bright blues, their tints and the shadows built from them.
const COBALT_LITERAL =
	/#003594|#0b2f8a|#174ea6|#1f4fa0|#2457c6|#e3ecff|#e8efff|#edf3ff|#004ac6|#2878e5|#e7f1ff|#0d3f91|#1d4ed8|#2563eb|#3b82f6|#eff6ff|#dbeafe|#bfdbfe|rgba?\(\s*0,\s*53,\s*148|rgba?\(\s*0,\s*74,\s*198|rgba?\(\s*23,\s*78,\s*166|rgba?\(\s*8,\s*36,\s*88|rgba?\(\s*6,\s*41,\s*106|var\(--marketing-primary/i;

test("no authenticated-app rule paints a literal cobalt (the landing keeps its own palette)", async () => {
	const files = [
		"app.css",
		"styles.css",
		"dialog-polish.css",
		"dashboard-polish.css",
		"dashboard-mobile-ergonomics.css",
		"dashboard-mobile-content.css",
		"dashboard-motion.css",
		"dashboard-loading.css",
		"motion.css",
		"demo-scenarios.css",
		"identity-b.css",
		"summary-polish.css",
		"movements-polish.css",
		"components/onboarding/onboarding.css",
		"components/onboarding/consent-points.css",
		"components/analytics/dashboard-pace.css",
	];
	const offenders = [];
	for (const file of files) {
		const css = await read(`src/client/${file}`);
		for (const rule of flatRules(css)) {
			if (/landing/.test(rule.selector)) continue;
			const hit = rule.body.match(COBALT_LITERAL);
			if (hit) offenders.push(`${file}: ${rule.selector.slice(0, 80)} -> ${hit[0]}`);
		}
		// Keyframes carry the saved-row highlight; they are not selectors, so check them as text.
		for (const frames of css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g) ?? []) {
			const hit = frames.match(COBALT_LITERAL);
			if (hit) offenders.push(`${file}: ${frames.slice(0, 40)} -> ${hit[0]}`);
		}
	}
	assert.deepEqual(offenders, []);
});
