import React, { useState, type ReactNode } from "react";
import type { MovementsTableViewProps } from "../../pages/DashboardPage";
import type { RecognizedExpenseMovement, EditableRecognizedExpenseMovement } from "./manualExpense";
import { getSimilarCounterpartyAffordance } from "./movementSelection";
import { getMovementSortIndicator } from "./movementSorting";
import { getSpendingChartKindLabel } from "../analytics/spendingChart";
import { MovementCategoryChip, MovementDate } from "./MovementsStates";
import { getMovementActionName } from "./movementDisplay";

/** One control tree: desktop CSS always exposes it, while mobile has a local disclosure. */
export function MovementFilterDisclosure({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="react-movements-secondary-filters" data-expanded={expanded}>
      <button type="button" className="secondary react-movements-filter-toggle"
        aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        Buscar y filtrar movimientos
      </button>
      <div className="react-movements-filter-controls">{children}</div>
    </div>
  );
}

export type MobileMovementListProps = Pick<MovementsTableViewProps,
  "sort" | "onActivate" | "onView" | "onEdit" | "onRemove" | "selection" |
  "onToggleSelection" | "onToggleAllSelection" | "onSelectSimilar" | "readOnlyReason" | "highlightedMovementId"> & {
  /** Already filtered and sorted by the shared public view; never sort or filter again here. */
  rows: RecognizedExpenseMovement[];
  editableById: ReadonlyMap<string | null, EditableRecognizedExpenseMovement>;
  emptyMessage: string;
  /** The no-results state (active filters and a way to clear them); `emptyMessage` stays the fallback. */
  noResults?: ReactNode;
  /** Colour of the donut slice a category sits in, so chips and donut agree. */
  categoryColor?: (category: string) => string;
};

const formatClp = (amount: number) => {
  const formatted = new Intl.NumberFormat("es-CL", {
    style: "currency", currency: "CLP", maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  return amount < 0 ? `-${formatted}` : formatted;
};

/** A responsive projection of the same rows and capabilities as the desktop table, not a data owner. */
export function MobileMovementList({ rows, editableById, emptyMessage, sort, onActivate,
  onView, onEdit, onRemove, selection, onToggleSelection, onToggleAllSelection,
  onSelectSimilar, readOnlyReason, highlightedMovementId, noResults, categoryColor }: MobileMovementListProps) {
  const selectionEnabled = selection !== undefined && onToggleSelection !== undefined;
  const selectedIds = new Set(selection?.selectedIds ?? []);
  return (
    <div className="react-mobile-movements">
      <div className="react-mobile-movement-sort" role="group" aria-label="Ordenar movimientos">
        {([ ["counterparty", "Contraparte"], ["amount", "Monto"], ["date", "Fecha"],
          ["category", "Categoría"] ] as const).map(([key, label]) => (
          <button key={key} type="button" className="secondary" onClick={() => onActivate(key)}
            aria-label={`Ordenar por ${label}`} aria-pressed={sort.key === key}>
            {label} {getMovementSortIndicator(sort, key)}
          </button>
        ))}
      </div>
      {selectionEnabled && selection !== undefined && onToggleAllSelection !== undefined && (
        <label className="react-mobile-movement-select-all">
          <input type="checkbox" className="react-movements-select-all"
            aria-label="Seleccionar todos los movimientos editables"
            checked={selection.headerChecked} aria-checked={selection.indeterminate ? "mixed" : undefined}
            ref={(node) => { if (node) node.indeterminate = selection.indeterminate; }}
            disabled={selection.selectableCount === 0} onChange={onToggleAllSelection} />
          Seleccionar todos
        </label>
      )}
      {rows.length === 0 && (noResults ?? <p className="react-movements-no-results">{emptyMessage}</p>)}
      {rows.map((movement, index) => {
        const editable = movement.id === null ? null : editableById.get(movement.id) ?? null;
        const similar = selectionEnabled && selection !== undefined
          ? getSimilarCounterpartyAffordance(movement, rows, selection.selectableIds) : null;
        return (
          <article className="react-mobile-movement-card" key={`${movement.counterparty}-${movement.date}-${index}`}
            data-selected={movement.id !== null && selectedIds.has(movement.id) ? "true" : undefined}
            data-highlighted={movement.id !== null && movement.id === highlightedMovementId ? "true" : undefined}>
            <div className="react-mobile-movement-primary">
              {selectionEnabled && (
                <label className="react-mobile-movement-selection">
                  <input type="checkbox" className={editable ? "react-movement-select" : "react-movement-select react-movement-select-disabled"}
                    aria-label={editable ? `Seleccionar ${movement.counterparty}` : `No seleccionable: ${movement.counterparty}`}
                    disabled={!editable} checked={editable ? movement.id !== null && selectedIds.has(movement.id) : false}
                    onChange={() => movement.id !== null && onToggleSelection?.(movement.id)} />
                </label>
              )}
              <strong className="react-mobile-movement-description">{movement.description || movement.counterparty}</strong>
              <strong className="react-movement-amount">{formatClp(movement.amount)}</strong>
            </div>
            <div className="react-mobile-movement-meta">
              {movement.description && movement.description !== movement.counterparty && <span>{movement.counterparty}</span>}
              <MovementDate date={movement.date} />
              <MovementCategoryChip category={movement.category} color={categoryColor?.(movement.category)} />
              {movement.kind && <span className="react-movement-kind-badge">{getSpendingChartKindLabel(movement.kind)}</span>}
            </div>
            <details className="react-mobile-movement-details">
              <summary>Detalle y acciones</summary>
              <div className="react-mobile-movement-actions">
                <button type="button" className="secondary react-movement-action" aria-label={getMovementActionName("Ver", movement.counterparty, movement.date)} onClick={() => onView?.(movement)}>Ver</button>
                {editable ? <>
                  <button type="button" className="secondary react-movement-action" aria-label={getMovementActionName("Editar", movement.counterparty, movement.date)} onClick={() => onEdit(editable)}>Editar</button>
                  <button type="button" className="secondary react-movement-action" aria-label={getMovementActionName("Eliminar", movement.counterparty, movement.date)} onClick={() => onRemove(editable)}>Eliminar</button>
                </> : <span className="react-movements-read-only">{readOnlyReason ?? "Solo lectura: sin identificación o fecha válida"}</span>}
                {similar !== null && similar.count > 1 && onSelectSimilar !== undefined && (
                  <button type="button" className="react-movement-similar" onClick={() => onSelectSimilar(similar.ids)}>{similar.label}</button>
                )}
              </div>
            </details>
          </article>
        );
      })}
    </div>
  );
}
