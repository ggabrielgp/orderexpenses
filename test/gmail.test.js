import assert from "node:assert/strict";
import test from "node:test";

import {
	bancoChileQueriesForPayTiming,
	bancoChileQueriesForRange,
	collectMessagesForQueries,
} from "../src/gmail.js";

test("discovers the supported incoming funds transfer template precisely", () => {
	const [, incomeQuery] = bancoChileQueriesForPayTiming("varies", "2026-08");

	assert.match(
		incomeQuery,
		/subject:\([^)]*"Aviso de transferencia de fondos recibida"/,
	);
	assert.match(
		incomeQuery,
		/\(\("ha instruído una transferencia" OR "ha instruido una transferencia"\) "a su cuenta"\)/,
	);
	assert.doesNotMatch(incomeQuery, /OR "transferencia" OR/);
});

test("builds Gmail after and before queries for the complete canonical range", () => {
	const queries = bancoChileQueriesForRange({
		startDate: "2026-12-31",
		endDateExclusive: "2027-01-02",
	});

	assert.equal(queries.length, 2);
	for (const query of queries) {
		assert.match(query, /after:2026\/12\/31/);
		assert.match(query, /before:2027\/1\/2/);
	}
});

test("exhausts every Gmail page for each selected-range query", async () => {
	const calls = [];
	const gmail = {
		users: {
			messages: {
				list: async ({ q, pageToken }) => {
					calls.push({ q, pageToken });
					if (!pageToken) return { data: { messages: [{ id: `${q}-1` }], nextPageToken: "next" } };
					return { data: { messages: [{ id: `${q}-2` }] } };
				},
			},
		},
	};

	const result = await collectMessagesForQueries(gmail, ["first", "second"]);

	assert.equal(result.messages.length, 4);
	assert.equal(result.failedCount, 0);
	assert.deepEqual(calls, [
		{ q: "first", pageToken: undefined },
		{ q: "first", pageToken: "next" },
		{ q: "second", pageToken: undefined },
		{ q: "second", pageToken: "next" },
	]);
});
