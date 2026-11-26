import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import "./account-reconciliation.css";
import { formatClpAmountInput } from "../movements/manualExpense";
import {
	formatReconciliationClp,
	formatSignedReconciliationClp,
	parseClpBalanceInput,
	type AccountReconciliationModel,
} from "./accountReconciliation";

/**
 * "Cuadre con tu cuenta" as a state chip beside the hero figure plus an on-demand panel
 * (a popover on desktop, a bottom sheet on narrow screens).
 * Follows design/cuadre-saldo-real/04-chip-hero-popover.html and 05-chip-movil-bottom-sheet.html.
 */
export interface AccountReconciliationChipProps {
	model: AccountReconciliationModel;
	/** Persists the real balance (negative allowed for credit lines) or `null` to clear it. */
	onSave?: (actualBalance: number | null) => Promise<void>;
	onAddIncome?: () => void;
	readOnly?: boolean;
}

type Step = "summary" | "input";
type HintTone = "neutral" | "warn";
interface Hint {
	tone: HintTone;
	text: ReactNode;
}

function plural(count: number, singular: string, pluralForm: string): string {
	return count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;
}

function magnitudeInput(amount: number | null): string {
	return amount === null ? "" : Math.abs(Math.round(amount)).toLocaleString("es-CL");
}

function buildHints(model: AccountReconciliationModel): Hint[] {
	const hints: Hint[] = [];
	if (model.movementsAfterCount > 0) {
		hints.push({
			tone: "warn",
			text: `${plural(model.movementsAfterCount, "gasto registrado", "gastos registrados")} después de tu último corte. Vuelve a confirmar tu saldo.`,
		});
	}
	if (model.pendingAmountCount > 0) {
		hints.push({
			tone: "warn",
			text: `${plural(model.pendingAmountCount, "movimiento sin monto", "movimientos sin monto")} aún no se descuentan: la brecha real podría ser menor.`,
		});
	}
	if (model.creditLineUsed !== null) {
		hints.push({
			tone: "neutral",
			text: (
				<>
					Estás usando <b>{formatReconciliationClp(model.creditLineUsed)}</b> de tu línea de crédito: es dinero que te debes a ti mismo.
				</>
			),
		});
	}
	if (hints.every((hint) => hint.tone !== "warn")) {
		if (model.kind === "gap") hints.push({ tone: "neutral", text: "Suele ser efectivo, comisiones o compras sin correo." });
		if (model.kind === "surplus") hints.push({ tone: "neutral", text: "Puede ser un ingreso extra, saldo arrastrado o un gasto duplicado." });
		if (model.kind === "matched") hints.push({ tone: "neutral", text: "Tu saldo real coincide con lo calculado en este ciclo." });
	}
	return hints;
}

const InfoIcon = () => (
	<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="react-recon-hint-icon">
		<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
		<path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		<circle cx="8" cy="4.8" r=".9" fill="currentColor" />
	</svg>
);

