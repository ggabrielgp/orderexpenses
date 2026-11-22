import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const presets = await vite.ssrLoadModule("/src/client/components/financial-cycle/cyclePresets.ts");
const firstResult = await vite.ssrLoadModule("/src/client/components/onboarding/firstResult.ts");

const day = (year, month, dayOfMonth) => ({ year, month, day: dayOfMonth });

test("calendarMonthCycle spans the first to the last day, including leap years", () => {
	assert.deepEqual(presets.calendarMonthCycle(day(2026, 11, 20)), { startDate: "2026-11-01", endDate: "2026-11-30" });
	assert.deepEqual(presets.calendarMonthCycle(day(2026, 2, 3)), { startDate: "2026-02-01", endDate: "2026-02-28" });
	assert.deepEqual(presets.calendarMonthCycle(day(2028, 2, 29)), { startDate: "2028-02-01", endDate: "2028-02-29" });
	assert.deepEqual(presets.calendarMonthCycle(day(2026, 12, 31)), { startDate: "2026-12-01", endDate: "2026-12-31" });
	assert.deepEqual(presets.calendarMonthCycle(day(2026, 1, 1)), { startDate: "2026-01-01", endDate: "2026-01-31" });
});

test("payDayCycle runs from the latest pay day on or before today to the day before the next one", () => {
	assert.deepEqual(presets.payDayCycle(day(2026, 11, 20), 25), { startDate: "2026-10-25", endDate: "2026-11-24" });
	assert.deepEqual(presets.payDayCycle(day(2026, 11, 25), 25), { startDate: "2026-11-25", endDate: "2026-12-24" });
	assert.deepEqual(presets.payDayCycle(day(2026, 11, 30), 25), { startDate: "2026-11-25", endDate: "2026-12-24" });
	// Crossing the year boundary in both directions.
	assert.deepEqual(presets.payDayCycle(day(2026, 1, 10), 25), { startDate: "2025-12-25", endDate: "2026-01-24" });
	assert.deepEqual(presets.payDayCycle(day(2026, 12, 28), 25), { startDate: "2026-12-25", endDate: "2027-01-24" });
	// Pay day 1 is the calendar month.
	assert.deepEqual(presets.payDayCycle(day(2026, 11, 20), 1), { startDate: "2026-11-01", endDate: "2026-11-30" });
});

test("payDayCycle clamps a pay day beyond the month length to that month's last day", () => {
	// February 2026 has 28 days: the pay day lands on the 28th.
	assert.deepEqual(presets.payDayCycle(day(2026, 2, 28), 31), { startDate: "2026-02-28", endDate: "2026-03-30" });
	// Before it, the cycle began on January 31 and ends the day before February's pay day.
	assert.deepEqual(presets.payDayCycle(day(2026, 2, 10), 31), { startDate: "2026-01-31", endDate: "2026-02-27" });
	// April has 30 days.
	assert.deepEqual(presets.payDayCycle(day(2026, 4, 30), 31), { startDate: "2026-04-30", endDate: "2026-05-30" });
	assert.deepEqual(presets.payDayCycle(day(2026, 4, 15), 31), { startDate: "2026-03-31", endDate: "2026-04-29" });
	// Leap February has 29 days.
	assert.deepEqual(presets.payDayCycle(day(2028, 2, 29), 31), { startDate: "2028-02-29", endDate: "2028-03-30" });
});

test("payDayCycle rejects a pay day outside 1..31", () => {
	for (const invalid of [0, 32, -1, 1.5, Number.NaN, "25", undefined]) {
		assert.throws(() => presets.payDayCycle(day(2026, 11, 20), invalid), RangeError, String(invalid));
	}
});

test("lastBusinessDayOf steps back from a weekend month end to the previous Friday", () => {
	assert.equal(presets.lastBusinessDayOf(2026, 10), 30); // Oct 31 2026 is a Saturday.
	assert.equal(presets.lastBusinessDayOf(2026, 5), 29); // May 31 2026 is a Sunday.
	assert.equal(presets.lastBusinessDayOf(2026, 11), 30); // Nov 30 2026 is a Monday.
	assert.equal(presets.lastBusinessDayOf(2026, 2), 27); // Feb 28 2026 is a Saturday.
	assert.equal(presets.lastBusinessDayOf(2028, 2), 29); // Leap Feb 29 2028 is a Tuesday.
});

test("lastBusinessDayCycle runs from the latest last business day on or before today to the day before the next one", () => {
	// Before November's last business day (Mon 30): started Fri Oct 30, ends Sun Nov 29.
	assert.deepEqual(presets.lastBusinessDayCycle(day(2026, 11, 20)), { startDate: "2026-10-30", endDate: "2026-11-29" });
	// On it: starts Nov 30 and ends the day before December's (Thu Dec 31).
	assert.deepEqual(presets.lastBusinessDayCycle(day(2026, 11, 30)), { startDate: "2026-11-30", endDate: "2026-12-30" });
	// Weekend days after a Friday last business day belong to the cycle that started that Friday.
	assert.deepEqual(presets.lastBusinessDayCycle(day(2026, 10, 31)), { startDate: "2026-10-30", endDate: "2026-11-29" });
	// Across the year boundary: Dec 31 2026 (Thu) to the day before Fri Jan 29 2027.
	assert.deepEqual(presets.lastBusinessDayCycle(day(2027, 1, 10)), { startDate: "2026-12-31", endDate: "2027-01-28" });
});

// The option cards (radiogroup, reveals, quick pay days) are covered in test/cycle-setup-options.test.js.

test("first result storage helpers read and write the seen flag", () => {
	assert.equal(firstResult.FIRST_RESULT_SEEN_KEY, "gc:first-result-seen");
	const values = new Map();
	const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
	assert.equal(firstResult.hasSeenFirstResult(storage), false);
	firstResult.markFirstResultSeen(storage);
	assert.equal(values.get("gc:first-result-seen"), "1");
	assert.equal(firstResult.hasSeenFirstResult(storage), true);
});

test("first result storage helpers tolerate unavailable storage", () => {
	const throwing = {
		getItem() { throw new Error("denied"); },
		setItem() { throw new Error("denied"); },
	};
	assert.equal(firstResult.hasSeenFirstResult(throwing), false);
	assert.doesNotThrow(() => firstResult.markFirstResultSeen(throwing));
	assert.equal(firstResult.hasSeenFirstResult(null), false);
	assert.doesNotThrow(() => firstResult.markFirstResultSeen(undefined));
});

