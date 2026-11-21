import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Identity B (odd/tasks/identidad-b.md, T14, S15): dialogs the page unmounts on close must animate out.
// The component keeps rendering its last content while the CSS exit runs (300ms sheet <=760px, 150ms
// desktop) and releases it afterwards; under prefers-reduced-motion it releases at once.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
let vite, cache, motion, viewDialog;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "motion-dialog-exit-"));
	vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	motion = await vite.ssrLoadModule("/src/client/components/feedback/motion.ts");
	viewDialog = await vite.ssrLoadModule("/src/client/components/movements/ViewMovementDialog.tsx");
});
test.after(async () => {
	await vite?.close();
	await rm(cache, { recursive: true, force: true });
});

const media = ({ reduced = false, narrow = false } = {}) => ({
	matchMedia: (query) => ({
		matches: query.includes("prefers-reduced-motion") ? reduced : query.includes("max-width: 760px") ? narrow : false,
	}),
});

test("the exit lasts 300ms as a bottom sheet, 150ms on desktop and 0 under reduced motion or without matchMedia", () => {
	assert.equal(motion.getDialogExitMs(media({ narrow: true })), 300);
	assert.equal(motion.getDialogExitMs(media()), 150);
	assert.equal(motion.getDialogExitMs(media({ reduced: true, narrow: true })), 0);
	assert.equal(motion.getDialogExitMs(media({ reduced: true })), 0);
	assert.equal(motion.getDialogExitMs(undefined), 0);
	assert.equal(motion.getDialogExitMs({}), 0);
});

const fakeTimers = () => {
	const pending = new Map();
	let next = 1;
	return {
		pending,
		setTimer: (callback, ms) => { pending.set(next, { callback, ms }); return next++; },
		clearTimer: (handle) => { pending.delete(handle); },
		fire: () => { const [[id, timer]] = [...pending]; pending.delete(id); timer.callback(); },
	};
};

test("a deferred unmount waits the exit duration, then releases exactly once", () => {
	const timers = fakeTimers();
	let released = 0;
	const exit = motion.createDeferredUnmount({ ms: 300, onUnmount: () => { released++; }, ...timers });
	exit.begin();
	assert.equal(released, 0);
	assert.equal([...timers.pending.values()][0].ms >= 300, true);
	timers.fire();
	assert.equal(released, 1);
	exit.finish();
	assert.equal(released, 1, "a late transitionend after the timeout never releases twice");
});

test("a transitionend (finish) releases early and clears the fallback timer", () => {
	const timers = fakeTimers();
	let released = 0;
	const exit = motion.createDeferredUnmount({ ms: 150, onUnmount: () => { released++; }, ...timers });
	exit.begin();
	exit.finish();
	assert.equal(released, 1);
	assert.equal(timers.pending.size, 0);
});

test("reduced motion (0ms) releases immediately with no timer at all", () => {
	const timers = fakeTimers();
	let released = 0;
	const exit = motion.createDeferredUnmount({ ms: 0, onUnmount: () => { released++; }, ...timers });
	exit.begin();
	assert.equal(released, 1);
	assert.equal(timers.pending.size, 0);
});

test("reopening during the exit cancels the release so the new content is never dropped", () => {
	const timers = fakeTimers();
	let released = 0;
	const exit = motion.createDeferredUnmount({ ms: 300, onUnmount: () => { released++; }, ...timers });
	exit.begin();
	exit.cancel();
	assert.equal(timers.pending.size, 0);
	exit.finish();
	assert.equal(released, 0);
});

test("ViewMovementDialog keeps the last movement while closing but renders nothing when it never opened", async () => {
	const closed = renderToStaticMarkup(createElement(viewDialog.ViewMovementDialog, { movement: null, onClose() {} }));
	assert.equal(closed, "");
	const src = await read("src/client/components/movements/ViewMovementDialog.tsx");
	assert.match(src, /useRetainedWhileClosing/);
	assert.match(src, /onTransitionEnd/);
});

test("the retained dialog still closes through the shared native lifecycle and keeps dismissal wiring", async () => {
	const src = await read("src/client/components/movements/ViewMovementDialog.tsx");
	assert.match(src, /syncNativeModalDialog\(dialogRef\.current, isOpen\)/);
	assert.match(src, /onClose=\{onClose\}/);
	const shared = await read("src/client/components/movements/CreateManualExpenseDialog.tsx");
	assert.match(shared, /if \(dialog\.open\) dialog\.close\(\)/);
});

test("the day detail dialog stays mounted and closes natively so its sheet slides out", async () => {
	const src = await read("src/client/components/analytics/SpendingDayDetailDialog.tsx");
	assert.doesNotMatch(src, /if \(!isOpen\) return null/);
	assert.match(src, /syncNativeModalDialog\(dialog, isOpen\)/);
});
