const registered = new WeakSet<HTMLDialogElement>();

/** Minimum downward drag distance (px) that dismisses a mobile bottom sheet on release. */
export const SHEET_DRAG_DISMISS_DISTANCE_PX = 96;

/** Minimum downward release velocity (px/ms) that dismisses a mobile bottom sheet on a quick flick. */
export const SHEET_DRAG_DISMISS_VELOCITY_PX_MS = 0.55;

/** Clamps sheet drag translation to downward-only finite pixel offsets. */
export function clampSheetDragOffset(deltaY: number): number {
	if (!Number.isFinite(deltaY) || deltaY <= 0) return 0;
	return deltaY;
}

/** Pure dismiss decision for a released bottom-sheet handle drag. */
export function shouldDismissSheetDrag({
	offsetY,
	velocityY,
}: {
	offsetY: number;
	velocityY: number;
}): boolean {
	const clampedOffset = clampSheetDragOffset(offsetY);
	if (clampedOffset <= 0) return false;
	if (clampedOffset >= SHEET_DRAG_DISMISS_DISTANCE_PX) return true;
	return Number.isFinite(velocityY) && velocityY >= SHEET_DRAG_DISMISS_VELOCITY_PX_MS;
}

/**
 * Element-owned drag-to-dismiss on the mobile bottom-sheet grab handle (`.cycle-grab`).
 * Preserves native `requestClose()` / cancelable `cancel` veto so in-flight saving dialogs
 * are never abandoned when dragged.
 */
export function registerSheetDragDismiss(
	candidate: unknown,
	handleCandidate?: unknown,
): void {
	const dialog = candidate as HTMLDialogElement | null;
	const realm = dialog?.ownerDocument?.defaultView;
	// Minimal lifecycle stubs and SSR are intentionally supported without registration.
	if (
		!realm?.HTMLDialogElement ||
		!realm.PointerEvent ||
		!(dialog instanceof realm.HTMLDialogElement) ||
		registered.has(dialog)
	) {
		return;
	}
	const handle = (
		handleCandidate ??
		(typeof dialog.querySelector === "function" ? dialog.querySelector(".cycle-grab") : null)
	) as HTMLElement | null;
	if (!handle || typeof handle.addEventListener !== "function") return;
	registered.add(dialog);

	let drag: {
		pointerId: number;
		startY: number;
		lastY: number;
		lastTime: number;
		offsetY: number;
		velocityY: number;
	} | null = null;

	const isSheetActive = () => {
		if (typeof realm.matchMedia === "function") {
			return realm.matchMedia("(max-width: 760px)").matches;
		}
		if (typeof handle.getBoundingClientRect === "function") {
			const rect = handle.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		}
		return true;
	};

	const setDraggingFlag = (active: boolean) => {
		if (dialog.dataset) {
			if (active) dialog.dataset.dragging = "true";
			else delete dialog.dataset.dragging;
		} else if (active && typeof dialog.setAttribute === "function") {
			dialog.setAttribute("data-dragging", "true");
		} else if (!active && typeof dialog.removeAttribute === "function") {
			dialog.removeAttribute("data-dragging");
		}
	};

	const clearVisual = () => {
		setDraggingFlag(false);
		if (dialog.style) {
			dialog.style.transform = "";
			dialog.style.transition = "";
		}
	};

	const releaseCapture = (pointerId: number) => {
		if (typeof handle.releasePointerCapture !== "function") return;
		try {
			handle.releasePointerCapture(pointerId);
		} catch {
			// Synthetic events or uncaptured pointers do not need release.
		}
	};

	const reset = () => {
		if (drag) releaseCapture(drag.pointerId);
		drag = null;
		clearVisual();
	};

	const requestDismiss = () => {
		if (typeof dialog.requestClose === "function") {
			dialog.requestClose();
			return;
		}
		const cancel = new realm.Event("cancel", { cancelable: true });
		if (dialog.dispatchEvent(cancel) && dialog.open) dialog.close();
	};

	handle.addEventListener("pointerdown", (event) => {
		if (!dialog.open || !isSheetActive() || !event.isPrimary || event.button !== 0) return;
		reset();
		const now = event.timeStamp || Date.now();
		drag = {
			pointerId: event.pointerId,
			startY: event.clientY,
			lastY: event.clientY,
			lastTime: now,
			offsetY: 0,
			velocityY: 0,
		};
		if (typeof handle.setPointerCapture === "function") {
			try {
				handle.setPointerCapture(event.pointerId);
			} catch {
				// Ignore capture errors for synthetic pointer events.
			}
		}
		setDraggingFlag(true);
		if (dialog.style) dialog.style.transition = "none";
	});

	handle.addEventListener("pointermove", (event) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!dialog.open) {
			reset();
			return;
		}
		const offsetY = clampSheetDragOffset(event.clientY - drag.startY);
		const now = event.timeStamp || Date.now();
		const dt = now - drag.lastTime;
		if (dt > 0) drag.velocityY = (event.clientY - drag.lastY) / dt;
		drag.lastY = event.clientY;
		drag.lastTime = now;
		drag.offsetY = offsetY;
		if (dialog.style) {
			dialog.style.transform = offsetY > 0 ? `translateY(${offsetY}px)` : "";
		}
	});

	handle.addEventListener("pointerup", (event) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const finalOffsetY = clampSheetDragOffset(event.clientY - drag.startY);
		const now = event.timeStamp || Date.now();
		const dt = now - drag.lastTime;
		const finalVelocityY =
			event.clientY !== drag.lastY && dt > 0
				? (event.clientY - drag.lastY) / dt
				: drag.velocityY;
		const pointerId = drag.pointerId;
		drag = null;
		releaseCapture(pointerId);
		setDraggingFlag(false);
		if (dialog.style) dialog.style.transition = "";

		if (shouldDismissSheetDrag({ offsetY: finalOffsetY, velocityY: finalVelocityY })) {
			requestDismiss();
		}
		// Clear inline transform whether closed (lets the closed CSS rule take over cleanly),
		// vetoed by onCancel, or released below threshold (springs smoothly back to 0).
		clearVisual();
	});

	handle.addEventListener("pointercancel", reset);
	dialog.addEventListener("cancel", (event) => {
		if (event.target === dialog) reset();
	});
	dialog.addEventListener("close", (event) => {
		if (event.target === dialog) reset();
	});
}
