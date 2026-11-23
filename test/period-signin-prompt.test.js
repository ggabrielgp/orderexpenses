import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Identity B S27 (odd/tasks/identidad-b.md, T29, L41-L42): after each sign-in (OAuth return on
// `/app?gmail=connected`) a configured period opens the edit-period dialog prefilled with the stored range
// and income; confirming saves exactly what is shown; "No volver a preguntar hasta que termine este
// período" skips the prompt until the period has ended. No server change (S10).
const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const prompt = await vite.ssrLoadModule("/src/client/components/financial-cycle/signInPeriodPrompt.ts");
const settings = await vite.ssrLoadModule("/src/client/components/financial-cycle/cycleSettings.ts");
const editDialog = await vite.ssrLoadModule("/src/client/components/financial-cycle/FinancialCycleEditDialog.tsx");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const cycle = {
	selectedPeriod: { startDate: "2026-11-01", endDateExclusive: "2026-12-01" },
	incomeAmount: 900000,
	completedAt: null,
};
/** In-memory `Storage` stand-in. */
const fakeStorage = (initial = {}) => {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, String(value)),
		removeItem: (key) => void data.delete(key),
	};
};
const throwingStorage = {
	getItem() { throw new Error("denied"); },
	setItem() { throw new Error("denied"); },
	removeItem() { throw new Error("denied"); },
};
const KEY = "gc:skip-period-prompt:ana@example.com";
const decide = (overrides = {}) => prompt.decideSignInPrompt({
	search: "?gmail=connected", status: "ready", email: "Ana@Example.com", storage: fakeStorage(), today: "2026-11-10", ...overrides,
});

test("marker + configured period opens the prompt; the marker is then handled", () => {
	assert.deepEqual(decide(), { handled: true, open: true });
});

test("marker + unconfigured keeps today's first-cycle setup: handled, no prompt", () => {
	assert.deepEqual(decide({ status: "unconfigured" }), { handled: true, open: false });
});

test("no marker never prompts and is not handled; other gmail values are not the marker", () => {
	assert.deepEqual(decide({ search: "" }), { handled: false, open: false });
	assert.deepEqual(decide({ search: "?view=movements" }), { handled: false, open: false });
	assert.deepEqual(decide({ search: "?gmail=other" }), { handled: false, open: false });
	assert.equal(prompt.hasSignInMarker("?x=1&gmail=connected"), true);
});

test("while the summary loads or failed the marker waits: nothing is handled yet", () => {
	assert.deepEqual(decide({ status: "loading" }), { handled: false, open: false });
	assert.deepEqual(decide({ status: "failed" }), { handled: false, open: false });
});

test("the marker is removed from the query and the other parameters are kept", () => {
	assert.equal(prompt.removeSignInMarker("?gmail=connected"), "");
	assert.equal(prompt.removeSignInMarker("?a=1&gmail=connected&b=2"), "?a=1&b=2");
	assert.equal(prompt.removeSignInMarker("?a=1"), "?a=1");
	assert.equal(prompt.removeSignInMarker(""), "");
});

test("clearSignInMarker rewrites the URL with replaceState, keeping path, params and hash", () => {
	const calls = [];
	const win = {
		location: { pathname: "/app", search: "?x=1&gmail=connected", hash: "#top" },
		history: { state: { k: 1 }, replaceState: (...args) => calls.push(args) },
	};
	assert.equal(prompt.clearSignInMarker(win), true);
	assert.deepEqual(calls, [[{ k: 1 }, "", "/app?x=1#top"]]);
	// Without the marker nothing is rewritten.
	calls.length = 0;
	win.location.search = "?x=1";
	assert.equal(prompt.clearSignInMarker(win), false);
	assert.deepEqual(calls, []);
	// A missing history is tolerated.
	assert.equal(prompt.clearSignInMarker({ location: { pathname: "/app", search: "?gmail=connected", hash: "" } }), false);
});

