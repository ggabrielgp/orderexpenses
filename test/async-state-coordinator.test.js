import test from "node:test";
import assert from "node:assert/strict";
import {
	beginAsync,
	createAsyncState,
	invalidateAsync,
	isCurrentAsync,
	settleAsync,
} from "../public/async-state-coordinator.js";

test("newer invocation supersedes the prior owner", () => {
	let state = createAsyncState();
	const first = beginAsync(state, "candidates", { month: "2026-07" });
	state = first.state;
	const second = beginAsync(state, "candidates", { month: "2026-08" });
	state = second.state;

	assert.equal(isCurrentAsync(state, first.invocation), false);
	assert.equal(isCurrentAsync(state, second.invocation), true);
	assert.notEqual(first.invocation.id, second.invocation.id);
});

test("stale or forged settle cannot clear the current invocation", () => {
	let state = createAsyncState();
	const first = beginAsync(state, "transactions", { month: "2026-07" });
	const second = beginAsync(first.state, "transactions", { month: "2026-08" });
	state = settleAsync(second.state, first.invocation);

	assert.equal(isCurrentAsync(state, second.invocation), true);
	const forged = { ...second.invocation };
	assert.equal(isCurrentAsync(state, forged), false);
	state = settleAsync(state, forged);
	assert.equal(isCurrentAsync(state, second.invocation), true);
	state = settleAsync(state, second.invocation);
	assert.equal(isCurrentAsync(state, second.invocation), false);
});

test("invalidation clears only the exact channel owner", () => {
	let state = createAsyncState();
	const candidate = beginAsync(state, "candidates", { month: "2026-07" });
	const sync = beginAsync(candidate.state, "sync", { month: "2026-07" });
	const invalidated = invalidateAsync(sync.state, "candidates");
	state = invalidated.state;

	assert.equal(invalidated.invalidatedInvocation.id, candidate.invocation.id);
	assert.equal(isCurrentAsync(state, candidate.invocation), false);
	assert.equal(isCurrentAsync(state, sync.invocation), true);
});

test("returning to an equal context does not revive an old invocation", () => {
	let state = createAsyncState();
	const firstA = beginAsync(state, "candidates", { month: "2026-07" });
	const requestB = beginAsync(firstA.state, "candidates", { month: "2026-08" });
	const secondA = beginAsync(requestB.state, "candidates", {
		month: "2026-07",
	});
	state = secondA.state;

	assert.deepEqual(firstA.invocation.context, secondA.invocation.context);
	assert.equal(isCurrentAsync(state, firstA.invocation), false);
	assert.equal(isCurrentAsync(state, secondA.invocation), true);
});

test("transaction replacement does not invalidate sync lifecycle", () => {
	let state = createAsyncState();
	const sync = beginAsync(state, "sync", { month: "2026-07" });
	const syncTransactions = beginAsync(sync.state, "transactions", {
		month: "2026-07",
	});
	const refresh = beginAsync(syncTransactions.state, "transactions", {
		month: "2026-07",
	});
	state = refresh.state;

	assert.equal(isCurrentAsync(state, sync.invocation), true);
	assert.equal(isCurrentAsync(state, syncTransactions.invocation), false);
	assert.equal(isCurrentAsync(state, refresh.invocation), true);
});

test("invocation context is deeply snapshotted", () => {
	const context = {
		month: "2026-07",
		filters: { payTiming: "varies" },
	};
	const started = beginAsync(createAsyncState(), "candidates", context);
	context.month = "2026-08";
	context.filters.payTiming = "last_week";

	assert.deepEqual(started.invocation.context, {
		month: "2026-07",
		filters: { payTiming: "varies" },
	});
	assert.equal(Object.isFrozen(started.invocation.context), true);
	assert.equal(Object.isFrozen(started.invocation.context.filters), true);
});

test("rejects unsupported channels and malformed invocations", () => {
	const state = createAsyncState();
	assert.throws(() => beginAsync(state, "unknown"), /channel/);
	assert.throws(() => invalidateAsync(state, "unknown"), /channel/);
	assert.equal(isCurrentAsync(state, null), false);
	assert.equal(isCurrentAsync(state, { channel: "unknown", id: 1 }), false);
});
