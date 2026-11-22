import assert from "node:assert/strict";
import { readFile, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const noop = () => {};
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
let vite, cache, pace, gauge;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "dashboard-pace-"));
	vite = await createServer({ configFile: false, envFile: false, cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
	pace = await vite.ssrLoadModule("/src/client/components/analytics/dashboardPace.ts");
	gauge = await vite.ssrLoadModule("/src/client/components/analytics/DashboardPaceGauge.tsx");
});
test.after(async () => { await vite?.close(); await rmdir(cache); });

// November 2026: 30 days, [2026-11-01, 2026-12-01).
const cycle = { startDate: "2026-11-01", endDateExclusive: "2026-12-01" };
const day = (month, d, year = 2026) => ({ year, month, day: d });
const run = (overrides) => pace.getDashboardPace({
	...cycle, incomeAmount: 1_000_000, totalSpending: 0, today: day(11, 15), ...overrides,
});

test("state labels never claim control", () => {
	// S11: one vocabulary for the month state; "Pasado" became "Vas rápido".
	assert.deepEqual(pace.PACE_STATE_LABELS, { calm: "En ritmo", tight: "Ajustado", over: "Vas rápido" });
});

test("spent equal to elapsed is calm and just above it is tight", () => {
	// Day 15 of 30: elapsed is exactly 0.5.
	const equal = run({ totalSpending: 500_000 });
	assert.equal(equal.kind, "income");
	assert.equal(equal.elapsed, 0.5);
	assert.equal(equal.spent, 0.5);
	assert.equal(equal.state, "calm");
	assert.equal(run({ totalSpending: 499_999 }).state, "calm");
	assert.equal(run({ totalSpending: 500_001 }).state, "tight");
});

test("spent above elapsed plus 0.10 is over while the margin itself is tight", () => {
	assert.equal(run({ totalSpending: 600_000 }).state, "tight");
	assert.equal(run({ totalSpending: 600_001 }).state, "over");
	// 18 of 30 days: elapsed 0.6, margin edge 0.7 (a float-hostile boundary).
	assert.equal(run({ today: day(11, 18), totalSpending: 700_000 }).state, "tight");
	assert.equal(run({ today: day(11, 18), totalSpending: 700_001 }).state, "over");
});

test("negative remaining is over even when the cycle is over", () => {
	const closed = run({ today: day(12, 5), totalSpending: 1_000_001 });
	assert.equal(closed.state, "over");
	assert.equal(closed.remaining, -1);
	assert.equal(closed.perDay, 0);
	// Exactly all the income spent at the very end is not negative.
	assert.equal(run({ today: day(11, 30), totalSpending: 1_000_000 }).state, "calm");
});

test("before the start nothing has elapsed and every day is left", () => {
	const before = run({ today: day(10, 20), totalSpending: 50_000 });
	assert.equal(before.elapsed, 0);
	assert.equal(before.elapsedDays, 0);
	assert.equal(before.daysLeft, 30);
	assert.equal(before.projectedSpending, 50_000);
	assert.equal(before.projectedBalance, 950_000);
	assert.equal(before.state, "tight");
});

test("after the end the cycle is fully elapsed with no days left", () => {
	const after = run({ today: day(12, 1), totalSpending: 400_000 });
	assert.equal(after.elapsed, 1);
	assert.equal(after.daysLeft, 0);
	assert.equal(after.perDay, 0);
	assert.equal(after.projectedSpending, 400_000);
	assert.equal(after.state, "calm");
	assert.equal(run({ today: day(12, 1), incomeAmount: null }).daysLeft, 0);
});

test("first and last day of the cycle count today as elapsed and as left", () => {
	const first = run({ today: day(11, 1), totalSpending: 10_000 });
	assert.equal(first.elapsedDays, 1);
	assert.equal(first.daysLeft, 30);
	assert.equal(first.elapsed, 1 / 30);
	assert.equal(first.projectedSpending, 300_000);
	const last = run({ today: day(11, 30), totalSpending: 900_000 });
	assert.equal(last.elapsedDays, 30);
	assert.equal(last.elapsed, 1);
	assert.equal(last.daysLeft, 1);
	assert.equal(last.perDay, 100_000);
});

test("without a positive income there is no state", () => {
	for (const incomeAmount of [null, 0, -5]) {
		const result = run({ incomeAmount, today: day(11, 20), totalSpending: 912_430 });
		assert.deepEqual(result, { kind: "no-income", totalSpending: 912_430, elapsed: 20 / 30, daysLeft: 11 });
	}
});

