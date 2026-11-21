import type { DashboardView } from "../shell/AppHeader";

function Placeholder({ variant = "label" }: { variant?: "label" | "value" | "detail" | "chart" | "row" }) {
	return <span className={`react-loading-placeholder react-loading-placeholder-${variant}`} />;
}

function LoadingSummary() {
	return (
		<div className="react-analytics-body">
			{/* One hero block, like the month gauge that replaced the KPI band (S11). */}
			<div className="react-loading-card react-loading-hero">
				<span className="react-loading-placeholder react-loading-circle react-loading-hero-ring" />
				<div className="react-loading-hero-body">
					<Placeholder variant="value" />
					<Placeholder variant="row" />
					<Placeholder variant="detail" />
				</div>
			</div>
			<div className="react-analytics-columns">
				<div className="react-analytics-main">
					<div className="react-loading-card">
						<Placeholder />
						<Placeholder variant="value" />
						<Placeholder variant="row" />
					</div>
					<div className="react-loading-card react-loading-chart">
						<Placeholder />
						<Placeholder variant="detail" />
						<Placeholder variant="chart" />
					</div>
				</div>
				<div className="react-analytics-side">
					<div className="react-loading-card">
						<Placeholder />
						<div className="react-loading-category">
							<span className="react-loading-placeholder react-loading-circle" />
							<div className="react-loading-rows">
								{[0, 1, 2, 3].map((row) => <Placeholder key={row} variant="row" />)}
							</div>
						</div>
					</div>
					<div className="react-loading-card">
						<Placeholder />
						{[0, 1, 2].map((row) => <Placeholder key={row} variant="row" />)}
					</div>
				</div>
			</div>
		</div>
	);
}

/** Decorative placeholders reserve space; they never represent financial values or progress. */
export function DashboardLoadingState({ view }: { view: DashboardView }) {
	return (
		<div className="react-dashboard-loading">
			{/* Keep the live message outside the busy region so it can be announced immediately. */}
			<p className="react-dashboard-loading-status" role="status" aria-live="polite">
				Preparando los movimientos de tu período...
				<span>El resumen aparecerá cuando los datos estén listos.</span>
			</p>
			<section aria-busy="true" aria-label="Datos financieros en preparación">
				{view === "summary" ? (
					<div aria-hidden="true"><LoadingSummary /></div>
				) : (
					<div className="react-loading-card react-loading-movements" aria-hidden="true">
						<Placeholder />
						{[0, 1, 2, 3, 4, 5].map((row) => (
							<div className="react-loading-movement-row" key={row}>
								<Placeholder variant="row" />
								<Placeholder variant="row" />
								<Placeholder variant="row" />
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
