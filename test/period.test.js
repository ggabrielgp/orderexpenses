import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { ReviewPeriod } from "../public/review-period.js";

test("creates strict inclusive periods and converts the visible end to exclusive UTC calendar date", () => {
	const period = ReviewPeriod.fromInclusive("2028-02-29", "2028-02-29");

	assert.deepEqual(period.toJSON(), {
		startDate: "2028-02-29",
		endDateExclusive: "2028-03-01",
	});
	assert.equal(period.visibleEndDate, "2028-02-29");
	assert.equal(period.label, "2028-02-29 – 2028-02-29");
});

test("handles December to January conversion without timezone shifts", () => {
	const period = ReviewPeriod.fromInclusive("2026-12-31", "2026-12-31");

	assert.deepEqual(period.toJSON(), {
		startDate: "2026-12-31",
		endDateExclusive: "2027-01-01",
	});
	assert.equal(period.label, "2026-12-31 – 2026-12-31");
});

test("rejects malformed and impossible date-only values", () => {
	for (const [startDate, endDate] of [
		["2028-02-30", "2028-03-01"],
		["2028-2-29", "2028-02-29"],
		["2028-02-29T00:00:00", "2028-02-29"],
		["2028-04-31", "2028-05-01"],
	]) {
		assert.throws(
			() => ReviewPeriod.fromInclusive(startDate, endDate),
			/valid YYYY-MM-DD/,
		);
	}
});

test("rejects incomplete and reversed exclusive ranges", () => {
	assert.throws(
		() => ReviewPeriod.create({ startDate: "2028-03-01" }),
		/endDateExclusive is required/,
	);
	assert.throws(
		() =>
			ReviewPeriod.create({
				startDate: "2028-03-01",
				endDateExclusive: "2028-03-01",
			}),
		/startDate must be before endDateExclusive/,
	);
	assert.throws(
		() => ReviewPeriod.fromInclusive("2028-03-02", "2028-03-01"),
		/startDate must be before endDateExclusive/,
	);
});

test("uses local calendar fields for the current-month default", () => {
	const period = ReviewPeriod.currentMonth(new Date(2027, 0, 1, 0, 30));

	assert.deepEqual(period.toJSON(), {
		startDate: "2027-01-01",
		endDateExclusive: "2027-02-01",
	});
});

test("rolls the current-month exclusive end from December into January", () => {
	const period = ReviewPeriod.currentMonth(new Date(2026, 11, 15));

	assert.deepEqual(period.toJSON(), {
		startDate: "2026-12-01",
		endDateExclusive: "2027-01-01",
	});
});

test("includes date-only values with an inclusive start and exclusive end", () => {
	const period = ReviewPeriod.create({
		startDate: "2026-12-31",
		endDateExclusive: "2027-01-01",
	});

	assert.equal(period.includes("2026-12-31"), true);
	assert.equal(period.includes("2027-01-01"), false);
	assert.equal(period.includes("2026-12-30"), false);
});

test("does not parse date-only values through the timezone-sensitive Date string constructor", async () => {
	const source = await readFile(
		new URL("../public/review-period.js", import.meta.url),
		"utf8",
	);

	assert.doesNotMatch(source, /new Date\(\s*["']\d{4}-\d{2}-\d{2}/);
});
