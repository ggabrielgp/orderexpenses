/** How long the "Deshacer" notice stays before it dismisses itself (S12). */
export const UNDO_NOTICE_MS = 7000;

export type UndoCountdownHold = "pointer" | "focus" | "busy";

export interface UndoCountdownOptions {
	onExpire: () => void;
	durationMs?: number;
	/** Injectable so the countdown is testable without real timers or a DOM. */
	now?: () => number;
	schedule?: (fn: () => void, ms: number) => unknown;
	cancel?: (handle: unknown) => void;
}

/**
 * A pausable one-shot countdown. It runs only while nothing holds it: the pointer over the notice,
 * keyboard focus inside it, and an undo request in flight each pause it, and releasing the last hold
 * resumes with the time that was left. It never fires after `dispose`.
 */
export function createUndoCountdown({
	onExpire,
	durationMs = UNDO_NOTICE_MS,
	now = Date.now,
	schedule = (fn, ms) => setTimeout(fn, ms),
	cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: UndoCountdownOptions) {
	const holds = new Set<UndoCountdownHold>();
	let remaining = durationMs;
	let handle: unknown = null;
	let startedAt = 0;
	let started = false;
	let finished = false;

	const arm = () => {
		if (!started || finished || handle !== null || holds.size > 0) return;
		startedAt = now();
		handle = schedule(() => {
			handle = null;
			finished = true;
			onExpire();
		}, remaining);
	};
	const disarm = () => {
		if (handle === null) return;
		cancel(handle);
		handle = null;
		remaining = Math.max(0, remaining - (now() - startedAt));
	};

	return {
		start() {
			if (started || finished) return;
			started = true;
			arm();
		},
		hold(reason: UndoCountdownHold) {
			holds.add(reason);
			disarm();
		},
		release(reason: UndoCountdownHold) {
			holds.delete(reason);
			arm();
		},
		isRunning: () => handle !== null,
		dispose() {
			finished = true;
			if (handle !== null) cancel(handle);
			handle = null;
		},
	};
}
