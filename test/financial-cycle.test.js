import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	createAuthenticatedAdapter,
	createDemoAdapter,
	createWizardController,
	focusHeading,
	restoreFocus,
	trapFocus,
	wizardReducer,
} from "../public/financial-cycle.js";
import { renderLandingSession } from "../public/index.js";

const period = { startDate: "2028-02-29", endDateExclusive: "2028-03-01" };

test("landing visibly renders the authenticated profile while anonymous entry is unchanged", () => {
	const label = { textContent: "Acceder con Google" };
	const action = { href: "/auth/google", setAttribute() {}, querySelector: () => label };
	const identity = { hidden: true, textContent: "" };
	renderLandingSession(action, identity, { authenticated: true, profile: { name: "Ada Lovelace", email: "ada@example.com" } });
	assert.deepEqual({ href: action.href, label: label.textContent, identity: identity.textContent, hidden: identity.hidden }, { href: "/app", label: "Ir al dashboard", identity: "Ada Lovelace", hidden: false });
	const anonymousLabel = { textContent: "Acceder con Google" };
	const anonymousAction = { href: "/auth/google", setAttribute() { throw new Error("anonymous CTA must not change"); }, querySelector: () => anonymousLabel };
	const anonymousIdentity = { hidden: true, textContent: "" };
	renderLandingSession(anonymousAction, anonymousIdentity, { authenticated: false });
	assert.deepEqual({ href: anonymousAction.href, label: anonymousLabel.textContent, identity: anonymousIdentity.textContent, hidden: anonymousIdentity.hidden }, { href: "/auth/google", label: "Acceder con Google", identity: "", hidden: true });
});

test("authenticated bootstrap loads settings before opening only incomplete selected periods", async () => {
	const adapter = { load: async () => ({ selectedPeriod: period, incomeAmount: 900000, completedAt: "2028-03-02" }) };
	const controller = createWizardController({ adapter });
	assert.equal(await controller.bootstrap(), true);
	assert.deepEqual(controller.state.period, period);
	assert.equal(controller.state.incomeAmount, 900000);
	assert.equal(controller.state.completed, true);
	controller.dispatch({ type: "OPEN" });
	assert.equal(controller.state.step, 1);
	const incomplete = createWizardController({ adapter: { load: async () => ({ selectedPeriod: period, completedAt: null }) } });
	assert.equal(await incomplete.bootstrap(), false);
});

test("major income accepts only positive whole CLP pesos or skip", () => {
	for (const value of ["12.5", "0", "-1", "pesos"]) {
		let state = wizardReducer(undefined, { type: "SET_INCOME", incomeAmount: value });
		state = wizardReducer(state, { type: "CONTINUE_INCOME" });
		assert.deepEqual({ step: state.step, field: state.errorField }, { step: 1, field: "incomeAmount" });
	}
	let state = wizardReducer(undefined, { type: "SET_INCOME", incomeAmount: "900000" });
	state = wizardReducer(state, { type: "CONTINUE_INCOME" });
	assert.equal(state.incomeAmount, 900000);
	assert.equal(wizardReducer(undefined, { type: "SKIP_INCOME" }).incomeAmount, null);
});

test("save failure or non-success is retryable and never invokes completion", async () => {
	let completes = 0;
	for (const save of [async () => ({ outcome: "error" }), async () => { throw new Error("offline"); }]) {
		const controller = createWizardController({ adapter: { save, complete: async () => { completes += 1; return { outcome: "success" }; } } });
		controller.dispatch({ type: "SET_DATES", startDate: "2028-02-29", endDate: "2028-02-29" }); controller.dispatch({ type: "NEXT" }); controller.dispatch({ type: "SKIP_INCOME" });
		await controller.sync();
		assert.deepEqual({ completes, outcome: controller.state.outcome, completed: controller.state.completed }, { completes: 0, outcome: "error", completed: false });
	}
});

test("wizard advances through period, optional income, and empty success", async () => {
	let state = wizardReducer(undefined, { type: "SET_DATES", startDate: "2028-02-29", endDate: "2028-02-29" });
	state = wizardReducer(state, { type: "NEXT" });
	assert.deepEqual(state.period, period);
	assert.equal(state.step, 2);
	state = wizardReducer(state, { type: "SKIP_INCOME" });
	assert.equal(state.step, 3);
	const controller = createWizardController({ adapter: createDemoAdapter() });
	controller.dispatch({ type: "SET_DATES", startDate: "2028-02-29", endDate: "2028-02-29" });
	controller.dispatch({ type: "NEXT" }); controller.dispatch({ type: "SKIP_INCOME" });
	await controller.sync();
	assert.equal(controller.state.outcome, "success");
	assert.equal(controller.state.transactions, 0);
	assert.equal(controller.state.progress, 100);
});

test("invalid period stays on step one and identifies the date field", () => {
	let state = wizardReducer(undefined, { type: "SET_DATES", startDate: "2028-03-02", endDate: "2028-03-01" });
	state = wizardReducer(state, { type: "NEXT" });
	assert.equal(state.step, 1);
	assert.equal(state.errorField, "endDate");
});

test("retry, disconnected, partial, and error outcomes remain on step three", async () => {
	const outcomes = ["disconnected", "partial", "error", "success"];
	const adapter = { save: async () => {}, complete: async () => ({ outcome: outcomes.shift(), transactions: 1 }) };
	const controller = createWizardController({ adapter });
	controller.dispatch({ type: "SET_DATES", startDate: "2028-02-29", endDate: "2028-02-29" }); controller.dispatch({ type: "NEXT" }); controller.dispatch({ type: "SKIP_INCOME" });
	for (const expected of ["disconnected", "partial", "error", "success"]) {
		await controller.sync();
		assert.equal(controller.state.outcome, expected);
		assert.equal(controller.state.step, 3);
	}
});

test("authenticated adapter uses the financial-cycle API while demo makes zero calls or writes", async () => {
	const calls = [];
	const authenticated = createAuthenticatedAdapter(async (url, options = {}) => {
		calls.push([url, options.method]);
		return { ok: true, json: async () => ({ outcome: "success", transactions: 2 }) };
	});
	await authenticated.save(period, 1000); await authenticated.complete(period);
	assert.deepEqual(calls, [["/api/financial-cycle", "PUT"], ["/api/financial-cycle/complete", "POST"]]);
	const demo = createDemoAdapter();
	assert.deepEqual(await demo.save(period, 1000), { selectedPeriod: period, incomeAmount: 1000 });
	assert.equal((await demo.complete(period)).outcome, "success");
});

test("focus helpers focus heading, trap tab, and restore the invoker", () => {
	let focused = ""; const heading = { focus: () => { focused = "heading"; } }; const invoker = { focus: () => { focused = "invoker"; } };
	focusHeading({ querySelector: () => heading }); restoreFocus(invoker);
	let prevented = false; const first = { focus: () => { focused = "first"; } }; const last = { focus: () => { focused = "last"; } };
	trapFocus({ key: "Tab", shiftKey: false, target: last, preventDefault: () => { prevented = true; } }, { querySelectorAll: () => [first, last] });
	assert.deepEqual({ focused, prevented }, { focused: "first", prevented: true });
});
