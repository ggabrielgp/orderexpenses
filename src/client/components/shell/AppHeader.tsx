import type { ReactNode } from "react";
import { BrandMark } from "../brand/BrandMark";
import { ThemeToggle } from "../theme/ThemeToggle";

/**
 * The two authenticated dashboard views the chrome switches between.
 *
 * The page owns the state; this header only renders the active one and asks for a change, so the
 * navigation and the body below it can never disagree about which view is shown.
 */
export type DashboardView = "summary" | "movements";

export interface AppHeaderProps {
	/** Current view; drives the active navigation state. */
	view: DashboardView;
	/** Requests a view change. The page owns the state. */
	onViewChange: (view: DashboardView) => void;
	/**
	 * Account slot. The authenticated page composes the shipped `AccountMenu` (and the settings
	 * action it owns) here, so this chrome stays free of account state and the read-only demo
	 * tree never mounts it.
	 */
	children?: ReactNode;
}

const DASHBOARD_NAVIGATION: { view: DashboardView; label: string }[] = [
	{ view: "summary", label: "Resumen" },
	{ view: "movements", label: "Movimientos" },
];

/**
 * Authenticated product chrome: brand, view navigation and the account slot, mirroring the legacy
 * app header. It renders no data and issues no request; it only presents the view the page handed
 * it and reports the one the user asked for. Month navigation is deliberately absent: the React
 * dashboard is period-scoped, so there is no month control this surface could drive.
 */
export function AppHeader({ view, onViewChange, children }: AppHeaderProps) {
	return (
		<header className="react-app-header">
			<div className="react-app-header-inner">
				<div className="react-app-brand-group">
					<a className="react-app-brand" href="/" aria-label="Gastos Controlados, inicio">
						<BrandMark size={32} className="react-app-brand-logo" />
						<span>Gastos Controlados</span>
					</a>
				</div>
				<nav className="react-app-navigation" data-view={view} aria-label="Vistas del panel">
					{DASHBOARD_NAVIGATION.map((item) => {
						const isActive = item.view === view;
						return (
							<button
								key={item.view}
								type="button"
								className={
									isActive
										? "react-app-navigation-link react-app-navigation-link-active"
										: "react-app-navigation-link"
								}
								aria-pressed={isActive}
								onClick={() => onViewChange(item.view)}
							>
								{item.label}
							</button>
						);
					})}
				</nav>
				<div className="react-app-account">
					<ThemeToggle />
					{children}
				</div>
			</div>
		</header>
	);
}
