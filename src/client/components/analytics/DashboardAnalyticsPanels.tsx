import type { CSSProperties } from "react";
import {
  faArrowRightArrowLeft,
  faBolt,
  faCartShopping,
  faChartPie,
  faClock,
  faLightbulb,
  faReceipt,
  faStore,
  faTags,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { Category } from "../../api/types";
import type { RecognizedExpenseMovement } from "../movements/manualExpense";
import { formatClp } from "../movements/movementSummary";
import { CategoryDetailView, CategoryDistributionPanel } from "./CategoryDistributionPanel";
import { DashboardPaceGauge } from "./DashboardPaceGauge";
import { SpendingChartPanel } from "./SpendingChartPanel";
import { formatMovementCount } from "./categoryDistribution";
import {
  findCategoryRankingRow,
  type CategoryRanking,
  type CategoryRankingRow,
} from "./categoryRanking";
import type { DashboardCounterpartyRanking } from "./dashboardCounterpartyRanking";
import type {
  DashboardStory,
  DashboardTopInsights,
  SpendingBreakdown,
  SpendingBreakdownBar,
} from "./dashboardInsights";
import type { DashboardLead } from "./dashboardLead";
import type { DashboardPace } from "./dashboardPace";
import type { SpendingChart, SpendingChartDetailMovement } from "./spendingChart";

/**
 * The category ranking as one already-decided state: the ranked rows, and the detail of the selected
 * row when there is one.
 *
 * Exported so both the list and the detail markup are provable from a static render, like
 * other analytics views: a live summary only ever reaches the list without a session, and what the
 * detail claims is worth proving from what the user reads. The component renders the decisions the
 * pure module made and computes nothing of its own.
 *
 * The merged tail offers no jump: `Otras categorías` is not a category the movement filter can
 * select, so a control that pretended otherwise would narrow the table to nothing. Its detail lists
 * the categories it merged, which is the part of the distribution a user can still act on.
 */
export interface CategoryRankingViewProps {
  /** The decided ranking, from `getCategoryRanking`. */
  ranking: CategoryRanking;
  /** Category whose detail is shown, or `null` for the ranked list. */
  selectedCategory: string | null;
  onSelect: (category: string) => void;
  onClearSelection: () => void;
  /** Jumps into the movement table filter; never called for the merged tail. */
  onJumpToCategory: (category: string) => void;
}

export function CategoryRankingView({
  ranking,
  selectedCategory,
  onSelect,
  onClearSelection,
  onJumpToCategory,
}: CategoryRankingViewProps) {
  const selectedRow: CategoryRankingRow | null =
    selectedCategory === null ? null : findCategoryRankingRow(ranking, selectedCategory);

  return (
    <section className="react-category-ranking" aria-labelledby="react-category-ranking-title">
      <h3 id="react-category-ranking-title">Gasto reconocido por categoría</h3>
      {/* The excluded outflows are their own fact, stated only when there is one to state. */}
      {ranking.disclosure !== null && (
        <p className="react-category-ranking-disclosure" role="status">{ranking.disclosure}</p>
      )}
      {ranking.rows.length === 0 ? (
        <p className="react-category-ranking-empty" role="status">
          Aún no hay gastos con monto conocido para distribuir por categoría en este período.
        </p>
      ) : selectedRow === null ? (
        <ul className="react-category-ranking-list">
          {ranking.rows.map((row) => (
            <li key={row.category}>
              <button
                type="button"
                className="react-category-ranking-row"
                onClick={() => onSelect(row.category)}
              >
                <strong>{row.category}</strong>
                <small>
                  {formatClp(row.total)} · {row.share}% · {formatMovementCount(row.count)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <CategoryDetailView
          row={selectedRow}
          onClearSelection={onClearSelection}
          onJumpToCategory={onJumpToCategory}
          formatAmount={formatClp}
        />
      )}
    </section>
  );
}

/**
 * The legacy `¿A dónde se fue tu dinero?` mount point: it hands the decided ranking, the stored colours
 * and the jump to the distribution container, which owns the selection. The jump stays the
 * summary's, because only the summary can switch to the movements view and carry the requested
 * category into it.
 */
export interface CategoryRankingPanelProps {
  ranking: CategoryRanking;
  /** Stored category catalog, used for the donut and legend colours. */
  catalog?: readonly Category[];
  onJumpToCategory: (category: string) => void;
  movements?: readonly RecognizedExpenseMovement[];
  onOpenMovement?: (movementId: string) => void;
}

export function CategoryRankingPanel({
  ranking,
  catalog,
  onJumpToCategory,
  movements,
  onOpenMovement,
}: CategoryRankingPanelProps) {
  return (
    <CategoryDistributionPanel
      ranking={ranking}
      catalog={catalog}
      onJumpToCategory={onJumpToCategory}
      formatAmount={formatClp}
      movements={movements}
      onOpenMovement={onOpenMovement}
    />
  );
}

/** Compact ranking of stored identities, shared by authenticated and demo period views. */
export function DashboardCounterpartyRankingView({
  ranking,
}: {
  ranking: DashboardCounterpartyRanking;
}) {
  return (
    <section className="react-counterparty-ranking" aria-labelledby="react-counterparty-ranking-title">
      <header className="react-counterparty-ranking-header">
        <div className="react-counterparty-ranking-heading">
          <span className="react-counterparty-ranking-heading-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faStore} />
          </span>
          <div>
            <h3 id="react-counterparty-ranking-title">Top Comercios y Personas</h3>
            <p>Destinatarios identificados de tus gastos.</p>
          </div>
        </div>
        <div className="react-counterparty-ranking-header-actions">
          <span className="react-counterparty-ranking-badge">Ranking del período</span>
        </div>
      </header>
      {ranking.rows.length === 0 ? (
        <p className="react-counterparty-ranking-empty">
          No hay destinatarios identificados con monto conocido en este período.
        </p>
      ) : (
        <ul className="react-counterparty-ranking-list">
          {ranking.rows.slice(0, 4).map((row, index) => {
            const initials = row.name.split(" ").slice(0, 2)
              .map((word) => Array.from(word)[0]?.toLocaleUpperCase("es") ?? "").join("");
            return (
              <li key={row.name} className="react-counterparty-ranking-row">
                <span className={`react-counterparty-ranking-avatar react-counterparty-ranking-avatar-${index % 4}`} aria-hidden="true">
                  {initials}<span className="react-counterparty-ranking-rank">{index + 1}</span>
                </span>
                <div className="react-counterparty-ranking-detail">
                  <div className="react-counterparty-ranking-line">
                    <strong>{row.name}</strong>
                    <b>{Number.isFinite(row.total) ? formatClp(row.total) : "Monto no disponible"}</b>
                  </div>
                  <div className="react-counterparty-ranking-meta">
                    <span>{row.count} {row.count === 1 ? "movimiento" : "movimientos"}</span>
                    <span>
                      {row.share === null
                        ? "Porcentaje no disponible"
                        : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(row.share)}% del gasto cuantificado`}
                    </span>
                  </div>
                  <div className="react-counterparty-ranking-track" aria-hidden="true">
                    <span style={{ width: `${Math.max(0, Math.min(100, row.share ?? 0))}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="react-counterparty-ranking-denominator">
        Base: {Number.isFinite(ranking.allRecognizedQuantifiedSpending) ? formatClp(ranking.allRecognizedQuantifiedSpending) : "monto no disponible"} de todos los gastos reconocidos con monto conocido del período, incluidos los no identificados.
        {ranking.unnamedCount > 0 && ` ${ranking.unnamedCount} ${ranking.unnamedCount === 1 ? "movimiento sin destinatario identificado" : "movimientos sin destinatario identificado"} incluidos en la base.`}
        {(!Number.isFinite(ranking.allRecognizedQuantifiedSpending) || ranking.allRecognizedQuantifiedSpending <= 0) && " No se calcula un porcentaje sin una base positiva y finita."}
      </p>
    </section>
  );
}

export interface TopInsightsViewProps {
  /** The decided insights, from `getTopInsights`. */
  insights: DashboardTopInsights;
  /** The non-duplicative period note, from `getDashboardStory`. */
  story: DashboardStory;
  /** Authenticated category-filter jump; omitted by the read-only demo. */
  onJumpToUncategorized?: () => void;
}

/**
 * The one free solid glyph each top insight keeps beside its label. The label already names the
 * insight, so the glyph is decorative and never carries information on its own.
 */
const TOP_INSIGHT_ICONS: Record<"frequency" | "uncategorized" | "largest" | "latest", typeof faTags> = {
  frequency: faStore,
  uncategorized: faTags,
  largest: faBolt,
  latest: faClock,
};

/**
 * The `Lectura rápida · Inteligencia de gastos` card keeps its existing four equal tiles and period
 * note. Its optional authenticated category action remains separate from the ranking above it.
 */
export function TopInsightsView({ insights, story, onJumpToUncategorized }: TopInsightsViewProps) {
  const tiles = [insights.largest, insights.frequency, insights.latest, insights.uncategorized];
  return (
    <section className="react-top-insights" aria-labelledby="react-top-insights-title">
      <header className="react-top-insights-header">
        <div className="react-top-insights-heading">
          {/* Decorative: the adjacent title names the card, so the glyph is hidden. */}
          <span className="react-card-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faLightbulb} />
          </span>
          <h3 id="react-top-insights-title">Lectura rápida · Inteligencia de gastos</h3>
        </div>
        <p className="react-top-insights-subtitle">Tus datos más relevantes del período.</p>
        {/* A compact, supported badge: it names what the card summarizes without claiming AI. */}
        <span className="react-top-insights-badge">Resumen del período</span>
      </header>
      <ul className="react-top-insights-grid">
        {tiles.map((insight) => (
          <li key={insight.key} className={`react-insight-callout react-insight-callout-${insight.key}`}>
            <div className="react-insight-callout-header">
              <span className="react-insight-callout-label">{insight.label}</span>
              {/* Decorative: the adjacent label names the insight, so the glyph is hidden. */}
              <span className="react-insight-callout-icon" aria-hidden="true">
                <FontAwesomeIcon icon={TOP_INSIGHT_ICONS[insight.key]} />
              </span>
            </div>
            <strong className="react-insight-callout-value">
              {insight.key === "uncategorized" && insight.amount !== null
                ? formatClp(insight.amount) : insight.value}
            </strong>
            <p className="react-insight-callout-detail">
              {insight.key === "uncategorized" ? insight.note
                : insight.amount === null ? insight.note : formatClp(insight.amount)}
              {insight.hint.length > 0 && (
                <span className="react-insight-callout-hint">{insight.hint}</span>
              )}
            </p>
            {insight.key === "uncategorized" && insights.uncategorizedCount > 0 &&
              onJumpToUncategorized && (
                <button type="button" className="react-insight-category-action"
                  onClick={onJumpToUncategorized}>
                  Clasificar ahora →
                </button>
              )}
          </li>
        ))}
      </ul>
      <div className="react-top-insights-note" role={story.facts.length === 0 ? "status" : undefined}>
        <span className="react-top-insights-note-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faLightbulb} />
        </span>
        <div className="react-top-insights-note-copy">
          <p>{story.summary}</p>
          {story.facts.map((fact) => (
            <p key={fact}>{fact}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The visual spending breakdown as one already-decided state: a single segmented bar whose segments
 * are the proportional shares by kind, plus a readable icon legend and the recognized quantified
 * total.
 *
 * Exported so both the populated and the empty markup are provable from a static render, like the
 * other analytics panels. Each segment width is the share the pure module decided from raw amounts,
 * and the legend states every kind's amount and percentage as text too, so the distribution is
 * readable without the bar or its colour. Every legend marker reuses its segment's colour token, an
 * upper-right decorative chart glyph names the card, and there is deliberately no donut or charting
 * dependency. A zero total shows a truthful message instead of fabricated segments.
 */
export interface SpendingBreakdownViewProps {
  /** The decided bars, from `getSpendingBreakdown`. */
  breakdown: SpendingBreakdown;
}

/**
 * The one free Font Awesome solid glyph each recognized kind keeps in the legend. The icon is
 * decorative — the adjacent label names the kind — so it never carries information on its own and
 * the card never relies on colour alone.
 */
const SPENDING_BREAKDOWN_ICONS: Record<SpendingBreakdownBar["key"], typeof faCartShopping> = {
  purchase: faCartShopping,
  transfer: faArrowRightArrowLeft,
  payment: faReceipt,
};

export function SpendingBreakdownView({ breakdown }: SpendingBreakdownViewProps) {
  return (
    <section className="react-spending-breakdown" aria-labelledby="react-spending-breakdown-title">
      <div className="react-spending-breakdown-header">
        <div className="react-spending-breakdown-heading">
          <h3 id="react-spending-breakdown-title">Distribución de gastos</h3>
          {breakdown.emptyMessage === null ? (
            <p className="react-spending-breakdown-total">
              <span>Total registrado</span>
              <strong>{formatClp(breakdown.total)}</strong>
            </p>
          ) : null}
        </div>
        <span className="react-spending-breakdown-header-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faChartPie} />
        </span>
      </div>
      {breakdown.emptyMessage !== null ? (
        <p className="react-spending-breakdown-empty" role="status">{breakdown.emptyMessage}</p>
      ) : (
        <>
          <div className="react-spending-breakdown-chart">
          <div
            className="react-spending-breakdown-bar"
            role="img"
            aria-label={`Distribución de gastos por tipo. Total registrado ${formatClp(breakdown.total)}.`}
          >
            {breakdown.bars.map((bar) => (
              <span
                key={bar.key}
                className={`react-spending-breakdown-segment react-spending-breakdown-segment-${bar.key}`}
                style={{ "--share": `${bar.percent}%` } as CSSProperties}
              />
            ))}
          </div>
          <ul className="react-spending-breakdown-legend">
            {breakdown.bars.map((bar) => (
              <li
                key={bar.key}
                className={`react-spending-breakdown-legend-item react-spending-breakdown-legend-item-${bar.key}`}
              >
                <span className="react-spending-breakdown-legend-heading">
                  <span
                    className={`react-spending-breakdown-icon react-spending-breakdown-icon-${bar.key}`}
                    aria-hidden="true"
                  >
                    <FontAwesomeIcon icon={SPENDING_BREAKDOWN_ICONS[bar.key]} />
                  </span>
                  <span className="react-spending-breakdown-kind">{bar.label}</span>
                </span>
                <strong>{formatClp(bar.amount)}</strong>
                <span className="react-spending-breakdown-percent">{bar.percent}%</span>
              </li>
            ))}
          </ul>
          </div>
        </>
      )}
    </section>
  );
}

export interface DashboardAnalyticsBodyProps {
  /** The month gauge (identity B); absent when the caller has no cycle to measure. */
  pace?: DashboardPace;
  /** Exclusive end of the period the pace measures; the gauge says on which day it closes. */
  paceEndExclusive?: string;
  /** Replays the gauge sweep when it changes (the demo scenario); omitted, the gauge sweeps only once. */
  paceReplayKey?: string;
  /** Opens the cycle editor so the user can add the income the gauge needs. */
  onAddIncome?: () => void;
  /** Named counterparties from the same period's raw transactions. */
  counterpartyRanking: DashboardCounterpartyRanking;
  /** The decided lead, from `getDashboardLead`. */
  lead: DashboardLead;
  /** The decided month story, from `getDashboardStory`. */
  story: DashboardStory;
  /** The decided chart, from `getSpendingChart`. */
  chart: SpendingChart;
  /** Recognized outflow rows for the read-only chart detail. */
  chartDetailMovements: SpendingChartDetailMovement[];
  /** The decided ranking, from `getCategoryRanking`. */
  ranking: CategoryRanking;
  /** Individual recognized expenses for the donut detail, from the same period as the ranking. */
  categoryMovements: readonly RecognizedExpenseMovement[];
  /** Authenticated-only movement detail action; no edit/mutation is mounted in demo. */
  onOpenCategoryMovement?: (movementId: string) => void;
  /** Stored category catalog for the donut colours; absent when the caller has none. */
  catalog?: readonly Category[];
  /** Jumps into the caller's movement surface, including the read-only demo table. */
  onJumpToCategory: (category: string) => void;
  /** The decided insights, from `getTopInsights`. */
  insights: DashboardTopInsights;
  /** Authenticated-only jump to the uncategorized movement filter. */
  canJumpToUncategorized?: boolean;
  /** The decided breakdown, from `getSpendingBreakdown`. */
  breakdown: SpendingBreakdown;
  /** Opens the read-only chart day detail; absent keeps every row inert in the demo. */
  onOpenMovement?: (movementId: string) => void;
}

/**
 * The one dashboard analytics composition both the authenticated summary and the read-only demo mount:
 * the month gauge hero (which holds the income, spent, remaining and percentage once), spending chart, spending-type
 * breakdown, category distribution/ranking and top insights, in that order.
 *
 * It is deliberately internal and holds no state, data or request: each caller decides the data and
 * passes the capabilities it supports. The authenticated summary wires the category jump and the chart
 * detail dialog; the demo wires a local jump without a detail callback, and omits the stored catalog, so
 * the two differ in capabilities and copy, never in layout. The authenticated movement table and the
 * demo's read-only movements list/footer stay outside this body.
 *
 * One semantic wrapper keeps the Stitch composition: a two-column region that keeps the
 * chart/history column beside the category/insight column. The four-up KPI band (lead plus
 * income/budget truth) was merged into the gauge hero (S11), so no figure is stated twice. The spending-type distribution leads
 * the main column, so it sits physically left of the category distribution, which leads the side
 * column. The `Lectura rápida · Inteligencia de gastos` card is a full-width row below both columns (S14),
 * so no gap remains under the shorter one. The card keeps its highlights primary and carries the
 * non-duplicative story note below them. Every panel keeps a single mount,
 * so both trees read the same structure.
 */
export function DashboardAnalyticsBody({
  pace,
  paceEndExclusive,
  paceReplayKey,
  onAddIncome,
  lead,
  story,
  chart,
  chartDetailMovements,
  ranking,
  counterpartyRanking,
  categoryMovements,
  onOpenCategoryMovement,
  catalog,
  onJumpToCategory,
  insights,
  canJumpToUncategorized,
  breakdown,
  onOpenMovement,
}: DashboardAnalyticsBodyProps) {
  // The facts the former KPI band carried that no figure repeats: how many expenses the total sums
  // (and how many had no clear amount), and the pending-amount caveat when a balance is stated.
  const heroNotes = [
    lead.spending.detail,
    lead.balance.amount !== null ? lead.balance.detail : "",
  ].filter((note) => note.length > 0);
  return (
    <div className="react-analytics-body">
      {/* The month gauge is the hero: it answers "am I on track?" first and holds income, spent, remaining
          and the share of income once, so the former KPI band and the budget card are merged into it.
          Every panel below keeps its place. */}
      {pace && <DashboardPaceGauge pace={pace} formatClp={formatClp} onAddIncome={onAddIncome} notes={heroNotes} periodEndExclusive={paceEndExclusive} replayKey={paceReplayKey} />}
      {/* Two-column region: the larger chart/history column and the category/insight column. */}
      <div className="react-analytics-columns">
        <div className="react-analytics-main">
          {/* The distribution card leads the main column, so it aligns beside the category card in the
					    side column at desktop. */}
          <div className="react-mobile-breakdown">
            <SpendingBreakdownView breakdown={breakdown} />
          </div>
          <div className="react-mobile-evolution">
            <SpendingChartPanel
              chart={chart}
              detailMovements={chartDetailMovements}
              onOpenMovement={onOpenMovement}
            />
          </div>
        </div>
        <div className="react-analytics-side">
          <div className="react-mobile-categories">
            <CategoryRankingPanel
              ranking={ranking}
              catalog={catalog}
              movements={categoryMovements}
              onOpenMovement={onOpenCategoryMovement}
              onJumpToCategory={onJumpToCategory}
            />
          </div>
          <div className="react-mobile-counterparties">
            <DashboardCounterpartyRankingView ranking={counterpartyRanking} />
          </div>
        </div>
      </div>
      {/* Full-width row below the panels (S14), as in artboard 01: no gap is left under the shorter column. */}
      <div className="react-mobile-insights">
        <TopInsightsView insights={insights} story={story}
          onJumpToUncategorized={canJumpToUncategorized
            ? () => onJumpToCategory("Sin categoría") : undefined} />
      </div>
    </div>
  );
}
