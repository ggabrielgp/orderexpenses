import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
// The legacy global `button:hover` paints an ink background; ghost buttons must cancel it on hover
// with a more specific rule, or their dark text lands on a dark fill.
const hoverRule = (css, selector) => {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return css.match(new RegExp(`${escaped}:hover[^{]*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("movement sort headers keep a transparent background on hover", async () => {
	const rule = hoverRule(await read("src/client/styles.css"), ".react-movement-sort-button");
	assert.match(rule, /background:\s*(none|transparent)/);
	assert.match(rule, /box-shadow:\s*none/);
});

test("view navigation keeps readable hover states on desktop and in the bottom bar", async () => {
	const identity = await read("src/client/identity-b.css");
	const desktop = hoverRule(identity, ".react-app-navigation .react-app-navigation-link");
	assert.match(desktop, /background:\s*transparent/);
	assert.match(desktop, /color:\s*var\(--color-ink\)/);
	const idle = hoverRule(identity, ".react-mobile-tabbar .react-mobile-tabbar-link");
	assert.match(idle, /background:\s*var\(--color-surface-subtle\)/);
	assert.match(idle, /color:\s*var\(--color-ink\)/);
	const active = hoverRule(identity, ".react-mobile-tabbar .react-mobile-tabbar-link-active");
	assert.match(active, /background:\s*var\(--color-ink\)/);
	assert.match(active, /color:\s*#ffffff/);
});
