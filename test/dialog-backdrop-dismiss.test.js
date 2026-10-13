import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/client/components/dialog/nativeBackdropDismiss.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { registerNativeBackdropDismiss } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

class Pointer extends Event {
	constructor(type, options = {}) {
		super(type, { cancelable: true, bubbles: true });
		Object.assign(this, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10, detail: 1 }, options);
	}
}
class Dialog extends EventTarget {
	open = true;
	cancels = 0;
	closes = 0;
	requests = 0;
	ownerState = "open";
	returnValue = "unchanged";
	ownerDocument = { defaultView: { HTMLDialogElement: Dialog, PointerEvent: Pointer, Event } };
	constructor({ native = false, blocked = false } = {}) {
		super();
		this.addEventListener("cancel", (event) => {
			this.cancels++;
			if (blocked) event.preventDefault();
		});
		this.addEventListener("close", () => { this.ownerState = "closed"; });
		if (native) this.requestClose = () => {
			this.requests++;
			if (this.dispatchEvent(new Event("cancel", { cancelable: true }))) this.close();
		};
	}
	getBoundingClientRect() { return { left: 100, right: 300, top: 100, bottom: 300 }; }
	close() { this.open = false; this.closes++; this.dispatchEvent(new Event("close")); }
	showModal() { this.open = true; this.ownerState = "open"; }
}
const fire = (dialog, type, options) => dialog.dispatchEvent(new Pointer(type, options));
function click(dialog, down = {}, up = down, activation = up) {
	fire(dialog, "pointerdown", down);
	fire(dialog, "pointerup", up);
	fire(dialog, "click", activation);
}
const counts = (dialog) => [dialog.cancels, dialog.closes, dialog.requests];

test("outside click uses native requestClose or realm cancel fallback and updates only close owner", () => {
	for (const native of [true, false]) {
		const dialog = new Dialog({ native });
		registerNativeBackdropDismiss(dialog);
		click(dialog, {}, {}, { isPrimary: false });
		assert.deepEqual(counts(dialog), [1, 1, Number(native)]);
		assert.equal(dialog.ownerState, "closed");
		assert.equal(dialog.returnValue, "unchanged");
	}
});

test("existing cancellation veto preserves open state and operation counters", () => {
	for (const native of [true, false]) {
		const dialog = new Dialog({ native, blocked: true });
		let submissions = 0;
		dialog.addEventListener("submit", () => submissions++);
		registerNativeBackdropDismiss(dialog);
		click(dialog);
		assert.deepEqual(counts(dialog), [1, 0, Number(native)]);
		assert.equal(dialog.open, true);
		assert.equal(dialog.ownerState, "open");
		assert.equal(submissions, 0);
		assert.equal(dialog.returnValue, "unchanged");
	}
});

test("content, padding, edge and drags are not backdrop activation", () => {
	const inside = { clientX: 150, clientY: 150 };
	for (const [down, up] of [[inside, inside], [inside, {}], [{}, inside],
		[{ clientX: 100, clientY: 100 }, {}], [{}, { clientX: 50, clientY: 10 }]]) {
		const dialog = new Dialog();
		registerNativeBackdropDismiss(dialog);
		click(dialog, down, up);
		assert.deepEqual(counts(dialog), [0, 0, 0]);
	}
	const dialog = new Dialog();
	registerNativeBackdropDismiss(dialog);
	fire(dialog, "pointerdown");
	fire(dialog, "pointermove", { clientX: 200, clientY: 200 });
	fire(dialog, "pointerup");
	fire(dialog, "click");
	assert.deepEqual(counts(dialog), [0, 0, 0]);
});

test("mismatched, cancelled, secondary and nonprimary gestures are ignored", () => {
	for (const [down, up, activation] of [[{}, { pointerId: 2 }, {}], [{}, {}, { pointerId: 2 }],
		[{ button: 2 }, { button: 2 }, { button: 2 }],
		[{ isPrimary: false }, { isPrimary: false }, { isPrimary: false }],
		[{}, { isPrimary: false }, {}]]) {
		const dialog = new Dialog();
		registerNativeBackdropDismiss(dialog);
		click(dialog, down, up, activation);
		assert.deepEqual(counts(dialog), [0, 0, 0]);
	}
	const dialog = new Dialog();
	registerNativeBackdropDismiss(dialog);
	fire(dialog, "pointerdown");
	fire(dialog, "pointercancel");
	fire(dialog, "pointerup");
	fire(dialog, "click");
	assert.deepEqual(counts(dialog), [0, 0, 0]);
});

