import { useEffect, useRef, type SyntheticEvent } from "react";
import { syncNativeModalDialog } from "./CreateManualExpenseDialog";
import {
	canSubmitRemoval,
	getRemovalConfirmation,
	reduceRemovalDismissal,
	reduceRemovalState,
	type RemovalMovement,
	type RemovalState,
} from "./removalState";

export interface RemoveMovementDialogProps {
	/** Movement awaiting confirmation; `null` renders nothing. */
	movement: RemovalMovement | null;
	/** State produced by `reduceRemovalState`; the dialog never keeps a second phase copy. */
	state: RemovalState;
	/**
	 * Dismiss intent. It never re-sends anything; the parent owns mounting.
	 *
	 * The parent maps it by phase: `confirming` closes through the reducer's `cancel`
	 * event, and a terminal phase (`removed`/`failed`/`notFound`) closes through
	 * `dismissRemoval`, which keeps `removedMovementIds` so a stale row cannot be removed
	 * twice. It is also the native `close` handler, so `Esc` dismisses through the same
	 * by-phase rule.
	 */
	onCancel: () => void;
	/** Confirm intent. The parent performs the DELETE and feeds the outcome back as state. */
	onConfirm: () => void;
}

/**
 * Presentational native `<dialog>` for the removal confirmation. It renders the phase
 * produced by `reduceRemovalState`, so the single in-flight lock and the no-re-send rule
 * stay in the pure reducer. Review unit C wires it into the movements table.
 *
 * It is a real modal, using the same `syncNativeModalDialog` helper as the create and edit
 * dialogs: the confirmation for the irreversible Gmail hide cannot have less protection (no
 * focus trap, no `Esc`, inert `::backdrop`) than the reversible edit.
 */
export function RemoveMovementDialog({
	movement,
	state,
	onCancel,
	onConfirm,
}: RemoveMovementDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const isOpen = movement !== null && state.phase !== "closed";

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	if (!isOpen || !movement) return null;

	const confirmation = getRemovalConfirmation(movement);
	const { phase, errorMessage, reloadFailed } = state;
	const isRemoving = phase === "removing";
	const isFailed = phase === "failed";
	const isNotFound = phase === "notFound";
	const isRemoved = phase === "removed";
	// The reducer owns the rule that only `confirming` can be called off; ask it instead of
	// duplicating the phase table here.
	const canCancel = reduceRemovalState(state, { type: "cancel" }).phase === "closed";
	const canConfirm = canSubmitRemoval(state);
	// `Esc` may only dismiss a removal that has not been sent. While the DELETE is in flight the
	// `cancel` event is prevented, because closing then would hide the outcome of a request that
	// already left; every terminal phase dismisses through `reduceRemovalDismissal`, which keeps a
	// completed removal in `removedMovementIds`.
	const isDismissible = reduceRemovalDismissal(state) !== state;
	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		if (!isDismissible) event.preventDefault();
	};

	return (
		<dialog
			ref={dialogRef}
			className="react-removal-dialog"
			aria-labelledby="react-removal-dialog-title"
			aria-describedby="react-removal-dialog-description"
			onCancel={handleDialogCancel}
			onClose={onCancel}
		>
			<h2 id="react-removal-dialog-title">{confirmation.title}</h2>
			<p id="react-removal-dialog-description">{confirmation.message}</p>
			{isRemoving && (
				<p className="react-removal-dialog-pending" role="status">
					Eliminando movimiento...
				</p>
			)}
			{(isFailed || isNotFound) && errorMessage !== null && (
				<p className="react-removal-dialog-error" role="alert">{errorMessage}</p>
			)}
			{isRemoved && (
				<div className="react-removal-dialog-result" role="status">
					<p>El movimiento se eliminó correctamente.</p>
					{reloadFailed && (
						<p className="react-removal-dialog-stale">
							La lista de movimientos no se pudo actualizar y puede estar
							desactualizada: puede seguir mostrando el movimiento eliminado. Actualiza
							la página para ver el estado real.
						</p>
					)}
				</div>
			)}
			<div className="react-shell-actions">
				{/* Closing after a terminal phase is a dismissal, not a rollback: the movement
				    is either gone (removed) or untouched (failed/notFound). The parent dismisses
				    through `dismissRemoval`, which remembers a completed removal. */}
				{isRemoved || isFailed || isNotFound ? (
					<button type="button" className="secondary" onClick={onCancel}>
						Cerrar
					</button>
				) : (
					<button type="button" className="secondary" onClick={onCancel} disabled={!canCancel || isRemoving}>
						{confirmation.cancelLabel}
					</button>
				)}
				{/* A movement the server could not locate is terminal, exactly like the edit flow: the
				    same DELETE cannot succeed by repeating it, so no retry control is offered. */}
				{!isRemoved && !isNotFound && (
					<button
						type="button"
						className="react-removal-dialog-confirm"
						onClick={onConfirm}
						disabled={!canConfirm}
						aria-busy={isRemoving}
					>
						{isRemoving ? "Eliminando..." : isFailed ? "Reintentar" : confirmation.confirmLabel}
					</button>
				)}
			</div>
		</dialog>
	);
}
