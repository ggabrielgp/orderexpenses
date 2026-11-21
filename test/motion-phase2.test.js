import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Identity B phase 2 (odd/tasks/identidad-b.md, T14, S15): view crossfade, dialog sheets, notice slide
// and the edited-row highlight. Logic is proven through injected hosts; the CSS is pinned structurally
// because this repository has no browser animation runner.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
let vite, cache, motion, page;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "motion-phase2-"));
	vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	motion = await vite.ssrLoadModule("/src/client/components/feedback/motion.ts");
	page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
});
test.after(async () => {
	await vite?.close();
	await rm(cache, { recursive: true, force: true });
});

const host = ({ reduced = false, supported = true, throws = false } = {}) => {
	const calls = [];
	const target = { matchMedia: (query) => ({ matches: reduced && query.includes("prefers-reduced-motion") }) };
	if (supported) {
		target.startViewTransition = (update) => {
			calls.push("transition");
			if (throws) throw new Error("not allowed");
			update();
			return {};
		};
	}
	return { target, calls };
};

test("a view change runs inside a native view transition exactly once", () => {
	const { target, calls } = host();
	let updates = 0;
	motion.runViewTransition(target, () => { updates++; });
	assert.deepEqual(calls, ["transition"]);
	assert.equal(updates, 1);
});

test("reduced motion, a missing API or a refusal change the view immediately and once", () => {
	for (const options of [{ reduced: true }, { supported: false }, { throws: true }]) {
		const { target, calls } = host(options);
		let updates = 0;
		motion.runViewTransition(target, () => { updates++; });
		assert.equal(updates, 1, JSON.stringify(options));
		assert.equal(calls.includes("transition"), Boolean(options.throws));
	}
	let updates = 0;
	motion.runViewTransition(undefined, () => { updates++; });
	assert.equal(updates, 1);
});

const timers = () => {
	const pending = new Map();
	let next = 1;
	return {
		pending,
		setTimer: (callback, ms) => { pending.set(next, { callback, ms }); return next++; },
		clearTimer: (handle) => { pending.delete(handle); },
		fire: () => { for (const [handle, timer] of [...pending]) { pending.delete(handle); timer.callback(); } },
	};
};

