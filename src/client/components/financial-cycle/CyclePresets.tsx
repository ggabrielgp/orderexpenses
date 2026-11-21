import { useId, useState } from "react";
import "../onboarding/onboarding.css";
import { calendarMonthCycle, payDayCycle, type CalendarDay, type CyclePresetRange } from "./cyclePresets";

export type CyclePresetChoice = "calendar" | "payDay" | "custom";

export interface CyclePresetsProps {
	/** The viewer's local calendar day. */
	today: CalendarDay;
	/** Called with the range to put in the start/end inputs when a preset is chosen or the pay day changes. */
	onApply: (range: CyclePresetRange) => void;
	/** Called when the person wants to pick the range in the calendar instead. */
	onCustom?: () => void;
	initialPreset?: CyclePresetChoice;
	initialPayDay?: number;
}

const DEFAULT_PAY_DAY = 25;
const PAY_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** Cycle setup presets (artboard 06, phone 2): one tap fills the existing date inputs. */
export function CyclePresets({ today, onApply, onCustom, initialPreset, initialPayDay = DEFAULT_PAY_DAY }: CyclePresetsProps) {
	const [selected, setSelected] = useState<CyclePresetChoice | null>(initialPreset ?? null);
	const [payDay, setPayDay] = useState(initialPayDay);
	const payDayId = useId();

	const choose = (choice: CyclePresetChoice) => {
		setSelected(choice);
		if (choice === "calendar") onApply(calendarMonthCycle(today));
		else if (choice === "payDay") onApply(payDayCycle(today, payDay));
		else onCustom?.();
	};

	const changePayDay = (value: number) => {
		setPayDay(value);
		onApply(payDayCycle(today, value));
	};

	const option = (choice: CyclePresetChoice, label: string, detail: string) => (
		<button
			className="cycle-preset"
			type="button"
			role="radio"
			aria-checked={selected === choice}
			onClick={() => choose(choice)}
		>
			<span className="cycle-preset-radio" aria-hidden="true" />
			<span>
				<b>{label}</b>
				<small>{detail}</small>
			</span>
		</button>
	);

	return (
		<div className="cycle-presets" role="radiogroup" aria-label="¿Cuándo empieza tu mes?">
			{option("calendar", "Mes calendario", "Del 1 al último día")}
			{option("payDay", "Desde mi día de pago", "De pago a pago; por ejemplo, del 25 al 24")}
			{selected === "payDay" ? (
				<div className="cycle-preset-payday">
					<label htmlFor={payDayId}>Día de pago</label>
					<select id={payDayId} value={payDay} onChange={(event) => changePayDay(Number(event.target.value))}>
						{PAY_DAYS.map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</div>
			) : null}
			{option("custom", "Otro rango", "Elige inicio y fin en el calendario")}
		</div>
	);
}
