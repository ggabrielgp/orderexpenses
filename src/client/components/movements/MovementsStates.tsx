import React, { type CSSProperties } from "react";
import { describeActiveMovementFilters, formatMovementLongDate, formatMovementShortDate, type ActiveMovementFilter } from "./movementDisplay";

/** A movement date: short in the row, the full date in the title and in the machine-readable attribute. */
export function MovementDate({ date }: { date: string }) {
	const isIso = /^\d{4}-\d{2}-\d{2}/.test(date);
	if (!isIso) return <span className="react-movement-date">{date}</span>;
	return (
		<time className="react-movement-date" dateTime={date} title={formatMovementLongDate(date)}>
			{formatMovementShortDate(date)}
		</time>
	);
}

/**
 * A category chip. The dot carries the exact colour the donut gives the category (the caller resolves it
 * with the shared resolver); a movement without category is a dashed, ink-outlined chip instead.
 */
export function MovementCategoryChip({ category, color }: { category: string; color?: string }) {
	const unassigned = category === "Sin categoría";
	return (
		<span
			className={`react-movement-category${unassigned ? " react-movement-category-unassigned" : ""}`}
			style={!unassigned && color ? ({ "--category-color": color } as CSSProperties) : undefined}
		>
			<span className="react-movement-category-dot" aria-hidden="true" />
			{category}
		</span>
	);
}

/** The prompt that turns "Sin categoría" into an action, or a calm note once everything is classified. */
export function MovementsUncategorizedPrompt({
	count, amountLabel, onClassify,
}: { count: number; amountLabel: string; onClassify?: () => void }) {
	if (count === 0) {
		return (
			<p className="react-movements-all-classified">
				<span className="react-movements-all-classified-mark" aria-hidden="true">✓</span>
				Todo clasificado
			</p>
		);
	}
	const one = count === 1;
	return (
		<div className="react-movements-prompt" role="group" aria-label="Movimientos sin categoría">
			<p className="react-movements-prompt-title">
				{count} {one ? "movimiento" : "movimientos"} sin categoría
				<span className="react-movements-prompt-amount"> · {amountLabel}</span>
			</p>
			<p className="react-movements-prompt-note">
				Clasifícal{one ? "o" : "os"} para que la distribución de tus gastos sea más fiel.
			</p>
			{onClassify && (
				<button type="button" className="react-movements-prompt-action" onClick={onClassify}
					aria-label={`Clasificar ${one ? "el movimiento" : "los movimientos"} sin categoría`}>
					Clasificar
				</button>
			)}
		</div>
	);
}

/** Filters narrowed the rows to none: say which filters are on and offer the way back. */
export function MovementsNoResults({
	filters, onClearFilters, fallbackMessage,
}: { filters: readonly ActiveMovementFilter[]; onClearFilters: () => void; fallbackMessage: string }) {
	if (filters.length === 0) return <p className="react-movements-no-results">{fallbackMessage}</p>;
	return (
		<div className="react-movements-no-results react-movements-state">
			<h4>No hay movimientos con estos filtros</h4>
			<p>No encontramos movimientos con {describeActiveMovementFilters(filters)}. Prueba con otra palabra o quita algún filtro.</p>
			<button type="button" className="react-movements-state-action" onClick={onClearFilters}>Limpiar filtros</button>
		</div>
	);
}

/** A period with no recognized expenses: what will appear here and the first action, where creation is allowed. */
export function MovementsEmptyPeriod({
	onCreateExpense, onRefresh,
}: { onCreateExpense?: () => void; onRefresh?: () => void }) {
	return (
		<section className="react-movements-empty-period react-movements-state" aria-label="Período sin movimientos">
			<h3>Aún no hay movimientos en este período</h3>
			<p>Cuando lleguen avisos de compra a tu Gmail o agregues un gasto a mano, aparecerán aquí con su categoría.</p>
			{(onCreateExpense || onRefresh) && (
				<div className="react-movements-state-actions">
					{onCreateExpense && (
						<button type="button" className="react-movements-state-action" onClick={onCreateExpense}>Agregar gasto</button>
					)}
					{onRefresh && (
						<button type="button" className="secondary react-movements-state-secondary" onClick={onRefresh}>Actualizar</button>
					)}
				</div>
			)}
		</section>
	);
}
