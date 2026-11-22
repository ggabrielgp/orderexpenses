import { useId, type ReactNode } from "react";
import "./cycle-setup.css";
import { CalendarGlyph } from "./CycleIcons";
import {
	PAY_DAYS,
	PAY_DAY_QUICK_CHOICES,
	formatCycleResult,
	payDayLabel,
	type CycleOptionChoice,
} from "./cycleOptions";
import type { CyclePresetRange } from "./cyclePresets";

export interface CyclePresetsProps {
	option: CycleOptionChoice;
	onOptionChange: (option: CycleOptionChoice) => void;
	payDay: number;
	onPayDayChange: (payDay: number) => void;
	/** The range the form would save; the calendar-month and pay day result lines read it. */
	range: CyclePresetRange;
	/** What "Otro rango" reveals: the calendar and the start/end inputs, owned by the form. */
	customPane?: ReactNode;
	/** Disables every control while a save is in flight. */
	disabled?: boolean;
}

/**
 * "¿Cuándo empieza tu mes?" (S20): three option cards in one radiogroup. Each card reveals only what
 * it needs — the calendar month a result line, the pay day one question plus the resulting range, and
 * "Otro rango" whatever the form passes as `customPane`. The component is controlled: the form keeps
 * the option and the start/end state, so its validation and saved payload do not change.
 */
export function CyclePresets({
	option,
	onOptionChange,
	payDay,
	onPayDayChange,
	range,
	customPane,
	disabled = false,
}: CyclePresetsProps) {
	const groupName = useId();
	const result = formatCycleResult(range);
	const isQuickChoice = PAY_DAY_QUICK_CHOICES.includes(payDay);

	const card = (choice: CycleOptionChoice, label: string, detail: string, reveal: ReactNode) => {
		const isOn = option === choice;
		return (
			<div className={isOn ? "cycle-option is-on" : "cycle-option"} data-option={choice}>
				<label className="cycle-option-head">
					<input
						type="radio"
						name={groupName}
						value={choice}
						checked={isOn}
						disabled={disabled}
						onChange={() => onOptionChange(choice)}
					/>
					<span className="cycle-option-radio" aria-hidden="true" />
					<span className="cycle-option-text">
						<b>{label}</b>
						<span>{detail}</span>
					</span>
				</label>
				{isOn ? (
					<div className="cycle-option-reveal">
						<div className="cycle-option-reveal-in">
							<div className="cycle-option-pad">{reveal}</div>
						</div>
					</div>
				) : null}
			</div>
		);
	};

	return (
		<div className="cycle-options" role="radiogroup" aria-label="¿Cuándo empieza tu mes?">
			{card(
				"calendar",
				"Mes calendario",
				"Del 1 al último día",
				<p className="cycle-result">
					<CalendarGlyph />
					<span>
						Tu mes: <b>{result}</b>
					</span>
				</p>,
			)}
			{card(
				"payDay",
				"Desde mi día de pago",
				"De un pago al siguiente",
				<>
					<fieldset className="cycle-payday">
						<legend>¿Qué día te pagan?</legend>
						<div className="cycle-chips">
							{PAY_DAY_QUICK_CHOICES.map((value) => (
								<label className="cycle-chip" key={value}>
									<input
										type="radio"
										name={`${groupName}-pay-day`}
										value={value}
										checked={payDay === value}
										disabled={disabled}
										onChange={() => onPayDayChange(value)}
									/>
									<span>{payDayLabel(value)}</span>
								</label>
							))}
							<span className={isQuickChoice ? "cycle-select" : "cycle-select is-on"}>
								<select
									id="financial-cycle-pay-day"
									aria-label="Otro día de pago"
									value={isQuickChoice ? "" : String(payDay)}
									disabled={disabled}
									onChange={(event) => {
										if (event.target.value !== "") onPayDayChange(Number(event.target.value));
									}}
								>
									<option value="">Otro día</option>
									{PAY_DAYS.map((value) => (
										<option key={value} value={value}>
											{`Día ${value}`}
										</option>
									))}
								</select>
							</span>
						</div>
					</fieldset>
					<p className="cycle-result">
						<CalendarGlyph />
						<span>
							Tu mes: <b>{result}</b>
						</span>
					</p>
					{payDay >= 29 ? <p className="cycle-note">En los meses más cortos usamos su último día.</p> : null}
				</>,
			)}
			{card("custom", "Otro rango", "Elige inicio y fin", customPane)}
		</div>
	);
}
