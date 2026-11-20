import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

const walk = (node) => !node || typeof node !== "object" ? [] :
 [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
function hooks() {
 const slots = []; let cursor = 0, effects = [];
 const api = {
  useRef(value) { return slots[cursor++] ??= { current: value }; },
  useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
   return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
  useEffect(effect, deps) { const i = cursor++, old = slots[i];
   if (!deps || !old || deps.some((v, j) => !Object.is(v, old.deps?.[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  render(run, attach) { cursor = 0; effects = []; const tree = run(); attach?.(tree); effects.forEach((run) => run()); return tree; },
  unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
 }; api.useLayoutEffect = api.useEffect; return api;
}

test("mobile day activation opens detail only on demand, closes on tabs/resize, desktop keeps inline detail", async () => {
 const vite = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false }, plugins: [{ name: "mobile-hooks",
   resolveId(id) { if (id === "mobile-test-react") return "\0mobile-test-react"; },
   load(id) { if (id === "\0mobile-test-react") return `export * from 'react'; let hooks; export const install = h => hooks = h;
    export const useRef = (...a) => hooks.useRef(...a); export const useState = (...a) => hooks.useState(...a);
    export const useEffect = (...a) => hooks.useEffect(...a); export const useLayoutEffect = (...a) => hooks.useLayoutEffect(...a);`; },
   transform(source, id) { if (/\/(?:pages\/DashboardPage\.tsx|hooks\/use.*\.ts|components\/analytics\/SpendingDayDetailDialog\.tsx)$/.test(id.replaceAll("\\", "/"))) return source.replace(/from "react"/g, 'from "mobile-test-react"'); },
  }] });
 const previousWindow = globalThis.window;
 const mobile = new EventTarget(); mobile.matches = true;
 const reduced = new EventTarget(); reduced.matches = true;
 globalThis.window = { matchMedia: (query) => query === "(max-width: 640px)" ? mobile : reduced };
 const panelHooks = hooks(), dialogHooks = hooks();
 try {
  const harness = await vite.ssrLoadModule("mobile-test-react");
  const { SpendingChartPanel, SpendingChartView } = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
  const { SpendingDayDetailDialog } = await vite.ssrLoadModule("/src/client/components/analytics/SpendingDayDetailDialog.tsx");
  const { getSpendingChart } = await vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts");
  const chart = getSpendingChart([{ id: "a", counterparty: "Mercado", amount: 999999999999, date: "2026-02-02", category: "Comida" }], { startDate: "2026-02-01", endDateExclusive: "2026-03-01" }, 0);
  const calls = [];
  const props = { chart, detailMovements: [{ id: "a", label: "Mercado", kindLabel: "Compra", amount: 999999999999, dateKey: "2026-02-02", time: "" }], onOpenMovement: (id) => calls.push(id) };
  const native = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  let panel;
  const render = () => { harness.install(panelHooks); panel = panelHooks.render(() => SpendingChartPanel(props)); return panel; };
  const presentation = () => {
   const view = walk(panel).find((n) => n.type === SpendingChartView);
   const tree = SpendingChartView(view.props);
   const dialog = walk(tree).find((n) => n.type === SpendingDayDetailDialog);
   if (!dialog) return { view, tree };
   harness.install(dialogHooks);
   const markup = dialogHooks.render(() => SpendingDayDetailDialog(dialog.props), (n) => { n.props.ref.current = native; });
   return { view, tree, dialog, markup };
  };
  render(); let result = presentation();
  assert.ok(result.dialog, "mobile must replace inline detail with a native dialog");
  assert.equal(native.open, false, "default selected day must not open a modal");
  result.view.props.onSelectTab("week-1"); render(); result = presentation(); assert.equal(native.open, false);
  let focused = 0;
  const dayButton = walk(result.tree).find((n) => n.type === "button" && n.props["aria-controls"] && n.props["aria-label"].includes("lun"));
  assert.equal(dayButton.props["aria-haspopup"], "dialog");
  assert.ok(dayButton.props["aria-label"].replace(/\D/g, "").includes("999999999999"), "huge amount remains in the day accessible name");
  const dayButtons = walk(result.tree).filter((n) => n.type === "button" && n.props["aria-controls"]);
  assert.equal(dayButtons.length, 7, "compact presentation keeps every weekday control");
  const amount = walk(dayButton).find((n) => n.props?.className?.includes("react-spending-chart-value"));
  assert.ok(walk(amount).some((n) => n.props?.className === "react-spending-chart-value-full" && n.props.children.replace(/\D/g, "") === "999999999999"), "exact amount retained alongside mobile shorthand");
  dayButton.props.onClick({ currentTarget: { focus() { focused++; } } });
  assert.equal(focused, 1, "touch trigger receives focus before native showModal captures the return target");
  render(); result = presentation(); assert.equal(native.open, true);
  assert.ok(walk(result.markup).some((n) => n.props?.children === "Mercado"));
  assert.ok(walk(result.markup).some((n) => typeof n.props?.children === "string" && n.props.children.replace(/\D/g, "") === "999999999999"), "modal retains the full huge amount");
  props.onOpenMovement = (id) => { assert.equal(native.open, false, "day modal closes before movement handoff"); calls.push(id); };
  render(); result = presentation();
  walk(result.markup).find((n) => n.props?.className === "react-spending-chart-day-open").props.onClick();
  assert.deepEqual(calls, ["a"]); render(); result = presentation(); assert.equal(native.open, false);
  result.view.props.onSelectDay("2026-02-03"); render(); result = presentation();
  assert.equal(native.open, true);
  assert.ok(walk(result.markup).some((n) => n.props?.children === "No hay gastos con monto conocido para este día."));
  walk(result.markup).find((n) => n.type === "button" && n.props.children === "Cerrar").props.onClick();
  render(); result = presentation(); assert.equal(native.open, false);
  result.view.props.onSelectDay("2026-02-02"); render(); result = presentation();
  result.view.props.onSelectTab("period"); render(); result = presentation(); assert.equal(native.open, false);
  result.view.props.onSelectDay("weekday-0"); render(); presentation();
  mobile.matches = false; mobile.dispatchEvent(new Event("change")); render(); result = presentation();
  assert.equal(result.dialog, undefined); assert.equal(native.open, false);
  result.view.props.onSelectDay("weekday-1"); render(); result = presentation();
  assert.ok(walk(result.tree).some((n) => n.props?.className === "react-spending-chart-day-panel"), "desktop keeps inline day detail");
  mobile.matches = true; mobile.dispatchEvent(new Event("change")); render(); presentation(); render(); result = presentation();
  assert.equal(native.open, false, "returning to mobile must not reopen stale detail");
  result.view.props.onSelectDay("weekday-0"); render(); result = presentation();
  let prevented = false;
  result.markup.props.onCancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); render(); result = presentation(); assert.equal(native.open, false, "Escape closes native dialog and state");
  result.view.props.onSelectDay("weekday-0"); render(); result = presentation();
  native.open = false; result.markup.props.onClose(); render(); presentation(); assert.equal(native.open, false, "native backdrop close stays closed");
 } finally { panelHooks.unmount(); dialogHooks.unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; await vite.close(); }
});

test("mobile weekday geometry fits seven shrinkable columns instead of masking overflow", async () => {
 const css = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
 const compact = css.slice(css.indexOf("/* Mobile chart: seven visible days"));
 assert.ok(compact.startsWith("/* Mobile chart: seven visible days"));
 assert.match(compact, /@media \(max-width: 640px\)/);
 const rule = (selector) => compact.match(new RegExp(`${selector.replaceAll(".", "\\.")}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
 const bars = rule(".react-analytics-body .react-spending-chart-bars");
 assert.match(bars, /display: grid/);
 assert.match(bars, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
 assert.match(bars, /gap: 2px/);
 assert.match(bars, /padding: 12px 6px/);
 assert.match(bars, /overflow: visible/);
 const bar = rule(".react-analytics-body .react-spending-chart-bar");
 assert.match(bar, /min-width: 0/);
 assert.match(bar, /width: 100%/);
 assert.match(bar, /box-sizing: border-box/);
 assert.match(bar, /padding: 4px 0/);
 assert.match(compact, /\.react-analytics-body \.react-spending-chart-track\s*\{[^}]*width: 10px/);
 assert.match(compact, /\.react-analytics-body \.react-spending-chart-header::after\s*\{[^}]*content: none/);
 assert.doesNotMatch(compact, /overflow(?:-x)?: (?:hidden|clip)/);
 // Geometry budget only, not a browser layout assertion: shell/card borders and padding,
 // track gaps and button borders still leave a >=24px-wide day at each requested width.
 for (const viewport of [320, 390, 640]) {
  const shellGutter = viewport <= 480 ? 16 : 24;
  const content = viewport - shellGutter - 2 - 24 - 2 - 12;
  const column = (content - 6 * 2) / 7;
  assert.ok(column >= 24, `${viewport}px leaves a selectable column`);
  assert.ok(column - 2 >= 10, "thin track fits inside each button border");
 }
});

test("mobile compact labels and touch-sized tabs preserve desktop and preview rules", async () => {
 const css = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
 const compact = css.slice(css.indexOf("/* Mobile chart: seven visible days"));
 assert.ok(compact.startsWith("/* Mobile chart: seven visible days"));
 assert.match(compact, /\.react-analytics-body \.react-spending-chart-bar \.react-spending-chart-value\s*\{[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*transform: none/s);
 assert.match(compact, /grid-template-rows: minmax\(1\.6rem, auto\) 136px auto auto/);
 assert.match(compact, /\.react-analytics-body \.react-spending-chart-tab\s*\{[^}]*min-height: 44px;[^}]*max-width: 100%;[^}]*padding: 4px 7px;[^}]*font-size: \.75rem;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere/s);
 assert.match(compact, /\.react-analytics-body \.react-spending-chart-tabs\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*gap: 4px/s);
 assert.match(compact, /\.react-analytics-body \.react-spending-chart-bar > \*\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow-wrap: anywhere/s);
 // Preserve existing desktop sizing, angled values, and accessible focus outlines.
 const desktop = css.slice(0, css.indexOf("/* Mobile chart: seven visible days"));
 assert.match(desktop, /\.react-spending-chart-bar\s*\{[^}]*min-width: 70px/s);
 assert.match(desktop, /transform: rotate\(320deg\)/);
 for (const control of ["bar", "tab"]) assert.match(desktop, new RegExp(`\\.react-spending-chart-${control}:focus-visible\\s*\\{[^}]*outline: 3px solid var\\(--focus\\)`));
 assert.doesNotMatch(compact, /selection-indicator|dialog|transition|animation/);
});

test("mobile composition declares compact side-by-side balances, chart then categories, preserving budget below", async () => {
 const css = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
 const mobile = css.slice(css.indexOf("/* Mobile summary: balances"));
 assert.match(mobile, /@media \(max-width: 640px\)/);
 assert.match(mobile, /\.react-dashboard-lead\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
 for (const [name, order] of [["evolution", 2], ["categories", 3], ["breakdown", 5]]) assert.match(mobile, new RegExp(`\\.react-mobile-${name}\\s*\\{\\s*order: ${order}`));
 assert.match(mobile, /\.react-budget-panel\s*\{\s*order: 4/);
 assert.match(css, /\.react-spending-day-dialog\s*\{[^}]*max-height: calc\(100dvh - 24px\);[^}]*overflow-y: auto/s);
});
