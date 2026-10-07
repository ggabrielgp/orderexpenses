import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, loadConfigFromFile } from "vite";

const fixture = JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8"));

async function loadDemoModules(t) {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  );
  const vite = await createViteServer({
    ...loaded?.config,
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  return Promise.all([
    vite.ssrLoadModule("/src/client/demo-data.ts"),
    vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
  ]);
}

test("published demo fixture has one coherent CLP month and rebased totals", async (t) => {
  const [demo, page] = await loadDemoModules(t);
  assert.ok(fixture.length >= 35);
  for (const field of ["id", "movementKey", "sourceId"]) {
    assert.equal(new Set(fixture.map((row) => row[field])).size, fixture.length, `${field} must be unique`);
  }
  const categories = new Set();
  const inflows = [];
  for (const movement of fixture) {
    assert.equal(movement.id, movement.movementKey);
    assert.equal(movement.currency, "CLP");
    assert.equal(movement.source, "gmail_banco_chile");
    assert.match(movement.sourceId, /^gmail:\d+$/);
    assert.equal(movement.isManual, false);
    assert.equal(movement.counterpartyKey, movement.counterparty.toLocaleLowerCase("es-CL"));
    assert.ok(movement.description.trim());
    assert.ok(Number.isSafeInteger(movement.amount) && movement.amount > 0);
    assert.match(movement.occurredAt, /^2026-05-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const parsed = new Date(movement.occurredAt);
    assert.ok(!Number.isNaN(parsed.getTime()));
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 4);
    assert.equal(parsed.getDate(), Number(movement.occurredAt.slice(8, 10)));
    if (movement.direction === "inflow") inflows.push(movement);
    else if (movement.category !== null) categories.add(movement.category);
  }
  assert.ok(categories.size >= 10);
  assert.ok(inflows.length >= 2);
  assert.ok(inflows.some((row) => /sueldo/i.test(row.description)));
  assert.ok(inflows.some((row) => /proyecto/i.test(row.description)));
  assert.ok(fixture.some((row) => row.direction === "outflow" && row.category === null));
  for (const merchant of ["Spotify", "Netflix"]) {
    assert.equal(fixture.filter((row) => row.counterparty === merchant).length, 1);
  }
  assert.ok(fixture.some((row) => row.category === "Vivienda" && row.kind === "transfer"));
  assert.ok(fixture.some((row) => row.category === "Servicios" && row.kind === "payment"));

  const before = structuredClone(fixture);
  const data = demo.createDemoDashboardData(fixture, new Date(2025, 1, 10, 12));
  assert.deepEqual(fixture, before, "rebasing must leave the published fixture untouched");
  assert.equal(data.movements.length, fixture.length);
  assert.deepEqual(data.period, { startDate: "2025-02-01", endDateExclusive: "2025-03-01" });
  for (const row of data.movements) {
    assert.match(row.occurredAt, /^2025-02-\d{2}T/);
    assert.ok(Number(row.occurredAt.slice(8, 10)) <= 28);
  }
  const sum = (direction) => fixture
    .filter((row) => row.direction === direction)
    .reduce((total, row) => total + row.amount, 0);
  assert.equal(data.currentPeriodSpending, sum("outflow"));
  assert.equal(data.currentPeriodInflow, sum("inflow"));
  assert.equal(page.summarizeRecognizedExpenses(demo.getDemoTransactions(data)).totalSpending, sum("outflow"));
  assert.equal(page.summarizeRecognizedExpenses(demo.getDemoTransactions(data)).count, fixture.length - inflows.length);
});

test("demo renders the newest six movements without changing the analytics or fixture order", async (t) => {
  const [demo, page] = await loadDemoModules(t);
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 10, 12));
  const originalOrder = data.movements.map((row) => row.id);
  const expected = [...data.movements]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 6);
  assert.notDeepEqual(expected.map((row) => row.id), originalOrder.slice(0, 6));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Read-only demo rendering must not fetch"); };
  let markup;
  try {
    markup = renderToStaticMarkup(React.createElement(page.DemoDashboardPage, { data }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(data.movements.map((row) => row.id), originalOrder);
  const card = markup.match(/<section class="demo-movements"[\s\S]*?<ul>([\s\S]*?)<\/ul>/)?.[1];
  assert.ok(card, "recent activity card should render a list");
  const rows = [...card.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  assert.equal(rows.length, 6);
  const clp = (amount) => new Intl.NumberFormat("es-CL", {
    style: "currency", currency: "CLP", maximumFractionDigits: 0,
  }).format(amount);
  for (const [index, row] of rows.entries()) {
    const movement = expected[index];
    assert.ok(row.includes(`<strong>${movement.counterparty}</strong>`));
    assert.ok(row.includes(`${movement.category ?? "Sin categoría"} · ${movement.occurredAt.slice(0, 10)}`));
    assert.ok(row.includes(`${movement.direction === "inflow" ? "+" : "-"}${clp(movement.amount)}`));
  }
  assert.ok(markup.includes(clp(data.currentPeriodSpending)), "summary should reflect the complete fixture");
  assert.ok(markup.includes(clp(data.currentPeriodInflow)), "income should reflect both fixture inflows");
  assert.match(markup, /Solo lectura/);
  assert.doesNotMatch(markup, /Nuevo gasto|Filtrar tabla por categoría/);
});
