import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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

	// A native modal dialog sits in the browser's top layer, above any z-index. Showing the toast as a
	// manual popover (re-shown for every new toast) puts the check above an open settings dialog too.
	const hostRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const host = hostRef.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
		if (!toast || !host || typeof host.showPopover !== "function") return undefined;
		try {
			if (host.matches(":popover-open")) host.hidePopover?.();
			host.showPopover();
		} catch {
			// Without the popover API the fixed overlay still shows above the page.
		}
		return undefined;
	}, [toast?.id]);

	if (!toast) return null;

	return (
		<div
			key={toast.id}
			ref={hostRef}
			popover="manual"
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

/** Shows the centered success check; a no-op outside a `SuccessToastProvider` (demo, isolated renders). */
export type ShowSuccessToast = (message: string) => void;

const SuccessToastContext = createContext<ShowSuccessToast>(() => {});

/** The one success check of the page: any save under it calls `useSuccessToast()` to confirm. */
export function SuccessToastProvider({ children }: { children: ReactNode }) {
	const [toast, setToast] = useState<SuccessToastItem | null>(null);
	const seq = useRef(0);
	const show = useCallback<ShowSuccessToast>((message) => {
		seq.current += 1;
		setToast({ id: seq.current, message });
	}, []);
	return (
		<SuccessToastContext.Provider value={show}>
			{children}
			<SuccessToast toast={toast} onDismiss={() => setToast(null)} />
		</SuccessToastContext.Provider>
	);
}

export function useSuccessToast(): ShowSuccessToast {
	return useContext(SuccessToastContext);
}
