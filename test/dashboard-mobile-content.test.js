import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const withModules = async (run) => {
 const vite = await createServer({ configFile: false, envFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false } });
 try { await run(vite); } finally { await vite.close(); }
};
const nodes = (element) => {
 if (!element || typeof element !== "object") return [];
 return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
};

test("movement cards use the sorted filtered rows and original public callback objects", () => withModules(async (vite) => {
 const { MovementsTableView } = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
 const { createElement } = await import("react");
 const { renderToStaticMarkup } = await import("react-dom/server");
 const a = { id: "a", counterparty: "Café", amount: 2000, date: "2026-02-02", category: "Comida", kind: "purchase", description: "Compra con descripción larga <segura>" };
 const b = { ...a, id: "b", amount: 1000, date: "2026-02-03" };
 const readonly = { ...a, id: null, counterparty: "Sin identidad", amount: 3000 };
 const editA = { ...a, originalDate: "2026-02-02" }, editB = { ...b, originalDate: "2026-02-03" };
 const calls = [];
 const props = {
  filteredView: { rows: [a, readonly, b], activeCategory: "Comida", options: [{ value: "Comida", label: "Comida", count: 3 }], count: { category: "Comida", isActive: true, shown: 3, total: 4, message: "3 de 4 movimientos" } },
  periodMovements: [a, readonly, b, { ...a, id: "hidden", counterparty: "Oculto" }],
  sort: { key: "amount", direction: "asc" }, editableMovements: [editA, editB],
  search: "Café", kind: "purchase", pendingAmountCount: 1,
  selection: { selectableIds: ["a", "b"], selectedIds: ["a"], selectedCount: 1, selectableCount: 2, headerChecked: false, indeterminate: true, message: "1 de 2 movimientos seleccionados" },
  onActivate: (key) => calls.push(["sort", key]), onSelect: (category) => calls.push(["category", category]),
  onClear: () => calls.push(["clearCategory"]), onSearchChange: (value) => calls.push(["search", value]), onKindChange: (value) => calls.push(["kind", value]),
  onView: (row) => calls.push(["view", row]), onEdit: (row) => calls.push(["edit", row]), onRemove: (row) => calls.push(["remove", row]),
  onToggleSelection: (id) => calls.push(["toggle", id]), onToggleAllSelection: () => calls.push(["all"]),
  onSelectSimilar: (ids) => calls.push(["similar", ids]), onClearSelection: () => calls.push(["clearSelection"]),
  bulkCategoryOptions: [{ value: "Comida", label: "Comida" }], onBulkCategoryChange: (value) => calls.push(["bulk", value]), onAssignCategory: () => calls.push(["assign"]),
 };
 const tree = MovementsTableView(props);
 const projection = nodes(tree).find((node) => typeof node.type === "function" && node.type.name === "MobileMovementList");
 assert.ok(projection, "public view must mount the mobile card projection");
 const cards = projection.type(projection.props);
 const articles = nodes(cards).filter((node) => node.type === "article");
 assert.equal(articles.length, 3);
 assert.strictEqual(projection.props.rows[0], b);
 assert.strictEqual(projection.props.rows[1], a);
 assert.strictEqual(projection.props.rows[2], readonly);
 for (const [index, row, editable] of [[0, b, editB], [1, a, editA], [2, readonly, null]]) {
  const elements = nodes(articles[index]);
  const buttons = elements.filter((node) => node.type === "button");
  buttons.find((node) => node.props.children === "Ver").props.onClick();
  assert.strictEqual(calls.at(-1)[1], row);
  const checkbox = elements.find((node) => node.type === "input");
  if (editable) {
   for (const label of ["Editar", "Eliminar"]) {
    buttons.find((node) => node.props.children === label).props.onClick();
    assert.strictEqual(calls.at(-1)[1], editable);
   }
   checkbox.props.onChange(); assert.deepEqual(calls.at(-1), ["toggle", row.id]);
   assert.equal(checkbox.props.checked, row === a);
   buttons.find((node) => node.props.children === "2 similares").props.onClick();
   assert.deepEqual(calls.at(-1), ["similar", ["b", "a"]]);
  } else {
   assert.equal(checkbox.props.disabled, true);
   assert.ok(!buttons.some((node) => ["Editar", "Eliminar"].includes(node.props.children)));
  }
 }
 const all = nodes(cards).find((node) => node.type === "input" && node.props["aria-checked"] === "mixed");
 const native = { indeterminate: false }; all.props.ref(native);
 assert.equal(native.indeterminate, true); all.props.onChange(); assert.deepEqual(calls.at(-1), ["all"]);
 const disabled = projection.type({ ...projection.props, selection: { ...props.selection, selectableCount: 0, indeterminate: false, headerChecked: false } });
 assert.equal(nodes(disabled).find((node) => node.props?.className === "react-movements-select-all").props.disabled, true);
 const checked = projection.type({ ...projection.props, selection: { ...props.selection, indeterminate: false, headerChecked: true } });
 assert.equal(nodes(checked).find((node) => node.props?.className === "react-movements-select-all").props.checked, true);
 for (const label of ["Limpiar selección", "Asignar categoría"]) nodes(tree).find((node) => node.type === "button" && node.props.children === label).props.onClick();
 assert.deepEqual(calls.slice(-2), [["clearSelection"], ["assign"]]);
 nodes(tree).find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "Feria" } });
 assert.deepEqual(calls.at(-1), ["search", "Feria"]);
 nodes(tree).find((node) => node.type === "button" && node.props.children === "Transferencias").props.onClick();
 assert.deepEqual(calls.at(-1), ["kind", "transfer"]);
 nodes(tree).find((node) => node.type === "select" && node.props.value === "").props.onChange({ target: { value: "Comida" } });
 assert.deepEqual(calls.at(-1), ["bulk", "Comida"]);
 const busy = MovementsTableView({ ...props, isBulkAssigning: true });
 for (const label of ["Limpiar selección", "Asignando..."]) assert.equal(nodes(busy).find((node) => node.type === "button" && node.props.children === label).props.disabled, true);
 const html = renderToStaticMarkup(createElement(MovementsTableView, props));
 assert.match(html, /class="react-movements-secondary-filters" data-expanded="false"/);
 assert.match(html, /class="secondary react-movements-filter-toggle" aria-expanded="false"/);
 assert.match(html, /Búsqueda: Café/); assert.match(html, /Tipo: Compras/); assert.match(html, /Categoría: Comida/);
 assert.equal((html.match(/gastos reconocidos sin monto conocido/g) ?? []).length, 1);
 assert.match(html, /<table class="react-movements-table"/);
 assert.match(html, /Ordenar por Contraparte/); assert.match(html, /Ordenar por Monto/);
 assert.match(html, /Solo lectura/); assert.doesNotMatch(html, /id="/);
 assert.match(html, /react-mobile-movement-description">Compra con descripción larga &lt;segura&gt;/);
 const emptyHtml = renderToStaticMarkup(createElement(MovementsTableView, { ...props,
  filteredView: { ...props.filteredView, rows: [], activeCategory: "", count: { ...props.filteredView.count, isActive: false, category: "", message: null } },
  search: "", kind: "", selection: undefined,
 }));
 assert.doesNotMatch(emptyHtml, /react-movements-active-filters|Acciones sobre la selección|react-movement-select/);
 assert.equal((emptyHtml.match(/No hay movimientos que coincidan/g) ?? []).length, 2);
 const blankPeriodHtml = renderToStaticMarkup(createElement(MovementsTableView, { ...props,
  periodMovements: [], filteredView: { ...props.filteredView, rows: [] }, selection: undefined,
 }));
 // S18 (T18): a period with no recognized expenses shows one empty state (artboards 06/07) instead of the
 // duplicated table/list cell, and has nothing to filter or sort.
 assert.equal((blankPeriodHtml.match(/Aún no hay movimientos en este período/g) ?? []).length, 1);
 assert.doesNotMatch(blankPeriodHtml, /No hay gastos reconocidos disponibles|<table|react-mobile-movements/);
 const filter = nodes(tree).find((node) => node.type?.name === "MovementFilterBar");
 const filterNodes = nodes(filter.type(filter.props));
 filterNodes.find((node) => node.type === "select").props.onChange({ target: { value: "Comida" } });
 assert.deepEqual(calls.at(-1), ["category", "Comida"]);
 filterNodes.find((node) => node.type === "button").props.onClick(); assert.deepEqual(calls.at(-1), ["clearCategory"]);
 const header = nodes(tree).find((node) => node.type?.name === "MovementsTableHeader");
 nodes(header.type(header.props)).find((node) => node.type === "button").props.onClick(); assert.deepEqual(calls.at(-1), ["sort", "counterparty"]);
}));