test("per-day money is floored to whole pesos and never negative", () => {
	assert.equal(run({ today: day(11, 20), totalSpending: 1_000_000 - 100 }).perDay, 9);
	assert.equal(run({ today: day(11, 20), totalSpending: 1_000_000 - 120 }).perDay, 10);
	assert.equal(run({ today: day(11, 20), totalSpending: 1_200_000 }).perDay, 0);
});

test("projection extrapolates the spend rate over the whole cycle", () => {
	const result = run({ today: day(11, 10), totalSpending: 250_000 });
	assert.equal(result.projectedSpending, 750_000);
	assert.equal(result.projectedBalance, 250_000);
	const overspent = run({ today: day(11, 10), totalSpending: 400_000 });
	assert.equal(overspent.projectedSpending, 1_200_000);
	assert.equal(overspent.projectedBalance, -200_000);
});

test("cycles spanning a year boundary and leap days count calendar days", () => {
	const year = pace.getDashboardPace({ startDate: "2027-12-15", endDateExclusive: "2028-01-15",
		incomeAmount: 310_000, totalSpending: 0, today: day(1, 1, 2028) });
	assert.equal(year.totalDays, 31);
	assert.equal(year.elapsedDays, 18);
	const leap = pace.getDashboardPace({ startDate: "2028-02-01", endDateExclusive: "2028-03-01",
		incomeAmount: 290_000, totalSpending: 0, today: day(2, 29, 2028) });
	assert.equal(leap.totalDays, 29);
	assert.equal(leap.daysLeft, 1);
	assert.throws(() => run({ startDate: "2026-11-01T00:00:00" }), /YYYY-MM-DD/);
});

test("todayInSantiago reads the calendar day in Santiago, not in the machine zone", () => {
	// 2026-11-21T01:30Z is still the 20th in Santiago (UTC-3 in summer).
	assert.deepEqual(pace.todayInSantiago(new Date(Date.UTC(2026, 10, 21, 1, 30))), day(11, 20));
	// 2026-07-01T03:30Z is the 30th of June in Santiago (UTC-4 in winter).
	assert.deepEqual(pace.todayInSantiago(new Date(Date.UTC(2026, 6, 1, 3, 30))), day(6, 30));
	assert.deepEqual(pace.todayInSantiago(new Date(Date.UTC(2026, 10, 21, 12, 0))), day(11, 21));
});

test("a calm cycle renders the gauge with exact copy", () => {
	const result = run({ today: day(11, 20), incomeAmount: 1_450_000, totalSpending: 912_430 });
	assert.equal(result.state, "calm");
	assert.equal(result.remaining, 537_570);
	assert.equal(result.daysLeft, 11);
	assert.equal(result.perDay, 48_870);
	const html = render(gauge.DashboardPaceGauge, { pace: result });
	assert.match(html, /^<section class="react-pace-gauge react-pace-gauge--calm"[^>]*aria-labelledby="[^"]+"/);
	assert.match(html, /role="img" aria-label="Gastaste 63% de tu ingreso; pasó el 67% del período"/);
	assert.match(html, />Te quedan</);
	assert.match(html, />\$537\.570</);
	assert.match(html, />\$48\.870 por día</);
	assert.match(html, />En ritmo</);
	assert.match(html, /aria-hidden="true">✓</);
	// Projection: 912430 / (20/30) = 1368645 -> balance 81355 -> "unos $81.000".
	assert.match(text(html), /Llevas 63% del ingreso y pasó el 67% del período\. A este ritmo cierras con unos \$81\.000 de sobra\./);
	assert.doesNotMatch(html, /Si sigues así/);
	assert.match(html, /transform="rotate\(240 150 150\)"/);
	const arc = /<circle class="react-pace-gauge-arc"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(html);
	assert.ok(arc, "arc circle with dash array");
	assert.ok(Math.abs(Number(arc[1]) / Number(arc[2]) - 912_430 / 1_450_000) < 0.001);
	assert.doesNotMatch(html, /En control|Agregar ingreso|<button/);
});

test("the pill and ring colour follow each state", () => {
	const tight = render(gauge.DashboardPaceGauge, { pace: run({ today: day(11, 15), totalSpending: 550_000 }) });
	assert.match(tight, /react-pace-gauge--tight/);
	assert.match(tight, />Ajustado</);
	assert.match(tight, /aria-hidden="true">!</);
	assert.match(tight, /class="react-pace-gauge-arc"/);
	assert.doesNotMatch(tight, /En control/);
});

