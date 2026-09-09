import assert from "node:assert/strict";
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
	const action = {
		href: "/auth/google",
		setAttribute() {},
		querySelector: () => label,
	};
	const identity = { hidden: true, textContent: "" };
	renderLandingSession(action, identity, {
		authenticated: true,
		profile: { name: "Ada Lovelace", email: "ada@example.com" },
	});
	assert.deepEqual(
		{
			href: action.href,
			label: label.textContent,
			identity: identity.textContent,
			hidden: identity.hidden,
		},
		{
			href: "/app",
			label: "Ir al dashboard",
			identity: "Ada Lovelace",
			hidden: false,
		},
	);
});

test("failed settings reads are not first-time configuration and can retry", async () => {
	let failed = true;
	const controller = createWizardController({
		adapter: {
			load: async () =>
				failed ? { outcome: "error" } : { selectedPeriod: period },
		},
	});
	await controller.bootstrap();
	assert.equal(controller.state.outcome, "load-error");
	assert.equal(controller.state.configured, false);
	failed = false;
	assert.equal(await controller.bootstrap(), true);
});

test("first setup exposes the current local calendar month as editable visible defaults", () => {
	const controller = createWizardController({
		adapter: createDemoAdapter(),
		now: new Date(2028, 1, 15, 12),
	});
	assert.deepEqual(
		{ startDate: controller.state.startDate, endDate: controller.state.endDate },
		{ startDate: "2028-02-01", endDate: "2028-02-29" },
	);
});

test("bootstrap hydrates saved settings and converts the exclusive end to the visible inclusive date", async () => {
	const controller = createWizardController({
		adapter: {
			load: async () => ({ selectedPeriod: period, incomeAmount: 900000 }),
		},
	});
	assert.equal(await controller.bootstrap(), true);
	assert.deepEqual(
		{
			startDate: controller.state.startDate,
			endDate: controller.state.endDate,
			incomeAmount: controller.state.incomeAmount,
			configured: controller.state.configured,
		},
		{
			startDate: "2028-02-29",
			endDate: "2028-02-29",
			incomeAmount: 900000,
			configured: true,
		},
	);
});

test("one save persists period and blank income without invoking completion or synchronization", async () => {
	const calls = [];
	const controller = createWizardController({
		adapter: {
			load: async () => null,
			save: async (...args) => {
				calls.push(args);
				return { selectedPeriod: args[0], incomeAmount: args[1] };
			},
			complete: async () => {
				throw new Error("must not complete or sync");
			},
		},
	});
	await controller.save({
		startDate: "2028-02-29",
		endDate: "2028-02-29",
		incomeAmount: "",
	});
	assert.deepEqual(calls, [[period, null]]);
	assert.deepEqual(
		{
			period: controller.state.period,
			incomeAmount: controller.state.incomeAmount,
			configured: controller.state.configured,
			outcome: controller.state.outcome,
		},
		{ period, incomeAmount: null, configured: true, outcome: "success" },
	);
});

test("income must be a positive whole CLP amount when provided", () => {
	for (const value of ["12.5", "0", "-1", "pesos"]) {
		let state = wizardReducer(undefined, {
			type: "SET_FORM",
			startDate: "2028-02-29",
			endDate: "2028-02-29",
			incomeAmount: value,
		});
		state = wizardReducer(state, { type: "VALIDATE" });
		assert.equal(state.errorField, "incomeAmount");
	}
	let state = wizardReducer(undefined, {
		type: "SET_FORM",
		startDate: "2028-02-29",
		endDate: "2028-02-29",
		incomeAmount: "900000",
	});
	state = wizardReducer(state, { type: "VALIDATE" });
	assert.equal(state.incomeAmount, 900000);
	assert.deepEqual(state.period, period);
});

test("invalid periods identify the date field", () => {
	let state = wizardReducer(undefined, {
		type: "SET_FORM",
		startDate: "2028-03-02",
		endDate: "2028-03-01",
		incomeAmount: "",
	});
	state = wizardReducer(state, { type: "VALIDATE" });
	assert.equal(state.errorField, "endDate");
});

test("duplicate save submissions share one in-flight settings request", async () => {
	let release;
	let saves = 0;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const controller = createWizardController({
		adapter: {
			save: async () => {
				saves += 1;
				await pending;
				return {};
			},
		},
	});
	const input = {
		startDate: "2028-02-29",
		endDate: "2028-02-29",
		incomeAmount: "",
	};
	const first = controller.save(input);
	const second = controller.save(input);
	assert.equal(saves, 1);
	assert.equal(controller.state.saving, true);
	release();
	await Promise.all([first, second]);
	assert.equal(saves, 1);
	assert.equal(controller.state.saving, false);
});

test("save failures leave first setup blocking and retryable", async () => {
	const controller = createWizardController({
		adapter: { save: async () => ({ outcome: "error" }) },
	});
	await controller.save({
		startDate: "2028-02-29",
		endDate: "2028-02-29",
		incomeAmount: "",
	});
	assert.equal(controller.state.configured, false);
	assert.equal(controller.state.outcome, "error");
	assert.equal(controller.state.saving, false);
});

test("authenticated adapter only uses the financial-cycle settings endpoint while demo performs no write", async () => {
	const calls = [];
	const authenticated = createAuthenticatedAdapter(async (url, options = {}) => {
		calls.push([url, options.method]);
		return {
			ok: true,
			json: async () => ({ selectedPeriod: period, incomeAmount: null }),
		};
	});
	await authenticated.load();
	await authenticated.save(period, null);
	assert.deepEqual(calls, [
		["/api/financial-cycle", "GET"],
		["/api/financial-cycle", "PUT"],
	]);
	assert.deepEqual(await createDemoAdapter().save(period, null), {
		selectedPeriod: period,
		incomeAmount: null,
	});
});

test("focus helpers focus heading, trap tab, and restore the invoker", () => {
	let focused = "";
	const heading = {
		focus: () => {
			focused = "heading";
		},
	};
	const invoker = {
		focus: () => {
			focused = "invoker";
		},
	};
	focusHeading({ querySelector: () => heading });
	assert.equal(focused, "heading");
	restoreFocus(invoker);
	let prevented = false;
	const first = {
		focus: () => {
			focused = "first";
		},
	};
	const last = {
		focus: () => {
			focused = "last";
		},
	};
	trapFocus(
		{
			key: "Tab",
			shiftKey: false,
			target: last,
			preventDefault: () => {
				prevented = true;
			},
		},
		{ querySelectorAll: () => [first, last] },
	);
	assert.deepEqual(
		{ focused, prevented },
		{ focused: "first", prevented: true },
	);
});
