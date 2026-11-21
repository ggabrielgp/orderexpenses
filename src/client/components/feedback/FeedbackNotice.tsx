import { useEffect, useRef, useState, type CSSProperties } from "react";
import { UNDO_NOTICE_MS, createUndoCountdown } from "./undoCountdown";

interface FeedbackNoticeProps {
	className: string;
	tone: string;
	message: string;
	/** Optional inline action, e.g. "Deshacer" after a recategorization. */
	action?: { label: string; onClick: () => void; disabled?: boolean };
	/**
	 * With an action, the notice dismisses itself after 7 s through this callback. Hovering or
	 * focusing it pauses the countdown, and it never runs while the action is disabled (in flight).
	 * Notices without an action are never timed.
	 */
	onDismiss?: () => void;
}

/** A check belongs to an actual settled success, never a warning, error or pending request. */
export function FeedbackNotice({ className, tone, message, action, onDismiss }: FeedbackNoticeProps) {
	const timed = Boolean(action && onDismiss);
	const [pointer, setPointer] = useState(false);
	const [focus, setFocus] = useState(false);
	const busy = Boolean(action?.disabled);
	const dismissRef = useRef(onDismiss);
	dismissRef.current = onDismiss;
	const countdown = useRef<ReturnType<typeof createUndoCountdown> | null>(null);

	useEffect(() => {
		if (!timed) return undefined;
		const next = createUndoCountdown({ onExpire: () => dismissRef.current?.() });
		countdown.current = next;
		next.start();
		return () => {
			next.dispose();
			countdown.current = null;
		};
	}, [timed, message]);

	// Runs after the effect above on every new notice, so holds that already apply (pointer resting on
	// the notice, an undo in flight) pause the countdown before any time elapses.
	useEffect(() => {
		const current = countdown.current;
		if (!current) return;
		for (const [reason, held] of [["pointer", pointer], ["focus", focus], ["busy", busy]] as const) {
			if (held) current.hold(reason); else current.release(reason);
		}
	}, [pointer, focus, busy, timed, message]);

	const held = pointer || focus || busy;
	const timedProps = timed
		? {
			onMouseEnter: () => setPointer(true),
			onMouseLeave: () => setPointer(false),
			onFocus: () => setFocus(true),
			onBlur: () => setFocus(false),
			"data-held": held ? "true" : undefined,
			style: { "--undo-notice-ms": `${UNDO_NOTICE_MS}ms` } as CSSProperties,
		}
		: {};

	return (
		<p className={`${className} react-feedback-notice${timed ? " react-feedback-notice-timed" : ""}`} role="status" {...timedProps}>
			{tone === "success" && (
				<svg className="react-success-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="m5 12 4 4 10-10" pathLength="1" />
				</svg>
			)}
			<span>{message}</span>
			{action && (
				<button className="react-feedback-notice-action" type="button" onClick={action.onClick} disabled={action.disabled}>
					{action.label}
				</button>
			)}
			{timed && <span key={message} className="react-feedback-notice-timer" aria-hidden="true" />}
		</p>
	);
}