test("mobile amounts preserve the same signed CLP representation as the desktop table", () => withModules(async (vite) => {
 const { MobileMovementList } = await vite.ssrLoadModule("/src/client/components/movements/MobileMovementList.tsx");
 const { createElement } = await import("react");
 const { renderToStaticMarkup } = await import("react-dom/server");
 const noop = () => {};
 const props = { rows: [], editableById: new Map(), emptyMessage: "Sin filas", sort: { key: "date", direction: "asc" }, onActivate: noop, onEdit: noop, onRemove: noop };
 for (const amount of [-1234, 1234, 0]) {
  const formatted = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.abs(amount));
  const expected = amount < 0 ? `-${formatted}` : formatted;
  const row = { id: null, counterparty: "Ejemplo", amount, date: "2026-02-02", category: "Comida" };
  const html = renderToStaticMarkup(createElement(MobileMovementList, { ...props, rows: [row] }));
  assert.match(html, new RegExp(`class="react-movement-amount">${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));
 }
}));

test("mobile amount and category wrapping explicitly overrides the inherited nowrap", async () => {
 const css = await read("src/client/dashboard-mobile-content.css");
 assert.match(css, /\.react-movements-view \.react-mobile-movement-card :is\(\.react-movement-amount, \.react-movement-category, \.react-movement-kind-badge\)\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere/s);
 assert.match(css, /\.react-mobile-movement-meta\s*\{[^}]*min-width: 0/s);
});

test("responsive layout has complementary projections and single analytics panels", async () => {
 const css = await read("src/client/dashboard-mobile-content.css");
 assert.match(css, /\.react-mobile-movements\s*\{\s*display:\s*none/);
 assert.match(css, /@media \(max-width: 760px\)/);
 assert.match(css, /\.react-movements-table-wrapper\s*\{\s*display:\s*none/);
 assert.match(css, /\.react-mobile-movements\s*\{\s*display:\s*grid/);
 assert.match(css, /\.react-movements-secondary-filters\[data-expanded="false"\] > \.react-movements-filter-controls\s*\{\s*display:\s*none/);
 for (const [name, order] of [["categories", 1], ["evolution", 2], ["breakdown", 3], ["counterparties", 4], ["insights", 5]]) {
  assert.match(css, new RegExp(`\\.react-mobile-${name}\\s*\\{\\s*order:\\s*${order}`));
 }
 const page = await read("src/client/pages/DashboardPage.tsx");
 const analyticsPanels = await read("src/client/components/analytics/DashboardAnalyticsPanels.tsx");
 assert.match(page, /<AccountMenu profile=\{profile\} gmailConnected=\{connected\}>/);
 for (const name of ["SpendingBreakdownView", "SpendingChartPanel", "CategoryRankingPanel", "DashboardCounterpartyRankingView", "TopInsightsView"]) assert.equal((analyticsPanels.match(new RegExp(`<${name}\\b`, "g")) ?? []).length, 1);
});
