import { useEffect, useRef, useState, type ReactNode } from "react";
import { faChartColumn, faUser } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSpendingChartMotion } from "../../hooks/useSpendingChartMotion";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import { formatClp } from "../movements/movementSummary";
import { SpendingDayDetailDialog } from "./SpendingDayDetailDialog";
import {
  FULL_PERIOD_TAB_ID,
  getSpendingChartDayDetail,
  getSpendingChartDefaultDayKey,
  getSpendingChartSeries,
  getSpendingChartTotalsRows,
  type SpendingChart,
  type SpendingChartBar,
  type SpendingChartDetailMovement,
  type SpendingChartSeries,
} from "./spendingChart";

/**
 * Accessible name of one bar: it names the day and, when it carries a value, the total it selects.
 * A padded day outside the period is stated as outside instead of claiming a zero.
 */
function getSpendingChartBarLabel(series: SpendingChartSeries, day: SpendingChartBar): string {
  if (!day.isInPeriod) return `${day.label}, fuera del período`;
  const prefix =
    series.mode === "period"
      ? `Ver detalle de ${day.titleDetail ?? day.label}`
      : `Ver detalle de ${day.label} ${day.detail}`;
  return `${prefix}: ${day.total > 0 ? formatClp(day.total) : "$0"}`;
}

/**
 * Native hover tooltip for one bar track, restored from legacy's `track.title`
 * (`public/app.js:2286-2289`): the weekday label plus the day's date (or the period-wide weekday
 * detail) and its total, and the explicit "outside the period" wording for a padded day.
 */
function getSpendingChartBarTitle(day: SpendingChartBar): string {
  if (!day.isInPeriod) return `${day.label}: fuera del período`;
  const detail = day.titleDetail ?? day.detail;
  return `${day.label} · ${detail}: ${day.total > 0 ? formatClp(day.total) : "$0"}`;
}

/**
 * The spending chart as one already-decided state: the selected series, its proportional bars, the
 * read-only detail of the selected bar and the totals summary grid.
 *
 * Exported so the populated and empty markup are provable from a static render, like the other
 * analytics panels. The component renders the heights, the detail and the totals the pure module
 * decided and computes nothing of its own beyond the string labels that need the page formatter.
 *
 * Bars are selectable buttons again, like legacy's `weekly-bar` buttons (`public/app.js:2277`), so
 * each one carries `aria-pressed` and `aria-controls` for the detail panel. A padded day outside the
 * period is disabled and cannot become the selected day. The detail itself offers no edit or delete
 * action: a row with an identity can open the read-only movement dialog, and a row without one stays
 * plain text. `onOpenMovement` is optional so the read-only demo can select bars without ever
 * mounting a dialog.
 */
export interface SpendingChartViewProps {
  /** The decided chart, from `getSpendingChart`. */
  chart: SpendingChart;
  /** Id of the tab whose series is shown; an unknown id falls back to the full period. */
  selectedTab: string;
  onSelectTab: (tabId: string) => void;
  /** Calendar key of the selected bar, or `null` while none is selected. */
  selectedDayKey: string | null;
  onSelectDay: (dayKey: string) => void;
  /** Recognized outflow rows the read-only detail reads. */
  detailMovements: SpendingChartDetailMovement[];
  /** Opens the read-only movement dialog for a row identity; absent keeps every row inert. */
  onOpenMovement?: (movementId: string) => void;
  /** Optional instance identifiers when a page illustrates this chart more than once. */
  titleId?: string;
  detailId?: string;
  /** Supplied by the interactive owner; static previews need no effects or hooks. */
  motion?: ReturnType<typeof useSpendingChartMotion>;
  /** Interactive mobile owner may wrap the one detail presentation in a native dialog. */
  dayDetailPresentation?: (detail: ReactNode) => ReactNode;
  dayDetailIsModal?: boolean;
  /** Dashboard-only visual shorthand; exact amounts remain in accessible names and detail. */
  compactMobileLabels?: boolean;
}

const DAY_DETAIL_ID = "react-spending-chart-day-detail";

