import type { ReactNode } from "react";
import { getDemoTransactions, type DemoDashboardData, type DemoMovement } from "../../demo-data";
import { getRecognizedExpenseMovements, MovementsTableView } from "../../pages/DashboardPage";
import { CycleCalendar } from "../financial-cycle/FinancialCycleCalendar";
import { createCalendarRange } from "../financial-cycle/cycleCalendar";
import { createMovementFilterSelection, getMovementFilterView } from "../movements/movementFilters";
import { createMovementSortState } from "../movements/movementSorting";
import { getSpendingChartKindLabel } from "../analytics/spendingChart";
import { LandingDashboardPreview } from "./LandingDashboardPreview";
import { LandingPhoneFrame } from "./LandingPhoneFrame";
import { LandingTourSlider } from "./LandingTourSlider";
import "./landing-tour.css";

const formatClp = (amount: number) => new Intl.NumberFormat("es-CL", {
	style: "currency", currency: "CLP", maximumFractionDigits: 0,
}).format(amount);
const noop = () => {};
const tourLabels = ["Resumen de tu periodo", "Elegir periodo", "Tabla de gastos", "Agregar un gasto", "Categorizar un gasto"];

/** The fixture period is half-open; the calendar displays an inclusive end date. */
function getPeriodEnd(data: DemoDashboardData) {
	const [year, month, day] = data.period.endDateExclusive.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function TourPhone({ workflow, title, summary, children }: {
	workflow: string;
	title: string;
	summary: string;
	children: ReactNode;
}) {
	return (
		<li className="tour-item">
			<article data-workflow={workflow}>
				<div className="landing-tour-illustration" role="img" aria-label={`${title}. Vista de solo lectura. ${summary}`}>
					{/* Only the gallery is interactive. These are illustrations, never account-owned dialogs. */}
					<div className="landing-tour-canvas" inert aria-hidden="true">
						<LandingPhoneFrame className="landing-tour-phone">
							<div className="landing-tour-screen-inner">{children}</div>
						</LandingPhoneFrame>
					</div>
				</div>
			</article>
		</li>
	);
}

/** Static counterparts of the real create/edit form labels, without API or modal lifecycle. */
function ExpenseFormPreview({ movement, edit = false }: { movement: DemoMovement; edit?: boolean }) {
	const prefix = edit ? "react-edit-movement" : "react-create-expense";
	const idPrefix = edit ? "landing-tour-edit" : "landing-tour-create";
	const fields = [
		{ key: "occurred-at", label: "Fecha y hora", value: movement.occurredAt.slice(0, 16), type: "datetime-local" },
		{ key: "amount", label: "Monto CLP", value: String(movement.amount), type: "text" },
		{ key: "kind", label: "Tipo", value: getSpendingChartKindLabel(movement.kind), type: "select" },
		{ key: "category", label: "Categoría", value: movement.category ?? "Sin categoría", type: "select" },
		{ key: "counterparty", label: "Comercio o persona", value: movement.counterparty, type: "text" },
		{ key: "description", label: "Descripción", value: "", type: "text" },
	];
	return (
		<div className={`${prefix}-dialog landing-tour-modal`}>
			<div className={`${prefix}-form`}>
				<h2>{edit ? "Editar movimiento" : "Nuevo gasto"}</h2>
				<p className="landing-tour-form-note">{edit ? "Revisa y ajusta la categoría del gasto." : "Un gasto del ejemplo, sin guardar."}</p>
				<div className={`${prefix}-fields`}>
					{fields.map((field) => (
						<label key={field.key} htmlFor={`${idPrefix}-${field.key}`} className={`${prefix}-full`}>
							<span>{field.label}</span>
							{field.type === "select" ? (
								<select id={`${idPrefix}-${field.key}`} defaultValue={field.value} disabled>
									<option value={field.value}>{field.value}</option>
								</select>
							) : (
								<input id={`${idPrefix}-${field.key}`} type={field.type} defaultValue={field.value}
									placeholder={field.key === "description" ? "Detalle breve" : undefined} disabled />
							)}
							{edit && field.key === "occurred-at" && <small>Fecha y hora del gasto de ejemplo. Vista de solo lectura.</small>}
						</label>
					))}
				</div>
				<div className="react-shell-actions">
					<button type="button" className="secondary" disabled>Cancelar</button>
					<button type="button" disabled>{edit ? "Guardar cambios" : "Guardar gasto"}</button>
				</div>
			</div>
		</div>
	);
}

export function LandingTourSection({ data, previewError = null }: { data: DemoDashboardData | null; previewError?: string | null }) {
	const movements = data ? getRecognizedExpenseMovements(getDemoTransactions(data)) : [];
	const sample = data?.movements.find((movement) => movement.direction === "outflow");
	const endDate = data ? getPeriodEnd(data) : "";
	const filteredView = data ? getMovementFilterView(createMovementFilterSelection(data.period), data.period, movements) : null;
	const rows = filteredView?.rows.slice(0, 3) ?? [];
	const formSummary = sample ? `Fecha y hora: ${sample.occurredAt.replace("T", " ")}. Monto CLP: ${formatClp(sample.amount)}. Tipo: ${getSpendingChartKindLabel(sample.kind)}. Categoría: ${sample.category ?? "Sin categoría"}. Comercio o persona: ${sample.counterparty}. Descripción vacía. No guarda cambios.` : "No hay gastos de ejemplo disponibles.";

	return (
		<section className="tour landing-tour landing-feature-section" id="recorrido" aria-labelledby="landing-tour-title">
			<div className="landing-shell">
				<header className="landing-section-heading">
					<p className="landing-eyebrow">Recorrido por la app</p>
					<h2 id="landing-tour-title">Un periodo. Cada gasto en su lugar.</h2>
					<p>Elige las fechas, revisa tus movimientos y conoce cómo agregar y categorizar un gasto.</p>
				</header>
				<p className="landing-tour-notice">Ilustraciones de la app: los campos y botones no se pueden usar ni guardan cambios.</p>
				{data && filteredView ? (
						<LandingTourSlider labels={tourLabels}>
							<TourPhone workflow="dashboard" title="Resumen de tu periodo"
								summary={`Total gastado: ${formatClp(data.currentPeriodSpending)}. Gasto por día de la semana y distribución por categoría.`}>
								<LandingDashboardPreview data={data} />
							</TourPhone>
							<TourPhone workflow="period" title="Elegir periodo"
								summary={`Calendario del periodo. Inicio: ${data.period.startDate}. Término: ${endDate}. Rango seleccionado.`}>
								<div className="landing-tour-modal"><h2>Cambiar período</h2><p className="landing-tour-form-note">Selecciona el rango de fechas.</p>
									<CycleCalendar bounds={{ startDate: data.period.startDate, endDate }} range={createCalendarRange(data.period.startDate, endDate)} today={endDate} onSelectDate={noop} disabled />
									<div className="landing-tour-period-fields">
										<label htmlFor="landing-tour-period-start"><span>Fecha de inicio</span><input id="landing-tour-period-start" type="date" value={data.period.startDate} disabled /></label>
										<label htmlFor="landing-tour-period-end"><span>Fecha de término (inclusive)</span><input id="landing-tour-period-end" type="date" value={endDate} disabled /></label>
										<label htmlFor="landing-tour-period-income"><span>Ingreso mensual (opcional)</span><input id="landing-tour-period-income" value={data.currentPeriodInflow} disabled /></label>
									</div>
									<div className="react-shell-actions"><button type="button" disabled>Guardar cambios</button><button type="button" className="secondary" disabled>Cancelar</button></div>
								</div>
							</TourPhone>
							<TourPhone workflow="expenses" title="Tabla de gastos"
								summary={`Muestra de ${rows.length} de ${movements.length} gastos del periodo. ${rows.map((row) => `${row.counterparty}, ${formatClp(row.amount)}, ${row.date}, ${row.category}`).join(". ")}.`}>
								<MovementsTableView filteredView={{ ...filteredView, rows }} periodMovements={movements} sort={createMovementSortState()}
									editableMovements={[]} onActivate={noop} onSelect={noop} onClear={noop} onEdit={noop} onRemove={noop} />
							</TourPhone>
							<TourPhone workflow="create" title="Agregar un gasto" summary={formSummary}>
								{sample ? <ExpenseFormPreview movement={sample} /> : <p>No hay gastos de ejemplo disponibles.</p>}
							</TourPhone>
							<TourPhone workflow="categorize" title="Categorizar un gasto" summary={formSummary}>
								{sample ? <ExpenseFormPreview movement={sample} edit /> : <p>No hay gastos de ejemplo disponibles.</p>}
							</TourPhone>
						</LandingTourSlider>
					) : <p className="landing-tour-loading" role="status">{previewError ?? "Cargando vista de ejemplo. Puedes abrir la demo para explorar la app."}</p>}
				<div className="landing-tour-footer"><a className="landing-primary-button" href="/app/demo">Explorar la demo <span aria-hidden="true">↗</span></a><p>Sin conectar tu cuenta.</p></div>
			</div>
		</section>
	);
}
