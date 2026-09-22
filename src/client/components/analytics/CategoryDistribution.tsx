import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { EChartsOption, EChartsType } from "echarts";
import type { Category } from "../../api/types";
import {
	findCategoryRankingRow,
	type CategoryRanking,
	type CategoryRankingRow,
} from "./categoryRanking";
import {
	formatMovementCount,
	getCategoryDistributionInsight,
	getCategoryRowColor,
	getDistributionAriaLabel,
} from "./categoryDistribution";

/**
 * The legacy `Dónde se fue tu plata` card as a reusable authenticated view: the ECharts donut, the
 * coloured legend rows that select a category, and the existing category detail.
 *
 * Legacy rendered this through `renderCategoryDistribution` (`public/app.js:2733-2872`) with an
 * ECharts pie whose slices and legend rows shared one colour, a click that toggled the active
 * category, and a detail panel that replaced the legend while a category was selected. This port
 * keeps that behaviour but reuses the ranking decisions (`getCategoryRanking`/`findCategoryRankingRow`)
 * and the extracted `CategoryDetailView` instead of duplicating either.
 *
 * ECharts is imported dynamically inside the effect, so the module can be statically rendered without
 * a browser and the charting library is only fetched when the authenticated card actually mounts.
 * The donut container carries the same facts as text through `aria-label`, because the canvas itself
 * is not readable by assistive technology.
 *
 * The card renders nothing of its own: the rows, their colours and the insight sentence all come from
 * the pure modules, so a static render proves what the user reads.
 */

/** Legacy's darker slice border (`darkenColor`, `public/app.js:2712-2718`). */
function darkenColor(hex: string, amount = 30): string {
	const value = Number.parseInt(hex.replace("#", ""), 16);
	if (!Number.isFinite(value)) return hex;
	const red = Math.max(0, ((value >> 16) & 0xff) - amount);
	const green = Math.max(0, ((value >> 8) & 0xff) - amount);
	const blue = Math.max(0, (value & 0xff) - amount);
	return `#${((red << 16) | (green << 8) | blue).toString(16).padStart(6, "0")}`;
}

interface CategoryLegendEntry {
	category: string;
	total: number;
	share: number;
	count: number;
	color: string;
}

/**
 * The category detail panel, extracted from the ranking view so both the ranked list and the donut
 * card render the same markup for the counterparties inside a category (and the categories the merged
 * tail absorbed). The jump is withheld for the merged tail, exactly as before.
 */
export interface CategoryDetailViewProps {
	row: CategoryRankingRow;
	onClearSelection: () => void;
	/** Jumps into the movement table filter; never called for the merged tail. */
	onJumpToCategory: (category: string) => void;
	formatAmount: (amount: number) => string;
}

export function CategoryDetailView({
	row,
	onClearSelection,
	onJumpToCategory,
	formatAmount,
}: CategoryDetailViewProps) {
	return (
		<div className="react-category-detail">
			<header className="react-category-detail-header">
				<strong>{row.category}</strong>
				<small>
					{formatAmount(row.total)} · {row.share}% · {formatMovementCount(row.count)}
				</small>
			</header>
			<div className="react-category-detail-rows">
				{row.mergesTail
					? row.children.map((child) => (
							<article key={child.category} className="react-category-detail-row">
								<strong>{child.category}</strong>
								<small>{formatAmount(child.total)} · {formatMovementCount(child.count)}</small>
							</article>
						))
					: row.counterparties.map((counterparty) => (
							<article key={counterparty.counterparty} className="react-category-detail-row">
								<strong>{counterparty.counterparty}</strong>
								<small>{formatAmount(counterparty.total)} · {formatMovementCount(counterparty.count)}</small>
							</article>
						))}
			</div>
			<div className="react-category-detail-actions">
				{/* No jump for the merged tail: it cannot be the movement filter's category. */}
				{!row.mergesTail && (
					<button
						type="button"
						className="secondary react-category-detail-jump"
						onClick={() => onJumpToCategory(row.category)}
					>
						Ver gastos de esta categoría
					</button>
				)}
				<button
					type="button"
					className="secondary react-category-detail-back"
					onClick={onClearSelection}
				>
					← Todas las categorías
				</button>
			</div>
		</div>
	);
}

