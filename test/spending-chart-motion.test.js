import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

// A deterministic commit/effect harness, not browser playback or layout proof.
function createHooks() {
	const slots = [];
	let cursor = 0;
	let pending = [];
	const hooks = {
		useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
		useState(value) {
			const i = cursor++;
			if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
			return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
		},
		useLayoutEffect(effect, deps) {
			const i = cursor++;
			const previous = slots[i];
			if (!deps || !previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) {
				pending.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
			}
		},
		render(run, attach) { cursor = 0; pending = []; const result = run(); attach?.(result); pending.forEach((effect) => effect()); return result; },
		unmount() { slots.forEach((slot) => { slot?.cleanup?.(); if (slot?.cleanup) slot.cleanup = undefined; }); },
	};
	hooks.useEffect = hooks.useLayoutEffect;
	return hooks;
}

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("spending chart animates measured replacements, unchanged-height summaries, rapid changes and live reduced motion", async () => {
	const vite = await createServer({
		configFile: false, envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false },
		plugins: [{
			name: "motion-effect-harness",
			resolveId(id) { if (id === "motion-test-react") return "\0motion-test-react"; },
			load(id) { if (id === "\0motion-test-react") return `let hooks; export const install = value => hooks = value;
				export const useRef = (...args) => hooks.useRef(...args);
				export const useState = (...args) => hooks.useState(...args);
				export const useEffect = (...args) => hooks.useEffect(...args);
				export const useLayoutEffect = (...args) => hooks.useLayoutEffect(...args);`; },
			transform(source, id) {
				if (/\/hooks\/use(?:SpendingChart|AutoHeight|SelectionIndicator)Motion\.ts$/.test(id.replaceAll("\\", "/"))) {
					return source.replace('from "react"', 'from "motion-test-react"');
				}
			},
		}],
	});
	const previousWindow = globalThis.window;
	const preference = new EventTarget();
	let listening = 0;
	const add = preference.addEventListener.bind(preference);
	const remove = preference.removeEventListener.bind(preference);
	preference.addEventListener = (...args) => { listening++; add(...args); };
	preference.removeEventListener = (...args) => { listening--; remove(...args); };
	preference.matches = false;
	globalThis.window = { matchMedia: () => preference };
	const hooks = createHooks();
	const elements = Object.fromEntries(["chartRef", "summaryRef", "dayRef"].map((key) => [key, {
		height: key === "dayRef" ? 110 : 260, calls: [], animations: [],
		getBoundingClientRect() { return { height: this.animations.at(-1)?.playState === "running" ? 175 : this.height }; },
		animate(frames, options) {
			this.calls.push({ frames, options });
			const animation = { playState: "running", cancelled: false, cancel() { this.cancelled = true; this.playState = "idle"; } };
			this.animations.push(animation);
			return animation;
		},
	}]));
	try {
		const harness = await vite.ssrLoadModule("motion-test-react");
		const { useSelectionIndicatorMotion } = await vite.ssrLoadModule("/src/client/hooks/useSelectionIndicatorMotion.ts");
		for (const selector of ['[aria-pressed="true"]', '[aria-current="true"]']) {
			const selectionHooks = createHooks();
			harness.install(selectionHooks);
			let target = { left: 20, top: 30, width: 90, height: 35 };
			let displayed = null;
			const calls = [];
			const indicator = {
				style: {},
				getBoundingClientRect: () => displayed ?? target,
				animate(frames, options) {
					const animation = { cancelled: false, cancel() { this.cancelled = true; } };
					calls.push({ frames, options, animation });
					return animation;
				},
			};
			const attributes = new Map();
			const container = {
				clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
				children: [],
				getBoundingClientRect: () => ({ left: 10, top: 10 }),
				querySelector(query) { assert.equal(query, selector); return { getBoundingClientRect: () => target }; },
				setAttribute: (key, value) => attributes.set(key, value),
				removeAttribute: (key) => attributes.delete(key),
			};
			const observers = [];
			const previousObserver = globalThis.ResizeObserver;
			globalThis.ResizeObserver = class {
				constructor(callback) { this.callback = callback; observers.push(this); }
				observe() {}
				disconnect() { this.disconnected = true; }
			};
			try {
				const renderSelection = (key, reduced = false) => selectionHooks.render(
					() => useSelectionIndicatorMotion(key, reduced, selector),
					(refs) => { refs.containerRef.current = container; refs.indicatorRef.current = indicator; },
				);
				renderSelection("period");
				assert.equal(calls.length, 0);
				assert.equal(indicator.style.left, "10px");
				target = { left: 130, top: 75, width: 120, height: 48 };
				renderSelection("week-1");
				assert.deepEqual(calls[0].frames, [
					{ left: "10px", top: "20px", width: "90px", height: "35px" },
					{ left: "120px", top: "65px", width: "120px", height: "48px" },
				]);
				displayed = { left: 65, top: 52, width: 105, height: 40 };
				target = { left: 15, top: 130, width: 80, height: 50 };
				renderSelection("week-2");
				assert.equal(calls[0].animation.cancelled, true);
				assert.deepEqual(calls[1].frames[0], { left: "55px", top: "42px", width: "105px", height: "40px" });
				displayed = null;
				target = { left: 18, top: 190, width: 160, height: 60 };
				observers.at(-1).callback();
				assert.equal(calls[1].animation.cancelled, true);
				assert.equal(indicator.style.top, "180px", "wrapping/resize snaps to fresh geometry");
				target = { left: 18, top: 260, width: 140, height: 55 };
				renderSelection("week-3");
				assert.equal(calls[2].frames[0].top, "180px");
				renderSelection("week-3", true);
				assert.equal(calls[2].animation.cancelled, true);
				renderSelection("period", true);
				assert.equal(calls.length, 3, "reduced motion never starts an animation");
				selectionHooks.unmount();
				assert.ok(observers.every((observer) => observer.disconnected));
				assert.equal(attributes.has("data-selection-motion"), false);
			} finally {
				selectionHooks.unmount();
				if (previousObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = previousObserver;
			}
		}
		harness.install(hooks);
		const { useSpendingChartMotion } = await vite.ssrLoadModule("/src/client/hooks/useSpendingChartMotion.ts");
		const render = (tab, day) => hooks.render(() => useSpendingChartMotion(tab, day), (refs) => {
			for (const key of Object.keys(elements)) refs[key].current = elements[key];
		});
		render("period", "mon");
		assert.ok(Object.values(elements).every((element) => element.calls.length === 0), "no initial animation");
		elements.dayRef.height = 310;
		render("week-1", "2026-02-02");
		assert.deepEqual(elements.dayRef.calls[0].frames, [{ height: "110px" }, { height: "310px" }]);
		for (const key of ["chartRef", "summaryRef"]) {
			assert.deepEqual(elements[key].calls[0].frames, [{ opacity: 0.85 }, { opacity: 1 }]);
			assert.deepEqual(elements[key].calls[0].options, { duration: 200, easing: "ease-out" });
		}
		// A rapid populated -> empty day switch starts at the currently displayed height.
		const interrupted = elements.dayRef.animations.at(-1);
		elements.dayRef.height = 110;
		render("week-1", "2026-02-03");
		assert.equal(interrupted.cancelled, true);
		assert.deepEqual(elements.dayRef.calls.at(-1).frames, [{ height: "175px" }, { height: "110px" }]);
		assert.equal(elements.summaryRef.calls.length, 1, "day selection does not flash the period summary");
		render("week-2", "2026-02-09");
		assert.equal(elements.summaryRef.animations[0].cancelled, true);
		assert.equal(elements.summaryRef.calls.length, 2, "same-height summary still transitions on tabs");
		const counts = Object.values(elements).map((element) => element.calls.length);
		preference.matches = true;
		preference.dispatchEvent(new Event("change"));
		render("week-2", "2026-02-09");
		assert.ok(Object.values(elements).every((element) => element.animations.every((animation) => animation.cancelled)));
		elements.dayRef.height = 310;
		render("period", "mon");
		assert.deepEqual(Object.values(elements).map((element) => element.calls.length), counts);
		preference.matches = false;
		preference.dispatchEvent(new Event("change"));
		render("period", "mon");
		render("week-1", "2026-02-02");
		hooks.unmount();
		assert.equal(listening, 0, "live preference listener is removed on unmount");
		assert.ok(Object.values(elements).every((element) => element.animations.every((animation) => animation.cancelled)));
	} finally {
		hooks.unmount();
		if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
		await vite.close();
	}
});