function ChipIcon({ kind }: { kind: AccountReconciliationModel["kind"] }) {
	if (kind === "empty" || kind === "no-income") {
		return (
			<svg className="react-recon-chip-icon" viewBox="0 0 18 18" aria-hidden="true">
				<path d="M2.5 7 9 3l6.5 4M4 7.5v5M7.3 7.5v5M10.7 7.5v5M14 7.5v5M2.5 14.5h13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	return (
		<svg className="react-recon-chip-icon" viewBox="0 0 18 18" aria-hidden="true">
			<circle cx="9" cy="9" r="8" fill="currentColor" opacity=".15" />
			{kind === "matched" ? (
				<path d="M5.5 9.2 7.8 11.4 12.5 6.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
			) : kind === "surplus" ? (
				<path d="M9 5.5v7M5.5 9h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			) : (
				<>
					<path d="M9 5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
					<circle cx="9" cy="12.6" r="1" fill="currentColor" />
				</>
			)}
		</svg>
	);
}

function chipCopy(model: AccountReconciliationModel): { tone: "empty" | "tight" | "calm"; label: string } {
	switch (model.kind) {
		case "gap":
			return { tone: "tight", label: `${formatReconciliationClp(model.difference ?? 0)} sin seguimiento` };
		case "surplus":
			return { tone: "calm", label: `+${formatReconciliationClp(model.difference ?? 0)} a favor` };
		case "matched":
			return { tone: "calm", label: "Cuadrado" };
		default:
			return { tone: "empty", label: "Cuadrar con tu banco" };
	}
}

export function AccountReconciliationChip({ model, onSave, onAddIncome, readOnly = false }: AccountReconciliationChipProps) {
	const panelId = useId();
	const titleId = useId();
	const inputId = useId();
	const signId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const chipRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<Step>("summary");
	const [inputValue, setInputValue] = useState(() => magnitudeInput(model.actualBalance));
	const [negative, setNegative] = useState(() => (model.actualBalance ?? 0) < 0);
	const [isSaving, setIsSaving] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		setInputValue(magnitudeInput(model.actualBalance));
		setNegative((model.actualBalance ?? 0) < 0);
		setErrorMessage(null);
	}, [model.actualBalance, model.actualBalanceAt]);

	const close = (restoreFocus = true) => {
		setOpen(false);
		setStep("summary");
		setErrorMessage(null);
		if (restoreFocus) chipRef.current?.focus();
	};

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		const onPointer = (event: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", onPointer);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("pointerdown", onPointer);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const target = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
		target?.focus();
	}, [open, step]);

	const canEdit = Boolean(onSave) && !readOnly && model.kind !== "no-income";
	const hasBalance = model.actualBalance !== null && model.kind !== "no-income";
	const showInput = canEdit && (model.kind === "empty" || step === "input");
	const chip = chipCopy(model);
	const hasCaveat = model.pendingAmountCount > 0 || model.movementsAfterCount > 0;
	const hints = hasBalance ? buildHints(model) : [];

	const runSave = async (value: number | null, failure: string) => {
		if (!onSave || isSaving) return false;
		setErrorMessage(null);
		setIsSaving(true);
		try {
			await onSave(value);
			return true;
		} catch {
			setErrorMessage(failure);
			return false;
		} finally {
			setIsSaving(false);
		}
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canEdit) return;
		const parsed = parseClpBalanceInput(inputValue);
		if (parsed === undefined || parsed === null) {
			setErrorMessage("Ingresa un monto entero en pesos chilenos (por ejemplo, 495.070 o 0).");
			return;
		}
		const value = negative && parsed !== 0 ? -Math.abs(parsed) : Math.abs(parsed);
		if (await runSave(value, "No pudimos guardar el saldo real. Intenta nuevamente.")) setStep("summary");
	};

	// Typing shows CLP thousands as you go ("20000" -> "20.000"); a minus switches the sign toggle on.
	const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
		const input = event.target;
		const typed = input.value;
		if (/[-−]/.test(typed)) setNegative(true);
		const caret = input.selectionStart ?? typed.length;
		const formatted = formatClpAmountInput(typed);
		setInputValue(formatted);
		if (errorMessage) setErrorMessage(null);
		// Reformatting moves the caret to the end; an edit in the middle keeps its digit position.
		if (caret >= typed.length) return;
		const digitsBeforeCaret = typed.slice(0, caret).replace(/\D/g, "").replace(/^0+(?=\d)/, "").length;
		let position = 0;
		let seen = 0;
		while (position < formatted.length && seen < digitsBeforeCaret) {
			if (formatted[position] !== ".") seen += 1;
			position += 1;
		}
		window.requestAnimationFrame(() => input.setSelectionRange(position, position));
	};

	const handleConfirm = async () => {
		if (model.actualBalance === null) return;
		if (await runSave(model.actualBalance, "No pudimos confirmar el saldo. Intenta nuevamente.")) close();
	};

	const handleClear = async () => {
		if (await runSave(null, "No pudimos quitar el saldo real. Intenta nuevamente.")) setStep("summary");
	};

	const chipAria = [
		model.kind === "matched" ? "Cuadrado con tu cuenta" : chip.label,
		model.shortUpdatedLabel,
		model.movementsAfterCount > 0 ? "saldo posiblemente desactualizado" : null,
		model.pendingAmountCount > 0 ? plural(model.pendingAmountCount, "movimiento sin monto", "movimientos sin monto") : null,
	].filter(Boolean).join(", ");

	// The ledger label already says which way the gap goes ("Dinero sin seguimiento" or
	// "Saldo a favor no registrado"), so the result shows the amount without a minus sign.
	const resultText =
		model.difference === null
			? "—"
			: model.kind === "matched"
				? "$0"
				: `${model.kind === "surplus" ? "+" : ""}${formatReconciliationClp(model.difference)}`;

	return (
		<div className={`react-recon${open ? " is-open" : ""}`} ref={rootRef}>
			<button
				ref={chipRef}
				type="button"
				className={`react-recon-chip is-${chip.tone}`}
				aria-expanded={open ? "true" : "false"}
				aria-controls={panelId}
				aria-haspopup="dialog"
				aria-label={`${chipAria}. Abrir cuadre con tu cuenta`}
				onClick={() => (open ? close() : setOpen(true))}
			>
				<ChipIcon kind={model.kind} />
				<span className="react-recon-chip-label">
					{chip.label}
					{model.shortUpdatedLabel && model.kind !== "empty" ? (
						<span className="react-recon-chip-meta"> · {model.shortUpdatedLabel}</span>
					) : null}
				</span>
				{hasCaveat ? <span className="react-recon-chip-dot" aria-hidden="true" /> : null}
				<svg className="react-recon-chip-caret" viewBox="0 0 12 12" aria-hidden="true">
					<path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>

			{open ? <div className="react-recon-scrim" aria-hidden="true" onClick={() => close()} /> : null}

			<div
				ref={panelRef}
				id={panelId}
				className="react-recon-panel"
				role="dialog"
				aria-labelledby={titleId}
				aria-live="polite"
				hidden={!open}
			>
				<div className="react-recon-grabber" aria-hidden="true" />
				<div className="react-recon-head">
					<div>
						<h2 id={titleId}>Cuadre con tu cuenta</h2>
						<p>{model.updatedLabel}</p>
					</div>
					<button type="button" className="react-recon-close" aria-label="Cerrar" onClick={() => close()} data-autofocus={!canEdit ? "" : undefined}>
						<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
						</svg>
					</button>
				</div>

				{model.kind === "no-income" || (model.kind === "empty" && !canEdit) ? (
					<p className="react-recon-note">{model.callout.body}</p>
				) : null}

				{model.kind === "no-income" && onAddIncome && !readOnly ? (
					<button type="button" className="button primary react-recon-btn" onClick={onAddIncome} data-autofocus="">
						Configurar ingreso del ciclo
					</button>
				) : null}

				{hasBalance && !showInput ? (
					<>
						<dl className="react-recon-ledger">
							<div>
								<dt>Según tus registros</dt>
								<dd>{formatSignedReconciliationClp(model.theoreticalRemaining ?? 0)}</dd>
							</div>
							<div>
								<dt>En tu cuenta</dt>
								<dd>{formatSignedReconciliationClp(model.actualBalance ?? 0)}</dd>
							</div>
							<div className={`react-recon-ledger-total is-${model.diffTone}`}>
								<dt>{model.diffLabel}</dt>
								<dd>{resultText}</dd>
							</div>
						</dl>
						{hints.map((hint, index) => (
							<p key={index} className={`react-recon-hint is-${hint.tone}`}>
								<InfoIcon />
								<span>{hint.text}</span>
							</p>
						))}
						{canEdit ? (
							<>
								<p className="react-recon-question">
									¿Sigues teniendo <span className="react-recon-num">{formatSignedReconciliationClp(model.actualBalance ?? 0)}</span> en tu cuenta?
								</p>
								<div className="react-recon-choices">
									<button type="button" className="button primary react-recon-btn" onClick={handleConfirm} disabled={isSaving} data-autofocus="">
										{isSaving ? "Guardando…" : "Sí, confirmar"}
									</button>
									<button type="button" className="react-recon-btn react-recon-btn-secondary" onClick={() => setStep("input")} disabled={isSaving}>
										No, cambió
									</button>
								</div>
							</>
						) : null}
					</>
				) : null}

				{showInput ? (
					<form className="react-recon-form" onSubmit={handleSubmit} noValidate>
						<label className="react-recon-question" htmlFor={inputId}>¿Cuánto tienes hoy en tu cuenta?</label>
						<div className="react-recon-input-row">
							<div className={`react-recon-clp${negative ? " is-negative" : ""}`}>
								<span className="react-recon-clp-prefix" aria-hidden="true">{negative ? "−$" : "$"}</span>
								<input
									id={inputId}
									className="react-recon-input"
									type="text"
									inputMode="numeric"
									autoComplete="off"
									value={inputValue}
									placeholder="Ej. 495.070"
									aria-describedby={signId}
									disabled={isSaving}
									data-autofocus=""
									onChange={handleInputChange}
								/>
							</div>
							<button type="submit" className="button primary react-recon-btn" disabled={isSaving}>
								{isSaving ? "Guardando…" : "Guardar saldo"}
							</button>
						</div>
						<label className="react-recon-sign" id={signId}>
							<input type="checkbox" checked={negative} onChange={(event) => setNegative(event.target.checked)} disabled={isSaving} />
							<span>Saldo en negativo (estoy usando mi línea de crédito)</span>
						</label>
						<p className="react-recon-hint is-neutral">
							<InfoIcon />
							<span>
								Lo comparamos con los <b>{formatSignedReconciliationClp(model.theoreticalRemaining ?? 0)}</b> que calculan tus registros.
							</span>
						</p>
						{hasBalance ? (
							<button type="button" className="react-recon-link" onClick={() => setStep("summary")} disabled={isSaving}>
								Cancelar
							</button>
						) : null}
					</form>
				) : null}

				{errorMessage ? (
					<p className="react-recon-error" role="alert">{errorMessage}</p>
				) : null}

				{canEdit && model.actualBalance !== null ? (
					<div className="react-recon-foot">
						<span>Solo tú ves este saldo</span>
						<button type="button" className="react-recon-link" onClick={handleClear} disabled={isSaving}>
							Quitar saldo real
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
