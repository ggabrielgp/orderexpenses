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
const rule = await vite.ssrLoadModule("/src/client/components/movements/recategorizeRule.ts");
const dialog = await vite.ssrLoadModule("/src/client/components/movements/EditMovementDialog.tsx");
const { FeedbackNotice } = await vite.ssrLoadModule("/src/client/components/feedback/FeedbackNotice.tsx");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { readFile } = await import("node:fs/promises");

const target = { id: "tx-1", month: "2026-11", isManual: false };

test("the always-use option is offered only for a real category change on a named counterparty", () => {
	assert.equal(rule.getAlwaysUseLabel({ originalCategory: "Comida", category: "Transporte", counterparty: "  Uber  " }), "Usar siempre para Uber");
	assert.equal(rule.getAlwaysUseLabel({ originalCategory: null, category: "Comida", counterparty: "Líder" }), "Usar siempre para Líder");
	assert.equal(rule.getAlwaysUseLabel({ originalCategory: "Comida", category: "Comida", counterparty: "Uber" }), null);
	assert.equal(rule.getAlwaysUseLabel({ originalCategory: "Comida", category: "", counterparty: "Uber" }), null);
	assert.equal(rule.getAlwaysUseLabel({ originalCategory: "Comida", category: "Transporte", counterparty: "   " }), null);
});

test("saving the rule snapshots the previous rule and stores the new one under the server key", async () => {
	const calls = [];
	const deps = {
		getRules: async () => [{ counterpartyKey: "uber", displayName: "UBER", category: "Comida" }],
		upsertRule: async (body) => { calls.push(body); return { outcome: "saved", rule: body }; },
	};
	const previous = await rule.saveAlwaysUseRule(deps, { counterparty: "  Úber  ", category: "Transporte" });
	assert.deepEqual(calls, [{ counterpartyKey: "uber", displayName: "Úber", category: "Transporte" }]);
	assert.deepEqual(previous, { counterpartyKey: "uber", displayName: "UBER", category: "Comida" });
});

test("without a previous rule the snapshot clears the rule on undo", async () => {
	const deps = { getRules: async () => [], upsertRule: async () => ({ outcome: "saved" }) };
	const previous = await rule.saveAlwaysUseRule(deps, { counterparty: "Líder", category: "Supermercado" });
	assert.deepEqual(previous, { counterpartyKey: "lider", displayName: "Líder", category: "" });
});

test("saving fails before writing when the rules cannot be read", async () => {
	let wrote = false;
	const deps = { getRules: async () => { throw new Error("offline"); }, upsertRule: async () => { wrote = true; } };
	await assert.rejects(rule.saveAlwaysUseRule(deps, { counterparty: "Uber", category: "Transporte" }), /offline/);
	assert.equal(wrote, false);
});

test("undo restores the previous rule state first, then the previous category, then reloads", async () => {
	const calls = [];
	const deps = {
		upsertRule: async (body) => { calls.push(["rule", body]); },
		updateMovement: async (t, payload) => { calls.push(["patch", t, payload]); },
		reload: async () => { calls.push(["reload"]); return true; },
	};
	const undo = {
		target,
		payload: { amount: 1000, kind: "purchase", direction: "outflow", category: "Transporte", counterparty: "Uber", description: null, status: "edited" },
		previousCategory: "Comida",
		previousRule: { counterpartyKey: "uber", displayName: "Uber", category: "" },
	};
	assert.deepEqual(await rule.undoRecategorize(deps, undo), { reloadFailed: false });
	assert.deepEqual(calls, [
		["rule", { counterpartyKey: "uber", displayName: "Uber", category: "" }],
		["patch", target, { ...undo.payload, category: "Comida" }],
		["reload"],
	]);
});

test("undo without a rule only restores the category; a failed reload is reported, a failed write rejects", async () => {
	const calls = [];
	const undo = { target, payload: { category: "Transporte" }, previousCategory: null, previousRule: null };
	const result = await rule.undoRecategorize({
		upsertRule: async () => calls.push("rule"),
		updateMovement: async (_t, payload) => calls.push(payload),
		reload: async () => false,
	}, undo);
	assert.deepEqual(result, { reloadFailed: true });
	assert.deepEqual(calls, [{ category: null }]);
	await assert.rejects(rule.undoRecategorize({
		upsertRule: async () => {},
		updateMovement: async () => { throw new Error("500"); },
		reload: async () => true,
	}, undo), /500/);
});

