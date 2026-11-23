import { Suspense, lazy, useRef, useState } from "react";
import { faReceipt } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { createCategoryColorResolver } from "../analytics/categoryDistribution";
import { getCategoryRanking } from "../analytics/categoryRanking";
import { getSpendingChartKindLabel } from "../analytics/spendingChart";
import { FeedbackNotice } from "../feedback/FeedbackNotice";
import {
  acquireInFlightLock,
  releaseInFlightLock,
  type CategorySelectOption,
} from "./CreateManualExpenseDialog";
import { MobileMovementList, MovementFilterDisclosure } from "./MobileMovementList";
import {
  MovementCategoryChip,
  MovementDate,
  MovementsEmptyPeriod,
  MovementsNoResults,
  MovementsUncategorizedPrompt,
} from "./MovementsStates";
import {
  getMovementUpdateTarget,
  type EditableRecognizedExpenseMovement,
  type RecognizedExpenseMovement,
} from "./manualExpense";
import { getActiveMovementFilters, getMovementActionName } from "./movementDisplay";
import {
  createMovementFilterSelection,
  getMovementFilterView,
  reconcileMovementFilterSelection,
  selectMovementFilterCategory,
  type MovementFilterCount,
  type MovementFilterOption,
  type MovementFilterSelection,
  type MovementFilterView,
} from "./movementFilters";
import {
  createMovementSelection,
  getBulkCategoryFeedback,
  getBulkCategoryTargets,
  getMovementSelectionView,
  getSelectableMovementIds,
  getSimilarCounterpartyAffordance,
  reconcileMovementSelection,
  selectMovementIds,
  toggleAllMovementSelection,
  toggleMovementSelection,
  type BulkCategoryFeedback,
  type BulkCategorySubmitter,
  type MovementSelection,
  type MovementSelectionView,
} from "./movementSelection";
import {
  createMovementSortState,
  cycleMovementSort,
  getMovementSortAriaSort,
  getMovementSortIndicator,
  sortMovements,
  type MovementSortKey,
  type MovementSortState,
} from "./movementSorting";
import { formatClp } from "./movementSummary";
import type { Category, FinancialPeriod } from "../../api/types";

const ViewMovementDialog = lazy(() =>
  import("./ViewMovementDialog").then((m) => ({ default: m.ViewMovementDialog })),
);

function useHasOpened(isOpen: boolean): boolean {
  const [hasOpened, setHasOpened] = useState(isOpen);
  if (isOpen && !hasOpened) setHasOpened(true);
  return hasOpened || isOpen;
}

/**
 * Movements filter control: the category narrowed over the rows already loaded for the period.
 *
 * Exported so both the unfiltered and the active markup are provable from a static render; the live
 * table only ever reaches the unfiltered one, because a static render has no state to select with.
 * It shows the category decision and the table's current count (which also reflects search and kind),
 * so it cannot display a category the table is not applying. It keeps a labelled group, an announced
 * count when filters are active, and a visible way to clear the category.
 */
export interface MovementFilterBarProps {
  options: MovementFilterOption[];
  count: MovementFilterCount;
  onSelect: (category: string) => void;
  onClear: () => void;
}

export function MovementFilterBar({ options, count, onSelect, onClear }: MovementFilterBarProps) {
  return (
    <div className="react-movements-filters" role="group" aria-label="Filtrar tabla por categoría">
      <label className="react-movements-filter-field">
        <span>Categoría</span>
        <select value={count.category} onChange={(event) => onSelect(event.target.value)}>
          {options.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {`${option.label} · ${option.count}`}
            </option>
          ))}
        </select>
      </label>
      {/* Announce the current table count when any filter narrows the rows. */}
      {count.message !== null && (
        <p className="react-movements-filter-count" role="status">{count.message}</p>
      )}
      {/* Offered only while there is something to clear: a control that cannot change anything is noise. */}
      {count.isActive && (
        <button type="button" className="secondary react-movements-filter-clear" onClick={onClear}>
          Limpiar filtro
        </button>
      )}
    </div>
  );
}

