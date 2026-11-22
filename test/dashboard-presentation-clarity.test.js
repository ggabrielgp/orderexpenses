import assert from "node:assert/strict";
import { readFile, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const noop = () => {};
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const row = { id: null, counterparty: "Mercado", amount: 193840, date: "2026-02-02", category: "Comida", kind: "purchase" };
const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
const reason = "Edición deshabilitada en la demo";
let page, vite, cache;
test.before(async () => {
 cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "dashboard-clarity-"));
 vite = await createServer({ configFile: false, envFile: false, cacheDir: cache,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
 page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
});
test.after(async () => { await vite?.close(); await rmdir(cache); });

test("dashboard chart opts into mobile labels while default consumers retain full values", async () => {
 const { getSpendingChart } = await vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts");
 const chart = getSpendingChart([row], period, 0);
 const props = { chart, selectedTab: "period", selectedDayKey: "weekday-0", onSelectTab: noop, onSelectDay: noop, detailMovements: [{ id: null, label: "Mercado", kindLabel: "Compra", amount: 193840, dateKey: "2026-02-02", time: "" }] };
 const original = render(page.SpendingChartView, props);
 assert.doesNotMatch(original, /react-spending-chart-value-compact|Montos aproximados/);
 const html = render(page.SpendingChartView, { ...props, compactMobileLabels: true });
 assert.match(html, /react-spending-chart-value-compact[^>]*>\$194 mil</);
 assert.match(html, /Montos aproximados en CLP; valor exacto en el detalle/);
 assert.match(html, /aria-label="Ver detalle[^\"]*\$193\.840"/);
 assert.match(html, /title="[^\"]*\$193\.840"/);
 assert.match(html, /react-spending-chart-day-total">\$193\.840</);
});

test("period context is conditional and uses the shared inclusive formatter", () => {
 assert.equal(render(page.DashboardPeriodContext, { period: null }), "");
 assert.match(render(page.DashboardPeriodContext, { period }), /Período: 01\/02\/2026 a 28\/02\/2026/);
});

test("demo omits unavailable selection but retains browsing and honest explanations", async () => {
 const { createDemoDashboardData } = await vite.ssrLoadModule("/src/client/demo-data.ts");
 const fixture = JSON.parse(await read("public/demo-data.json"));
 const data = createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
 for (const view of ["summary", "movements"]) {
  const html = render(page.DemoDashboardView, { data, view, onViewChange: noop, onRequestedCategoryChange: noop });
  assert.match(html, /Datos de ejemplo · Solo lectura/);
  assert.ok(html.includes(`Período: ${page.formatPeriodLabel(data.period)}`));
  if (view === "movements") {
   assert.match(html, /Edición deshabilitada en la demo/);
   assert.doesNotMatch(html, /sin identificación|react-movements-bulk|type="checkbox"|>Editar<|>Eliminar</);
   for (const text of ["Buscar movimientos", "Ordenar por Monto", "Filtrar por tipo", ">Ver<"]) assert.ok(html.includes(text), text);
  }
 }
});

test("shared movement defaults keep invalid reasons, selection and editable actions", async () => {
 const filters = await vite.ssrLoadModule("/src/client/components/movements/movementFilters.ts");
 const props = { filteredView: filters.getMovementFilterView(filters.createMovementFilterSelection(period), period, [row]),
  sort: { key: "date", direction: "asc" }, editableMovements: [], onActivate: noop, onSelect: noop, onClear: noop, onEdit: noop, onRemove: noop,
  selection: { selectedIds: [], selectableIds: [], selectableCount: 0, selectedCount: 0 }, onToggleSelection: noop, onToggleAllSelection: noop };
 const html = render(page.MovementsTableView, props);
 assert.match(html, /Solo lectura: sin identificación o fecha válida/);
 assert.match(html, /Acciones sobre la selección/);
 const editable = { ...row, id: "real" };
 const active = render(page.MovementsTableView, { ...props, filteredView: { ...props.filteredView, rows: [editable] }, editableMovements: [editable] });
 assert.match(active, />Editar</); assert.match(active, />Eliminar</);
 const { ViewMovementDialog } = await vite.ssrLoadModule("/src/client/components/movements/ViewMovementDialog.tsx");
 const defaults = render(ViewMovementDialog, { movement: row, onClose: noop });
 assert.match(defaults, /Este movimiento no tiene identificación o fecha válida/);
 const demo = render(ViewMovementDialog, { movement: row, onClose: noop, readOnlyReason: reason });
 assert.match(demo, /Edición deshabilitada en la demo/);
 assert.doesNotMatch(demo, /no tiene identificación|>Editar<|>Eliminar</);
});

test("mobile compact typography cannot split digits and tabs keep touch height", async () => {
 const css = await read("src/client/styles.css");
 assert.match(css, /\.react-analytics-body \.react-spending-chart-value-compact\s*\{[^}]*overflow-wrap: normal;[^}]*word-break: normal/s);
 assert.match(css, /\.react-analytics-body \.react-spending-chart-tabs\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s);
 assert.match(css, /\.react-analytics-body \.react-spending-chart-tab\s*\{[^}]*min-height: 44px/s);
});
