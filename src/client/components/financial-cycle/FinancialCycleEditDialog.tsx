import { useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import { CycleCalendar } from "./CycleCalendar";
import {
	createCalendarRange,
	getCurrentYearCalendarBounds,
	selectCalendarDate,
	validateCalendarRange,
} from "./cycleCalendar";
import {
	createCycleEditDraft,
	getCycleClosureNotice,
	getCycleEditFailureMessage,
	shouldClearCycleEditPhase,
	validateCycleEditDraft,
	type CycleEditDraft,
	type CycleEditSubmitOutcome,
	type CycleEditSubmitter,
} from "./cycleSettings";
import type { FinancialCycleResponse } from "../../api/types";

/**
 * `Cambiar período` dialog: edits the dates and the income of the configured period.
 *
 * This is the whole of "navigation" in a period-scoped surface — legacy hides the month picker once a
 * cycle exists (`public/app.js:1013-1017`), so reopening the cycle is the only way to review another
 * range. Every decision it renders comes from `cycleSettings`: the prefilled draft, the validation
 * copy, and the completion consequence that a range change would otherwise lose silently. This file
 * owns only React state.
 *
 * It is a real modal through the same `syncNativeModalDialog` helper as the movement, Gmail, settings
 * and counterparty dialogs, and it is mounted only inside the authenticated summary, so the read-only
 * demo never renders it.
 */

type CycleEditStatus = {
	message: string;
	tone: "pending" | "error";
};

const PENDING_MESSAGE = "Guardando los cambios del periodo...";

export interface FinancialCycleClosureNoteProps {
	/** The configured cycle the consequence is derived from. */
	cycle: FinancialCycleResponse | null;
	/** The draft whose range decides which consequence applies. */
	draft: CycleEditDraft;
}

/**
 * The closed-period statement and the fate of the closure record, shown before the save.
 *
 * Exported so both consequences are provable from markup: the range the dialog derives from the
 * configured cycle is always the unchanged one, so the different-range case is only reachable with a
 * draft the test hands over.
 */
export function FinancialCycleClosureNote({ cycle, draft }: FinancialCycleClosureNoteProps) {
	const closure = getCycleClosureNotice(cycle, draft);
	if (closure.closedMessage === null) return null;
	return (
		<div className="react-financial-cycle-closure-note" role="status">
			<p>{closure.closedMessage}</p>
			{closure.consequenceMessage !== null && <p>{closure.consequenceMessage}</p>}
		</div>
	);
}

export interface FinancialCycleEditDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** Configured cycle the draft is prefilled from; `null` keeps the dialog closed. */
	cycle: FinancialCycleResponse | null;
	/** Dismissal intent. It never re-sends the PUT. */
	onClose: () => void;
	/** Performs the single in-flight save and its follow-up period reload. */
	submitCycle: CycleEditSubmitter;
	/** Called after a successful save so the summary can report the outcome and close the dialog. */
	onSaved: (reloadFailed: boolean) => void;
}

