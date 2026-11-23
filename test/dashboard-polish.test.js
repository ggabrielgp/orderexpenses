import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const withModules = async (run) => {
	const vite = await createServer({
		configFile: false, envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false },
	});
	try { await run(vite); } finally { await vite.close(); }
};

test("only a settled success receives a decorative check; every message stays readable", () => withModules(async (vite) => {
	const { FeedbackNotice } = await vite.ssrLoadModule("/src/client/components/feedback/FeedbackNotice.tsx");
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	for (const tone of ["success", "warning", "error", "pending"]) {
		const html = renderToStaticMarkup(createElement(FeedbackNotice, {
			tone, className: `notice-${tone}`, message: "Resultado real",
		}));
		assert.ok(html.includes("Resultado real"));
		assert.ok(html.includes('role="status"'));
		assert.equal(html.includes('class="react-success-check"'), tone === "success");
		if (tone === "success") assert.match(html, /aria-hidden="true"/);
	}
}));

test("setup dismissal calls its owner only while idle, including the same-tick ref lock", () => withModules(async (vite) => {
	const { requestFinancialSetupDismiss } = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	let dismissals = 0;
	for (const [locked, saving] of [[true, false], [false, true], [true, true]]) {
		assert.equal(requestFinancialSetupDismiss({ current: locked }, saving, () => dismissals++), false);
	}
	assert.equal(dismissals, 0);
	assert.equal(requestFinancialSetupDismiss({ current: false }, false, () => dismissals++), true);
	assert.equal(dismissals, 1);
}));

test("category continuity animates measured height only, and skips reduced motion or unchanged geometry", () => withModules(async (vite) => {
	const { animateAutoHeight } = await vite.ssrLoadModule("/src/client/hooks/useAutoHeightMotion.ts");
	const calls = [];
	const animation = { cancel() {} };
	const element = { animate(...args) { calls.push(args); return animation; } };
	assert.equal(animateAutoHeight(element, 120, 240, false), animation);
	assert.deepEqual(calls[0][0], [{ height: "120px" }, { height: "240px" }]);
	assert.equal(calls[0][1].duration, 200);
	assert.equal(animateAutoHeight(element, 240, 120, false), animation);
	assert.equal(animateAutoHeight(element, 120, 240, true), null);
	assert.equal(animateAutoHeight(element, 120, 120, false), null);
	assert.equal(animateAutoHeight(element, 0, 240, false), null);
	assert.equal(animateAutoHeight({}, 120, 240, false), null);
	assert.equal(animateAutoHeight(element, NaN, 240, false), null);
	assert.equal(animateAutoHeight(element, 120, Infinity, false), null);
	assert.equal(calls.length, 2);
}));

test("select-all remains a native input with immediate callbacks and imperative mixed state", () => withModules(async (vite) => {
	const { MovementsTableHeader } = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	let toggles = 0;
	const head = MovementsTableHeader({
		sort: { key: "date", direction: "asc" }, onActivate() {},
		selection: { headerChecked: false, indeterminate: true, selectableCount: 2 },
		onToggleAllSelection() { toggles++; },
	});
	const input = head.props.children.props.children[0].props.children;
	assert.equal(input.type, "input");
	assert.equal(input.props.type, "checkbox");
	assert.equal(input.props.checked, false);
	assert.equal(input.props["aria-checked"], "mixed");
	assert.equal(input.props.disabled, false);
	const node = { indeterminate: false };
	input.props.ref(node);
	assert.equal(node.indeterminate, true);
	input.props.onChange();
	assert.equal(toggles, 1);
}));

test("only selected rows gain a visual marker; unselected markup and the filtered rows stay unchanged", () => withModules(async (vite) => {
	const { MovementsTableView } = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	const filters = await vite.ssrLoadModule("/src/client/components/movements/movementFilters.ts");
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 1000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 2000, date: "2026-02-03", category: "Comida" },
	];
	const filteredView = filters.getMovementFilterView(filters.createMovementFilterSelection(period), period, rows);
	const noop = () => {};
	const html = renderToStaticMarkup(createElement(MovementsTableView, {
		filteredView, sort: { key: "date", direction: "asc" }, editableMovements: [],
		onActivate: noop, onSelect: noop, onClear: noop, onEdit: noop, onRemove: noop,
		onToggleSelection: noop,
		selection: { selectedIds: ["a"], selectedCount: 1, selectableCount: 2, headerChecked: false, indeterminate: true },
	}));
	const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
	assert.deepEqual([...body.matchAll(/<tr\b[^>]*>/g)].map((match) => match[0]), ['<tr data-selected="true">', "<tr>"]);
	assert.ok(body.includes("Mercado") && body.includes("Feria"));
	assert.doesNotMatch(body, /data-selected="false"/);
	assert.equal(filteredView.rows.length, 2);
	assert.deepEqual(filteredView.rows.map((row) => row.id), ["a", "b"]);
}));

// Structural/SSR safeguards below are not native browser or animation playback proof.
test("setup retains its mounted draft and synchronizes cancel/close with an explicit reopen control", async () => {
	const source = await read("src/client/components/financial-cycle/FinancialCycleSetupForm.tsx");
	const setup = source.slice(source.indexOf("function FinancialCycleSetupForm"));
	assert.match(setup, /\[isOpen, setIsOpen\] = useState\(true\)/);
	assert.match(setup, /syncNativeModalDialog\(dialogRef.current, isOpen\)/);
	assert.match(setup, /onCancel=\{[\s\S]*?event.preventDefault\(\)[\s\S]*?requestFinancialSetupDismiss/);
	assert.match(setup, /onClose=\{[\s\S]*?requestFinancialSetupDismiss[\s\S]*?syncNativeModalDialog\(dialogRef.current, true\)/);
	assert.match(setup, /!isOpen[\s\S]*?Configurar período/);
	assert.doesNotMatch(setup, /setIncomeValue\(""\)|setStartDate\(configuredPeriod.startDate\)/);
});

test("additive motion preserves menu hiding, native checkbox semantics and one detail entrance", async () => {
	const css = await read("src/client/dashboard-polish.css");
	const menu = await read("src/client/components/account/AccountMenuComponent.tsx");
	assert.match(menu, /hidden=\{!isOpen\}/);
	assert.match(css, /\.react-account-menu:not\(\[hidden\]\)/);
	assert.match(css, /transform-origin:\s*top right/);
	assert.match(css, /\.react-movement-select:checked/);
	assert.match(css, /\.react-movement-select:indeterminate/);
	assert.match(css, /\.react-movements-bulk\[data-selected="true"\]/);
	assert.match(css, /stroke-dashoffset:\s*0/);
	assert.doesNotMatch(css, /pointer-events|animation-delay|infinite|\.react-movements-table\s*\{/);
	const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /animation:\s*none\s*!important/);
	assert.match(reduced, /transition:\s*none\s*!important/);
	const category = await read("src/client/components/analytics/CategoryDistributionPanel.tsx");
	assert.match(category, /useAutoHeightMotion\(activeCategory, reducedMotion\)/);
	assert.match(category, /ref=\{legendMotionRef\}/);
	assert.match(category, /void import\("echarts"\)/);
	assert.match(category, /returnCategoryRef.current/);
});