test("child-target events never dismiss the parent, even when coordinates are outside", () => {
	const parent = new Dialog();
	const child = new Dialog();
	registerNativeBackdropDismiss(parent);
	for (const type of ["pointerdown", "pointerup", "click"]) {
		const event = new Pointer(type);
		// EventTarget has no DOM tree: explicitly retain the originating child on forwarding.
		Object.defineProperty(event, "target", { value: child });
		parent.dispatchEvent(event);
	}
	assert.deepEqual(counts(parent), [0, 0, 0]);
	fire(parent, "pointerdown");
	const childRelease = new Pointer("pointerup");
	Object.defineProperty(childRelease, "target", { value: child });
	parent.dispatchEvent(childRelease);
	fire(parent, "click");
	assert.deepEqual(counts(parent), [0, 0, 0]);
});

test("registration is element-scoped and idempotent across reopening; stale gestures reset", () => {
	const dialog = new Dialog();
	registerNativeBackdropDismiss(dialog);
	registerNativeBackdropDismiss(dialog);
	for (const reset of ["cancel", "close"]) {
		fire(dialog, "pointerdown");
		fire(dialog, "pointerup");
		dialog.dispatchEvent(new Event(reset, { cancelable: true }));
		fire(dialog, "click");
		assert.equal(dialog.closes, 0);
	}
	dialog.cancels = 0;
	click(dialog);
	dialog.showModal();
	registerNativeBackdropDismiss(dialog);
	click(dialog);
	assert.deepEqual(counts(dialog), [2, 2, 0]);
});

test("keyboard and programmatic activation stay browser-owned; minimal stubs are untouched", () => {
	const dialog = new Dialog();
	registerNativeBackdropDismiss(dialog);
	fire(dialog, "click");
	fire(dialog, "pointerdown");
	fire(dialog, "pointerup");
	fire(dialog, "click", { detail: 0 });
	dialog.dispatchEvent(new Event("keydown"));
	assert.deepEqual(counts(dialog), [0, 0, 0]);
	dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
	assert.deepEqual(counts(dialog), [1, 0, 0]);
	const stub = { open: false, showModal() {}, close() {} };
	assert.doesNotThrow(() => registerNativeBackdropDismiss(stub));
	assert.deepEqual(Object.keys(stub), ["open", "showModal", "close"]);
});

test("shared modal sync registers the element without changing lifecycle or form handlers", async () => {
	const shared = await readFile(new URL("../src/client/components/movements/CreateManualExpenseDialog.tsx", import.meta.url), "utf8");
	const sync = shared.slice(shared.indexOf("export function syncNativeModalDialog"), shared.indexOf("export interface CreateManualExpenseDialogProps"));
	assert.match(sync, /registerNativeBackdropDismiss\(dialog\)/);
	assert.match(sync, /if \(!dialog\.open\) dialog\.showModal\(\)/);
	assert.match(sync, /if \(dialog\.open\) dialog\.close\(\)/);
});

test("registration requires owning native pointer and geometry APIs", () => {
	for (const missing of ["PointerEvent", "geometry"]) {
		const dialog = new Dialog();
		if (missing === "PointerEvent") delete dialog.ownerDocument.defaultView.PointerEvent;
		else dialog.getBoundingClientRect = undefined;
		registerNativeBackdropDismiss(dialog);
		click(dialog);
		assert.deepEqual(counts(dialog), [0, 0, 0]);
	}
});

test("input polish is scoped, token-based, responsive and preserves reduced-motion focus feedback", async () => {
	const css = await readFile(new URL("../src/client/dialog-polish.css", import.meta.url), "utf8");
	for (const type of ["checkbox", "radio", "file", "color", "range", "hidden"]) {
		assert.ok(css.includes(`:not([type="${type}"])`));
	}
	assert.match(css, /\.react-financial-setup-dialog, \.react-financial-cycle-setup/);
	assert.match(css, /:focus-visible[\s\S]*outline: 2px solid var\(--primary\)/);
	assert.match(css, /aria-invalid/);
	assert.match(css, /:disabled/);
	assert.match(css, /\[readonly\]/);
	assert.match(css, /@media \(max-width: 640px\)/);
	assert.match(css, /prefers-reduced-motion: reduce[\s\S]*transition: none/);
	assert.doesNotMatch(css, /outline:\s*(?:none|0)|animation:|appearance:/);
});
