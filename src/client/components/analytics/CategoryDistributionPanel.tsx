import { useEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import type { EChartsOption, EChartsType } from "echarts";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { Category } from "../../api/types";
import type { RecognizedExpenseMovement } from "../movements/manualExpense";
import {
	findCategoryRankingRow,
	getCategoryKey,
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
 * Ranking rows and colours come from the pure modules; the selected detail receives the same period's
 * recognized movements and displays individual records without treating grouped recipients as records.
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

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	})[character] ?? character);
}

/**
 * The category detail panel is shared with the ranking view. When given period movements, it lists
 * individual expenses rather than presenting aggregated counterparties as movements. The merged tail
 * matches its real child categories; it is never itself used as a movement category filter.
 */
export interface CategoryDetailViewProps {
	row: CategoryRankingRow;
	onClearSelection: () => void;
	/** Jumps into the movement table filter; never called for the merged tail. */
	onJumpToCategory: (category: string) => void;
	formatAmount: (amount: number) => string;
	/** Recognized finite expenses from the current period; omitted by the standalone ranking view. */
	movements?: readonly RecognizedExpenseMovement[];
	/** Only ID-bearing rows can open the authenticated detail dialog. */
	onOpenMovement?: (movementId: string) => void;
	/** When provided, the category title is a programmatic focus target. */
	headingRef?: Ref<HTMLElement>;
}

