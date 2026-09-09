import assert from "node:assert/strict";
import test from "node:test";
import { bindNativeAccountMenu } from "../public/account-menu.js";
import { createDeferredDashboardInitializer } from "../public/dashboard-startup.js";
import { mountFinancialCycleWizard } from "../public/financial-cycle.js";

class FakeElement extends EventTarget {
	constructor() {
		super();
		this.hidden = true;
		this.attributes = new Map();
		this.children = [];
		this.focused = false;
		this.style = {};
		this.dataset = {};
	}

	setAttribute(name, value) { this.attributes.set(name, value); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	focus() { this.focused = true; }
	contains(target) { return target === this || this.children.includes(target); }
	click() { this.dispatchEvent(new Event("click", { bubbles: true })); }
}

function createWizardDialog() {
	const elements = Object.fromEntries(
		["heading", "form", "start", "end", "income-input", "error", "status", "cancel", "save"]
			.map((name) => [name, new FakeElement()]),
	);
	const dialog = new FakeElement();
	dialog.querySelector = (selector) => {
		const match = /data-wizard-([\w-]+)/.exec(selector);
		return match ? elements[match[1]] : null;
	};
	dialog.querySelectorAll = () => [];
	dialog.showModal = () => { dialog.open = true; };
	dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event("close")); };
	return { dialog, elements };
}

function keydown(target, key) {
	const event = new Event("keydown", { bubbles: true });
	Object.defineProperty(event, "key", { value: key });
	target.dispatchEvent(event);
}

test("native profile keyboard activation produces one account-menu toggle and retains escape/outside behavior", () => {
	const trigger = new FakeElement();
	const menu = new FakeElement();
	const settings = new FakeElement();
	const documentRoot = new FakeElement();
	trigger.hidden = false;
	bindNativeAccountMenu({ trigger, menu, firstMenuItem: settings, documentRoot });

	for (const key of ["Enter", " "]) {
		keydown(trigger, key);
		assert.equal(menu.hidden, true, `${key} keydown must defer activation to the native click`);
		trigger.click();
		assert.deepEqual(
			{ open: !menu.hidden, expanded: trigger.getAttribute("aria-expanded"), focused: settings.focused },
			{ open: true, expanded: "true", focused: true },
		);
		keydown(trigger, "Escape");
		assert.deepEqual({ open: !menu.hidden, expanded: trigger.getAttribute("aria-expanded") }, { open: false, expanded: "false" });
	}

	trigger.click();
	documentRoot.dispatchEvent(new Event("click"));
	assert.equal(menu.hidden, true, "outside click must close an open account menu");
});

test("one-form setup saves, closes, and initializes dashboard work once", async () => {
	const calls = [];
	const initialize = createDeferredDashboardInitializer({
		loadGmailStatus: async () => calls.push("gmail"),
		loadCategories: async () => calls.push("categories"),
		loadTransactions: async () => calls.push("transactions"),
		autoSyncAfterGmailConnect: async () => calls.push("sync"),
	});
	const { dialog, elements } = createWizardDialog();
	const reopen = new FakeElement();
	const wizard = mountFinancialCycleWizard({ dialog, reopen, demo: true, onSaved: initialize, now: new Date(2028, 1, 15) });
	await wizard.ready;
	assert.deepEqual({ open: dialog.open, start: elements.start.value, end: elements.end.value, cancelHidden: elements.cancel.hidden }, { open: true, start: "2028-02-01", end: "2028-02-29", cancelHidden: true });
	elements.form.dispatchEvent(new Event("submit", { cancelable: true }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(dialog.open, false);
	assert.equal(reopen.focused, true);
	assert.deepEqual(calls, ["gmail", "categories", "transactions", "sync"]);
});

test("configured reopen hydrates values and Cancel closes without saving", async () => {
	let saves = 0;
	const settings = { selectedPeriod: { startDate: "2028-02-01", endDateExclusive: "2028-03-01" }, incomeAmount: 750000 };
	const fetcher = async (_url, options = {}) => {
		if (options.method === "PUT") saves += 1;
		return { ok: true, json: async () => settings };
	};
	const { dialog, elements } = createWizardDialog();
	const reopen = new FakeElement();
	const wizard = mountFinancialCycleWizard({ dialog, reopen, fetcher });
	assert.equal(await wizard.ready, false);
	reopen.click();
	assert.deepEqual({ open: dialog.open, start: elements.start.value, end: elements.end.value, income: elements["income-input"].value, cancelHidden: elements.cancel.hidden }, { open: true, start: "2028-02-01", end: "2028-02-29", income: "750000", cancelHidden: false });
	elements.cancel.click();
	assert.equal(dialog.open, false);
	assert.equal(saves, 0);
	assert.equal(reopen.focused, true);
});