/**
 * Legacy's sortable columns and their labels (`renderTableHead`, `public/app.js:3506-3520`). The
 * actions column is deliberately absent: legacy never made it sortable and it carries no value to
 * order by.
 */
const movementSortColumns: { key: MovementSortKey; label: string }[] = [
  { key: "counterparty", label: "Contraparte" },
  { key: "amount", label: "Monto" },
  { key: "date", label: "Fecha" },
  { key: "category", label: "Categoría" },
];

export interface MovementsTableHeaderProps {
  /** The sort in effect; `createMovementSortState()` is the neutral one. */
  sort: MovementSortState;
  onActivate: (key: MovementSortKey) => void;
  /**
   * Selection view. When present together with `onToggleAllSelection` the head gains the select-all
   * column; a caller that omits both renders the pre-selection head, which is what the standalone
   * header proof relies on.
   */
  selection?: MovementSelectionView;
  onToggleAllSelection?: () => void;
}

/**
 * The table head: one activatable header per legacy-sortable column, carrying the `aria-sort` value
 * and the `▬/▲/▼` indicator the pure module decided (`renderTableHead`, `public/app.js:3499-3578`).
 * It only displays that decision, so it cannot disagree with the order of the rows. Exported so both
 * the neutral and the active markup are provable from a static render, like `MovementFilterBar`.
 */
export function MovementsTableHeader({
  sort,
  onActivate,
  selection,
  onToggleAllSelection,
}: MovementsTableHeaderProps) {
  const selectionEnabled = selection !== undefined && onToggleAllSelection !== undefined;
  return (
    <thead>
      <tr>
        {/* The select-all control only exists while a selection layer is mounted. Its mixed state is
				    exposed both as the native `indeterminate` property and as `aria-checked="mixed"` so a
				    static render can prove it without a live DOM. */}
        {selectionEnabled && selection !== undefined && (
          <th scope="col" className="react-movements-select-column">
            <input
              type="checkbox"
              className="react-movements-select-all"
              aria-label="Seleccionar todos los movimientos editables"
              checked={selection.headerChecked}
              aria-checked={selection.indeterminate ? "mixed" : undefined}
              ref={(node) => {
                if (node) node.indeterminate = selection.indeterminate;
              }}
              disabled={selection.selectableCount === 0}
              onChange={onToggleAllSelection}
            />
          </th>
        )}
        {movementSortColumns.map((column) => (
          <th
            key={column.key}
            scope="col"
            aria-sort={getMovementSortAriaSort(sort, column.key)}
            className={sort.key === column.key ? "react-movement-sort-active" : undefined}
          >
            <button
              type="button"
              className="react-movement-sort-button"
              aria-label={`Ordenar por ${column.label}`}
              onClick={() => onActivate(column.key)}
            >
              {column.label} {getMovementSortIndicator(sort, column.key)}
            </button>
          </th>
        ))}
        <th scope="col">Acciones</th>
      </tr>
    </thead>
  );
}

/**
 * The movements view for one already-decided state: the filter's rows in the order the sort decided,
 * the filter bar the table is actually applying, and the actions each row can offer.
 *
 * The action availability is not a second rule: a row is actionable exactly when the editable
 * projection produced a record for it, which already requires a usable identity and a parseable
 * original date. A row outside that projection therefore renders no control at all instead of a
 * control that could only produce a rejected request.
 *
 * The filter narrows the rows already loaded, like legacy (`public/app.js:3621-3668`), and the
 * ordering sorts the rows the filter left visible, like legacy's `renderTableView`
 * (`sortTransactions(filtered)`, `:1200-1203`). Neither issues a request.
 *
 * Exported so both the neutral and an active sort are provable from a static render, like
 * `MovementsTableHeader`: the container below owns the state and this component only displays the
 * decision it was handed.
 */