test("motion refs preserve populated/empty detail markup and tab/day/movement callbacks", async () => {
	const vite = await createServer({
		configFile: false, envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false },
	});
	try {
		const { SpendingChartView, getSpendingChartDetailMovements } = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
		const { getSpendingChart } = await vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts");
		const { createElement } = await import("react");
		const { renderToStaticMarkup } = await import("react-dom/server");
		const chart = getSpendingChart([{ id: "a", counterparty: "Mercado", amount: 1000, date: "2026-02-02", category: "Comida" }],
			{ startDate: "2026-02-01", endDateExclusive: "2026-03-01" }, 0);
		const detailMovements = getSpendingChartDetailMovements([{ id: "a", occurredAt: "2026-02-02", amount: 1000,
			direction: "outflow", kind: "purchase", counterparty: "Mercado", description: "" }]);
		const calls = [];
		const props = { chart, selectedTab: "week-1", selectedDayKey: "2026-02-02", detailMovements,
			onSelectTab: (key) => calls.push(["tab", key]), onSelectDay: (key) => calls.push(["day", key]),
			onOpenMovement: (key) => calls.push(["movement", key]) };
		const motion = { chartRef: { current: null }, summaryRef: { current: null }, dayRef: { current: null } };
		for (const day of ["2026-02-02", "2026-02-03", null]) {
			const selected = { ...props, selectedDayKey: day };
			const html = renderToStaticMarkup(createElement(SpendingChartView, { ...selected, motion }));
			assert.equal(html, renderToStaticMarkup(createElement(SpendingChartView, selected)));
			assert.ok(html.includes('aria-live="polite"') && html.includes('aria-controls="react-spending-chart-day-detail"'));
			if (day === "2026-02-02") assert.ok(html.includes("Mercado"));
			if (day === "2026-02-03") assert.ok(html.includes("No hay gastos con monto conocido para este día."));
			if (day === null) assert.ok(html.includes("Elige un día del gráfico"));
		}
		const walk = (node) => !node || typeof node !== "object" ? [] :
			[node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
		const nodes = walk(SpendingChartView({ ...props, motion }));
		nodes.find((node) => node.props?.className === "react-spending-chart-tab").props.onClick();
		nodes.find((node) => node.type === "button" && node.props?.["aria-controls"]).props.onClick();
		nodes.find((node) => node.props?.className === "react-spending-chart-day-open").props.onClick();
		assert.deepEqual(calls, [["tab", chart.tabs[0].id], ["day", "2026-02-02"], ["movement", "a"]]);
	} finally { await vite.close(); }
});