test("remembering the skip stores the period end under a key scoped to the signed-in account", () => {
	const storage = fakeStorage();
	assert.equal(prompt.skipPeriodPromptKey("Ana@Example.com "), KEY);
	assert.equal(prompt.rememberPeriodPromptSkip(storage, "Ana@Example.com", "2026-11-30"), true);
	assert.deepEqual([...storage.data], [[KEY, "2026-11-30"]]);
	// Another account does not inherit it.
	assert.equal(prompt.isPeriodPromptSkipped(storage, "bea@example.com", "2026-11-10"), false);
	// Without an account there is nothing to scope the preference to: nothing is stored.
	assert.equal(prompt.rememberPeriodPromptSkip(storage, "", "2026-11-30"), false);
	assert.equal(storage.data.size, 1);
	assert.equal(prompt.rememberPeriodPromptSkip(storage, "ana@example.com", "not a date"), false);
});

test("the skip is respected through the period's last day and the prompt returns after it, clearing the key", () => {
	const storage = fakeStorage({ [KEY]: "2026-11-30" });
	assert.deepEqual(decide({ storage, today: "2026-11-10" }), { handled: true, open: false });
	assert.deepEqual(decide({ storage, today: "2026-11-30" }), { handled: true, open: false });
	assert.equal(storage.data.get(KEY), "2026-11-30");
	assert.deepEqual(decide({ storage, today: "2026-12-01" }), { handled: true, open: true });
	assert.equal(storage.data.has(KEY), false);
});

test("a malformed stored value or failing storage means the prompt appears as normal", () => {
	const junk = fakeStorage({ [KEY]: "mañana" });
	assert.deepEqual(decide({ storage: junk }), { handled: true, open: true });
	assert.equal(junk.data.has(KEY), false);
	assert.deepEqual(decide({ storage: throwingStorage }), { handled: true, open: true });
	assert.deepEqual(decide({ storage: null }), { handled: true, open: true });
	assert.equal(prompt.rememberPeriodPromptSkip(throwingStorage, "ana@example.com", "2026-11-30"), false);
});

test("today is the calendar day in Santiago as YYYY-MM-DD", () => {
	assert.equal(prompt.todayIsoSantiago(new Date("2026-11-10T12:00:00Z")), "2026-11-10");
	// 02:00 UTC is still the previous evening in Chile (UTC-3 in summer).
	assert.equal(prompt.todayIsoSantiago(new Date("2026-11-10T02:00:00Z")), "2026-11-09");
});

const unchangedDraft = settings.createCycleEditDraft(cycle);

test("Continuar with nothing changed skips the PUT; any change goes through the existing submitter", async () => {
	const submitted = [];
	const submit = async (draft) => (submitted.push(draft), { status: "saved", reloadFailed: false });
	assert.deepEqual(await prompt.confirmSignInPeriod({ cycle, draft: { ...unchangedDraft }, submitCycle: submit }), { status: "unchanged" });
	assert.deepEqual(submitted, []);
	// A differently formatted but equal income is still "nothing changed".
	assert.deepEqual(await prompt.confirmSignInPeriod({ cycle, draft: { ...unchangedDraft, incomeValue: "900000" }, submitCycle: submit }), { status: "unchanged" });
	const changed = { ...unchangedDraft, incomeValue: "950.000" };
	assert.deepEqual(await prompt.confirmSignInPeriod({ cycle, draft: changed, submitCycle: submit }), { status: "saved", reloadFailed: false });
	assert.deepEqual(submitted, [changed]);
});

test("an emptied income saves no income with the same payload rules as the edit dialog", async () => {
	const puts = [];
	const submitter = settings.createCycleEditSubmitter({
		updateCycle: async (payload) => (puts.push(payload), { ...cycle, incomeAmount: payload.incomeAmount }),
		reload: async () => true,
		lock: { current: false },
	});
	const emptied = { ...unchangedDraft, incomeValue: "" };
	const outcome = await prompt.confirmSignInPeriod({ cycle, draft: emptied, submitCycle: submitter });
	assert.deepEqual(outcome, { status: "saved", reloadFailed: false });
	assert.equal(puts.length, 1);
	assert.deepEqual(puts[0], settings.validateCycleEditDraft(emptied).payload);
	assert.equal(puts[0].incomeAmount, null);
	assert.deepEqual(puts[0].selectedPeriod, { startDate: "2026-11-01", endDateExclusive: "2026-12-01" });
});

