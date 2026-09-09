import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function dashboardFunctions(context, names) {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	const functions = names
		.map((name) => {
			const asyncStart = source.indexOf(`async function ${name}(`);
			const start =
				asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
			assert.notEqual(start, -1);
			const rest = source.slice(start);
			const end = rest.slice(1).search(/\n(?:async )?function /);
			return end < 0 ? rest : rest.slice(0, end + 1);
		})
		.join("\n");
	return vm.runInNewContext(`${functions}\n({${names.join(",")}})`, context);
}

test("session error survives a view switch and retry resumes startup", async () => {
	const state = { dashboardReady: false, view: "dashboard" };
	const region = () => ({
		children: [],
		style: {},
		replaceChildren() {
			this.children = [];
		},
		append(node) {
			this.children.push(node);
		},
	});
	const dashboardEl = region();
	const transactionsEl = region();
	let calls = 0;
	let started = false;
	const api = await dashboardFunctions(
		{
			state,
			dashboardEl,
			transactionsEl,
			DEMO_MODE: false,
			fetch: async () => ({
				ok: ++calls > 1,
				json: async () => ({ authenticated: false }),
			}),
			renderViewToggle() {},
			createEmptyState: (_message, _copy, options) => options,
			prefersReducedMotion: () => true,
			render() {
				dashboardEl.replaceChildren();
				transactionsEl.replaceChildren();
			},
		},
		["loadDashboardSession", "showTableMessage", "setView"],
	);
	const startup = api.loadDashboardSession().then(() => {
		state.dashboardReady = true;
		started = true;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(started, false);
	api.setView("table");
	assert.equal(
		state.view,
		"dashboard",
		"view switching must not discard the retry region",
	);
	assert.equal(typeof dashboardEl.children[0]?.onAction, "function");
	dashboardEl.children[0].onAction();
	await startup;
	assert.equal(started, true);
	assert.equal(calls, 2);
	api.setView("table");
	assert.equal(state.view, "table", "normal switching resumes after startup");
});

test("unknown session stays pending on errors and retries before allowing startup", async () => {
	let release;
	let retry;
	let settled = false;
	let calls = 0;
	const api = await dashboardFunctions(
		{
			DEMO_MODE: false,
			fetch: async () => {
				calls++;
				if (calls === 1)
					return new Promise((resolve) => {
						release = resolve;
					});
				return { ok: true, json: async () => ({ authenticated: false }) };
			},
			showTableMessage: (_message, options) => {
				retry = options?.onAction;
			},
		},
		["loadDashboardSession"],
	);
	const pending = api.loadDashboardSession().then((value) => {
		settled = true;
		return value;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(settled, false);
	release({ ok: false });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		settled,
		false,
		"failed profile must not release dashboard startup",
	);
	assert.equal(typeof retry, "function");
	retry();
	assert.equal((await pending).authenticated, false);
	assert.equal(calls, 2);
});

test("network and malformed session failures retry; demo never requests a profile", async () => {
	for (const failure of [
		async () => {
			throw new Error("offline");
		},
		async () => ({ ok: true, json: async () => ({}) }),
	]) {
		let retry;
		let calls = 0;
		let settled = false;
		const api = await dashboardFunctions(
			{
				DEMO_MODE: false,
				fetch: async () =>
					++calls === 1
						? failure()
						: { ok: true, json: async () => ({ authenticated: true }) },
				showTableMessage: (_message, options) => {
					retry = options?.onAction;
				},
			},
			["loadDashboardSession"],
		);
		const pending = api.loadDashboardSession().then((value) => {
			settled = true;
			return value;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(settled, false);
		retry();
		assert.equal((await pending).authenticated, true);
	}
	const demo = await dashboardFunctions(
		{ DEMO_MODE: true, fetch: () => assert.fail("demo profile request") },
		["loadDashboardSession"],
	);
	assert.equal(await demo.loadDashboardSession(), null);
});

test("early refresh, month, and data entry points do no work before confirmation", async () => {
	const names = [
		"loadTransactions",
		"changeSelectedMonth",
		"loadGmailStatus",
		"loadCategories",
		"loadIncomeCandidates",
		"syncGmail",
		"autoSyncAfterGmailConnect",
		"refreshDashboardAfterFinancialCycle",
	];
	const state = { dashboardReady: false, selectedMonth: "2026-09" };
	const api = await dashboardFunctions({ state }, names);
	for (const name of names) await api[name]();
	assert.equal(state.selectedMonth, "2026-09");
});
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

	set value(value) {
		this.inputValue = String(value);
	}
	get value() {
		return this.inputValue ?? "";
	}
	ownerDocument = { createElement: () => new FakeElement() };
	append(...nodes) {
		this.children.push(...nodes);
	}
	replaceChildren(...nodes) {
		this.children = nodes;
	}
	querySelector() {
		return null;
	}
	setAttribute(name, value) {
		this.attributes.set(name, value);
	}
	getAttribute(name) {
		return this.attributes.get(name) ?? null;
	}
	focus() {
		this.focused = true;
	}
	contains(target) {
		return target === this || this.children.includes(target);
	}
	click() {
		this.dispatchEvent(new Event("click", { bubbles: true }));
	}
}

function createWizardDialog() {
	const elements = Object.fromEntries(
		[
			"heading",
			"form",
			"start",
			"end",
			"income-input",
			"error",
			"status",
			"cancel",
			"save",
			"retry",
			"calendar",
		].map((name) => [name, new FakeElement()]),
	);
	const dialog = new FakeElement();
	dialog.querySelector = (selector) => {
		const match = /data-wizard-([\w-]+)/.exec(selector);
		return match ? elements[match[1]] : null;
	};
	dialog.querySelectorAll = () => [];
	dialog.showModal = () => {
		dialog.open = true;
	};
	dialog.close = () => {
		dialog.open = false;
		dialog.dispatchEvent(new Event("close"));
	};
	return { dialog, elements };
}

function keydown(target, key) {
	const event = new Event("keydown", { bubbles: true });
	Object.defineProperty(event, "key", { value: key });
	target.dispatchEvent(event);
}

test("calendar marks the local month range, today and selectable future days", async () => {
	const { dialog, elements } = createWizardDialog();
	const wizard = mountFinancialCycleWizard({
		dialog,
		reopen: new FakeElement(),
		demo: true,
		now: new Date(2026, 8, 9, 12),
	});
	await wizard.ready;
	const days = elements.calendar.children[1].children.filter((day) =>
		day.getAttribute("data-date"),
	);
	assert.equal(
		days.filter((day) => day.getAttribute("aria-pressed") === "true").length,
		30,
	);
	assert.equal(days[8].getAttribute("aria-current"), "date");
	assert.equal(days[8].getAttribute("data-date"), "2026-09-09");
	assert.equal(
		days.filter((day) => day.getAttribute("class").includes("is-future")).length,
		21,
	);
	assert.ok(days.every((day) => !day.disabled));
});

test("calendar selection spans months and saves inclusive boundaries", async () => {
	const { dialog, elements } = createWizardDialog();
	const wizard = mountFinancialCycleWizard({
		dialog,
		reopen: new FakeElement(),
		demo: true,
		now: new Date(2026, 11, 9),
	});
	await wizard.ready;
	function select(dataset) {
		const event = new Event("click");
		Object.defineProperty(event, "target", {
			value: { closest: () => ({ dataset }) },
		});
		elements.calendar.dispatchEvent(event);
	}
	select({ date: "2026-12-30" });
	select({ month: "1" });
	select({ date: "2027-01-03" });
	assert.equal(elements.start.value, "2026-12-30");
	assert.equal(elements.end.value, "2027-01-03");
	elements.form.dispatchEvent(new Event("submit", { cancelable: true }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(wizard.controller.state.period, {
		startDate: "2026-12-30",
		endDateExclusive: "2027-01-04",
	});
});

test("failed reads block saving and retry hydrates without a write", async () => {
	let reads = 0;
	let resumed = 0;
	const { dialog, elements } = createWizardDialog();
	const wizard = mountFinancialCycleWizard({
		dialog,
		reopen: new FakeElement(),
		onSaved: () => resumed++,
		fetcher: async (_url, options) => {
			assert.equal(options.method, "GET");
			reads++;
			return {
				ok: reads > 1,
				json: async () => ({
					selectedPeriod: {
						startDate: "2026-09-01",
						endDateExclusive: "2026-10-01",
					},
				}),
			};
		},
	});
	await wizard.ready;
	assert.equal(wizard.incomplete, true);
	assert.equal(elements.save.disabled, true);
	assert.equal(elements.retry.hidden, false);
	elements.retry.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(wizard.incomplete, false);
	assert.equal(dialog.open, false);
	assert.equal(resumed, 1);
});

test("native profile keyboard activation produces one account-menu toggle and retains escape/outside behavior", () => {
	const trigger = new FakeElement();
	const menu = new FakeElement();
	const settings = new FakeElement();
	const documentRoot = new FakeElement();
	trigger.hidden = false;
	bindNativeAccountMenu({
		trigger,
		menu,
		firstMenuItem: settings,
		documentRoot,
	});

	for (const key of ["Enter", " "]) {
		keydown(trigger, key);
		assert.equal(
			menu.hidden,
			true,
			`${key} keydown must defer activation to the native click`,
		);
		trigger.click();
		assert.deepEqual(
			{
				open: !menu.hidden,
				expanded: trigger.getAttribute("aria-expanded"),
				focused: settings.focused,
			},
			{ open: true, expanded: "true", focused: true },
		);
		keydown(trigger, "Escape");
		assert.deepEqual(
			{ open: !menu.hidden, expanded: trigger.getAttribute("aria-expanded") },
			{ open: false, expanded: "false" },
		);
	}

	trigger.click();
	documentRoot.dispatchEvent(new Event("click"));
	assert.equal(
		menu.hidden,
		true,
		"outside click must close an open account menu",
	);
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
	const wizard = mountFinancialCycleWizard({
		dialog,
		reopen,
		demo: true,
		onSaved: initialize,
		now: new Date(2028, 1, 15),
	});
	await wizard.ready;
	assert.deepEqual(
		{
			open: dialog.open,
			start: elements.start.value,
			end: elements.end.value,
			cancelHidden: elements.cancel.hidden,
		},
		{ open: true, start: "2028-02-01", end: "2028-02-29", cancelHidden: true },
	);
	elements.form.dispatchEvent(new Event("submit", { cancelable: true }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(dialog.open, false);
	assert.equal(reopen.focused, true);
	assert.deepEqual(calls, ["gmail", "categories", "transactions", "sync"]);
});

test("configured reopen hydrates values and Cancel closes without saving", async () => {
	let saves = 0;
	const settings = {
		selectedPeriod: { startDate: "2028-02-01", endDateExclusive: "2028-03-01" },
		incomeAmount: 750000,
	};
	const fetcher = async (_url, options = {}) => {
		if (options.method === "PUT") saves += 1;
		return { ok: true, json: async () => settings };
	};
	const { dialog, elements } = createWizardDialog();
	const reopen = new FakeElement();
	const wizard = mountFinancialCycleWizard({ dialog, reopen, fetcher });
	assert.equal(await wizard.ready, false);
	reopen.click();
	assert.deepEqual(
		{
			open: dialog.open,
			start: elements.start.value,
			end: elements.end.value,
			income: elements["income-input"].value,
			cancelHidden: elements.cancel.hidden,
		},
		{
			open: true,
			start: "2028-02-01",
			end: "2028-02-29",
			income: "750000",
			cancelHidden: false,
		},
	);
	elements.cancel.click();
	assert.equal(dialog.open, false);
	assert.equal(saves, 0);
	assert.equal(reopen.focused, true);
});
