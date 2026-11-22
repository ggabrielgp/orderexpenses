import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, loadConfigFromFile } from "vite";

const fixture = JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8"));

async function modules(t) {
	const loaded = await loadConfigFromFile({ command: "serve", mode: "test" },
		fileURLToPath(new URL("../vite.config.ts", import.meta.url)));
	const vite = await createServer({ ...loaded?.config, envFile: false, configFile: false,
		appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
	t.after(() => vite.close());
	return Promise.all([
		vite.ssrLoadModule("/src/client/demo-data.ts"),
		vite.ssrLoadModule("/src/client/components/landing/LandingHero.tsx"),
		vite.ssrLoadModule("/src/client/components/landing/LandingTourSection.tsx"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts"),
		vite.ssrLoadModule("/src/client/components/analytics/categoryRanking.ts"),
	]);
}

test("hero and five tour phones share the same frame chrome and every embedded screen is lazy except the hero's", async (t) => {
	const [demo, hero, tour] = await modules(t);
	const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 20));
	const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
		React.createElement(hero.LandingHero, { data }), React.createElement(tour.LandingTourSection, { data })));
	for (const frame of ["landing-phone-island", "landing-phone-home"]) {
		assert.equal((html.match(new RegExp(`class="${frame}"`, "g")) ?? []).length, 6, frame);
	}
	assert.doesNotMatch(html, /landing-stage-topbar|landing-phone-content/);
	// The screens are the real demo in iframes (S25): one eager, five lazy, none holds a duplicate chart id.
	assert.equal((html.match(/<iframe\b/g) ?? []).length, 6);
	assert.equal((html.match(/<iframe\b[^>]*loading="eager"/g) ?? []).length, 1);
	assert.equal((html.match(/<iframe\b[^>]*loading="lazy"/g) ?? []).length, 5);
	assert.doesNotMatch(html, /react-spending-chart-bar|react-category-donut-chart/);
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
	assert.equal(ids.length, new Set(ids).size, "Multiple chart instances must not share DOM IDs");
	for (const match of html.matchAll(/aria-(?:labelledby|controls)="([^"]+)"/g)) {
		for (const id of match[1].split(/\s+/)) assert.ok(ids.includes(id), `Missing target ${id}`);
	}
});

test("original phone dimensions remain canonical instead of enlarging frames to fit content", async () => {
	const base = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");
	const tour = await readFile(new URL("../src/client/components/landing/landing-tour.css", import.meta.url), "utf8");
	assert.match(base, /\.landing-phone\s*\{[^}]*width: min\(328px, calc\(100% - 8px\)\);[^}]*aspect-ratio: 20 \/ 41;[^}]*min-height: 0;/);
	assert.doesNotMatch(tour, /\.landing-tour \.landing-tour-phone\s*\{[^}]*\b(?:height|min-height):/);
	assert.match(tour, /height: calc\(328px \* 41 \/ 20 \* var\(--tour-phone-scale\)\)/);
});

test("unmodified dashboard consumers keep the existing chart heading and day-detail contracts", async (t) => {
	const [demo, , , page, spending, categories] = await modules(t);
	const data = demo.createDemoDashboardData(fixture, new Date(2026, 4, 20));
	const movements = page.getRecognizedExpenseMovements(demo.getDemoTransactions(data));
	const chart = spending.getSpendingChart(movements, data.period, 0);
	const noop = () => {};
	const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
		React.createElement(page.SpendingChartView, { chart, selectedTab: spending.FULL_PERIOD_TAB_ID,
			selectedDayKey: null, onSelectTab: noop, onSelectDay: noop, detailMovements: [] }),
		React.createElement(page.CategoryRankingPanel, { ranking: categories.getCategoryRanking(movements, 0), onJumpToCategory: noop })));
	for (const id of ["react-spending-chart-title", "react-spending-chart-day-detail", "react-category-distribution-title"]) {
		assert.ok(html.includes(`id="${id}"`), id);
	}
	assert.match(html, /aria-controls="react-spending-chart-day-detail"/);
	assert.equal((html.match(/class="react-spending-chart-bar"/g) ?? []).length, 7);
});