export interface MovementsTableViewProps {
  /** The filter's own view: its options, its rows and its count statement. */
  filteredView: MovementFilterView;
  /** All finite recognized expenses, used only for period-wide KPI totals. */
  periodMovements?: RecognizedExpenseMovement[];
  pendingAmountCount?: number;
  search?: string;
  onSearchChange?: (value: string) => void;
  kind?: string;
  onKindChange?: (value: string) => void;
  /** The ordering in effect; `createMovementSortState()` renders the loaded order. */
  sort: MovementSortState;
  /** Records a mutation may target, from `getEditableRecognizedExpenseMovements`. */
  editableMovements: EditableRecognizedExpenseMovement[];
  onActivate: (key: MovementSortKey) => void;
  onSelect: (category: string) => void;
  onClear: () => void;
  onEdit: (movement: EditableRecognizedExpenseMovement) => void;
  onRemove: (movement: EditableRecognizedExpenseMovement) => void;
  /**
   * Opens the read-only detail. It is called for every row, including ones with no editable target,
   * and is optional only so the standalone sort/filter proofs can render the table without it.
   */
  onView?: (movement: RecognizedExpenseMovement) => void;
  /** Selection view produced by the container; omitted, the table renders no selection column. */
  selection?: MovementSelectionView;
  onToggleSelection?: (id: string) => void;
  onToggleAllSelection?: () => void;
  /** Selects exactly the counterparty-similar ids the row's affordance offered. */
  onSelectSimilar?: (ids: string[]) => void;
  onClearSelection?: () => void;
  /** Bulk category control, offered only while a selection layer is mounted. */
  bulkCategoryOptions?: CategorySelectOption[];
  bulkCategoryValue?: string;
  onBulkCategoryChange?: (value: string) => void;
  onAssignCategory?: () => void;
  isBulkAssigning?: boolean;
  bulkNotice?: BulkCategoryFeedback | null;
  /** Explicit read-only presentation reason; omitted preserves normal eligibility explanations. */
  readOnlyReason?: string;
  /** The movement just edited; its row and card carry `data-highlighted` while the page flashes it. */
  highlightedMovementId?: string | null;
  /** Stored category colours, so a user-picked colour wins over the donut palette in the chips. */
  categoryCatalog?: readonly Category[];
  /** Applies the existing uncategorized filter; the prompt offers its action only when this is given. */
  onClassify?: () => void;
  /** First actions of an empty period; the read-only demo passes neither. */
  onCreateExpense?: () => void;
  onRefresh?: () => void;
}

