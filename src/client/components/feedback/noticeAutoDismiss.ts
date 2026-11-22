import { createUndoCountdown, type UndoCountdownHold } from "./undoCountdown";

/** How long the exit animation of an auto-dismissing notice lasts (matches `motion-notice-out`). */
export const NOTICE_EXIT_MS = 420;

export interface NoticeAutoDismissOptions {
	durationMs: number;
	/** Called when the notice should start its exit animation. */
	onLeave: () => void;
	/** Called once the exit animation has had time to finish; the owner removes the notice. */
	onDismiss: () => void;
	exitMs?: number;
	now?: () => number;
	schedule?: (fn: () => void, ms: number) => unknown;
	cancel?: (handle: unknown) => void;
}

/**
 * A two-phase timer for success notices (S2): it waits `durationMs` (pausable with the same holds as
 * the undo countdown: pointer, focus), starts the exit, then dismisses after `exitMs`. The removal
 * does not depend on `animationend`, so reduced motion (no animation) still removes the notice.
 */
export function createNoticeAutoDismiss({
	durationMs,
	onLeave,
	onDismiss,
	exitMs = NOTICE_EXIT_MS,
	now = Date.now,
	schedule = (fn, ms) => setTimeout(fn, ms),
	cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: NoticeAutoDismissOptions) {
	let exitHandle: unknown = null;
	let disposed = false;
	const countdown = createUndoCountdown({
		durationMs,
		now,
		schedule,
		cancel,
		onExpire: () => {
			if (disposed) return;
			onLeave();
			exitHandle = schedule(() => {
				exitHandle = null;
				if (!disposed) onDismiss();
			}, exitMs);
		},
	});
	return {
		start: () => countdown.start(),
		hold: (reason: UndoCountdownHold) => countdown.hold(reason),
		release: (reason: UndoCountdownHold) => countdown.release(reason),
		dispose() {
			disposed = true;
			countdown.dispose();
			if (exitHandle !== null) cancel(exitHandle);
			exitHandle = null;
		},
	};
}
