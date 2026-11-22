import "./cycle-setup.css";
import { AlertGlyph, CalendarGlyph } from "./CycleIcons";
import { describeCyclePeriod } from "./cycleOptions";

export interface CyclePeriodSummaryProps {
	startDate: string;
	endDate: string;
	/** True after the first calendar click, while the end is still to be chosen. */
	awaitingEnd?: boolean;
}

/** Persistent summary of the chosen period, shown in the sticky footer of both cycle dialogs (S20). */
export function CyclePeriodSummary({ startDate, endDate, awaitingEnd = false }: CyclePeriodSummaryProps) {
	const period = describeCyclePeriod({ startDate, endDate, awaitingEnd });
	return (
		<div className="cycle-summary">
			<span className="cycle-summary-label">Período elegido</span>
			<span className="cycle-summary-chip" data-tone={period.tone} role="status" aria-live="polite">
				{period.tone === "invalid" ? <AlertGlyph /> : <CalendarGlyph />}
				<span>{period.text}</span>
			</span>
		</div>
	);
}