test("an overspent cycle shows the overshoot and a negative projection", () => {
	const result = run({ today: day(11, 20), incomeAmount: 1_000_000, totalSpending: 1_250_000 });
	const html = render(gauge.DashboardPaceGauge, { pace: result });
	assert.match(html, /react-pace-gauge--over/);
	assert.match(html, />Te pasaste por</);
	assert.match(html, />\$250\.000</);
	assert.doesNotMatch(html, />Te quedan</);
	assert.doesNotMatch(html, / por día</);
	assert.match(html, />Vas rápido</);
	assert.doesNotMatch(html, /Pasado|Al límite|En peligro/);
	assert.match(html, /aria-hidden="true">↑</);
	assert.match(html, /Gastaste 125% de tu ingreso; pasó el 67% del período/);
	// Projection: 1250000 / (20/30) = 1875000 -> balance -875000.
	assert.match(text(html), /Llevas 125% del ingreso y pasó el 67% del período\. A este ritmo terminas unos \$875\.000 bajo cero\./);
	assert.doesNotMatch(html, /En control/);
	// The arc never exceeds the full ring.
	const arc = /<circle class="react-pace-gauge-arc"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(html);
	assert.ok(Number(arc[1]) <= Number(arc[2]));
});

test("a closed cycle says so instead of a per-day amount", () => {
	const html = render(gauge.DashboardPaceGauge, { pace: run({ today: day(12, 3), totalSpending: 400_000 }) });
	assert.match(html, />Período cerrado</);
	assert.doesNotMatch(html, / por día</);
	assert.match(html, /pasó el 100% del período/);
});

test("without income the gauge offers to add it and claims no state", () => {
	const result = run({ today: day(11, 20), incomeAmount: null, totalSpending: 912_430 });
	const html = render(gauge.DashboardPaceGauge, { pace: result, onAddIncome: noop });
	assert.match(html, /\$912\.430/);
	assert.match(html, /Agrega tu ingreso del período para saber si vas en ritmo\./);
	assert.match(html, /<button[^>]*type="button"[^>]*>Agregar ingreso<\/button>/);
	assert.doesNotMatch(html, /En ritmo|Ajustado|Vas rápido|Pasado|En control|Te quedan|<svg/);
	// Without a handler (demo) there is no dead button, but the copy stays.
	const demo = render(gauge.DashboardPaceGauge, { pace: result });
	assert.doesNotMatch(demo, /<button/);
	assert.match(demo, /Agrega tu ingreso del período/);
});

test("amounts use the injected formatter when provided", () => {
	const html = render(gauge.DashboardPaceGauge, {
		pace: run({ today: day(11, 20), totalSpending: 100_000 }), formatClp: (n) => `CLP ${n}`,
	});
	assert.match(html, />CLP 900000</);
	assert.match(html, />CLP 81818 por día</);
});