test("the edited movement is highlighted for 1.2s and then cleared", () => {
	const clock = timers();
	const seen = [];
	const highlight = motion.createEditHighlight({ onChange: (id) => seen.push(id), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
	assert.equal(motion.EDIT_HIGHLIGHT_MS, 1200);
	highlight.flash("m-1");
	assert.deepEqual(seen, ["m-1"]);
	assert.deepEqual([...clock.pending.values()].map((timer) => timer.ms), [1200]);
	clock.fire();
	assert.deepEqual(seen, ["m-1", null]);
});

test("a second edit restarts the highlight, and a missing id or dispose never leaves a timer", () => {
	const clock = timers();
	const seen = [];
	const highlight = motion.createEditHighlight({ onChange: (id) => seen.push(id), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
	highlight.flash("m-1");
	highlight.flash("m-2");
	assert.equal(clock.pending.size, 1);
	clock.fire();
	assert.deepEqual(seen, ["m-1", "m-2", null]);
	highlight.flash(null);
	highlight.flash(undefined);
	assert.equal(clock.pending.size, 0);
	assert.deepEqual(seen, ["m-1", "m-2", null]);
	highlight.flash("m-3");
	highlight.dispose();
	assert.equal(clock.pending.size, 0);
});

const movement = (id, counterparty) => ({
	id, counterparty, description: counterparty, date: "2026-05-05", amount: 1000, category: "Comida", kind: "purchase",
});

test("only the highlighted row of the table and of the mobile list carries the highlight", () => {
	const rows = [movement("m-1", "Uno"), movement("m-2", "Dos")];
	const props = {
		filteredView: { rows, activeCategory: null, options: [], count: { category: null, isActive: false, shown: 2, total: 2, message: null } },
		periodMovements: rows, sort: { key: "date", direction: "asc" }, editableMovements: [],
		onActivate() {}, onSelect() {}, onClear() {}, onEdit() {}, onRemove() {},
	};
	const html = (highlightedMovementId) => renderToStaticMarkup(createElement(page.MovementsTableView, { ...props, highlightedMovementId }));
	const marked = html("m-2");
	assert.equal((marked.match(/data-highlighted="true"/g) ?? []).length, 2, "one table row and one mobile card");
	assert.match(marked, /<tr[^>]*data-highlighted="true"[^>]*>(?:(?!<\/tr>)[\s\S])*Dos/);
	assert.match(marked, /<article[^>]*data-highlighted="true"[^>]*>(?:(?!<\/article>)[\s\S])*Dos/);
	assert.doesNotMatch(marked.replace(/<tr[^>]*data-highlighted[\s\S]*?<\/tr>/, "").replace(/<article[^>]*data-highlighted[\s\S]*?<\/article>/, ""), /data-highlighted/);
	assert.doesNotMatch(html(null), /data-highlighted/);
	assert.doesNotMatch(html(undefined), /data-highlighted/);
});

test("the authenticated summary flashes the edited movement after a save, and the demo never does", async () => {
	const source = await read("src/client/pages/DashboardPage.tsx");
	assert.match(source, /useEditHighlight\(\)/);
	assert.match(source, /flashEdited\(editMovement\?\.id\)/);
	assert.match(source, /highlightedMovementId=\{highlightedMovementId\}/);
	assert.match(source, /const \[view, setView\] = useAnimatedView<DashboardView>\("summary"\)/);
});

test("highlight, notices, view fade and sheets use the motion tokens and respect reduced motion", async () => {
	const css = await read("src/client/motion.css");
	// Notices slide in over the view-change duration.
	assert.match(css, /\.react-feedback-notice\s*\{[^}]*animation:\s*motion-notice-in var\(--duration-view\)/);
	assert.match(css, /@keyframes motion-notice-in\s*\{[^}]*translateY\(-?\d+px\)/);
	// Edited row: ~1.2s fade, driven by the data attribute the page sets.
	assert.match(css, /\[data-highlighted="true"\][^{]*\{[^}]*animation:\s*motion-row-highlight 1200ms/);
	assert.match(css, /@keyframes motion-row-highlight/);
	// The Resumen <-> Movimientos crossfade is the native root view transition at 300ms.
	assert.match(css, /::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{[^}]*animation-duration:\s*var\(--duration-view\)/);
	const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /\.react-feedback-notice[^{]*\{[^}]*animation:\s*none/);
	assert.match(reduced, /\[data-highlighted="true"\][^{]*\{[^}]*animation:\s*none/);
	assert.match(reduced, /::view-transition-group\(\*\)[^{]*\{[^}]*animation:\s*none/);
	assert.match(reduced, /dialog\[class\*="react-"\][^{]*\{[^}]*transition:\s*none/);
	assert.doesNotMatch(css, /infinite|animation-delay/);
});

test("dialogs fade/scale in 150ms on desktop and slide as bottom sheets in 300ms at <=760px, closing included", async () => {
	const css = await read("src/client/motion.css");
	const base = css.slice(0, css.indexOf("@media (max-width: 760px)"));
	// Transition based, so the close animates too, without touching the open/close/backdrop code.
	assert.match(base, /dialog\[class\*="react-"\]\s*\{[^}]*transition:[^;]*var\(--duration-fast\)[^;]*display var\(--duration-fast\) allow-discrete/);
	assert.match(base, /dialog\[class\*="react-"\]\s*\{[^}]*scale\(0?\.9\d*\)/);
	assert.match(base, /dialog\[class\*="react-"\]\[open\]\s*\{[^}]*opacity:\s*1/);
	assert.match(base, /@starting-style\s*\{\s*dialog\[class\*="react-"\]\[open\]/);
	assert.match(base, /dialog\[class\*="react-"\]::backdrop\s*\{[^}]*opacity:\s*0/);
	const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
	assert.match(narrow, /dialog\[class\*="react-"\]\s*\{[^}]*margin:\s*auto 0 0/);
	assert.match(narrow, /dialog\[class\*="react-"\]\s*\{[^}]*width:\s*100%/);
	assert.match(narrow, /dialog\[class\*="react-"\]\s*\{[^}]*translateY\(100%\)/);
	assert.match(narrow, /dialog\[class\*="react-"\]\s*\{[^}]*transform var\(--duration-view\)/);
	assert.match(narrow, /@starting-style\s*\{\s*dialog\[class\*="react-"\]\[open\][^}]*translateY\(100%\)/);
});

test("the previous 220ms dialog entrance no longer competes with the new transitions", async () => {
	const legacy = await read("src/client/dashboard-motion.css");
	assert.doesNotMatch(legacy, /dialog\[class\*="react-"\]\[open\][^{]*\{[^}]*animation:/);
	assert.doesNotMatch(legacy, /\.react-movements-view\s*\{[^}]*animation:/);
	const entry = await read("src/client/main.tsx");
	assert.ok(entry.indexOf('"./motion.css"') > entry.indexOf('"./identity-b.css"'));
});

test("dialog lifecycle helpers are untouched: still showModal/close guarded by the element's own state", async () => {
	const shared = await read("src/client/components/movements/CreateManualExpenseDialog.tsx");
	const sync = shared.slice(shared.indexOf("export function syncNativeModalDialog"), shared.indexOf("export interface CreateManualExpenseDialogProps"));
	assert.match(sync, /if \(!dialog\.open\) dialog\.showModal\(\)/);
	assert.match(sync, /if \(dialog\.open\) dialog\.close\(\)/);
});