export function FinancialCycleEditDialog({
	isOpen,
	cycle,
	onClose,
	submitCycle,
	onSaved,
}: FinancialCycleEditDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	// The calendar's selectable/navigation window is the current calendar year through the current
	// month, so a stored cycle narrower than the year so far can still be widened. It is frozen for the
	// life of the dialog so a midnight rollover cannot re-anchor the grid mid-edit.
	const calendarBounds = useMemo(() => getCurrentYearCalendarBounds(), []);
	// Derived during render rather than filled by an effect, so an open dialog never renders empty
	// fields first and the prefilled values are what the markup shows.
	const [draft, setDraft] = useState<CycleEditDraft>(() => createCycleEditDraft(cycle));
	const [status, setStatus] = useState<CycleEditStatus | null>(null);
	/** The date validation error, shown on the calendar as well as in the status line. */
	const [calendarError, setCalendarError] = useState<string | null>(null);
	/** The legacy two-click range: the first click sets the start, the second sets the end. */
	const [awaitingRangeEnd, setAwaitingRangeEnd] = useState(false);
	const isSaving = status?.tone === "pending";
	// The configured bounds are the identity of what the draft describes. Keyed on them instead of on
	// the `cycle` object, which the dashboard hands out fresh on every reload: an unrelated reload must
	// not discard dates the user already edited.
	const configuredRangeKey = cycle?.selectedPeriod
		? `${cycle.selectedPeriod.startDate}|${cycle.selectedPeriod.endDateExclusive}`
		: null;

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	// Opening starts a fresh surface prefilled from the configured cycle: no previous outcome and no
	// stale draft can leak into a new attempt.
	useEffect(() => {
		if (!isOpen) return;
		setDraft(createCycleEditDraft(cycle));
		setStatus(null);
		setCalendarError(null);
		setAwaitingRangeEnd(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen, configuredRangeKey]);

	const updateDraft = (patch: Partial<CycleEditDraft>) =>
		setDraft((current) => ({ ...current, ...patch }));

	const calendarRange = {
		...createCalendarRange(draft.startDate, draft.endDate),
		awaitingEnd: awaitingRangeEnd,
	};

	const handleCalendarSelect = (dateKey: string) => {
		const next = selectCalendarDate(calendarRange, dateKey);
		setDraft((current) => ({
			...current,
			startDate: next.startDate,
			endDate: next.endDate,
		}));
		setAwaitingRangeEnd(next.awaitingEnd);
		setCalendarError(null);
	};

	/**
	 * Runs the single save and reports exactly what happened.
	 *
	 * A failure never claims success, and it keeps the entered values so they can be corrected. The
	 * reset of the pending status is gated on the tested predicate: the `busy` outcome left no request
	 * behind, so the attempt that owns the lock is still the one that owns the status. The submitter
	 * this app wires in reports every rejection through its outcome and cannot throw, so the `catch`
	 * only guarantees that a throwing implementation still leaves the dialog truthful and unlocked.
	 */
	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isSaving) return;

		const dateValidation = validateCalendarRange(draft.startDate, draft.endDate);
		if (!dateValidation.ok) {
			// Nothing was sent, so this is an invalid draft rather than a rejected save. The same message
			// is shown inline on the calendar and in the status line.
			setCalendarError(dateValidation.message);
			setStatus({ message: dateValidation.message, tone: "error" });
			return;
		}
		setCalendarError(null);

		const validation = validateCycleEditDraft(draft);
		if (!validation.ok) {
			// Nothing was sent, so this is an invalid draft rather than a rejected save.
			setStatus({ message: validation.message, tone: "error" });
			return;
		}

		setStatus({ message: PENDING_MESSAGE, tone: "pending" });
		const outcome: CycleEditSubmitOutcome = await submitCycle(draft).catch(
			(error): CycleEditSubmitOutcome => ({
				status: "failed",
				message: getCycleEditFailureMessage(error),
			}),
		);
		if (!shouldClearCycleEditPhase(outcome)) return;
		if (outcome.status === "failed") {
			setStatus({ message: outcome.message, tone: "error" });
			return;
		}
		// The summary reports the saved period and the reload outcome, and closes this dialog.
		onSaved(outcome.reloadFailed);
	};

	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		// `Esc` must not hide a save that is already on its way.
		if (isSaving) event.preventDefault();
	};

	if (!isOpen || cycle === null) return null;

	return (
		<dialog
			ref={dialogRef}
			className="react-financial-cycle-dialog react-financial-cycle-edit-dialog"
			aria-labelledby="react-financial-cycle-edit-title"
			onCancel={handleDialogCancel}
			onClose={onClose}
		>
			<h2 id="react-financial-cycle-edit-title">Cambiar período</h2>
			<FinancialCycleClosureNote cycle={cycle} draft={draft} />
			<form className="react-financial-cycle-form" onSubmit={handleSubmit} aria-busy={isSaving}>
				{/* The calendar augments the text fields and is bounded by the current year through the
				    current month, not by the stored cycle; the fields below keep the unchanged submit
				    behaviour. */}
				{cycle.selectedPeriod && (
					<CycleCalendar
						bounds={calendarBounds}
						range={calendarRange}
						onSelectDate={handleCalendarSelect}
						disabled={isSaving}
						error={calendarError}
					/>
				)}
				{/* The same three fields and ids the setup form uses. The two forms cannot be on screen at
				    the same time: the setup form is the unconfigured state and this dialog is the ready one. */}
				<div className="react-financial-setup-fields">
					<label htmlFor="financial-cycle-start-date">
						<span>Fecha de inicio</span>
						<input
							id="financial-cycle-start-date"
							type="date"
							value={draft.startDate}
							onChange={(event) => {
								updateDraft({ startDate: event.target.value });
								setCalendarError(null);
							}}
							disabled={isSaving}
							required
						/>
					</label>
					<label htmlFor="financial-cycle-end-date">
						<span>Fecha de término (inclusive)</span>
						<input
							id="financial-cycle-end-date"
							type="date"
							value={draft.endDate}
							onChange={(event) => {
								updateDraft({ endDate: event.target.value });
								setCalendarError(null);
							}}
							disabled={isSaving}
							required
						/>
					</label>
					<label htmlFor="financial-cycle-income">
						<span>Ingreso mensual (opcional)</span>
						<input
							id="financial-cycle-income"
							type="text"
							inputMode="numeric"
							value={draft.incomeValue}
							onChange={(event) => updateDraft({ incomeValue: event.target.value })}
							disabled={isSaving}
							aria-describedby="financial-cycle-income-help"
						/>
						<small id="financial-cycle-income-help">
							Monto en CLP sin decimales. Ejemplo: 900.000
						</small>
					</label>
				</div>
				{status !== null && (
					<p
						className={`react-financial-cycle-status react-financial-cycle-status-${status.tone}`}
						role={status.tone === "error" ? "alert" : "status"}
					>
						{status.message}
					</p>
				)}
				<div className="react-shell-actions">
					<button type="submit" disabled={isSaving}>
						{isSaving ? "Guardando..." : "Guardar cambios"}
					</button>
					<button type="button" className="secondary" onClick={onClose} disabled={isSaving}>
						Cancelar
					</button>
				</div>
			</form>
		</dialog>
	);
}
