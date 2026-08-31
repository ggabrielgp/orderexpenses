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
		["start", "end", "step", "progress", "error", "status", "period", "income", "sync", "retry", "connect", "close", "next", "income-next", "skip", "income-input", "sync-button"]
			.map((name) => [name, new FakeElement()]),
	);
	const dialog = new FakeElement();
	dialog.querySelector = (selector) => {
		const match = /data-wizard-([\w-]+)/.exec(selector);
		return match ? elements[match[1]] : null;
	};
	dialog.querySelectorAll = () => [];
	dialog.showModal = () => { dialog.open = true; };
	dialog.close = () => { dialog.open = false; };
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

test("first Step 3 completion initializes Gmail, categories, selected-period transactions, and sync exactly once in order", async () => {
	const calls = [];
	const initialize = createDeferredDashboardInitializer({
		loadGmailStatus: async () => calls.push("gmail"),
		loadCategories: async () => calls.push("categories"),
		loadTransactions: async () => calls.push("transactions"),
		autoSyncAfterGmailConnect: async () => calls.push("sync"),
	});

	const { dialog, elements } = createWizardDialog();
	const wizard = mountFinancialCycleWizard({
		dialog,
		reopen: new FakeElement(),
		demo: true,
		onCompleted: initialize,
	});
	await wizard.ready;
	elements.next.click();
	elements.skip.click();
	elements["sync-button"].click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.all([initialize(), initialize()]);
	assert.deepEqual(calls, ["gmail", "categories", "transactions", "sync"]);
});
