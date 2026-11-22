import { useEffect, useRef } from "react";
import { DashboardPaceGauge } from "../analytics/DashboardPaceGauge";
import type { DashboardPace } from "../analytics/dashboardPace";
import { useRetainedWhileClosing } from "../feedback/motion";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import { isFirstResultOpen, type FirstResultPhase } from "./firstResultFlow";
import { FirstResultExplainer } from "./FirstResultExplainer";
import "./onboarding.css";

export interface FirstResultDialogProps {
	/** The summary owns the phase (`firstResultFlow`); the dialog only mirrors it. */
	phase: FirstResultPhase;
	/** The new cycle's gauge once the reload finished; `null` while it is still loading. */
	pace: DashboardPace | null;
	formatClp?: (amount: number) => string;
	/** "Ver mi resumen", Escape and the backdrop: all close the step through the same path. */
	onDone: () => void;
	/** Without income: close the step and open the existing add-income flow. */
	onAddIncome: () => void;
}

/**
 * Onboarding step 3 — "Paso 3 de 3 · Tu medidor" (S21). Same dialog as the cycle setup (stepper with the
 * third step current, width, bottom sheet and motion): it opens the moment the first cycle is saved with
 * a loading line, then shows the user's real gauge, one line on how to read it and "Ver mi resumen".
 * Without income it shows the no-income gauge and how to add it instead of a state.
 */
export function FirstResultDialog({ phase, pace, formatClp, onDone, onAddIncome }: FirstResultDialogProps) {
	const isOpen = isFirstResultOpen(phase);
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const doneRef = useRef<HTMLButtonElement | null>(null);
	const wasOpen = useRef(false);
	// The closing sheet keeps its last content while it slides away.
	const shown = useRetainedWhileClosing(isOpen ? { phase, pace } : null);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
		if (isOpen) {
			wasOpen.current = true;
			return;
		}
		if (!wasOpen.current) return;
		wasOpen.current = false;
		// The setup dialog that held focus is gone, so the browser has nowhere to return it: land on the
		// page title unless something else (the add-income dialog) already took focus.
		const active = document.activeElement;
		if (active && active !== document.body) return;
		const title = document.getElementById("react-dashboard-title");
		if (!title) return;
		title.setAttribute("tabindex", "-1");
		title.focus({ preventScroll: true });
	}, [isOpen]);

	// The loading state has nothing to focus; move into the primary action once the gauge is there.
	useEffect(() => {
		if (phase === "shown") doneRef.current?.focus({ preventScroll: true });
	}, [phase]);

	if (!shown.value) return null;
	const current = shown.value;
	const ready = current.phase === "shown" && current.pace !== null;
	const hasIncome = current.pace?.kind === "income";

	return (
		<dialog
			ref={dialogRef}
			className="react-first-result-dialog cycle-dialog"
			aria-labelledby="react-first-result-title"
			aria-busy={!ready}
			inert={!isOpen}
			onCancel={(event) => {
				// Escape and the backdrop dismiss the shown step; the brief loading state ignores them.
				event.preventDefault();
				if (phase === "shown") onDone();
			}}
			onClose={isOpen ? () => {
				// A native close that the cancel handler did not route (e.g. a stray close()).
				if (phase === "shown") onDone();
				else syncNativeModalDialog(dialogRef.current, true);
			} : undefined}
			onTransitionEnd={shown.onTransitionEnd}
		>
			<div className="cycle-form">
				<div className="cycle-body">
					<div className="cycle-grab" aria-hidden="true" />
					<header>
						<ol className="cycle-steps" aria-label="Pasos para empezar">
							<li className="is-done"><span className="cycle-step-bar" aria-hidden="true" /><span className="cycle-sr">Paso 1, Conectar, hecho</span></li>
							<li className="is-done"><span className="cycle-step-bar" aria-hidden="true" /><span className="cycle-sr">Paso 2, Tu período, hecho</span></li>
							<li aria-current="step"><span className="cycle-step-bar" aria-hidden="true" /><span className="cycle-sr">Paso 3, Tu medidor, paso actual</span></li>
						</ol>
						<p className="cycle-kicker">Paso 3 de 3 · Tu medidor</p>
						<h2 id="react-first-result-title" className="cycle-title">
							{ready ? "Tu medidor está listo" : "Tu período está guardado"}
						</h2>
					</header>
					{ready && current.pace ? (
						<div className="first-result-body">
							<DashboardPaceGauge pace={current.pace} formatClp={formatClp} compact />
							<FirstResultExplainer withIncome={hasIncome} />
						</div>
					) : (
						<p className="first-result-loading" role="status">
							<span className="first-result-spinner" aria-hidden="true" />
							Preparando tu medidor…
						</p>
					)}
				</div>
				{ready ? (
					<div className="cycle-foot">
						<div className="cycle-actions">
							{!hasIncome ? (
								<button type="button" className="secondary cycle-btn cycle-btn-ghost" onClick={onAddIncome}>
									Agregar ingreso
								</button>
							) : null}
							<button ref={doneRef} type="button" className="cycle-btn cycle-btn-primary" onClick={onDone}>
								Ver mi resumen
							</button>
						</div>
					</div>
				) : null}
			</div>
		</dialog>
	);
}
