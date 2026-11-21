import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());
const { FeedbackNotice } = await vite.ssrLoadModule("/src/client/components/feedback/FeedbackNotice.tsx");
const timer = await vite.ssrLoadModule("/src/client/components/feedback/undoCountdown.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { readFile } = await import("node:fs/promises");

/** A manual clock and scheduler: the countdown never touches real timers in these tests. */
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

function countdown(clock, expired) {
	return timer.createUndoCountdown({
		onExpire: () => expired.push(clock.now()),
		now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
	});
}

test("the undo notice lives 7 seconds", () => {
	assert.equal(timer.UNDO_NOTICE_MS, 7000);
});

test("the countdown expires once, exactly 7 s after it starts", () => {
	const clock = fakeClock();
	const expired = [];
	const c = countdown(clock, expired);
	c.start();
	clock.advance(6999);
	assert.deepEqual(expired, []);
	clock.advance(1);
	assert.deepEqual(expired, [7000]);
	clock.advance(20000);
	assert.deepEqual(expired, [7000]);
	assert.equal(clock.pendingCount, 0);
});

test("hovering or focusing pauses the countdown and leaving resumes with the time that was left", () => {
	const clock = fakeClock();
	const expired = [];
	const c = countdown(clock, expired);
	c.start();
	clock.advance(3000);
	c.hold("pointer");
	assert.equal(clock.pendingCount, 0);
	clock.advance(60000);
	assert.deepEqual(expired, []);
	c.release("pointer");
	clock.advance(3999);
	assert.deepEqual(expired, []);
	clock.advance(1);
	assert.deepEqual(expired, [3000 + 60000 + 4000]);
	// focus is its own hold: it keeps the pause even after the pointer leaves
	const clock2 = fakeClock();
	const expired2 = [];
	const c2 = countdown(clock2, expired2);
	c2.start();
	c2.hold("pointer");
	c2.hold("focus");
	c2.release("pointer");
	clock2.advance(100000);
	assert.deepEqual(expired2, []);
	c2.release("focus");
	clock2.advance(7000);
	assert.equal(expired2.length, 1);
});

test("while an undo is in flight the notice never dismisses", () => {
	const clock = fakeClock();
	const expired = [];
	const c = countdown(clock, expired);
	c.start();
	clock.advance(6500);
	c.hold("busy");
	clock.advance(30000);
	assert.deepEqual(expired, []);
	assert.equal(c.isRunning(), false);
	c.release("busy");
	assert.equal(c.isRunning(), true);
	clock.advance(500);
	assert.equal(expired.length, 1);
});

test("a disposed countdown never fires and repeated holds do not stack timers", () => {
	const clock = fakeClock();
	const expired = [];
	const c = countdown(clock, expired);
	c.start();
	c.start();
	c.hold("pointer");
	c.hold("pointer");
	c.release("pointer");
	c.release("pointer");
	assert.equal(clock.pendingCount, 1);
	c.dispose();
	assert.equal(clock.pendingCount, 0);
	clock.advance(20000);
	assert.deepEqual(expired, []);
	c.release("busy");
	assert.equal(clock.pendingCount, 0);
});

test("a notice without an action renders byte-identical markup", () => {
	assert.equal(
		renderToStaticMarkup(createElement(FeedbackNotice, { className: "n", tone: "success", message: "Listo" })),
		'<p class="n react-feedback-notice" role="status"><svg class="react-success-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" pathLength="1"></path></svg><span>Listo</span></p>',
	);
	assert.equal(
		renderToStaticMarkup(createElement(FeedbackNotice, { className: "n", tone: "error", message: "Listo" })),
		'<p class="n react-feedback-notice" role="status"><span>Listo</span></p>',
	);
	// an onDismiss without an action is inert: only the undo notice is timed
	assert.equal(
		renderToStaticMarkup(createElement(FeedbackNotice, { className: "n", tone: "error", message: "Listo", onDismiss() {} })),
		'<p class="n react-feedback-notice" role="status"><span>Listo</span></p>',
	);
});

test("a notice with an action and a dismiss handler shows the shrinking timer bar and keeps the button", () => {
	const html = renderToStaticMarkup(createElement(FeedbackNotice, {
		className: "n", tone: "success", message: "Listo", onDismiss() {},
		action: { label: "Deshacer", onClick() {} },
	}));
	assert.match(html, /<button class="react-feedback-notice-action" type="button">Deshacer<\/button>/);
	assert.match(html, /<span class="react-feedback-notice-timer" aria-hidden="true"><\/span>/);
	assert.match(html, /class="n react-feedback-notice react-feedback-notice-timed"/);
	assert.match(html, /style="--undo-notice-ms:7000ms"/);
	assert.doesNotMatch(html, /data-held/);
	// without a dismiss handler there is nothing to count down, so no bar is drawn
	const untimed = renderToStaticMarkup(createElement(FeedbackNotice, {
		className: "n", tone: "success", message: "Listo", action: { label: "Deshacer", onClick() {} },
	}));
	assert.doesNotMatch(untimed, /timer|timed/);
});

test("the bar animates over the notice lifetime, pauses with the countdown and is off under reduced motion", async () => {
	const css = await readFile(new URL("../src/client/dashboard-polish.css", import.meta.url), "utf8");
	assert.match(css, /\.react-feedback-notice-timer\s*\{[^}]*animation:\s*undo-notice-shrink var\(--undo-notice-ms\) linear forwards/);
	assert.match(css, /@keyframes undo-notice-shrink\s*\{\s*from\s*\{\s*transform:\s*scaleX\(1\)/);
	assert.match(css, /\.react-feedback-notice-timed\[data-held="true"\] \.react-feedback-notice-timer\s*\{\s*animation-play-state:\s*paused/);
	const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /\.react-feedback-notice-timer\s*\{\s*display:\s*none/);
});

test("the dashboard times only the undo notice and clears it when the countdown ends", async () => {
	const page = await readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8");
	assert.match(page, /onDismiss=\{editNotice\.undo \? \(\) => setEditNotice\(\(current\) => \(current === editNotice \? null : current\)\) : undefined\}/);
	const source = await readFile(new URL("../src/client/components/feedback/FeedbackNotice.tsx", import.meta.url), "utf8");
	assert.match(source, /createUndoCountdown/);
	assert.match(source, /action\?\.disabled/);
});
