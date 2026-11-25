import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("buildPaceCurve computes cumulative points, per-day breakdown with times, and deviation against ideal pace", async () => {
	const vite = await createServer({
		server: { middlewareMode: true, ws: false },
		appType: "custom",
		logLevel: "silent",
		optimizeDeps: { noDiscovery: true },
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
	}
});
