import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const COBALT_LITERAL =
	/#003594|#0b2f8a|#174ea6|#1f4fa0|#2457c6|#e3ecff|#e8efff|#edf3ff|#004ac6|#2878e5|#e7f1ff|#0d3f91|#1d4ed8|#2563eb|#3b82f6|#eff6ff|#dbeafe|#bfdbfe|rgba?\(\s*0,\s*53,\s*148|rgba?\(\s*0,\s*74,\s*198|rgba?\(\s*23,\s*78,\s*166|rgba?\(\s*8,\s*36,\s*88|rgba?\(\s*6,\s*41,\s*106|var\(--marketing-primary/i;

function fakeClock() {
	let now = 0;
	let next = 1;
	const pending = new Map();
	return {
		now: () => now,
		schedule: (fn, ms) => {
			const id = next++;
			pending.set(id, { fn, at: now + ms });
			return id;
		},
		cancel: (id) => {
			pending.delete(id);
		},
		advance(ms) {
			const target = now + ms;
			for (;;) {
				const due = [...pending.entries()]
					.filter(([, t]) => t.at <= target)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				pending.delete(due[0]);
				now = due[1].at;
				due[1].fn();
			}
			now = target;
		},
		get pendingCount() {
			return pending.size;
		},
	};
}

test("SuccessToast exports timing constants and normalizes summary labels", async () => {
	const mod = await vite.ssrLoadModule("/src/client/components/feedback/SuccessToast.tsx");
	assert.equal(typeof mod.SUCCESS_TOAST_DURATION_MS, "number");
	assert.ok(mod.SUCCESS_TOAST_DURATION_MS >= 1500 && mod.SUCCESS_TOAST_DURATION_MS <= 3500);
	assert.equal(typeof mod.SUCCESS_TOAST_EXIT_MS, "number");
	assert.ok(mod.SUCCESS_TOAST_EXIT_MS >= 150 && mod.SUCCESS_TOAST_EXIT_MS <= 500);
	assert.equal(mod.getSuccessToastSummary("Gasto guardado"), "Gasto guardado");
	assert.equal(mod.getSuccessToastSummary("  Cambios   guardados.  "), "Cambios guardados");
	assert.equal(mod.getSuccessToastSummary("   "), "Cambios guardados");
});

test("SuccessToast renders nothing when inactive and an accessible animated check overlay when active", async () => {
	const { SuccessToast } = await vite.ssrLoadModule("/src/client/components/feedback/SuccessToast.tsx");
	assert.equal(
		renderToStaticMarkup(createElement(SuccessToast, { toast: null, onDismiss() {} })),
		"",
	);

	const html = renderToStaticMarkup(
		createElement(SuccessToast, {
			toast: { id: 1, message: "Gasto guardado" },
			onDismiss() {},
		}),
	);
	assert.match(html, /class="react-success-toast"/);
	assert.doesNotMatch(html, /react-success-toast-leaving/);
	assert.match(html, /role="status"/);
	assert.match(html, /aria-live="polite"/);
	assert.match(html, /aria-atomic="true"/);
	assert.match(html, /class="react-success-toast-badge"/);
	assert.match(html, /<svg class="react-success-toast-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">/);
	assert.match(html, /pathLength="1"/);
	assert.match(html, /class="react-success-toast-message">Gasto guardado</);
});

