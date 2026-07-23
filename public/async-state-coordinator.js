const CHANNELS = new Set(["candidates", "transactions", "sync"]);

export function createAsyncState() {
	return freezeState(0, {
		candidates: null,
		transactions: null,
		sync: null,
	});
}

export function beginAsync(state, channel, context = null) {
	assertChannel(channel);
	const id = state.nextId + 1;
	const invocation = Object.freeze({
		channel,
		id,
		context: snapshotContext(context),
	});
	return {
		state: freezeState(id, { ...state.active, [channel]: invocation }),
		invocation,
	};
}

export function invalidateAsync(state, channel) {
	assertChannel(channel);
	const invalidatedInvocation = state.active[channel];
	return {
		state: freezeState(state.nextId + 1, {
			...state.active,
			[channel]: null,
		}),
		invalidatedInvocation,
	};
}

export function isCurrentAsync(state, invocation) {
	if (!invocation || !CHANNELS.has(invocation.channel)) return false;
	return state.active[invocation.channel] === invocation;
}

export function settleAsync(state, invocation) {
	if (!isCurrentAsync(state, invocation)) return state;
	return freezeState(state.nextId, {
		...state.active,
		[invocation.channel]: null,
	});
}

function assertChannel(channel) {
	if (!CHANNELS.has(channel)) throw new TypeError("Unsupported async channel");
}

function snapshotContext(context) {
	if (!context || typeof context !== "object") return context;
	return deepFreeze(structuredClone(context));
}

function deepFreeze(value) {
	for (const child of Object.values(value)) {
		if (child && typeof child === "object") deepFreeze(child);
	}
	return Object.freeze(value);
}

function freezeState(nextId, active) {
	return Object.freeze({
		nextId,
		active: Object.freeze(active),
	});
}
