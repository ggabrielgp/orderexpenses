import type { ReactNode } from "react";
import type { DashboardView } from "./AppHeader";

export interface MobileTabBarProps {
	/** Current view; drives `aria-current` and the filled pill. The page owns the state. */
	view: DashboardView;
	/** Requests a view change. */
	onViewChange: (view: DashboardView) => void;
	/** Opens the existing manual-expense dialog; absent where creation is unavailable (demo, no cycle). */
	onAddExpense?: () => void;
}

const SummaryIcon = () => (
	<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
		<circle cx="12" cy="12" r="8" />
		<path d="M12 4v4" strokeLinecap="round" />
	</svg>
);

const MovementsIcon = () => (
	<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
		<path d="M5 6h14M5 12h14M5 18h9" />
	</svg>
);

/**
 * Identity B bottom navigation for narrow screens (artboards 02/05/03). It mirrors the header's view
 * navigation, which CSS hides on the same breakpoint, so exactly one navigation is visible and in the
 * accessibility tree at a time. The central button reuses the page's create flow.
 */
export function MobileTabBar({ view, onViewChange, onAddExpense }: MobileTabBarProps) {
	const tab = (target: DashboardView, label: string, icon: ReactNode) => (
		<button
			type="button"
			className={target === view ? "react-mobile-tabbar-link react-mobile-tabbar-link-active" : "react-mobile-tabbar-link"}
			aria-current={target === view ? "page" : undefined}
			onClick={() => onViewChange(target)}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
	return (
		<nav className={onAddExpense ? "react-mobile-tabbar" : "react-mobile-tabbar react-mobile-tabbar-two"} aria-label="Navegación principal">
			{tab("summary", "Resumen", <SummaryIcon />)}
			{onAddExpense ? (
				<button type="button" className="react-mobile-tabbar-add" aria-label="Agregar gasto" onClick={onAddExpense}>
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" focusable="false">
						<path d="M12 5v14M5 12h14" />
					</svg>
				</button>
			) : null}
			{tab("movements", "Movimientos", <MovementsIcon />)}
		</nav>
	);
}