test("the saved notice names the rule and offers undo; failures say what was kept", () => {
	assert.deepEqual(rule.getRecategorizeNotice({ reloadFailed: false, ruleOutcome: "saved", counterparty: "Uber", category: "Transporte" }), {
		tone: "success",
		message: "Movimiento guardado. Desde ahora, Uber va siempre a Transporte.",
	});
	assert.deepEqual(rule.getRecategorizeNotice({ reloadFailed: false, ruleOutcome: "failed", counterparty: "Uber", category: "Transporte" }), {
		tone: "warning",
		message: "El movimiento se guardó, pero no se pudo guardar la regla para Uber. Puedes crearla en Configuración.",
	});
	assert.equal(rule.getRecategorizeNotice({ reloadFailed: false, ruleOutcome: "none", counterparty: "Uber", category: "Transporte" }).message, "El movimiento se guardó correctamente.");
	assert.equal(rule.getRecategorizeNotice({ reloadFailed: true, ruleOutcome: "saved", counterparty: "Uber", category: "Transporte" }).tone, "warning");
	assert.deepEqual(rule.getUndoNotice({ status: "done", reloadFailed: false }), { tone: "success", message: "Cambio deshecho." });
	assert.equal(rule.getUndoNotice({ status: "done", reloadFailed: true }).tone, "warning");
	assert.deepEqual(rule.getUndoNotice({ status: "failed" }), { tone: "warning", message: "No se pudo deshacer el cambio. Intenta de nuevo." });
});

const period = { startDate: "2026-11-01", endDate: "2026-11-30" };

test("the edit submitter saves the requested rule after the PATCH and before the reload", async () => {
	const calls = [];
	const submit = dialog.createMovementEditSubmitter({
		period,
		updateMovement: async () => calls.push("patch"),
		reload: async () => { calls.push("reload"); return true; },
		saveRule: async (input) => { calls.push(["rule", input]); return { counterpartyKey: "uber", displayName: "Uber", category: "" }; },
	});
	const outcome = await submit(target, { category: "Transporte" }, { alwaysUse: { counterparty: "Uber", category: "Transporte" } });
	assert.deepEqual(calls, ["patch", ["rule", { counterparty: "Uber", category: "Transporte" }], "reload"]);
	assert.deepEqual(outcome, {
		status: "saved",
		reloadFailed: false,
		ruleOutcome: "saved",
		previousRule: { counterpartyKey: "uber", displayName: "Uber", category: "" },
	});
});

test("a failed rule keeps the saved movement, and no option keeps the previous outcome shape", async () => {
	const failing = dialog.createMovementEditSubmitter({
		period,
		updateMovement: async () => {},
		reload: async () => true,
		saveRule: async () => { throw new Error("500"); },
	});
	assert.deepEqual(await failing(target, {}, { alwaysUse: { counterparty: "Uber", category: "Transporte" } }), {
		status: "saved", reloadFailed: false, ruleOutcome: "failed", previousRule: null,
	});
	let ruleCalls = 0;
	const plain = dialog.createMovementEditSubmitter({
		period, updateMovement: async () => {}, reload: async () => true, saveRule: async () => { ruleCalls += 1; },
	});
	assert.deepEqual(await plain(target, {}), { status: "saved", reloadFailed: false });
	assert.equal(ruleCalls, 0);
	// A refused PATCH never saves a rule.
	const refused = dialog.createMovementEditSubmitter({
		period, updateMovement: async () => { throw new Error("boom"); }, reload: async () => true, saveRule: async () => { ruleCalls += 1; },
	});
	assert.equal((await refused(target, {}, { alwaysUse: { counterparty: "Uber", category: "X" } })).status, "failed");
	assert.equal(ruleCalls, 0);
});

test("the notice renders an inline undo action only when one is given", () => {
	const plain = renderToStaticMarkup(createElement(FeedbackNotice, { className: "n", tone: "success", message: "Listo" }));
	assert.doesNotMatch(plain, /<button/);
	const withAction = renderToStaticMarkup(createElement(FeedbackNotice, {
		className: "n", tone: "success", message: "Listo", action: { label: "Deshacer", onClick() {} },
	}));
	assert.match(withAction, /<button class="react-feedback-notice-action" type="button">Deshacer<\/button>/);
});

test("the dialog offers the checkbox and the dashboard wires rule saving and undo", async () => {
	const dialogSource = await readFile(new URL("../src/client/components/movements/EditMovementDialog.tsx", import.meta.url), "utf8");
	assert.match(dialogSource, /\{alwaysUseLabel !== null && \(/);
	assert.match(dialogSource, /id="edit-movement-always-use"\s*type="checkbox"/);
	const page = await readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8");
	assert.match(page, /saveRule: \(input\) =>\s*saveAlwaysUseRule\(\{ getRules: \(\) => getCounterpartyRules\(\), upsertRule: upsertCounterpartyRule \}, input\)/);
	assert.match(page, /label: isUndoingEdit \? "Deshaciendo\.\.\." : "Deshacer"/);
	assert.match(page, /setEditNotice\(\{ \.\.\.getUndoNotice\(\{ status: "failed" \}\), undo \}\);/);
});
