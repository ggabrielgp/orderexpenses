import { useEffect, useState, type FormEvent } from "react";
import "./account-reconciliation.css";
import {
	formatReconciliationClp,
	parseClpBalanceInput,
	type AccountReconciliationModel,
} from "./accountReconciliation";

export interface AccountReconciliationCardProps {
	model: AccountReconciliationModel;
	onSave?: (actualBalance: number | null) => Promise<void>;
	onAddIncome?: () => void;
	readOnly?: boolean;
}

function formatInputValue(amount: number | null): string {
	return amount === null ? "" : Math.round(amount).toLocaleString("es-CL");
}

function formatSignedTheoretical(amount: number | null): string {
	if (amount === null) return "—";
	const formatted = formatReconciliationClp(amount);
	return amount < 0 ? `-${formatted}` : formatted;
}

function formatDifferenceDisplay(model: AccountReconciliationModel): string {
	if (model.difference === null) return "—";
	if (model.kind === "matched") return "$0";
	if (model.kind === "surplus") return `+${formatReconciliationClp(model.difference)}`;
	return formatReconciliationClp(model.difference);
}

export function AccountReconciliationCard({
	model,
	onSave,
	onAddIncome,
	readOnly = false,
}: AccountReconciliationCardProps) {
	const [inputValue, setInputValue] = useState(() => formatInputValue(model.actualBalance));
	const [isSaving, setIsSaving] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		setInputValue(formatInputValue(model.actualBalance));
		setErrorMessage(null);
	}, [model.actualBalance, model.actualBalanceAt]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!onSave || readOnly || isSaving) return;

		const parsed = parseClpBalanceInput(inputValue);
		if (parsed === undefined) {
			setErrorMessage("Ingresa un monto entero en pesos chilenos (por ejemplo, 495.070 o 0).");
			return;
		}

		setErrorMessage(null);
		setIsSaving(true);
		try {
			await onSave(parsed);
			setInputValue(formatInputValue(parsed));
		} catch {
			setErrorMessage("No pudimos guardar el saldo real. Intenta nuevamente.");
		} finally {
			setIsSaving(false);
		}
	};

	const handleClear = async () => {
		if (!onSave || readOnly || isSaving) return;
		setErrorMessage(null);
		setIsSaving(true);
		try {
			await onSave(null);
			setInputValue("");
		} catch {
			setErrorMessage("No pudimos limpiar el saldo real. Intenta nuevamente.");
		} finally {
			setIsSaving(false);
		}
	};

	const canEdit = Boolean(onSave) && !readOnly && model.kind !== "no-income";

	return (
		<section
			className="panel react-reconciliation-card"
			aria-labelledby="react-reconciliation-title"
			aria-live="polite"
		>
			<div className="react-reconciliation-head">
				<div>
					<h2 id="react-reconciliation-title">Cuadre con tu cuenta</h2>
					<p className="react-reconciliation-updated">{model.updatedLabel}</p>
				</div>
				<span className={`react-reconciliation-badge is-${model.badgeTone}`}>
					{model.badgeLabel}
				</span>
			</div>

			<div className="react-reconciliation-ledger">
				<div className="react-reconciliation-row">
					<span className="react-reconciliation-lbl">Disponible según registros</span>
					<span className="react-reconciliation-amt">
						{formatSignedTheoretical(model.theoreticalRemaining)}
					</span>
				</div>
				<div className="react-reconciliation-row">
					<span className="react-reconciliation-lbl">Saldo real en tu cuenta</span>
					<span className="react-reconciliation-amt">
						{model.actualBalance === null ? "—" : formatReconciliationClp(model.actualBalance)}
					</span>
				</div>
				<div className="react-reconciliation-row is-result">
					<span className="react-reconciliation-lbl">{model.diffLabel}</span>
					<span className={`react-reconciliation-amt is-${model.diffTone}`}>
						{formatDifferenceDisplay(model)}
					</span>
				</div>
			</div>

			<div className={`react-reconciliation-callout is-${model.callout.tone}`}>
				<div>
					<strong>{model.callout.title}</strong>
					<span>{model.callout.body}</span>
				</div>
			</div>

			{model.kind === "no-income" && onAddIncome && !readOnly ? (
				<div className="react-reconciliation-cta-row">
					<button
						type="button"
						className="button primary react-reconciliation-btn"
						onClick={onAddIncome}
					>
						Configurar ingreso del ciclo
					</button>
				</div>
			) : null}

			{canEdit ? (
				<form className="react-reconciliation-form" onSubmit={handleSubmit} noValidate>
					<div className="react-reconciliation-input-row">
						<div className="react-reconciliation-clp-wrap">
							<span className="react-reconciliation-clp-prefix" aria-hidden="true">
								$
							</span>
							<input
								id="react-reconciliation-balance-input"
								className="react-reconciliation-input"
								type="text"
								inputMode="numeric"
								value={inputValue}
								onChange={(event) => {
									setInputValue(event.target.value);
									if (errorMessage) setErrorMessage(null);
								}}
								placeholder="Ej. 495.070"
								aria-label="Saldo real en cuenta en pesos chilenos"
								disabled={isSaving}
							/>
						</div>
						<button
							type="submit"
							className="button primary react-reconciliation-btn"
							disabled={isSaving}
						>
							{isSaving
								? "Guardando…"
								: model.actualBalance === null
									? "Guardar saldo"
									: "Actualizar saldo"}
						</button>
					</div>
					{model.actualBalance !== null ? (
						<div className="react-reconciliation-secondary-row">
							<button
								type="button"
								className="react-reconciliation-clear"
								onClick={handleClear}
								disabled={isSaving}
							>
								Quitar saldo real
							</button>
						</div>
					) : null}
					{errorMessage ? (
						<p className="react-reconciliation-error" role="alert">
							{errorMessage}
						</p>
					) : null}
				</form>
			) : null}
		</section>
	);
}
