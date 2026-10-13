const registered = new WeakSet<HTMLDialogElement>();

/** Element-owned listeners preserve native focus and the owner's existing cancel veto. */
export function registerNativeBackdropDismiss(candidate: unknown): void {
	const dialog = candidate as HTMLDialogElement | null;
	const realm = dialog?.ownerDocument?.defaultView;
	// Minimal lifecycle stubs and SSR are intentionally supported without registration.
	if (!realm?.HTMLDialogElement || !realm.PointerEvent ||
		!(dialog instanceof realm.HTMLDialogElement) ||
		typeof dialog.getBoundingClientRect !== "function" || registered.has(dialog)) return;
	registered.add(dialog);

	let gesture: { id: number; x: number; y: number; released: boolean } | null = null;
	const reset = () => { gesture = null; };
	const primary = (event: PointerEvent) => event.isPrimary && event.button === 0;
	const outside = (event: PointerEvent) => {
		if (!dialog.open || event.target !== dialog) return false;
		const bounds = dialog.getBoundingClientRect();
		return event.clientX < bounds.left || event.clientX > bounds.right ||
			event.clientY < bounds.top || event.clientY > bounds.bottom;
	};
	const matches = (event: PointerEvent) => gesture !== null &&
		event.pointerId === gesture.id && event.button === 0 && outside(event) &&
		Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 5;

	dialog.addEventListener("pointerdown", (event) => {
		reset();
		if (primary(event) && outside(event)) {
			gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, released: false };
		}
	});
	dialog.addEventListener("pointermove", (event) => {
		// Do not treat a drag (including an excursion into content) as a click.
		if (gesture && (event.pointerId !== gesture.id || !outside(event) ||
			Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5)) reset();
	});
	dialog.addEventListener("pointerup", (event) => {
		if (primary(event) && matches(event) && gesture) gesture.released = true;
		else reset();
	});
	dialog.addEventListener("click", (event) => {
		// Primary status belongs to down/up; click implementations need not retain isPrimary.
		const activate = event instanceof realm.PointerEvent && event.detail > 0 &&
			gesture?.released && matches(event);
		reset();
		if (!activate) return;
		if (typeof dialog.requestClose === "function") {
			dialog.requestClose();
			return;
		}
		// React onCancel sees the same cancelable native event in the element's own realm.
		// The close event, not this helper, updates visibility in the owning component.
		const cancel = new realm.Event("cancel", { cancelable: true });
		if (dialog.dispatchEvent(cancel) && dialog.open) dialog.close();
	});
	dialog.addEventListener("pointercancel", reset);
	dialog.addEventListener("cancel", (event) => { if (event.target === dialog) reset(); });
	dialog.addEventListener("close", (event) => { if (event.target === dialog) reset(); });
}
