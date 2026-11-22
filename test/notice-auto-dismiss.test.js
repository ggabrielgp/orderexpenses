import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

// S2 (odd/tasks/mobile-polish-business-day.md, T2): "Período guardado y resumen actualizado." leaves
// by itself after a few seconds with a smooth exit; the stale-summary warning stays until replaced.
const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());
const { FeedbackNotice } = await vite.ssrLoadModule("/src/client/components/feedback/FeedbackNotice.tsx");
const exit = await vite.ssrLoadModule("/src/client/components/feedback/noticeAutoDismiss.ts");
const settings = await vite.ssrLoadModule("/src/client/components/financial-cycle/cycleSettings.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function fakeClock() {
	let now = 0;
	let next = 1;
	const pending = new Map();
	return {
		now: () => now,
		schedule: (fn, ms) => { const id = next++; pending.set(id, { fn, at: now + ms }); return id; },
		cancel: (id) => { pending.delete(id); },
		advance(ms) {
			const target = now + ms;
			for (;;) {
				const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				pending.delete(due[0]);
				now = due[1].at;
				due[1].fn();
			}
			now = target;
		},
		get pendingCount() { return pending.size; },
	};
}

test("the saved-period success notice dismisses itself after 4 s; the stale warning does not", () => {
	assert.deepEqual(settings.getCycleEditNotice({ status: "saved", reloadFailed: false }), {
		message: "Período guardado y resumen actualizado.",
		tone: "success",
		autoDismissMs: 4000,
	});
	assert.equal(settings.getCycleEditNotice({ status: "saved", reloadFailed: true }).autoDismissMs, undefined);
});

test("auto dismiss starts the exit at the duration and removes the notice once the exit animation ends", () => {
	const clock = fakeClock();
	const events = [];
	const timer = exit.createNoticeAutoDismiss({
		durationMs: 4000,
		onLeave: () => events.push("leave"),
		onDismiss: () => events.push("dismiss"),
		...clock,
	});
	timer.start();
	clock.advance(3999);
	assert.deepEqual(events, []);
	clock.advance(1);
	assert.deepEqual(events, ["leave"]);
	clock.advance(exit.NOTICE_EXIT_MS - 1);
	assert.deepEqual(events, ["leave"]);
	clock.advance(1);
	assert.deepEqual(events, ["leave", "dismiss"]);
	assert.equal(clock.pendingCount, 0);
});

test("hovering or focusing pauses the auto dismiss and dispose cancels everything", () => {
	const clock = fakeClock();
	const events = [];
	const timer = exit.createNoticeAutoDismiss({ durationMs: 4000, onLeave: () => events.push("leave"), onDismiss: () => events.push("dismiss"), ...clock });
	timer.start();
	clock.advance(1000);
	timer.hold("pointer");
	clock.advance(10000);
	assert.deepEqual(events, []);
	timer.release("pointer");
	clock.advance(2999);
	assert.deepEqual(events, []);
	clock.advance(1);
	assert.deepEqual(events, ["leave"]);
	timer.dispose();
	clock.advance(10000);
	assert.deepEqual(events, ["leave"]);
	assert.equal(clock.pendingCount, 0);
});

test("an auto-dismissing notice renders without a timer bar or action", () => {
	const html = renderToStaticMarkup(createElement(FeedbackNotice, {
		className: "n", tone: "success", message: "Listo", autoDismissMs: 4000, onDismiss() {},
	}));
	assert.match(html, /class="n react-feedback-notice react-feedback-notice-auto"/);
	assert.doesNotMatch(html, /react-feedback-notice-timer|<button/);
	assert.doesNotMatch(html, /react-feedback-notice-leaving/);
});

test("the exit fades, lifts and collapses smoothly, and is immediate under reduced motion", async () => {
	const css = await read("src/client/motion.css");
	assert.match(css, /\.react-feedback-notice\.react-feedback-notice-leaving\s*\{[^}]*animation:\s*motion-notice-out \d+ms/);
	const keyframes = css.slice(css.indexOf("@keyframes motion-notice-out"));
	assert.match(keyframes, /\bto\s*\{[^}]*opacity:\s*0;[^}]*max-height:\s*0/);
	const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /\.react-feedback-notice[^{]*\{[^}]*animation:\s*none/);
});

test("the dashboard hands the period notice its auto dismiss and clears it on dismiss", async () => {
	const page = await read("src/client/pages/DashboardPage.tsx");
	const block = page.slice(page.indexOf("{cycleEditNotice && ("), page.indexOf("{view === \"summary\" ? ("));
	assert.match(block, /autoDismissMs=\{cycleEditNotice\.autoDismissMs\}/);
	assert.match(block, /onDismiss=\{\(\) => setCycleEditNotice\(null\)\}/);
});
