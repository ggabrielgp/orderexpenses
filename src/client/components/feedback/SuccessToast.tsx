import { useEffect, useRef, useState } from "react";
import { createNoticeAutoDismiss } from "./noticeAutoDismiss";
import "./success-toast.css";

/** How long the centered success check stays visible before starting its exit transition. */
export const SUCCESS_TOAST_DURATION_MS = 2200;

/** How long the exit transition lasts before the toast unmounts (matches `success-toast-out`). */
export const SUCCESS_TOAST_EXIT_MS = 260;

export interface SuccessToastItem {
	/** Monotonic identifier so consecutive saves cleanly replay the enter and check animations. */
	id: number;
	message: string;
}

export interface SuccessToastProps {
	toast: SuccessToastItem | null;
	onDismiss: () => void;
	durationMs?: number;
}

const DEFAULT_SUCCESS_LABEL = "Cambios guardados";

/** Produces a concise, single-line neutral-Spanish label for the centered success toast. */
export function getSuccessToastSummary(message: string): string {
	const normalized = message.trim().replace(/\s+/g, " ").replace(/\.+$/, "");
	return normalized.length > 0 ? normalized : DEFAULT_SUCCESS_LABEL;
}

/**
 * Compact, centered, non-invasive animated check confirmation that appears briefly after a settled
 * mutation and dismisses itself automatically without blocking interaction.
 */
export function SuccessToast({
	toast,
	onDismiss,
	durationMs = SUCCESS_TOAST_DURATION_MS,
}: SuccessToastProps) {
	const [leaving, setLeaving] = useState(false);
	const dismissRef = useRef(onDismiss);
	dismissRef.current = onDismiss;

	useEffect(() => {
		if (!toast) return undefined;
		setLeaving(false);
		const timer = createNoticeAutoDismiss({
			durationMs,
			exitMs: SUCCESS_TOAST_EXIT_MS,
			onLeave: () => setLeaving(true),
			onDismiss: () => dismissRef.current(),
		});
		timer.start();
		return () => {
			timer.dispose();
		};
	}, [toast?.id, durationMs]);

	if (!toast) return null;

	return (
		<div
			key={toast.id}
			className={`react-success-toast${leaving ? " react-success-toast-leaving" : ""}`}
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<div className="react-success-toast-card">
				<span className="react-success-toast-badge" aria-hidden="true">
					<svg
						className="react-success-toast-check"
						viewBox="0 0 24 24"
						aria-hidden="true"
						focusable="false"
					>
						<path d="m5 12.5 4.5 4.5 9.5-10" pathLength="1" />
					</svg>
				</span>
				<span className="react-success-toast-message">
					{getSuccessToastSummary(toast.message)}
				</span>
			</div>
		</div>
	);
}
