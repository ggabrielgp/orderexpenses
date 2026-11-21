import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Identity B (odd/tasks/identidad-b.md, T12, S12; design/identidad-b-pulido/03-resumen-mobile.html):
// the bottom bar's active item is a filled pill, touch targets are at least 44px, the bar respects the
// bottom safe area, and the summary polish lives inside the narrow-screen media query only.
const css = await readFile(new URL("../src/client/identity-b.css", import.meta.url), "utf8");
const start = css.indexOf("@media (max-width: 760px)");
const narrow = css.slice(start);
const wide = css.slice(0, start);
const block = (source, selector) => source.match(new RegExp(`${selector.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";

test("the active item is a filled pill with color, not only weight", () => {
	const active = block(narrow, ".react-mobile-tabbar-link-active");
	assert.match(active, /background: var\(--color-ink\)/);
	assert.match(active, /color: #ffffff/);
	assert.match(active, /font-weight: 800/);
	assert.match(block(narrow, ".react-mobile-tabbar-link"), /border-radius: 999px/);
});

test("touch targets are at least 44px and the bar clears the bottom safe area", () => {
	const link = block(narrow, ".react-mobile-tabbar-link");
	assert.ok(Number(link.match(/min-height: (\d+)px/)?.[1]) >= 44);
	assert.ok(Number(link.match(/min-width: (\d+)px/)?.[1]) >= 44);
	const add = block(narrow, ".react-mobile-tabbar-add");
	assert.ok(Number(add.match(/width: (\d+)px/)?.[1]) >= 44);
	assert.ok(Number(add.match(/height: (\d+)px/)?.[1]) >= 44);
	assert.match(block(narrow, ".react-mobile-tabbar"), /padding: [^;]*env\(safe-area-inset-bottom\)/);
});

test("the mobile summary polish is scoped to narrow screens and leaves wide screens alone", () => {
	assert.match(narrow, /\.react-dashboard-header \{[^}]*gap: var\(--space-3\)/);
	assert.match(narrow, /\.react-spending-chart-tab:last-child \{[^}]*grid-column: 1 \/ -1/);
	assert.doesNotMatch(wide, /react-dashboard-header|react-spending-chart-tab/);
});
