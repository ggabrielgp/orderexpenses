import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

const requestTimings = new AsyncLocalStorage();
const STAGES = new Set(["transactions", "gmail-list", "gmail-details"]);

/** Record only fixed stage names and monotonic durations, never account or message data. */
export async function measureTiming(stage, action) {
	if (!STAGES.has(stage)) throw new TypeError("Unknown server timing stage");
	const timings = requestTimings.getStore();
	if (!timings) return action();
	const started = performance.now();
	try {
		return await action();
	} finally {
		// Failures are timed too; duration is not a claim that Gmail completed successfully.
		timings.push({ stage, duration: Math.max(0, performance.now() - started) });
	}
}

/** Each request gets its own timing context, including work performed by its concurrent workers. */
export async function withServerTiming(action) {
	const timings = [];
	const result = await requestTimings.run(timings, () => measureTiming("transactions", action));
	return {
		result,
		serverTiming: timings.map(({ stage, duration }) => `${stage};dur=${duration.toFixed(1)}`).join(", "),
	};
}