test("SuccessToast auto-dismisses after duration plus exit window using createNoticeAutoDismiss", async () => {
	const { SUCCESS_TOAST_DURATION_MS, SUCCESS_TOAST_EXIT_MS } = await vite.ssrLoadModule(
		"/src/client/components/feedback/SuccessToast.tsx",
	);
	const { createNoticeAutoDismiss } = await vite.ssrLoadModule(
		"/src/client/components/feedback/noticeAutoDismiss.ts",
	);
	const clock = fakeClock();
	const events = [];
	const timer = createNoticeAutoDismiss({
		durationMs: SUCCESS_TOAST_DURATION_MS,
		exitMs: SUCCESS_TOAST_EXIT_MS,
		onLeave: () => events.push("leave"),
		onDismiss: () => events.push("dismiss"),
		...clock,
	});
	timer.start();
	clock.advance(SUCCESS_TOAST_DURATION_MS - 1);
	assert.deepEqual(events, []);
	clock.advance(1);
	assert.deepEqual(events, ["leave"]);
	clock.advance(SUCCESS_TOAST_EXIT_MS - 1);
	assert.deepEqual(events, ["leave"]);
	clock.advance(1);
	assert.deepEqual(events, ["leave", "dismiss"]);
	assert.equal(clock.pendingCount, 0);

	// Disposing cancels any pending leave/dismiss callbacks cleanly.
	const clock2 = fakeClock();
	const events2 = [];
	const timer2 = createNoticeAutoDismiss({
		durationMs: SUCCESS_TOAST_DURATION_MS,
		exitMs: SUCCESS_TOAST_EXIT_MS,
		onLeave: () => events2.push("leave"),
		onDismiss: () => events2.push("dismiss"),
		...clock2,
	});
	timer2.start();
	clock2.advance(500);
	timer2.dispose();
	clock2.advance(10000);
	assert.deepEqual(events2, []);
	assert.equal(clock2.pendingCount, 0);
});

test("success-toast.css is centered, non-invasive, cobalt-free, and respects reduced motion", async () => {
	const css = await read("src/client/components/feedback/success-toast.css");
	assert.match(css, /\.react-success-toast\s*\{[^}]*position:\s*fixed/);
	assert.match(css, /\.react-success-toast\s*\{[^}]*inset:\s*0/);
	assert.match(css, /\.react-success-toast\s*\{[^}]*display:\s*grid/);
	assert.match(css, /\.react-success-toast\s*\{[^}]*place-items:\s*center/);
	assert.match(css, /\.react-success-toast\s*\{[^}]*pointer-events:\s*none/);
	assert.match(css, /\.react-success-toast-check path\s*\{[^}]*stroke-dasharray:\s*1/);
	assert.match(css, /\.react-success-toast\.react-success-toast-leaving/);
	assert.doesNotMatch(css, COBALT_LITERAL, "success-toast.css must not use cobalt colors");

	const reducedIdx = css.indexOf("@media (prefers-reduced-motion: reduce)");
	assert.notEqual(reducedIdx, -1, "success-toast.css must declare a reduced-motion media query");
	const reduced = css.slice(reducedIdx);
	assert.match(reduced, /animation:\s*none\s*!important/);
	assert.match(reduced, /transition:\s*none\s*!important/);
});

test("DashboardPage wires the page-level SuccessToast only on settled successes", async () => {
	const page = await read("src/client/pages/DashboardPage.tsx");
	assert.match(page, /import \{ SuccessToastProvider, useSuccessToast \} from "\.\.\/components\/feedback\/SuccessToast"/);
	assert.match(page, /const showSuccessToast = useSuccessToast\(\);/);
	const toast = await read("src/client/components/feedback/SuccessToast.tsx");
	// Monotonic id sequence so consecutive saves replay the animation cleanly.
	assert.match(toast, /seq\.current \+= 1/);

	assert.match(page, /handleManualExpenseSaved[\s\S]*?if \(!reloadFailed && notice\.tone === "success"\) showSuccessToast\("Gasto guardado"\)/);
	assert.match(page, /handleMovementEditSaved[\s\S]*?if \(!reloadFailed && notice\.tone === "success"\) showSuccessToast\("Cambios guardados"\)/);
	assert.match(page, /dismissMovementRemoval[\s\S]*?if \(notice\?\.tone === "success"\) showSuccessToast\("Movimiento eliminado"\)/);
	assert.match(page, /handleCycleEdited[\s\S]*?if \(!reloadFailed && notice\.tone === "success"\) showSuccessToast\("Período actualizado"\)/);
	assert.match(page, /outcome\.total > 0 &&[\s\S]*?outcome\.succeeded === outcome\.total &&[\s\S]*?!outcome\.reloadFailed[\s\S]*?showSuccessToast\("Categoría asignada"\)/);

	// Banners remain for warnings, errors and actions.
	assert.match(page, /\{creationNotice && \(\s*<FeedbackNotice/);
	assert.match(page, /\{editNotice && \(\s*<FeedbackNotice/);
	assert.match(page, /\{removalNotice && \(\s*<FeedbackNotice/);
	assert.match(page, /\{cycleEditNotice && \(\s*<FeedbackNotice/);
});