/** The ECharts option legacy configured for the donut (`public/app.js:2758-2838`). */
function buildDonutOption(
	legend: readonly CategoryLegendEntry[],
	formatAmount: (amount: number) => string,
): EChartsOption {
	const total = legend.reduce((sum, entry) => sum + entry.total, 0);
	const option = {
		animation: true,
		animationDuration: 800,
		animationEasing: "cubicOut",
		tooltip: {
			trigger: "item",
			formatter: (params: { name?: string; value?: number; percent?: number; data?: { count?: number } }) => {
				const count = params.data?.count ?? 0;
				const percent = params.percent ?? 0;
				const value = typeof params.value === "number" ? params.value : 0;
				return `${params.name ?? ""}<br/>${formatAmount(value)} · ${percent}%<br/>${formatMovementCount(count)}`;
			},
		},
		graphic: [
			{
				type: "text",
				left: "center",
				top: "40%",
				style: {
					text: "Total",
					fontSize: 12,
					fill: "#7a827b",
					textAlign: "center",
				},
			},
			{
				type: "text",
				left: "center",
				top: "52%",
				style: {
					text: formatAmount(total),
					fontSize: 20,
					fill: "#17211d",
					fontWeight: 700,
					textAlign: "center",
				},
			},
		],
		series: [
			{
				type: "pie",
				radius: ["48%", "74%"],
				center: ["50%", "50%"],
				avoidLabelOverlap: false,
				padAngle: 3,
				emphasis: {
					scale: true,
					scaleSize: 8,
				},
				label: { show: false },
				data: legend.map((entry) => ({
					value: entry.total,
					name: entry.category,
					count: entry.count,
					itemStyle: {
						color: entry.color,
						borderColor: darkenColor(entry.color, 30),
						borderWidth: 2,
						borderRadius: 6,
					},
				})),
			},
		],
	};
	return option as unknown as EChartsOption;
}

export interface CategoryDistributionViewProps {
	/** The decided ranking, from `getCategoryRanking`. */
	ranking: CategoryRanking;
	/** Stored category catalog, used for colours; a missing catalog falls back to the palette. */
	catalog?: readonly Category[];
	/** Category whose detail is shown, or `null` for the coloured legend. */
	selectedCategory: string | null;
	onSelect: (category: string) => void;
	onClearSelection: () => void;
	/** Jumps into the movement table filter; never called for the merged tail. */
	onJumpToCategory: (category: string) => void;
	formatAmount: (amount: number) => string;
}

