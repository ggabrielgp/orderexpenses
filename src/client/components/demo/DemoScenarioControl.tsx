import { DEMO_SCENARIOS, type DemoScenario } from "./demoScenarios";

export interface DemoScenarioControlProps {
	scenario: DemoScenario;
	onChange: (scenario: DemoScenario) => void;
}

/**
 * "Ver la demo como: En ritmo · Ajustado · Vas rápido". A group of toggle buttons (`aria-pressed`), so
 * it is operable with Tab, Enter and Space with no extra key handling. Rendered only by the demo.
 */
export function DemoScenarioControl({ scenario, onChange }: DemoScenarioControlProps) {
	// One control per demo page, so a fixed id is enough (and the component stays hook-free).
	const labelId = "demo-scenario-label";
	return (
		<div className="demo-scenario" role="group" aria-labelledby={labelId}>
			<span id={labelId} className="demo-scenario-label">Ver la demo como:</span>
			<div className="demo-scenario-options">
				{DEMO_SCENARIOS.map((option) => (
					<button
						key={option.id}
						type="button"
						className="demo-scenario-option"
						data-scenario={option.id}
						aria-pressed={scenario === option.id}
						onClick={() => onChange(option.id)}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}