test("an invalid draft is refused by the existing validation and nothing is sent", async () => {
	const submitted = [];
	const outcome = await prompt.confirmSignInPeriod({
		cycle, draft: { ...unchangedDraft, incomeValue: "abc" },
		submitCycle: async (draft) => (submitted.push(draft), { status: "saved", reloadFailed: false }),
	});
	assert.deepEqual(outcome, { status: "failed", message: settings.CYCLE_INCOME_INVALID_MESSAGE });
	assert.deepEqual(submitted, []);
});

const renderEdit = (props = {}) => renderToStaticMarkup(createElement(editDialog.FinancialCycleEditDialog, {
	isOpen: true, cycle, onClose() {}, submitCycle: async () => ({ status: "saved", reloadFailed: false }), onSaved() {}, ...props,
}));

test("the sign-in dialog is the edit-period dialog prefilled, with sign-in copy and the skip checkbox", () => {
	const html = renderEdit({ signIn: true, onSignInConfirmed() {} });
	assert.ok(html.includes("¿Seguimos con este período?"));
	assert.doesNotMatch(html, /Cambiar período/);
	assert.match(html, /<button type="submit"[^>]*>Continuar<\/button>/);
	assert.match(html, /<button[^>]*type="button"[^>]*>Cerrar<\/button>/);
	assert.doesNotMatch(html, />Cancelar<|Guardar cambios/);
	assert.match(html, /<label[^>]*class="cycle-skip"[^>]*>[\s\S]*<input[^>]*type="checkbox"[^>]*>[\s\S]*<span>No volver a preguntar hasta que termine este período<\/span>/);
	assert.doesNotMatch(html.match(/<input[^>]*type="checkbox"[^>]*>/)[0], /checked/);
	// Prefilled with the stored income (and the stored range through the shared draft and summary).
	assert.match(html, /id="financial-cycle-income"[^>]*value="900\.000"|value="900\.000"[^>]*id="financial-cycle-income"/);
	assert.match(html, /Tu período: <b>/);
	assert.match(html, /1.30 nov · 30 días/);
});

test("the regular edit dialog keeps its title, actions and no skip checkbox", () => {
	const html = renderEdit();
	assert.ok(html.includes("Cambiar período"));
	assert.match(html, /<button type="submit"[^>]*>Guardar cambios<\/button>/);
	assert.ok(html.includes(">Cancelar<"));
	assert.doesNotMatch(html, /¿Seguimos con este período\?|cycle-skip|No volver a preguntar|type="checkbox"/);
});

test("the summary wires the prompt to the OAuth return only: the marker is cleared, the skip stored, the demo untouched", async () => {
	const source = await read("src/client/pages/DashboardPage.tsx");
	const summary = source.slice(source.indexOf("function FinancialSummary("), source.indexOf("function browserStorage"));
	assert.match(summary, /decideSignInPrompt\(/);
	assert.match(summary, /clearSignInMarker\(/);
	assert.match(summary, /rememberPeriodPromptSkip\(/);
	assert.match(summary, /signIn=\{cycleEditMode === "signIn"\}/);
	// The first load after the OAuth return reads the server, not a tab cache left from an earlier session.
	assert.match(summary, /signInPending\.current/);
	// The read-only demo never mounts the summary or the prompt.
	const demo = await read("src/client/components/demo/DemoDashboardPage.tsx");
	assert.ok(demo.length > 1000);
	assert.doesNotMatch(demo, /decideSignInPrompt|signInPeriodPrompt|FinancialCycleEditDialog|clearSignInMarker/);
});

test("the sign-in dialog's skip checkbox is styled in ink with a wrapping label", async () => {
	const css = await read("src/client/components/financial-cycle/cycle-setup.css");
	assert.match(css, /\.cycle-skip\b/);
	const rules = css.slice(css.indexOf(".cycle-skip"));
	assert.match(rules, /accent-color:\s*var\(--color-ink/);
	assert.match(rules, /overflow-wrap:\s*anywhere/);
	assert.match(rules, /min-height:\s*44px/);
});

test("the sign-in marker comes from the server's OAuth return and the server is untouched", async () => {
	assert.match(await read("src/server.js"), /\/app\?gmail=connected/);
});