test("gauge styles are responsive, accessible and motion-safe", async () => {
	const css = await readFile(new URL("../src/client/components/analytics/dashboard-pace.css", import.meta.url), "utf8");
	const source = await readFile(new URL("../src/client/components/analytics/DashboardPaceGauge.tsx", import.meta.url), "utf8");
	assert.match(source, /import "\.\/dashboard-pace\.css";/);
	// S11: the hero stacks at <=760px; the sweep is driven from gaugeMotion.ts, not a CSS keyframe.
	assert.match(css, /@media \(max-width: 760px\)/);
	assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
	assert.doesNotMatch(css, /@keyframes react-pace-gauge-fill/);
	assert.match(css, /min-height: 44px/);
	for (const token of ["--state-calm", "--state-tight", "--state-over", "--color-track"]) assert.ok(css.includes(token), token);
	assert.doesNotMatch(source + css, /En control/);
	assert.doesNotMatch(source, /new Date\(\s*["']\d{4}-\d{2}-\d{2}/);
});

// ── S11: the gauge is the hero; its figures appear once ─────────────────────────────────────────────

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

test("the hero states income, spent, remaining and percent once, with the days left and the expense note", () => {
	const result = run({ today: day(11, 20), incomeAmount: 1_450_000, totalSpending: 912_430 });
	const html = render(gauge.DashboardPaceGauge, { pace: result, notes: ["35 gastos con monto", "2 sin monto claro"] });
	const plain = text(html);
	assert.equal(countOf(plain, "$1.450.000"), 1, "income once");
	assert.equal(countOf(plain, "$912.430"), 1, "spent once");
	assert.equal(countOf(plain, "$537.570"), 1, "remaining once");
	assert.equal(countOf(plain, "63%"), 1, "percent of income once, in the sentence");
	assert.equal(countOf(plain, "Quedan 11 días"), 1, "days left once");
	assert.doesNotMatch(plain, /Día 20 de 30/, "the bare cycle day is replaced by the days left");
	assert.match(html, /<dt>Gastado<\/dt><dd>[^]*?\$912\.430/);
	assert.match(html, /<dt>Período<\/dt><dd>Quedan 11 días/);
	assert.match(html, /Raya: hoy/);
	assert.match(plain, /35 gastos con monto/);
	assert.match(plain, /2 sin monto claro/);
	// The number is the hero: the ring centre owns the largest type of the page.
	assert.match(html, /react-pace-gauge-amount/);
});

test("very long amounts shrink inside the ring instead of overflowing it", () => {
	const html = render(gauge.DashboardPaceGauge, { pace: run({ incomeAmount: 12_345_678, totalSpending: 0, today: day(11, 2) }) });
	assert.match(html, /react-pace-gauge-amount react-pace-gauge-amount--long/);
	const short = render(gauge.DashboardPaceGauge, { pace: run({ today: day(11, 20), totalSpending: 912_430 }) });
	assert.doesNotMatch(short, /react-pace-gauge-amount--long/);
});

test("server markup renders the final values: no sweeping state, full arc, final number", () => {
	const result = run({ today: day(11, 20), incomeAmount: 1_450_000, totalSpending: 912_430 });
	const html = render(gauge.DashboardPaceGauge, { pace: result });
	assert.doesNotMatch(html, /react-pace-gauge--sweeping/);
	assert.match(html, />\$537\.570</);
	assert.match(html, />En ritmo</);
	assert.doesNotMatch(html, /opacity:\s*0/);
});

test("the entrance runs 700ms ease-out and never starts under prefers-reduced-motion", async () => {
	const motion = await vite.ssrLoadModule("/src/client/components/analytics/gaugeMotion.ts");
	assert.equal(motion.GAUGE_ANIMATION_MS, 700);
	assert.equal(motion.easeOutCubic(0), 0);
	assert.equal(motion.easeOutCubic(1), 1);
	assert.equal(motion.easeOutCubic(0.5), 0.875);
	assert.equal(motion.easeOutCubic(-3), 0);
	assert.equal(motion.easeOutCubic(9), 1);

	const makeHost = (reduce) => {
		const frames = [];
		return {
			frames,
			host: {
				matchMedia: (query) => ({ matches: reduce && /prefers-reduced-motion: reduce/.test(query) }),
				requestAnimationFrame: (cb) => (frames.push(cb), frames.length),
				cancelAnimationFrame: (id) => { frames[id - 1] = null; },
			},
		};
	};

	// Reduced motion: no progress callback, no scheduled frame; the final values stay as rendered.
	const reduced = makeHost(true);
	const seenReduced = [];
	const cancelReduced = motion.runGaugeEntrance(reduced.host, (p) => seenReduced.push(p));
	assert.deepEqual(seenReduced, []);
	assert.equal(reduced.frames.length, 0);
	assert.doesNotThrow(() => cancelReduced());
	// No animation API at all behaves the same.
	assert.deepEqual(motion.runGaugeEntrance({}, () => { throw new Error("must not run"); })(), undefined);

	// Normal motion: starts at 0, follows the easing and ends exactly at 1 after 700ms.
	const live = makeHost(false);
	const seen = [];
	motion.runGaugeEntrance(live.host, (p) => seen.push(p));
	assert.deepEqual(seen, [0]);
	live.frames[0](1000);
	live.frames[1](1350);
	live.frames[2](1700);
	assert.deepEqual(seen, [0, 0, 0.875, 1]);
	assert.equal(live.frames.length, 3, "no frame is scheduled after the last one");

	// Cancelling stops the loop (unmount in the middle of the sweep).
	const cancelled = makeHost(false);
	const seenCancelled = [];
	const cancel = motion.runGaugeEntrance(cancelled.host, (p) => seenCancelled.push(p));
	cancelled.frames[0](0);
	cancel();
	assert.equal(cancelled.frames[1], null);
});

test("the gauge sweep, the pill fade and reduced motion are wired in the component and its styles", async () => {
	const css = await readFile(new URL("../src/client/components/analytics/dashboard-pace.css", import.meta.url), "utf8");
	const source = await readFile(new URL("../src/client/components/analytics/DashboardPaceGauge.tsx", import.meta.url), "utf8");
	assert.match(source, /runGaugeEntrance\(/);
	assert.match(css, /\.react-pace-gauge--sweeping \.react-pace-gauge-pill\s*\{\s*opacity:\s*0/);
	assert.match(css, /transition:\s*opacity var\(--duration-view/);
	const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
	assert.match(reduced, /transition:\s*none\s*!important/);
	assert.match(reduced, /react-pace-gauge-pill/);
	// The summary has no cobalt: the hero uses ink for actions and the state hues only for the state.
	assert.doesNotMatch(css, /#(?:003594|004ac6|2878e5|e3ecff|e7f1ff)\b/i);
	assert.match(css, /--state-tight-strong/);
});
