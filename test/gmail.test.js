import assert from "node:assert/strict";
import test from "node:test";

import { bancoChileQueriesForPayTiming } from "../src/gmail.js";

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
