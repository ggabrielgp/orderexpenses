import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";

test("buildPaceCurve computes cumulative points, per-day breakdown with times, and deviation against ideal pace", async () => {
	// No project config, no env files and a private dep cache: the test must not read local
	// secrets (isolation denies it) nor rewrite node_modules/.vite under a running dev server.
	const cache = await mkdtemp(join(tmpdir(), "pace-curve-vite-"));
	const vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		appType: "custom",
		logLevel: "silent",
		optimizeDeps: { noDiscovery: true, include: [] },
	});
	try {
		const { buildPaceCurve } = await vite.ssrLoadModule("/src/client/components/analytics/paceCurve.ts");
		const model = buildPaceCurve({
			startDate: "2026-11-01",
			endDateExclusive: "2026-12-01",
			pace: {
				kind: "income",
				state: "tight",
				incomeAmount: 1_000_000,
				totalSpending: 600_000,
				remaining: 400_000,
				spent: 0.6,
				elapsed: 0.5,
				totalDays: 30,
				elapsedDays: 15,
				daysLeft: 15,
				perDay: 26_666,
				projectedSpending: 1_200_000,
				projectedBalance: -200_000,
			},
			movements: [
				{ amount: 250_000, counterparty: "Lider", occurredAt: "2026-11-03T18:30:00" },
				{ amount: 150_000, counterparty: "Café", occurredAt: "2026-11-12T09:15:00" },
				{ amount: 200_000, counterparty: "Farmacia", occurredAt: "2026-11-12T19:45:00" },
			],
		});

		assert.equal(model.hasCurve, true);
		assert.equal(model.actualPoints.length, 15);
		assert.equal(model.deviationAmount, 100_000);
		assert.match(model.deviationLabel, /\+\$100\.000 sobre ritmo/);
		assert.equal(model.startLabel, "01 nov");
		assert.equal(model.endLabel, "30 nov");
		assert.ok(model.idealLine !== null);
		assert.ok(model.todayPoint !== null);

		// Day 12 (index 11) has two chronologically sorted movements with HH:mm time labels
		const day12 = model.actualPoints[11];
		assert.equal(day12.dateLabel, "12 nov");
		assert.equal(day12.dailySpend, 350_000);
		assert.equal(day12.cumulative, 600_000);
		assert.deepEqual(day12.movements, [
			{ counterparty: "Café", amount: 150_000, timeLabel: "09:15" },
			{ counterparty: "Farmacia", amount: 200_000, timeLabel: "19:45" },
		]);

		// Day 1 (index 0) has $0 spend and empty movements
		assert.equal(model.actualPoints[0].dailySpend, 0);
		assert.deepEqual(model.actualPoints[0].movements, []);
	} finally {
		await vite.close();
		await rm(cache, { recursive: true, force: true });
	}
});

test("clampTooltipCenter keeps the whole tooltip inside the chart width", async () => {
	const cache = await mkdtemp(join(tmpdir(), "pace-curve-vite-"));
	const vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		appType: "custom",
		logLevel: "silent",
		optimizeDeps: { noDiscovery: true, include: [] },
	});
	try {
		const { clampTooltipCenter } = await vite.ssrLoadModule("/src/client/components/analytics/paceCurve.ts");
		// Mobile chart (320px) with a 240px tooltip: centers stay within [120, 200].
		assert.equal(clampTooltipCenter(310, 240, 320), 200); // near right edge
		assert.equal(clampTooltipCenter(4, 240, 320), 120); // near left edge
		assert.equal(clampTooltipCenter(160, 240, 320), 160); // centered: unchanged
		// Desktop: no clamping needed in the middle.
		assert.equal(clampTooltipCenter(500, 240, 1200), 500);
		// Tooltip wider than the chart: pin to the chart center instead of overflowing one side.
		assert.equal(clampTooltipCenter(300, 400, 320), 160);
	} finally {
		await vite.close();
		await rm(cache, { recursive: true, force: true });
	}
});