export function SpendingChartView({
  chart,
  selectedTab,
  onSelectTab,
  selectedDayKey,
  onSelectDay,
  detailMovements,
  onOpenMovement,
  titleId = "react-spending-chart-title",
  detailId = DAY_DETAIL_ID,
  motion,
  dayDetailPresentation = (detail) => detail,
  dayDetailIsModal = false,
  compactMobileLabels = false,
}: SpendingChartViewProps) {
  const series = getSpendingChartSeries(chart, selectedTab);
  const selectedDay =
    selectedDayKey === null ? null : series.days.find((day) => day.key === selectedDayKey) ?? null;
  const detail = getSpendingChartDayDetail(series, selectedDay, detailMovements);
  const totalsRows = getSpendingChartTotalsRows(chart, series.id);
  const [startDate, endDate] = series.detail.split(" - ");
  return (
    <section className="react-spending-chart" aria-labelledby={titleId}>
      <div className="react-spending-chart-header">
        <h3 id={titleId}>Gasto por día de la semana</h3>
        {/* Decorative: the adjacent title names the card, so the glyph is hidden. */}
        <span className="react-card-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faChartColumn} />
        </span>
      </div>
      {/* Each excluded fact is its own statement, only when there is one to state. */}
      {chart.disclosures.map((disclosure) => (
        <p key={disclosure} className="react-spending-chart-disclosure" role="status">
          {disclosure}
        </p>
      ))}
      {!chart.hasData ? (
        <p className="react-spending-chart-empty" role="status">
          {chart.emptyMessage}
        </p>
      ) : (
        <>
          <div
            ref={(element) => {
              if (motion?.tabsSelection) motion.tabsSelection.containerRef.current = element;
            }}
            className="react-spending-chart-tabs"
            role="group"
            aria-label="Período del gráfico de gastos"
          >
            <span ref={motion?.tabsSelection?.indicatorRef} className="react-spending-chart-selection-indicator" aria-hidden="true" />
            {chart.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="react-spending-chart-tab"
                aria-pressed={tab.id === series.id}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="react-spending-chart-heading">
            <span>
              <strong>{startDate}</strong>
              {endDate !== undefined && <>{" - "}<strong>{endDate}</strong></>}
            </span>
          </div>
          {compactMobileLabels && <p className="react-spending-chart-mobile-note">Montos aproximados en CLP; valor exacto en el detalle.</p>}
          <div className="react-spending-chart-body">
            <div ref={motion?.chartRef} className="react-spending-chart-bars" role="region" aria-label={series.ariaLabel}>
              {series.days.map((day) => {
                const isSelected = day.key === selectedDayKey;
                return (
                  <button
                    key={day.key}
                    type="button"
                    className={
                      isSelected
                        ? "react-spending-chart-bar react-spending-chart-bar-selected"
                        : "react-spending-chart-bar"
                    }
                    aria-pressed={isSelected}
                    aria-controls={detailId}
                    aria-haspopup={dayDetailIsModal ? "dialog" : undefined}
                    aria-label={getSpendingChartBarLabel(series, day)}
                    disabled={!day.isInPeriod}
                    onClick={(event) => {
                      // Some touch browsers do not focus clicked buttons; native close must return here.
                      if (dayDetailIsModal) event.currentTarget.focus();
                      onSelectDay(day.key);
                    }}
                  >
                    <span
                      className={day.isInPeriod && day.total > 0
                        ? "react-spending-chart-value react-spending-chart-value-positive"
                        : "react-spending-chart-value"}
                      aria-hidden="true"
                    >
                      {day.isInPeriod && (compactMobileLabels ? <>
                        <span className="react-spending-chart-value-full">{day.total > 0 ? formatClp(day.total) : "$0"}</span>
                        <span className="react-spending-chart-value-compact">{day.total > 0
                          ? `$${new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 0 }).format(day.total).replace(/\u00a0/g, " ").replace(/ k$/, " mil")}`
                          : "$0"}</span>
                      </> : day.total > 0 ? formatClp(day.total) : "$0")}
                    </span>
                    <span
                      className={
                        day.isInPeriod
                          ? "react-spending-chart-track"
                          : "react-spending-chart-track react-spending-chart-track-empty"
                      }
                      title={getSpendingChartBarTitle(day)}
                    >
                      {day.isInPeriod && day.total > 0 && (
                        <span
                          className="react-spending-chart-fill"
                          style={{
                            height: `${day.heightPercent}%`,
                            // Muted slate ramp (ends at the ink-3 tint), never the old cobalt hue.
                            backgroundColor: `hsl(220 16% ${72 - 31 * day.total / series.max}%)`,
                          }}
                        />
                      )}
                    </span>
                    <strong className="react-spending-chart-day">{day.label}</strong>
                    <small className="react-spending-chart-detail">{day.detail}</small>
                  </button>
                );
              })}
            </div>
            <aside
              ref={(element) => {
                if (motion) motion.summaryRef.current = element;
                if (motion?.summarySelection) motion.summarySelection.containerRef.current = element;
              }}
              className="react-spending-chart-summary"
              aria-label="Resumen de gastos del período"
            >
              <h4>Resumen del período</h4>
              <span ref={motion?.summarySelection?.indicatorRef} className="react-spending-chart-selection-indicator" aria-hidden="true" />
              {totalsRows.map((row) => (
                <div
                  key={row.id}
                  className={
                    row.isActive
                      ? "react-spending-chart-summary-row react-spending-chart-summary-row-active"
                      : "react-spending-chart-summary-row"
                  }
                  aria-current={row.isActive ? "true" : undefined}
                  aria-label={
                    row.isActive
                      ? `${row.label} seleccionado: ${formatClp(row.total)}`
                      : undefined
                  }
                >
                  <span>{row.label}:</span>
                  <strong>{formatClp(row.total)}</strong>
                </div>
              ))}
            </aside>
            {dayDetailPresentation(<aside
              ref={motion?.dayRef}
              id={detailId}
              className="react-spending-chart-day-panel"
              aria-live="polite"
            >
              <header className="react-spending-chart-day-header">
                <h4>{detail.title}</h4>
                {selectedDay?.isInPeriod && (
                  <strong className="react-spending-chart-day-total">
                    {detail.total > 0 ? formatClp(detail.total) : "$0"}
                  </strong>
                )}
              </header>
              {detail.groups.length === 0 ? (
                <p className="react-spending-chart-day-empty">
                  {detail.isEmpty
                    ? "No hay gastos con monto conocido para este día."
                    : "Elige un día del gráfico para ver qué gastos forman ese total."}
                </p>
              ) : (
                detail.groups.map((group) => (
                  <div key={group.key} className="react-spending-chart-day-group">
                    <span className="react-spending-chart-day-date">{group.label}</span>
                    <ul className="react-spending-chart-day-list">
                      {group.movements.map((movement) => {
                        const movementId = movement.id;
                        const rowContent = (
                          <>
                            <span className="react-spending-chart-day-identity">
                              <span className="react-spending-chart-day-person" aria-hidden="true">
                                <FontAwesomeIcon icon={faUser} />
                              </span>
                              <span className="react-spending-chart-day-info">
                                <strong>
                                  {movement.time
                                    ? `${movement.time} · ${movement.label}`
                                    : movement.label}
                                </strong>
                                <small>{movement.kindLabel}</small>
                              </span>
                            </span>
                            <strong className="react-spending-chart-day-amount">
                              {formatClp(movement.amount)}
                            </strong>
                          </>
                        );
                        return (
                          <li
                            key={
                              movementId ??
                              `${movement.dateKey}-${movement.time}-${movement.label}-${movement.amount}`
                            }
                            className="react-spending-chart-day-item"
                          >
                            {onOpenMovement !== undefined && movementId !== null ? (
                              <button
                                type="button"
                                className="react-spending-chart-day-open"
                                onClick={() => onOpenMovement(movementId)}
                              >
                                {rowContent}
                              </button>
                            ) : (
                              rowContent
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </aside>)}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The spending chart container: it owns which period tab and which bar are selected and hands that
 * decided state to the view. It starts on the full period, like legacy's `chartTab: "month"`
 * (`public/app.js:145`), selects Monday of that aggregate, and reselects the default bar of the new
 * series whenever the tab changes (`public/app.js:2261`).
 */
export interface SpendingChartPanelProps {
  chart: SpendingChart;
  /** Recognized outflow rows for the read-only detail; empty when the caller has none. */
  detailMovements?: SpendingChartDetailMovement[];
  /** Opens the read-only movement dialog for a row identity; absent keeps every row inert. */
  onOpenMovement?: (movementId: string) => void;
}

export function SpendingChartPanel({
  chart,
  detailMovements = [],
  onOpenMovement,
}: SpendingChartPanelProps) {
  const [selectedTab, setSelectedTab] = useState<string>(FULL_PERIOD_TAB_ID);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(() =>
    getSpendingChartDefaultDayKey(getSpendingChartSeries(chart, FULL_PERIOD_TAB_ID)),
  );
  const motion = useSpendingChartMotion(selectedTab, selectedDayKey);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 640px)").matches,
  );
  const [isDayDetailOpen, setIsDayDetailOpen] = useState(false);
  const dayDialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => {
      setIsMobile(media.matches);
      setIsDayDetailOpen(false);
      syncNativeModalDialog(dayDialogRef.current, false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const closeDayDetail = () => {
    syncNativeModalDialog(dayDialogRef.current, false);
    setIsDayDetailOpen(false);
  };
  const handleSelectTab = (tabId: string) => {
    closeDayDetail();
    setSelectedTab(tabId);
    setSelectedDayKey(getSpendingChartDefaultDayKey(getSpendingChartSeries(chart, tabId)));
  };
  const handleOpenMovement = onOpenMovement === undefined ? undefined : (movementId: string) => {
    // Close synchronously, before the movement owner can open another native modal.
    closeDayDetail();
    onOpenMovement(movementId);
  };
  return (
    <SpendingChartView
      chart={chart}
      selectedTab={selectedTab}
      onSelectTab={handleSelectTab}
      selectedDayKey={selectedDayKey}
      onSelectDay={(dayKey) => {
        setSelectedDayKey(dayKey);
        if (isMobile) setIsDayDetailOpen(true);
      }}
      motion={motion}
      detailMovements={detailMovements}
      onOpenMovement={handleOpenMovement}
      compactMobileLabels
      dayDetailIsModal={isMobile}
      dayDetailPresentation={isMobile ? (detail) => (
        <SpendingDayDetailDialog
          dialogRef={dayDialogRef}
          isOpen={isDayDetailOpen}
          onClose={() => setIsDayDetailOpen(false)}
        >
          {detail}
        </SpendingDayDetailDialog>
      ) : undefined}
    />
  );
}