export function CategoryDetailView({
	row,
	onClearSelection,
	onJumpToCategory,
	formatAmount,
	movements,
	onOpenMovement,
	headingRef,
}: CategoryDetailViewProps) {
	const categoryKeys = new Set(
		(row.mergesTail ? row.children.map((child) => child.category) : [row.category])
			.map(getCategoryKey),
	);
	const categoryMovements = movements?.filter((movement) =>
		Number.isFinite(movement.amount) && categoryKeys.has(getCategoryKey(movement.category)),
	);
	return (
		<div className="react-category-detail">
			<header className="react-category-detail-header">
				<strong ref={headingRef} role="heading" aria-level={4} tabIndex={headingRef ? -1 : undefined}>{row.category}</strong>
				<small>
					{formatAmount(row.total)} · {row.share}% · {formatMovementCount(row.count)}
				</small>
			</header>
			<div className="react-category-detail-rows">
				{categoryMovements ? (
					categoryMovements.map((movement, index) => {
						const movementId = movement.id;
						const content = (
							<>
								<span className="react-category-movement-identity">
									<strong>{movement.counterparty}</strong>
									<small>{movement.date === "—" ? "Fecha no disponible" : movement.date}{row.mergesTail ? ` · ${movement.category}` : ""}</small>
								</span>
								<strong className="react-category-movement-amount">{formatAmount(movement.amount)}</strong>
							</>
						);
						return (
							<div key={movementId ?? `unidentified-${index}`} className="react-category-detail-row">
								{movementId && onOpenMovement ? (
									<button type="button" className="react-category-movement-open" onClick={() => onOpenMovement(movementId)}>
										{content}
									</button>
								) : <div className="react-category-movement-static">{content}</div>}
							</div>
						);
					})
				) : row.mergesTail
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
	reducedMotion: boolean,
	selectedRow: CategoryRankingRow | null,
): EChartsOption {
	const total = legend.reduce((sum, entry) => sum + entry.total, 0);
	const centerAmount = formatAmount(selectedRow?.total ?? total);
	const option = {
		animation: !reducedMotion,
		animationDuration: reducedMotion ? 0 : 800,
		animationEasing: "cubicOut",
		tooltip: {
			trigger: "item",
			formatter: (params: { name?: string; value?: number; percent?: number; data?: { count?: number } }) => {
				const count = params.data?.count ?? 0;
				const percent = params.percent ?? 0;
				const value = typeof params.value === "number" ? params.value : 0;
				return `${escapeHtml(params.name ?? "")}<br/>${escapeHtml(formatAmount(value))} · ${escapeHtml(String(percent))}%<br/>${escapeHtml(formatMovementCount(count))}`;
			},
		},
		graphic: [
			{
				type: "text",
				left: "center",
				top: "40%",
				style: {
					text: selectedRow?.category ?? "Total",
					width: 108,
					overflow: "truncate",
					ellipsis: "…",
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
					text: centerAmount,
					width: 108,
					overflow: "breakAll",
					fontSize: centerAmount.length > 16 ? 11 : centerAmount.length > 10 ? 14 : 18,
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
	movements?: readonly RecognizedExpenseMovement[];
	onOpenMovement?: (movementId: string) => void;
}

export function CategoryDistributionView({
	ranking,
	catalog,
	selectedCategory,
	onSelect,
	onClearSelection,
	onJumpToCategory,
	formatAmount,
	movements,
	onOpenMovement,
}: CategoryDistributionViewProps) {
	const chartRef = useRef<HTMLDivElement | null>(null);
	const instanceRef = useRef<EChartsType | null>(null);
	const detailHeadingRef = useRef<HTMLElement | null>(null);
	const legendButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
	const returnCategoryRef = useRef<string | null>(null);
	const [reducedMotion, setReducedMotion] = useState(() =>
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	// The click handlers are registered once, so they read the latest callbacks through refs instead of
	// capturing the first render's identities.
	const selectRef = useRef(onSelect);
	const clearRef = useRef(onClearSelection);
	const selectCategory = (category: string) => {
		returnCategoryRef.current = category;
		onSelect(category);
	};
	selectRef.current = selectCategory;
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
	const previousCategoryRef = useRef(activeCategory);
	useEffect(() => {
		const previousCategory = previousCategoryRef.current;
		previousCategoryRef.current = activeCategory;
		if (activeCategory === previousCategory) return;
		if (activeCategory !== null) {
			detailHeadingRef.current?.focus();
		} else if (previousCategory !== null) {
			const buttons = legendButtonRefs.current;
			(buttons.get(returnCategoryRef.current ?? previousCategory) ??
				buttons.get(previousCategory) ?? buttons.values().next().value)?.focus();
			returnCategoryRef.current = null;
		}
	}, [activeCategory]);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(preference.matches);
		update();
		preference.addEventListener("change", update);
		return () => preference.removeEventListener("change", update);
	}, []);

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
				chart.setOption(buildDonutOption(legend, formatAmount, reducedMotion, selectedRow), true);
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
	}, [legend, activeCategory, formatAmount, reducedMotion, chartUnavailable]);

	useEffect(() => {
		const container = chartRef.current;
		if (container === null || legend.length === 0) return;
		const resize = () => {
			const chart = instanceRef.current;
			if (chart && !chart.isDisposed() && chart.getDom() === container) chart.resize();
		};
		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver(resize);
			observer.observe(container);
			return () => observer.disconnect();
		}
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, [legend.length, chartUnavailable]);

	useEffect(
		() => () => {
			instanceRef.current?.dispose();
			instanceRef.current = null;
		},
		[],
	);

	const heading = (
		<>
			<div className="react-category-distribution-heading">
				<h3 id="react-category-distribution-title">Dónde se fue tu plata</h3>
				{/* Decorative: the adjacent title names the card, so the glyph is hidden. */}
				<span className="react-card-icon" aria-hidden="true">
					<FontAwesomeIcon icon={faLayerGroup} />
				</span>
			</div>
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
				{ranking.disclosure !== null && (
					<p className="react-category-distribution-disclosure" role="status">{ranking.disclosure}</p>
				)}
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
								ref={(button) => {
									if (button) legendButtonRefs.current.set(entry.category, button);
									else legendButtonRefs.current.delete(entry.category);
								}}
								onClick={() => selectCategory(entry.category)}
							>
								<span className="react-category-legend-marker" aria-hidden="true" />
								<strong>{entry.category}</strong>
								<small>{formatAmount(entry.total)} · {entry.share}% · {entry.count} mov.</small>
							</button>
						))
					) : (
						<CategoryDetailView
							row={selectedRow}
							movements={movements}
							onOpenMovement={onOpenMovement}
							headingRef={detailHeadingRef}
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
	movements?: readonly RecognizedExpenseMovement[];
	onOpenMovement?: (movementId: string) => void;
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
	movements,
	onOpenMovement,
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
			movements={movements}
			onOpenMovement={onOpenMovement}
		/>
	);
}
