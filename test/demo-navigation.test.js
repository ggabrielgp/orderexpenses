import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer, loadConfigFromFile } from "vite";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("demo uses separate summary and production movement views without mutation controls", async (t) => {
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, fileURLToPath(new URL("../vite.config.ts", import.meta.url)));
  const vite = await createServer({ ...loaded?.config, configFile: false, envFile: false, appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
  t.after(() => vite.close());
  const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
  const demo = await vite.ssrLoadModule("/src/client/demo-data.ts");
  const fixture = JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8"));
  const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
  const before = structuredClone(data);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Demo must not fetch"); };
  try {
    const summary = renderToStaticMarkup(createElement(page.DemoDashboardPage, { data }));
    assert.doesNotMatch(summary, /demo-movements|react-movements-table/);
    assert.match(summary, /Resumen de la cuenta/);
    const clp = (amount) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount);
    assert.ok(summary.includes(clp(data.currentPeriodSpending)));
    assert.ok(summary.includes(clp(data.currentPeriodInflow)));
    for (const view of ["summary", "movements"]) {
      const changes = [];
      const tree = page.DemoDashboardView({ data, view, onViewChange: (next) => changes.push(next), onRequestedCategoryChange() {} });
      const header = tree.props.children[0];
      const nav = header.type(header.props).props.children.props.children[1];
      for (const button of nav.props.children) button.props.onClick();
      assert.deepEqual(changes, ["summary", "movements"]);
      const html = renderToStaticMarkup(tree);
      assert.match(html, new RegExp(`data-view="${view}"`));
      assert.match(html, /Solo lectura/);
      assert.doesNotMatch(html, /Nuevo gasto|>Editar<|>Eliminar<|>Configuración</);
      if (view === "movements") {
        assert.match(html, /react-movements-page/);
        assert.match(html, /<table/);
        assert.doesNotMatch(html, /demo-movements|Resumen de la cuenta/);
        for (const row of page.getRecognizedExpenseMovements(demo.getDemoTransactions(data))) {
          assert.ok(html.includes(row.counterparty), row.counterparty);
        }
      }
    }
    // Exercise the same category-detail button and callback supplied by the demo composition.
    const find = (node, predicate) => {
      if (!node || typeof node !== "object") return undefined;
      if (predicate(node)) return node;
      for (const child of [node.props?.children].flat(Infinity)) {
        const found = find(child, predicate);
        if (found) return found;
      }
    };
    let view = "summary";
    let requestedCategory;
    const renderView = () => page.DemoDashboardView({
      data, view, requestedCategory,
      onRequestedCategoryChange: (category) => { requestedCategory = category; },
      onViewChange: (next) => { view = next; },
    });
    const rows = page.getRecognizedExpenseMovements(demo.getDemoTransactions(data));
    // Repeated and different visible-category jumps both remount the filter.
    for (const category of ["Supermercado", "Supermercado", "Vivienda"]) {
      const tree = renderView();
      const analytics = find(tree, (node) => typeof node.props?.onJumpToCategory === "function");
      const ranking = analytics.props.ranking;
      const row = ranking.rows.find((entry) => entry.category === category);
      assert.ok(row, category);
      const detail = page.CategoryRankingView({
        ranking, selectedCategory: category, onSelect() {}, onClearSelection() {},
        onJumpToCategory: analytics.props.onJumpToCategory,
      });
      const detailElement = find(detail, (node) => node.props?.row === row);
      const detailTree = detailElement.type(detailElement.props);
      const jump = find(detailTree, (node) => node.props?.className?.includes("react-category-detail-jump"));
      jump.props.onClick();
      assert.equal(view, "movements", "Ver gastos must open Movimientos");
      assert.equal(requestedCategory, category);
      const movementsTree = renderView();
      const html = renderToStaticMarkup(movementsTree);
      assert.match(html, /data-view="movements"/);
      assert.match(html, /aria-pressed="true">Movimientos<\/button>/);
      assert.ok(html.includes(`Categoría: ${category}`));
      const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
      const expected = rows.filter((movement) => movement.category === category);
      assert.ok(expected.length > 0);
      assert.equal((tbody.match(/<tr[ >]/g) ?? []).length, expected.length);
      for (const movement of expected) assert.ok(tbody.includes(movement.counterparty));
      for (const movement of rows.filter((movement) => movement.category !== category)) {
        if (!expected.some((entry) => entry.counterparty === movement.counterparty)) {
          assert.ok(!tbody.includes(movement.counterparty), movement.counterparty);
        }
      }
      assert.doesNotMatch(html, /Nuevo gasto|>Editar<|>Eliminar</);
      assert.doesNotMatch(html, /react-movements-bulk|sin identificación o fecha válida/);
      assert.match(html, /Edición deshabilitada en la demo/);
      assert.doesNotMatch(html, /<input[^>]*type="checkbox"(?![^>]*disabled=)[^>]*>/);
      const header = movementsTree.props.children[0];
      header.props.onViewChange("summary");
      assert.match(renderToStaticMarkup(renderView()), /data-view="summary"/);
      header.props.onViewChange("movements");
      assert.ok(renderToStaticMarkup(renderView()).includes(`Categoría: ${category}`));
      header.props.onViewChange("summary");
    }
    assert.deepEqual(data, before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
