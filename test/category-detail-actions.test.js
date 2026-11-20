import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
const component = await readFile(new URL("../src/client/components/analytics/CategoryDistributionPanel.tsx", import.meta.url), "utf8");

const rule = (selector) => {
  const start = styles.indexOf(`${selector} {`);
  assert.notEqual(start, -1, selector);
  return styles.slice(start, styles.indexOf("}", start) + 1);
};

test("category detail uses short explanatory labels without changing action callbacks", () => {
  assert.match(component, /onClick=\{\(\) => onJumpToCategory\(row\.category\)\}[\s\S]*?>\s*Ver gastos\s*<\/button>/);
  assert.match(component, /onClick=\{onClearSelection\}[\s\S]*?>\s*← Categorías\s*<\/button>/);
  assert.doesNotMatch(component, /Ver gastos de esta categoría|← Todas las categorías/);
  assert.match(component, /!row\.mergesTail && \(/);
});

test("category actions stick inside the scrolling detail with an opaque in-flow footer", () => {
  const legend = rule(".react-category-distribution-legend");
  // The scroll-container declaration follows the shared width-only declaration.
  assert.match(styles, /\.react-category-distribution-legend \{[^}]*max-height: 340px;[^}]*overflow-y: auto;/);
  assert.ok(legend);
  const detail = rule(".react-category-distribution .react-category-detail");
  assert.match(detail, /display: flex/);
  assert.match(detail, /flex-direction: column/);
  const actions = rule(".react-category-distribution .react-category-detail-actions");
  assert.match(actions, /position: sticky/);
  assert.match(actions, /bottom: 0/);
  assert.match(actions, /flex-shrink: 0/);
  assert.match(actions, /background: var\(--surface\)/);
  assert.match(actions, /padding-block: var\(--space-2\)/);
  // Footer follows the rows in normal flow, so the last movement remains scrollable above it.
  assert.match(component, /<\/div>\s*<div className="react-category-detail-actions">/);
});

test("donut actions are content-sized and visually quiet, with touch-sized targets", () => {
  const layout = rule(".react-category-distribution .react-category-detail-actions");
  assert.match(layout, /display: flex/);
  assert.match(layout, /flex-wrap: nowrap/);
  assert.match(layout, /min-width: 0/);
  const button = rule(".react-category-distribution .react-category-detail-actions button");
  assert.match(button, /width: auto/);
  assert.match(button, /flex: 0 1 auto/);
  assert.match(button, /min-width: 0/);
  assert.match(button, /overflow-wrap: anywhere/);
  assert.match(button, /min-height: 36px/);
  assert.match(button, /font-size: 0\.8125rem/);
  assert.match(rule(".react-category-distribution button.react-category-detail-jump"), /background: var\(--surface-subtle\)/);
  assert.match(rule(".react-category-distribution button.react-category-detail-back"), /border-color: transparent/);
  assert.match(styles, /@media \(pointer: coarse\) \{\s*\.react-category-distribution \.react-category-detail-actions button \{\s*min-height: 44px;/);
  assert.match(styles, /button:focus-visible|:focus-visible/);
});