test("only the stateful panel supplies motion refs; direct view callers keep their native controls", async () => {
	const source = await read("src/client/components/analytics/SpendingChartPanel.tsx");
	const view = source.slice(source.indexOf("export function SpendingChartView("), source.indexOf("export interface SpendingChartPanelProps"));
	assert.doesNotMatch(view, /useSpendingChartMotion\(/);
	assert.match(view, /ref=\{motion\?\.chartRef\}/);
	assert.match(view, /motion\.summaryRef\.current = element/);
	assert.match(view, /motion\.summarySelection\.containerRef\.current = element/);
	assert.match(view, /motion\.tabsSelection\.containerRef\.current = element/);
	assert.match(view, /ref=\{motion\?\.dayRef\}/);
	assert.match(source, /useSpendingChartMotion\(selectedTab, selectedDayKey\)/);
	assert.match(source, /motion=\{motion\}/);
	assert.match(view, /aria-live="polite"/);
	assert.match(view, /aria-controls=\{detailId\}/);
	assert.match(view, /onClick=\{\(\) => onSelectTab\(tab.id\)\}/);
	assert.match(view, /onSelectDay\(day.key\)/);
	assert.match(view, /disabled=\{!day.isInPeriod\}/);
	assert.doesNotMatch(view, /key=\{selectedTab\}|key=\{selectedDayKey\}/);
});
