import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
	CYCLE_COMPLETION_PENDING_MESSAGE,
	getCycleCompletionNotice,
	shouldClearCycleCompletionPhase,
	type CycleCompletionNotice,
	type CycleCompletionSubmitOutcome,
	type CycleCompletionSubmitter,
} from "./cycleCompletion";
import { formatPeriodLabel } from "../movements/manualExpense";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import type { FinancialCycleResponse } from "../../api/types";

/**
 * `Cerrar período` confirmation. The copy is the point: the closure reads the mailbox and only happens if that read
 * completes, so the confirmation says so before the user consents, and the outcomes that wrote nothing are reported as
 * such. All of it comes from `cycleCompletion`; this file owns only React state and the native modal, through the same
 * `syncNativeModalDialog` and `isOpen`/`onClose` contract as the shipped dialogs.
 */

type CycleCompletionStatus = { message: string; tone: "pending" | CycleCompletionNotice["tone"] };

export interface CompleteCycleDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** Configured cycle: its period is closed, and its closure tells a re-close from a fresh one. */
	cycle: FinancialCycleResponse | null;
	/** Dismissal intent. It never re-sends the POST. */
	onClose: () => void;
	/** Performs the single in-flight closure and its follow-up period reload. */
	submitCompletion: CycleCompletionSubmitter;
}

export function CompleteCycleDialog({
	isOpen,
	cycle,
	onClose,
	submitCompletion,
}: CompleteCycleDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const [status, setStatus] = useState<CycleCompletionStatus | null>(null);
	const isClosing = status?.tone === "pending";
	const period = cycle?.selectedPeriod ?? null;

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	// Only the open transition resets: the fresh `cycle` object a reload hands out must not wipe a result on screen.
	useEffect(() => {
		if (isOpen) setStatus(null);
	}, [isOpen]);

	/** Runs the single closure and reports it. The pending reset is gated on the tested predicate, so the
	 * attempt that owns the lock keeps the status. */
	const handleConfirm = async () => {
		if (isClosing || period === null) return;
		setStatus({ message: CYCLE_COMPLETION_PENDING_MESSAGE, tone: "pending" });
		const outcome: CycleCompletionSubmitOutcome = await submitCompletion(period)
			.catch((): CycleCompletionSubmitOutcome => ({ status: "failed" }));
		if (!shouldClearCycleCompletionPhase(outcome)) return;
		setStatus(getCycleCompletionNotice(outcome));
	};

	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		// `Esc` must not hide a closure that may have been written: only this result says so.
		if (isClosing) event.preventDefault();
	};

	if (!isOpen || period === null) return null;

	const isSettled = status !== null && status.tone !== "pending";

	return (
		<dialog
			ref={dialogRef}
			className="react-financial-cycle-dialog"
			aria-labelledby="react-financial-cycle-completion-title" aria-describedby="react-financial-cycle-completion-consent"
			onCancel={handleDialogCancel} onClose={onClose}
		>
			<div className="react-financial-cycle-form">
				<h2 id="react-financial-cycle-completion-title">Cerrar período</h2>
				{/* The read the user consents to, and the condition the closure depends on: no synchronization,
				    no closure. */}
				<p id="react-financial-cycle-completion-consent" className="react-financial-cycle-closure-note">
					Cerrar el periodo {formatPeriodLabel(period)} lee tu correo de Gmail: el servidor
					sincroniza los mensajes del periodo y solo registra el cierre si esa sincronización se
					completa. Si la sincronización no se completa, no se registra ningún cierre y el periodo
					sigue abierto. Si el periodo ya tuviera un cierre registrado, se conserva el registro
					original.
				</p>
				{status !== null && (
					<p className={`react-financial-cycle-status react-financial-cycle-status-${status.tone}`} role={status.tone === "error" ? "alert" : "status"}>
						{status.message}
					</p>
				)}
				<div className="react-shell-actions">
					<button type="button" onClick={handleConfirm} disabled={isClosing || status?.tone === "success"}>
						{isClosing ? "Cerrando..." : "Cerrar período"}</button>
					<button type="button" className="secondary" onClick={onClose} disabled={isClosing}>
						{isSettled ? "Cerrar" : "Cancelar"}</button>
				</div>
			</div>
		</dialog>
	);
}
