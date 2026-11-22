import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** Body of the first `@media (max-width: <px>)` block that contains `selector`. */
function mediaRule(css, maxWidth, selector) {
	const blocks = css.split(`@media (max-width: ${maxWidth}px)`).slice(1);
	const block = blocks.find((candidate) => candidate.includes(selector));
	assert.ok(block, `no ${maxWidth}px media block styles ${selector}`);
	return block;
}

test("narrow screens turn the spending breakdown into a vertical bar beside one-line legend rows", async () => {
	const css = await read("src/client/styles.css");
	// Segments size from the --share custom property so the same markup fills width or height.
	assert.match(css, /\.react-spending-breakdown-segment \{[^}]*width: var\(--share\)/s);
	const block = mediaRule(css, 640, ".react-spending-breakdown-bar");
	assert.match(block, /\.react-spending-breakdown-chart \{[^}]*grid-template-columns: 14px minmax\(0, 1fr\)/s);
	assert.match(block, /\.react-spending-breakdown-bar \{[^}]*flex-direction: column/s);
	assert.match(block, /\.react-spending-breakdown-segment \{[^}]*height: var\(--share\)/s);
	assert.match(block, /\.react-spending-breakdown-legend-item \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/s);
});

test("Nuevo gasto fields drop the native iOS look and never widen the sheet", async () => {
	const css = await read("src/client/components/movements/expense-sheet.css");
	assert.match(css, /react-create-expense-fields :is\([^)]*\) \{[^}]*-webkit-appearance: none;[^}]*appearance: none;/s);
	assert.match(css, /react-create-expense-fields :is\([^)]*\) \{[^}]*min-width: 0;[^}]*max-width: 100%;/s);
	// iOS gives datetime-local an intrinsic width and centred value; both caused the horizontal scroll.
	assert.match(css, /#manual-expense-occurred-at::-webkit-date-and-time-value \{[^}]*text-align: left/s);
	// Selects keep a drawn chevron once the native control is gone.
	assert.match(css, /:is\(#manual-expense-kind, #manual-expense-category\) \{[^}]*background-image: url\("data:image\/svg\+xml/s);
	assert.match(css, /\.cycle-body \{[^}]*overflow-x: hidden/s);
});

test("narrow screens put the gauge key (Color, Raya: hoy) right under the ring", async () => {
	const css = await read("src/client/components/analytics/dashboard-pace.css");
	const block = mediaRule(css, 760, ".react-pace-gauge-key");
	// The body's children join the card grid so the key can sit between the ring and the state pill.
	assert.match(block, /\.react-pace-gauge:not\(\.react-pace-gauge--none\):not\(\.react-pace-gauge--compact\) \.react-pace-gauge-body \{[^}]*display: contents/s);
	assert.match(block, /\.react-pace-gauge-body > \* \{[^}]*order: 2/s);
	assert.match(block, /\.react-pace-gauge-body > \.react-pace-gauge-key \{[^}]*order: 1/s);
	assert.match(block, /:is\(\.react-pace-gauge-facts, \.react-pace-gauge-notes\) \{[^}]*justify-self: stretch/s);
});

test("the spending breakdown total stacks its caption above the amount instead of one line", async () => {
	const css = await read("src/client/styles.css");
	assert.match(css, /\.react-spending-breakdown-total \{[^}]*display: grid;[^}]*gap: 2px;/s);
	assert.doesNotMatch(css, /\.react-spending-breakdown-total \{[^}]*align-items: baseline/s);
});