export function MovementsTableView({
  filteredView,
  periodMovements,
  pendingAmountCount = 0,
  search = "",
  onSearchChange,
  kind = "",
  onKindChange,
  sort,
  editableMovements,
  onActivate,
  onSelect,
  onClear,
  onEdit,
  onRemove,
  onView,
  selection,
  onToggleSelection,
  onToggleAllSelection,
  onSelectSimilar,
  onClearSelection,
  bulkCategoryOptions,
  bulkCategoryValue,
  onBulkCategoryChange,
  onAssignCategory,
  isBulkAssigning,
  bulkNotice,
  readOnlyReason,
  highlightedMovementId,
  categoryCatalog,
  onClassify,
  onCreateExpense,
  onRefresh,
}: MovementsTableViewProps) {
  // The rows the table renders: the filter's own rows put in the order the sort decided. Sorting is
  // applied to the filtered rows, never to the loaded ones, and the count stays the filter's own — it
  // was computed from the filtered set, so ordering can neither hide nor reveal a row it describes.
  const visibleRows = sortMovements(filteredView.rows, sort);
  const editableById = new Map(
    editableMovements.map((movement) => [movement.id, movement] as const),
  );
  const selectionEnabled = selection !== undefined && onToggleSelection !== undefined;
  const selectedIds = new Set(selection?.selectedIds ?? []);
  const periodRows = periodMovements ?? filteredView.rows;
  const uncategorized = periodRows.filter((movement) => movement.category === "Sin categoría");
  const classified = periodRows.filter((movement) => movement.category !== "Sin categoría");
  const total = (rows: RecognizedExpenseMovement[]) =>
    rows.reduce((sum, movement) => sum + movement.amount, 0);
  const kindTabs = [
    { value: "", label: "Todos" },
    { value: "purchase", label: "Compras" },
    { value: "transfer", label: "Transferencias" },
    { value: "payment", label: "Pagos" },
  ];
  // Chips read the colour of the donut slice their category sits in (one shared resolver, S18).
  const categoryColor = createCategoryColorResolver(getCategoryRanking(periodRows, 0), categoryCatalog);
  const activeFilters = getActiveMovementFilters({
    search,
    kindLabel: kind === "" ? null : kindTabs.find((tab) => tab.value === kind)?.label ?? kind,
    category: filteredView.activeCategory,
  });
  const clearAllFilters = () => {
    onSearchChange?.("");
    onKindChange?.("");
    onClear();
  };
  const noResultsMessage = "No hay movimientos que coincidan con los filtros actuales.";
  const isEmptyPeriod = periodRows.length === 0;

  return (
    <div className="react-movements-view">
      {/* Keep the section title and its decorative, screen-reader-hidden glyph. */}
      <header className="react-movements-header">
        <h2>Actividad del período</h2>
        <span className="react-card-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faReceipt} />
        </span>
      </header>
      <section className="react-movements-metrics" aria-label="Indicadores del período">
        <article className="react-movements-metric react-movements-metric-lead">
          <span>Total gastado</span><strong>{formatClp(total(periodRows))}</strong>
          <small>Período completo, sin filtros</small>
        </article>
        <article className="react-movements-metric">
          <span>Gastos reconocidos</span><strong>{periodRows.length}</strong>
        </article>
        <article className="react-movements-metric react-movements-metric-pending">
          <span>Sin categoría</span><strong>{uncategorized.length}</strong>
          <small>{formatClp(total(uncategorized))}</small>
        </article>
        <article className="react-movements-metric react-movements-metric-classified">
          <span>Clasificados</span><strong>{classified.length}</strong>
          <small>{formatClp(total(classified))}</small>
        </article>
      </section>
      {!isEmptyPeriod && (
        <MovementsUncategorizedPrompt
          count={uncategorized.length}
          amountLabel={formatClp(total(uncategorized))}
          onClassify={onClassify}
        />
      )}
      {pendingAmountCount > 0 && (
        <p className="react-movements-pending-note" role="status">
          {pendingAmountCount} gastos reconocidos sin monto conocido no figuran en estos indicadores ni en la tabla.
        </p>
      )}
      {isEmptyPeriod ? (
        <MovementsEmptyPeriod onCreateExpense={onCreateExpense} onRefresh={onRefresh} />
      ) : (<>
      <MovementFilterDisclosure>
      <div className="react-movements-toolbar" role="group" aria-label="Buscar y filtrar movimientos">
        {onSearchChange && (
          <label className="react-movements-search">
            <span>Buscar movimientos</span>
            <input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar contraparte, descripción o categoría" />
          </label>
        )}
        <MovementFilterBar
          options={filteredView.options}
          count={filteredView.count}
          onSelect={onSelect}
          onClear={onClear}
        />
      </div>
      {onKindChange && (
        <div className="react-movements-kind-tabs" role="group" aria-label="Filtrar por tipo de gasto">
          {kindTabs.map((tab) => (
            <button key={tab.value || "all"} type="button" className="react-movements-kind-tab"
              aria-pressed={kind === tab.value} onClick={() => onKindChange(tab.value)}>
              {tab.label}
            </button>
          ))}
        </div>
      )}
      </MovementFilterDisclosure>
      {activeFilters.length > 0 && (
        <div className="react-movements-active-filters" role="group" aria-label="Filtros activos">
          <span className="react-movements-active-label">Filtros activos:</span>
          {activeFilters.map((filter) => (
            <button key={filter.key} type="button" className="react-movements-filter-chip"
              aria-label={`Quitar filtro ${filter.label}`}
              onClick={() => {
                if (filter.key === "search") onSearchChange?.("");
                else if (filter.key === "kind") onKindChange?.("");
                else onClear();
              }}>
              <span>{filter.label}</span>
              <span className="react-movements-filter-chip-x" aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="react-movements-clear-all" onClick={clearAllFilters}>Limpiar filtros</button>
        </div>
      )}
      {selectionEnabled && selection !== undefined && (
        <div className="react-movements-bulk" data-selected={selection.selectedCount > 0} role="group" aria-label="Acciones sobre la selección">
          <strong className="react-movements-bulk-count">
            {selection.message ?? "Sin selección"}
          </strong>
          {bulkCategoryOptions !== undefined && (
            <label className="react-movements-bulk-field">
              <span>Categoría de la selección</span>
              <select
                value={bulkCategoryValue ?? ""}
                onChange={(event) => onBulkCategoryChange?.(event.target.value)}
                disabled={isBulkAssigning}
              >
                {bulkCategoryOptions.map((option) => (
                  <option key={option.value || "none"} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="react-movements-bulk-actions">
            <button
              type="button"
              className="secondary react-movements-bulk-clear"
              onClick={onClearSelection}
              disabled={selection.selectedCount === 0 || isBulkAssigning}
            >
              Limpiar selección
            </button>
            <button
              type="button"
              className="react-movements-bulk-assign"
              onClick={onAssignCategory}
              disabled={selection.selectedCount === 0 || isBulkAssigning}
              aria-busy={isBulkAssigning}
            >
              {isBulkAssigning ? "Asignando..." : "Asignar categoría"}
            </button>
          </div>
          {bulkNotice !== null && bulkNotice !== undefined && (
            <FeedbackNotice
              className={`react-movements-bulk-notice react-movements-bulk-notice-${bulkNotice.tone}`}
              tone={bulkNotice.tone}
              message={bulkNotice.message}
            />
          )}
        </div>
      )}
      <section className="react-movements-table-card" aria-label="Detalle de movimientos">
        <header className="react-movements-table-heading">
          <h3 tabIndex={-1}>Detalle de movimientos</h3>
          {filteredView.count.message === null && (
            <span className="react-movements-table-count">{visibleRows.length} de {periodRows.length} movimientos</span>
          )}
        </header>
        <MobileMovementList
          rows={visibleRows} editableById={editableById} sort={sort} onActivate={onActivate}
          readOnlyReason={readOnlyReason} highlightedMovementId={highlightedMovementId}
          selection={selection} onToggleSelection={onToggleSelection}
          onToggleAllSelection={onToggleAllSelection} onSelectSimilar={onSelectSimilar}
          onView={onView} onEdit={onEdit} onRemove={onRemove}
          emptyMessage={noResultsMessage}
          noResults={<MovementsNoResults filters={activeFilters} onClearFilters={clearAllFilters} fallbackMessage={noResultsMessage} />}
          categoryColor={categoryColor}
        />
        {/* The table keeps its own scroll container, so the filter bar cannot scroll away with it. */}
        <div className="react-movements-table-wrapper">
        <table className="react-movements-table">
          <MovementsTableHeader
            sort={sort}
            onActivate={onActivate}
            selection={selection}
            onToggleAllSelection={onToggleAllSelection}
          />
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={selectionEnabled ? 6 : 5} className="react-movements-no-results-cell">
                <MovementsNoResults filters={activeFilters} onClearFilters={clearAllFilters} fallbackMessage={noResultsMessage} />
              </td></tr>
            )}
            {visibleRows.map((movement, index) => {
              const editable =
                movement.id === null ? null : editableById.get(movement.id) ?? null;
              const similar =
                selectionEnabled && selection !== undefined
                  ? getSimilarCounterpartyAffordance(
                    movement,
                    visibleRows,
                    selection.selectableIds,
                  )
                  : null;
              return (
                <tr key={`${movement.counterparty}-${movement.date}-${index}`} data-selected={movement.id !== null && selectedIds.has(movement.id) ? "true" : undefined} data-highlighted={movement.id !== null && movement.id === highlightedMovementId ? "true" : undefined}>
                  {selectionEnabled && (
                    <td className="react-movements-select-column">
                      {editable ? (
                        <input
                          type="checkbox"
                          className="react-movement-select"
                          aria-label={`Seleccionar ${movement.counterparty}`}
                          checked={movement.id !== null && selectedIds.has(movement.id)}
                          onChange={() => movement.id !== null && onToggleSelection?.(movement.id)}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          className="react-movement-select react-movement-select-disabled"
                          aria-label={`No seleccionable: ${movement.counterparty}`}
                          disabled
                        />
                      )}
                    </td>
                  )}
                  <td>
                    {movement.counterparty}
                    {movement.kind && (
                      <span className="react-movement-kind-badge">{getSpendingChartKindLabel(movement.kind)}</span>
                    )}
                    {similar !== null && similar.count > 1 && onSelectSimilar !== undefined && (
                      <button
                        type="button"
                        className="react-movement-similar"
                        onClick={() => onSelectSimilar(similar.ids)}
                      >
                        {similar.label}
                      </button>
                    )}
                  </td>
                  <td className="react-movement-amount">{formatClp(movement.amount)}</td>
                  <td className="react-movement-date-cell"><MovementDate date={movement.date} /></td>
                  <td><MovementCategoryChip category={movement.category} color={categoryColor(movement.category)} /></td>
                  <td className="react-movements-actions">
                    <button
                      type="button"
                      className="secondary react-movement-action"
                      aria-label={getMovementActionName("Ver", movement.counterparty, movement.date)}
                      onClick={() => onView?.(movement)}
                    >
                      Ver
                    </button>
                    {editable ? (
                      <>
                        <button
                          type="button"
                          className="secondary react-movement-action"
                          aria-label={getMovementActionName("Editar", movement.counterparty, movement.date)}
                          onClick={() => onEdit(editable)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="secondary react-movement-action"
                          aria-label={getMovementActionName("Eliminar", movement.counterparty, movement.date)}
                          onClick={() => onRemove(editable)}
                        >
                          Eliminar
                        </button>
                      </>
                    ) : (
                      <span className="react-movements-read-only">
                        {readOnlyReason ?? "Solo lectura: sin identificación o fecha válida"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>
      </>)}
    </div>
  );
}

/**
 * Movements table container: it owns the period-scoped filter selection and the in-memory ordering,
 * and hands the decided state to `MovementsTableView`, which renders it.
 */
export interface MovementsTableProps {
  /**
   * Period the loaded rows belong to. Together with the rows it owns the reset: a selection made in
   * another period, or naming a category these rows do not carry, is replaced before anything renders
   * — the empty-rows state included — so a stale category cannot hide rows after the data reloads.
   */
  period: FinancialPeriod;
  /** Read projection: every recognized expense of the period. */
  movements: RecognizedExpenseMovement[];
  pendingAmountCount?: number;
  /** Records a mutation may target, from `getEditableRecognizedExpenseMovements`. */
  editableMovements: EditableRecognizedExpenseMovement[];
  /**
   * Category the analytics ranking jumped to. It is read only while the state is first created, so it
   * is consumed on mount and a later manual choice is never overwritten by it; `undefined` renders
   * the unfiltered table. A category these rows no longer carry is cleared by the reconciliation
   * below, exactly like a selection made in another period.
   */
  requestedCategory?: string;
  onEdit: (movement: EditableRecognizedExpenseMovement) => void;
  onRemove: (movement: EditableRecognizedExpenseMovement) => void;
  /** Assigns one category to the whole selection through the existing PATCH client. */
  submitBulkCategory?: BulkCategorySubmitter;
  /** Read-only category catalog already loaded by the summary; `[]` still offers "Sin categoría". */
  categoryCatalog?: Category[];
  /** Presentation only: demo passes this explicitly, never inferred from missing identity. */
  readOnlyReason?: string;
  /** The movement just edited, highlighted in the table and list for a moment. */
  highlightedMovementId?: string | null;
  /** First actions of an empty period; the read-only demo passes neither. */
  onCreateExpense?: () => void;
  onRefresh?: () => void;
}

export function MovementsTable({
  period,
  movements,
  pendingAmountCount = 0,
  editableMovements,
  requestedCategory,
  onEdit,
  onRemove,
  submitBulkCategory,
  categoryCatalog = [],
  readOnlyReason,
  highlightedMovementId,
  onCreateExpense,
  onRefresh,
}: MovementsTableProps) {
  // Initialised for the period the rows belong to; the unified view also renders for empty periods.
  // the rows belong to. The requested category is only read here, which is what makes it a mount-time
  // input instead of a controlled value the table would have to re-adopt on every render.
  const [selection, setSelection] = useState<MovementFilterSelection>(() =>
    requestedCategory
      ? selectMovementFilterCategory(requestedCategory, period)
      : createMovementFilterSelection(period),
  );

  // The ordering is its own state, never stored and never persisted, exactly like the filter: a period
  // reload cannot carry a category the user did not pick, and sorting cannot reset the filter. Legacy
  // kept `sortKey`/`sortDir` in memory too (`public/app.js:142-143`).
  const [sort, setSort] = useState<MovementSortState>(() => createMovementSortState());
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");

  // Row selection, the detail modal and the bulk action are table-local state.
  const [rowSelection, setRowSelection] = useState<MovementSelection>(() => createMovementSelection());
  const [detailMovement, setDetailMovement] = useState<RecognizedExpenseMovement | null>(null);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkNotice, setBulkNotice] = useState<BulkCategoryFeedback | null>(null);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  // The single in-flight lock: React state cannot close the async window, so this ref is what keeps
  // two same-tick clicks from launching two bulk passes.
  const bulkLock = useRef(false);

  // Reconciling during render, instead of in an effect, is React's documented way to adjust state
  // when an input changes: the new period's rows are never rendered under the previous period's
  // selection. It runs even for empty rows, so the reset commits in every case — a
  // period with no rows still replaces the selection it inherited, and a category the loaded rows no
  // longer carry is cleared instead of only being hidden at render. The module returns the same
  // object while the selection still applies, so this re-renders only when something really changed
  // and cannot loop.
  const currentSelection = reconcileMovementFilterSelection(selection, period, movements);
  if (currentSelection !== selection) setSelection(currentSelection);

  const categoryView = getMovementFilterView(currentSelection, period, movements);
  const query = search.trim().toLocaleLowerCase("es");
  const matchingRows = categoryView.rows.filter((movement) =>
    (!kind || movement.kind === kind) &&
    (!query || [movement.counterparty, movement.description, movement.category]
      .some((value) => value?.toLocaleLowerCase("es").includes(query))),
  );
  const filteredView: MovementFilterView = {
    ...categoryView,
    rows: matchingRows,
    count: query || kind
      ? {
        ...categoryView.count,
        shown: matchingRows.length,
        message: `${categoryView.count.isActive ? `Filtro: ${categoryView.activeCategory} · ` : ""}${matchingRows.length} de ${movements.length} movimientos con los filtros actuales.`,
      }
      : categoryView.count,
  };
  // The selection is reconciled against the rows the table is actually showing, so a filtered-away
  // or reloaded-away row cannot stay silently selected. The module returns the same set while nothing
  // changed, so this only re-renders on a real transition.
  const visibleRows = sortMovements(filteredView.rows, sort);
  const selectableIds = getSelectableMovementIds(visibleRows, editableMovements);
  const reconciledRowSelection = reconcileMovementSelection(rowSelection, selectableIds);
  if (reconciledRowSelection !== rowSelection) setRowSelection(reconciledRowSelection);
  const selectionView = getMovementSelectionView(reconciledRowSelection, selectableIds);

  const bulkCategoryOptions: CategorySelectOption[] = [
    { value: "", label: "Sin categoría", disabled: false },
    ...categoryCatalog.map((category) => ({
      value: category.name,
      label: category.name,
      disabled: false,
    })),
  ];

  const openDetail = (movement: RecognizedExpenseMovement) => setDetailMovement(movement);
  const closeDetail = () => setDetailMovement(null);
  const hasOpenedDetail = useHasOpened(detailMovement !== null);
  const detailEditable =
    detailMovement === null
      ? null
      : editableMovements.find((movement) => movement.id === detailMovement.id) ?? null;

  const handleDetailEdit = (movement: EditableRecognizedExpenseMovement) => {
    // The detail view is read-only; handing the row to the existing edit flow closes it first so the
    // two native dialogs never stack.
    setDetailMovement(null);
    onEdit(movement);
  };
  const handleDetailRemove = (movement: EditableRecognizedExpenseMovement) => {
    setDetailMovement(null);
    onRemove(movement);
  };

  // "Clasificar" applies the existing uncategorized filter on its own: it replaces the search, the kind and
  // the category, so the rows it promises are exactly the ones shown, and moves focus to the list.
  const classifyUncategorized = () => {
    setSearch("");
    setKind("");
    setSelection(selectMovementFilterCategory("Sin categoría", period));
    setTimeout(() => {
      document.querySelector<HTMLElement>(".react-movements-table-heading h3")?.focus();
    }, 0);
  };

  const assignCategory = async () => {
    if (selectionView.selectedCount === 0) return;
    if (!submitBulkCategory) return;
    const targets = getBulkCategoryTargets(editableMovements, selectionView.selectedIds).flatMap(
      (movement) => {
        const target = getMovementUpdateTarget({
          id: movement.id ?? undefined,
          occurredAt: movement.occurredAt,
          isManual: movement.isManual,
        });
        return target === null ? [] : [target];
      },
    );
    // No usable targets means no bulk PATCH: the same rule that leaves a row untickable keeps a stale
    // selection from sending a request the API layer would refuse.
    if (targets.length === 0) return;
    if (!acquireInFlightLock(bulkLock)) return;
    setIsBulkAssigning(true);
    setBulkNotice(null);
    try {
      const outcome = await submitBulkCategory(targets, bulkCategory);
      setBulkNotice(getBulkCategoryFeedback(outcome));
      // A fully applied selection has nothing left to act on, so it clears. A partial one keeps the
      // selection so the user can see and re-run the action deliberately; nothing retries on its own.
      if (outcome.total > 0 && outcome.succeeded === outcome.total) {
        setRowSelection(createMovementSelection());
      }
    } finally {
      releaseInFlightLock(bulkLock);
      setIsBulkAssigning(false);
    }
  };

  return (
    <>
      <MovementsTableView
        filteredView={filteredView}
        periodMovements={movements}
        pendingAmountCount={pendingAmountCount}
        search={search}
        onSearchChange={setSearch}
        kind={kind}
        onKindChange={setKind}
        sort={sort}
        editableMovements={editableMovements}
        onActivate={(key) => setSort(cycleMovementSort(sort, key))}
        onSelect={(category) => setSelection(selectMovementFilterCategory(category, period))}
        onClear={() => setSelection(createMovementFilterSelection(period))}
        onEdit={onEdit}
        onRemove={onRemove}
        onView={openDetail}
        readOnlyReason={readOnlyReason}
        highlightedMovementId={highlightedMovementId}
        categoryCatalog={categoryCatalog}
        onClassify={classifyUncategorized}
        onCreateExpense={onCreateExpense}
        onRefresh={onRefresh}
        selection={readOnlyReason ? undefined : selectionView}
        onToggleSelection={(id) =>
          setRowSelection((current) =>
            toggleMovementSelection(current, id, selectableIds),
          )
        }
        onToggleAllSelection={() =>
          setRowSelection((current) =>
            toggleAllMovementSelection(current, selectableIds),
          )
        }
        onSelectSimilar={(ids) => setRowSelection(selectMovementIds(ids))}
        onClearSelection={() => setRowSelection(createMovementSelection())}
        bulkCategoryOptions={bulkCategoryOptions}
        bulkCategoryValue={bulkCategory}
        onBulkCategoryChange={setBulkCategory}
        onAssignCategory={assignCategory}
        isBulkAssigning={isBulkAssigning}
        bulkNotice={bulkNotice}
      />
      {/* The detail modal is rendered for every recognized row, editable or not. */}
      {hasOpenedDetail && (
        <Suspense fallback={null}>
          <ViewMovementDialog
            movement={detailMovement}
            readOnlyReason={readOnlyReason}
            editableMovement={detailEditable}
            onClose={closeDetail}
            onEdit={handleDetailEdit}
            onRemove={handleDetailRemove}
          />
        </Suspense>
      )}
    </>
  );
}
