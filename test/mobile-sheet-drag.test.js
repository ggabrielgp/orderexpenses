import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadSheetDragModule() {
	const source = await read("src/client/components/dialog/sheetDragDismiss.ts");
	const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

class Pointer extends Event {
	constructor(type, options = {}) {
		super(type, { cancelable: true, bubbles: true });
		const { timeStamp, ...rest } = options;
		Object.assign(
			this,
			{ pointerId: 1, button: 0, isPrimary: true, clientX: 120, clientY: 100 },
			rest,
		);
		if (typeof timeStamp === "number") {
			Object.defineProperty(this, "timeStamp", { value: timeStamp });
		}
	}
}

class Handle extends EventTarget {
	captured = new Set();
	setPointerCapture(id) { this.captured.add(id); }
	releasePointerCapture(id) { this.captured.delete(id); }
	getBoundingClientRect() { return { left: 100, right: 140, top: 12, bottom: 16, width: 40, height: 4 }; }
}

class Dialog extends EventTarget {
	open = true;
	cancels = 0;
	closes = 0;
	requests = 0;
	dataset = {};
	style = { transform: "", transition: "" };
	handle = new Handle();
	constructor({ native = false, blocked = false, mobile = true } = {}) {
		super();
		this.ownerDocument = {
			defaultView: {
				HTMLDialogElement: Dialog,
				PointerEvent: Pointer,
				Event,
				matchMedia: (query) => ({ matches: mobile && query.includes("max-width: 760px") }),
			},
		};
		this.addEventListener("cancel", (event) => {
			this.cancels++;
			if (blocked) event.preventDefault();
		});
		if (native) {
			this.requestClose = () => {
				this.requests++;
				if (this.dispatchEvent(new Event("cancel", { cancelable: true }))) this.close();
			};
		}
	}
	querySelector(selector) {
		return selector === ".cycle-grab" ? this.handle : null;
	}
	close() {
		this.open = false;
		this.closes++;
		this.dispatchEvent(new Event("close"));
	}
	showModal() {
		this.open = true;
	}
}

const fire = (target, type, options) => target.dispatchEvent(new Pointer(type, options));

test("pure drag helpers clamp negative/non-finite offsets and evaluate distance and velocity thresholds", async () => {
	const {
		SHEET_DRAG_DISMISS_DISTANCE_PX,
		SHEET_DRAG_DISMISS_VELOCITY_PX_MS,
		clampSheetDragOffset,
		shouldDismissSheetDrag,
	} = await loadSheetDragModule();

	assert.ok(Number.isFinite(SHEET_DRAG_DISMISS_DISTANCE_PX) && SHEET_DRAG_DISMISS_DISTANCE_PX > 0);
	assert.ok(Number.isFinite(SHEET_DRAG_DISMISS_VELOCITY_PX_MS) && SHEET_DRAG_DISMISS_VELOCITY_PX_MS > 0);

	assert.equal(clampSheetDragOffset(-40), 0);
	assert.equal(clampSheetDragOffset(0), 0);
	assert.equal(clampSheetDragOffset(Number.NaN), 0);
	assert.equal(clampSheetDragOffset(Number.POSITIVE_INFINITY), 0);
	assert.equal(clampSheetDragOffset(42.5), 42.5);

	assert.equal(shouldDismissSheetDrag({ offsetY: 0, velocityY: 2 }), false);
	assert.equal(shouldDismissSheetDrag({ offsetY: -30, velocityY: 2 }), false);
	assert.equal(
		shouldDismissSheetDrag({ offsetY: SHEET_DRAG_DISMISS_DISTANCE_PX - 1, velocityY: 0.1 }),
		false,
	);
	assert.equal(
		shouldDismissSheetDrag({ offsetY: SHEET_DRAG_DISMISS_DISTANCE_PX, velocityY: 0 }),
		true,
	);
	assert.equal(
		shouldDismissSheetDrag({ offsetY: 24, velocityY: SHEET_DRAG_DISMISS_VELOCITY_PX_MS }),
		true,
	);
});

test("registerSheetDragDismiss translates 1:1 while dragging and dismisses past threshold via requestClose or cancel fallback", async () => {
	const { registerSheetDragDismiss, SHEET_DRAG_DISMISS_DISTANCE_PX } = await loadSheetDragModule();

	for (const native of [true, false]) {
		const dialog = new Dialog({ native });
		registerSheetDragDismiss(dialog);

		fire(dialog.handle, "pointerdown", { clientY: 100, timeStamp: 1000 });
		assert.equal(dialog.dataset.dragging, "true");
		assert.equal(dialog.style.transition, "none");

		// Upward drag does not translate above 0.
		fire(dialog.handle, "pointermove", { clientY: 70, timeStamp: 1050 });
		assert.equal(dialog.style.transform, "");

		// Downward drag translates 1:1.
		const targetOffset = SHEET_DRAG_DISMISS_DISTANCE_PX + 10;
		fire(dialog.handle, "pointermove", { clientY: 100 + targetOffset, timeStamp: 1300 });
		assert.equal(dialog.style.transform, `translateY(${targetOffset}px)`);

		fire(dialog.handle, "pointerup", { clientY: 100 + targetOffset, timeStamp: 1320 });
		assert.equal(dialog.open, false);
		assert.equal(dialog.cancels, 1);
		assert.equal(dialog.closes, 1);
		assert.equal(dialog.requests, Number(native));
		assert.equal(dialog.dataset.dragging, undefined);
		assert.equal(dialog.style.transform, "");
		assert.equal(dialog.style.transition, "");
	}
});

test("registerSheetDragDismiss dismisses on fast downward flick even below distance threshold", async () => {
	const { registerSheetDragDismiss } = await loadSheetDragModule();
	const dialog = new Dialog({ native: false });
	registerSheetDragDismiss(dialog);

	fire(dialog.handle, "pointerdown", { clientY: 100, timeStamp: 1000 });
	fire(dialog.handle, "pointermove", { clientY: 136, timeStamp: 1030 }); // 36px in 30ms = 1.2 px/ms
	fire(dialog.handle, "pointerup", { clientY: 136, timeStamp: 1031 });

	assert.equal(dialog.open, false);
	assert.equal(dialog.cancels, 1);
	assert.equal(dialog.closes, 1);
});

test("registerSheetDragDismiss preserves onCancel veto (e.g. saving in flight) and snaps back cleanly", async () => {
	const { registerSheetDragDismiss, SHEET_DRAG_DISMISS_DISTANCE_PX } = await loadSheetDragModule();

	for (const native of [true, false]) {
		const dialog = new Dialog({ native, blocked: true });
		registerSheetDragDismiss(dialog);

		fire(dialog.handle, "pointerdown", { clientY: 100, timeStamp: 1000 });
		fire(dialog.handle, "pointermove", { clientY: 100 + SHEET_DRAG_DISMISS_DISTANCE_PX + 20, timeStamp: 1200 });
		fire(dialog.handle, "pointerup", { clientY: 100 + SHEET_DRAG_DISMISS_DISTANCE_PX + 20, timeStamp: 1220 });

		assert.equal(dialog.open, true);
		assert.equal(dialog.cancels, 1);
		assert.equal(dialog.closes, 0);
		assert.equal(dialog.dataset.dragging, undefined);
		assert.equal(dialog.style.transform, "");
		assert.equal(dialog.style.transition, "");
	}
});

test("registerSheetDragDismiss snaps back below threshold, ignores desktop/non-primary pointers, and is idempotent/SSR-safe", async () => {
	const { registerSheetDragDismiss } = await loadSheetDragModule();

	// Below threshold snaps back.
	const dialog = new Dialog();
	registerSheetDragDismiss(dialog);
	registerSheetDragDismiss(dialog); // idempotent
	fire(dialog.handle, "pointerdown", { clientY: 100, timeStamp: 1000 });
	fire(dialog.handle, "pointermove", { clientY: 130, timeStamp: 1400 });
	assert.equal(dialog.style.transform, "translateY(30px)");
	fire(dialog.handle, "pointerup", { clientY: 130, timeStamp: 1450 });
	assert.equal(dialog.open, true);
	assert.equal(dialog.cancels, 0);
	assert.equal(dialog.closes, 0);
	assert.equal(dialog.dataset.dragging, undefined);
	assert.equal(dialog.style.transform, "");

	// Desktop viewport ignores drag.
	const desktop = new Dialog({ mobile: false });
	registerSheetDragDismiss(desktop);
	fire(desktop.handle, "pointerdown", { clientY: 100, timeStamp: 1000 });
	fire(desktop.handle, "pointermove", { clientY: 260, timeStamp: 1100 });
	fire(desktop.handle, "pointerup", { clientY: 260, timeStamp: 1110 });
	assert.equal(desktop.open, true);
	assert.equal(desktop.closes, 0);
	assert.equal(desktop.style.transform, "");

	// Secondary button / non-primary / pointercancel ignored.
	for (const bad of [{ button: 2 }, { isPrimary: false }]) {
		fire(dialog.handle, "pointerdown", { ...bad, clientY: 100, timeStamp: 2000 });
		fire(dialog.handle, "pointermove", { ...bad, clientY: 280, timeStamp: 2100 });
		fire(dialog.handle, "pointerup", { ...bad, clientY: 280, timeStamp: 2110 });
		assert.equal(dialog.closes, 0);
	}
	fire(dialog.handle, "pointerdown", { clientY: 100, timeStamp: 3000 });
	fire(dialog.handle, "pointermove", { clientY: 250, timeStamp: 3100 });
	fire(dialog.handle, "pointercancel", { clientY: 250, timeStamp: 3110 });
	assert.equal(dialog.dataset.dragging, undefined);
	assert.equal(dialog.style.transform, "");

	// SSR / minimal stub safety.
	assert.doesNotThrow(() => registerSheetDragDismiss(null));
	assert.doesNotThrow(() => registerSheetDragDismiss({ open: false, showModal() {}, close() {} }));
});

test("motion.css animates mobile dialogs upward with @keyframes motion-sheet-up and respects reduced motion", async () => {
	const css = await read("src/client/motion.css");
	assert.match(css, /@keyframes motion-sheet-up\s*\{[\s\S]*translateY\(100%\)[\s\S]*translateY\(0\)/);
	const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
	assert.match(narrow, /dialog\[class\*="react-"\]\[open\]\s*\{[^}]*animation:\s*motion-sheet-up var\(--duration-view\) var\(--ease-out-expo\)/);
	assert.match(narrow, /\[data-dragging="true"\][^{]*\{[^}]*transition:\s*none/);
	const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /dialog\[class\*="react-"\][^{]*\{[^}]*animation:\s*none\s*!important/);
	assert.match(reduced, /dialog\[class\*="react-"\][^{]*\{[^}]*transition:\s*none\s*!important/);
});

test("expense-sheet.css gives .cycle-grab mobile drag affordance and touch hit area for all three dialogs", async () => {
	const css = await read("src/client/components/movements/expense-sheet.css");
	assert.match(css, /\.cycle-grab[\s\S]*touch-action:\s*none/);
	assert.match(css, /\.cycle-grab[\s\S]*cursor:\s*grab/);
	assert.match(css, /\.cycle-grab:active[\s\S]*cursor:\s*grabbing/);
	assert.match(css, /\.cycle-grab::before/);
	assert.match(css, /react-view-movement-dialog/);
});

test("Create, Edit, and View dialogs wire registerSheetDragDismiss and ViewMovementDialog renders the cycle-dialog bottom sheet", async () => {
	const [createSrc, editSrc, viewSrc] = await Promise.all([
		read("src/client/components/movements/CreateManualExpenseDialog.tsx"),
		read("src/client/components/movements/EditMovementDialog.tsx"),
		read("src/client/components/movements/ViewMovementDialog.tsx"),
	]);

	for (const [name, src] of [
		["CreateManualExpenseDialog", createSrc],
		["EditMovementDialog", editSrc],
		["ViewMovementDialog", viewSrc],
	]) {
		assert.match(src, /registerSheetDragDismiss/, `${name} must wire registerSheetDragDismiss`);
		assert.match(src, /className="cycle-grab"/, `${name} must render the .cycle-grab handle`);
	}

	assert.match(viewSrc, /import "\.\.\/financial-cycle\/cycle-setup\.css"/);
	assert.match(viewSrc, /import "\.\/expense-sheet\.css"/);

	const cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "mobile-sheet-drag-"));
	const vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	try {
		const { ViewMovementDialog } = await vite.ssrLoadModule("/src/client/components/movements/ViewMovementDialog.tsx");
		const movement = {
			id: "m1",
			occurredAt: "2026-02-10T10:00:00",
			date: "2026-02-10",
			amount: 5000,
			kind: "purchase",
			direction: "outflow",
			category: "Comida",
			counterparty: "Café",
			isManual: true,
			hasTime: true,
		};
		const html = renderToStaticMarkup(
			createElement(ViewMovementDialog, {
				movement,
				editableMovement: movement,
				onClose() {},
				onEdit() {},
				onRemove() {},
			}),
		);
		assert.match(html, /class="react-view-movement-dialog cycle-dialog"/);
		assert.match(html, /class="cycle-body"/);
		assert.match(html, /class="cycle-grab"/);
		assert.match(html, /class="cycle-title"[^>]*>Detalle del movimiento<\/h2>/);
		assert.match(html, /class="react-view-movement-fields"/);
		assert.match(html, /class="react-view-movement-field"/);
		assert.match(html, /class="cycle-foot"/);
		assert.match(html, /class="react-shell-actions cycle-actions"/);
		assert.match(html, /cycle-btn/);
		assert.match(html, />Cerrar</);
		assert.match(html, /react-movement-action[^>]*>Editar</);
		assert.match(html, /react-movement-action[^>]*>Eliminar</);

		const readOnlyHtml = renderToStaticMarkup(
			createElement(ViewMovementDialog, {
				movement,
				editableMovement: null,
				onClose() {},
			}),
		);
		assert.match(readOnlyHtml, /class="react-view-movement-read-only"/);
	} finally {
		await vite.close();
		await rm(cache, { recursive: true, force: true });
	}
});