export function CategoryDistributionView({
	ranking,
	catalog,
	selectedCategory,
	onSelect,
	onClearSelection,
	onJumpToCategory,
	formatAmount,
}: CategoryDistributionViewProps) {
	const chartRef = useRef<HTMLDivElement | null>(null);
	const instanceRef = useRef<EChartsType | null>(null);
	// The click handlers are registered once, so they read the latest callbacks through refs instead of
	// capturing the first render's identities.
	const selectRef = useRef(onSelect);
	const clearRef = useRef(onClearSelection);
	selectRef.current = onSelect;
	clearRef.current = onClearSelection;
	// A failed dynamic import is a fact the card can state instead of an unhandled rejection.
	const [chartUnavailable, setChartUnavailable] = useState(false);

	const legend = useMemo<CategoryLegendEntry[]>(
		() =>
			ranking.rows.map((row) => ({
				category: row.category,
				total: row.total,
				share: row.share,
				count: row.count,
				color: getCategoryRowColor(row.category, catalog),
			})),
		[ranking.rows, catalog],
	);

	const selectedRow: CategoryRankingRow | null =
		selectedCategory === null ? null : findCategoryRankingRow(ranking, selectedCategory);
	const activeCategory = selectedRow?.category ?? null;

	const insight = useMemo(
		() => getCategoryDistributionInsight(ranking.rows, ranking.total, formatAmount),
		[ranking.rows, ranking.total, formatAmount],
	);
	const ariaLabel = useMemo(
		() => getDistributionAriaLabel(ranking.rows, ranking.total, formatAmount),
		[ranking.rows, ranking.total, formatAmount],
	);

	// One effect owns the instance: it lazily imports ECharts, applies the option on every data or
	// selection change, and applies the active-slice highlight. A failed import never escapes as an
	// unhandled rejection: the card states it and the legend already carries the same data. The cleanup
	// only marks this run stale; the unmount effect below disposes the instance once.
	useEffect(() => {
		const container = chartRef.current;
		if (container === null || legend.length === 0) {
			// Nothing left to draw: drop any instance instead of keeping a stale chart alive.
			instanceRef.current?.dispose();
			instanceRef.current = null;
			return;
		}
		let disposed = false;

		void import("echarts")
			.then((echarts) => {
				if (disposed) return;
				setChartUnavailable(false);
				const chart = instanceRef.current ?? echarts.init(container);
				instanceRef.current = chart;
				chart.setOption(buildDonutOption(legend, formatAmount), true);
				chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
				if (activeCategory !== null) {
					chart.dispatchAction({ type: "highlight", seriesIndex: 0, name: activeCategory });
				}

				chart.off("click");
				chart.on("click", (params) => {
					const name = (params as { name?: unknown }).name;
					if (typeof name === "string") selectRef.current(name);
				});
				chart.getZr().off("click");
				chart.getZr().on("click", (event) => {
					if (!(event as { target?: unknown }).target) clearRef.current();
				});
			})
			.catch(() => {
				if (disposed) return;
				setChartUnavailable(true);
			});

		return () => {
			disposed = true;
		};
	}, [legend, activeCategory, formatAmount]);

	useEffect(
		() => () => {
			instanceRef.current?.dispose();
			instanceRef.current = null;
		},
		[],
	);

	const heading = (
		<>
			<h3 id="react-category-distribution-title">Dónde se fue tu plata</h3>
			<p className="react-category-distribution-copy">
				Distribución por categoría principal.
			</p>
		</>
	);

	if (ranking.rows.length === 0) {
		return (
			<section className="react-category-distribution" aria-labelledby="react-category-distribution-title">
				{heading}
				<p className="react-category-distribution-empty" role="status">
					Aún no hay gastos con monto conocido para distribuir por categoría en este periodo.
				</p>
			</section>
		);
	}

	return (
		<section className="react-category-distribution" aria-labelledby="react-category-distribution-title">
			{heading}
			{/* The excluded outflows are their own fact, stated only when there is one to state. */}
			{ranking.disclosure !== null && (
				<p className="react-category-distribution-disclosure" role="status">{ranking.disclosure}</p>
			)}
			{insight !== null && (
				<p className="react-category-distribution-insight" role="status">{insight}</p>
			)}
			<div className="react-category-distribution-body">
				<div className="react-category-donut-wrap">
					{chartUnavailable ? (
						<p className="react-category-donut-fallback" role="status">
							No se pudo cargar la gráfica de distribución. Las categorías de al lado llevan los mismos datos.
						</p>
					) : (
						<div className="react-category-donut" role="img" aria-label={ariaLabel}>
							<div ref={chartRef} className="react-category-donut-chart" />
						</div>
					)}
				</div>
				<div className="react-category-distribution-legend">
					{selectedRow === null ? (
						legend.map((entry) => (
							<button
								key={entry.category}
								type="button"
								className="react-category-legend-item"
								style={{ "--category-color": entry.color } as CSSProperties}
								aria-pressed={activeCategory === entry.category}
								onClick={() => onSelect(entry.category)}
							>
								<span className="react-category-legend-marker" aria-hidden="true" />
								<strong>{entry.category}</strong>
								<small>{formatAmount(entry.total)} · {entry.share}% · {entry.count} mov.</small>
							</button>
						))
					) : (
						<CategoryDetailView
							row={selectedRow}
							onClearSelection={onClearSelection}
							onJumpToCategory={onJumpToCategory}
							formatAmount={formatAmount}
						/>
					)}
				</div>
			</div>
		</section>
	);
}

export interface CategoryDistributionPanelProps {
	ranking: CategoryRanking;
	/** Stored category catalog, used for colours; a missing catalog falls back to the palette. */
	catalog?: readonly Category[];
	onJumpToCategory: (category: string) => void;
	formatAmount: (amount: number) => string;
}

/**
 * The distribution container: it owns which category is being inspected and hands the decided state
 * to the view. It starts on the coloured legend, exactly like legacy's cleared `activeCategory`.
 */
export function CategoryDistributionPanel({
	ranking,
	catalog,
	onJumpToCategory,
	formatAmount,
}: CategoryDistributionPanelProps) {
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
	return (
		<CategoryDistributionView
			ranking={ranking}
			catalog={catalog}
			selectedCategory={selectedCategory}
			onSelect={(category) =>
				setSelectedCategory((current) => (current === category ? null : category))
			}
			onClearSelection={() => setSelectedCategory(null)}
			onJumpToCategory={onJumpToCategory}
			formatAmount={formatAmount}
		/>
	);
}
