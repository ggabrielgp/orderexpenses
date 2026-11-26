import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
	configFile: false,
	envFile: false,
	appType: "custom",
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const client = await vite.ssrLoadModule("/src/client/api/client.ts");
const toastModule = await vite.ssrLoadModule("/src/client/components/feedback/SuccessToast.tsx");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const period = { startDate: "2026-01-01", endDateExclusive: "2026-02-01" };
const nextPeriod = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };

function mockFetch(t, respond) {
	const original = globalThis.fetch;
	const calls = [];
	let inFlight = 0;
	let maxInFlight = 0;
	globalThis.fetch = async (path) => {
		calls.push(String(path));
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise((resolve) => setTimeout(resolve, 5));
		inFlight -= 1;
		const body = respond(String(path));
		return { ok: true, status: 200, json: async () => structuredClone(body) };
	};
	t.after(() => { globalThis.fetch = original; });
	return { calls, get maxInFlight() { return maxInFlight; } };
}

const transactionsFor = (p) => ({ transactions: [{ id: `tx-${p.startDate}`, amount: 100 }], warning: null });

test("a refresh with the visible period requests the cycle and its movements together (S3)", async (t) => {
	const cycle = { selectedPeriod: period, incomeAmount: 1000 };
	const fetches = mockFetch(t, (path) => (path.startsWith("/api/financial-cycle") ? cycle : transactionsFor(period)));
	const data = await client.loadFinancialDashboardData(undefined, period);
	assert.equal(fetches.calls.length, 2);
	assert.equal(fetches.maxInFlight, 2, "both requests are in flight at the same time");
	assert.deepEqual(data, { cycle, transactions: [{ id: "tx-2026-01-01", amount: 100 }], warning: null });
});

test("a refresh whose stored period changed re-reads the movements of the new period (S3)", async (t) => {
	const cycle = { selectedPeriod: nextPeriod, incomeAmount: 1000 };
	const fetches = mockFetch(t, (path) => {
		if (path.startsWith("/api/financial-cycle")) return cycle;
		return transactionsFor(path.includes("2026-02-01&") || path.includes("startDate=2026-02-01") ? nextPeriod : period);
	});
	const data = await client.loadFinancialDashboardData(undefined, period);
	assert.equal(fetches.calls.length, 3);
	assert.match(fetches.calls[2], /startDate=2026-02-01/);
	assert.deepEqual(data.transactions, [{ id: "tx-2026-02-01", amount: 100 }]);
});

test("without a period hint the load stays cycle-first and sequential (existing behavior)", async (t) => {
	const cycle = { selectedPeriod: period, incomeAmount: 1000 };
	const fetches = mockFetch(t, (path) => (path.startsWith("/api/financial-cycle") ? cycle : transactionsFor(period)));
	await client.loadFinancialDashboardData(undefined);
	assert.equal(fetches.calls.length, 2);
	assert.equal(fetches.maxInFlight, 1);
	assert.match(fetches.calls[0], /^\/api\/financial-cycle/);
});

test("the success toast renders as a manual popover so it shows above open dialogs (S1, S2)", () => {
	const html = renderToStaticMarkup(
		createElement(toastModule.SuccessToast, { toast: { id: 1, message: "Regla guardada" }, onDismiss() {} }),
	);
	assert.match(html, /popover="manual"/);
	assert.match(html, /class="react-success-toast-message">Regla guardada</);
});

test("useSuccessToast is a no-op without a provider and the provider renders no toast until asked", () => {
	let captured = null;
	const Probe = () => { captured = toastModule.useSuccessToast(); return null; };
	renderToStaticMarkup(createElement(Probe));
	assert.equal(typeof captured, "function");
	assert.doesNotThrow(() => captured("x"));
	const html = renderToStaticMarkup(createElement(toastModule.SuccessToastProvider, null, createElement("p", null, "app")));
	assert.equal(html, "<p>app</p>");
});

test("the toast popover resets the UA popover box so the app stays visible behind the check (S2)", async () => {
	const css = await read("src/client/components/feedback/success-toast.css");
	assert.match(css, /\.react-success-toast\[popover\]\s*\{[^}]*background:\s*transparent/);
	assert.match(css, /\.react-success-toast\[popover\]\s*\{[^}]*border:\s*0/);
	assert.match(css, /\.react-success-toast\[popover\]::backdrop\s*\{[^}]*display:\s*none/);
});

test("every save confirms with the check and success banners no longer duplicate it (S1, S5)", async () => {
	const page = await read("src/client/pages/DashboardPage.tsx");
	for (const label of ["Gasto guardado", "Cambios guardados", "Movimiento eliminado", "Período actualizado", "Categoría asignada", "Cambio deshecho"]) {
		assert.match(page, new RegExp(`showSuccessToast\\("${label}"\\)`), label);
	}
	assert.match(page, /showSuccessToast\("Gasto guardado"\);\s*else setCreationNotice\(notice\)/);
	assert.match(page, /showSuccessToast\("Período actualizado"\);\s*else setCycleEditNotice\(notice\)/);
	assert.match(page, /showSuccessToast\(actualBalance === null \? "Saldo real borrado" : "Saldo real guardado"\)/);
	assert.match(page, /<SuccessToastProvider>/);

	const categories = await read("src/client/components/settings/CategorySettingsDialog.tsx");
	assert.match(categories, /showSuccessToast\(CATEGORY_SAVED_MESSAGE\)/);
	assert.match(categories, /showSuccessToast\(CATEGORY_DELETED_MESSAGE\)/);
	const rules = await read("src/client/components/settings/CounterpartyRulesDialog.tsx");
	assert.match(rules, /showSuccessToast\(outcome\.status === "cleared" \? "Regla eliminada" : "Regla guardada"\)/);
	const gmail = await read("src/client/components/gmail/GmailConnectionPanel.tsx");
	assert.match(gmail, /showSuccessToast\("Gmail desconectado"\)/);
	assert.match(gmail, /showSuccessToast\("Gmail sincronizado"\)/);
});

test("saves reload in the background and removals close at once (S3, S4)", async () => {
	const page = await read("src/client/pages/DashboardPage.tsx");
	for (const factory of ["createManualExpenseSubmitter", "createMovementEditSubmitter", "createMovementRemovalSubmitter", "createBulkCategorySubmitter"]) {
		assert.match(page, new RegExp(`${factory}\\(\\{[\\s\\S]{0,200}?reload: reloadInBackground`), factory);
	}
	assert.match(page, /reload: financialDashboard\?\.reloadInBackground \?\? null/);
	// The period edit keeps the foreground reload: a new period must not show old numbers under the check.
	assert.match(page, /createCycleEditSubmitter\(\{[\s\S]{0,300}?reload: reloadFinancialDashboard/);
	assert.match(page, /else if \(dashboardStale\.current\) setStaleAfterSave\(true\)/);
	assert.match(page, /\{ label: "Reintentar", onClick: retryStaleReload \}/);
	assert.match(page, /reduceRemovalDismissal\(\s*reduceRemovalState\(current, \{\s*type: "succeeded"/);
	assert.match(page, /\.filter\(isVisibleRow\)/);
});
