import { useId, type MouseEvent } from "react";
import { useTheme } from "../../theme/useTheme";

export interface ThemeToggleProps {
	className?: string;
}

/**
 * Accessible light/dark mode switch. Defaults to the OS preference until the user explicitly
 * toggles it, then persists their choice and keeps every mounted header in sync.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
	const { resolvedTheme, toggleTheme } = useTheme();
	const maskId = useId();
	const isDark = resolvedTheme === "dark";
	const label = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		toggleTheme({
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		});
	};

	return (
		<button
			type="button"
			className={className ? `theme-toggle ${className}` : "theme-toggle"}
			aria-label={label}
			data-theme-state={resolvedTheme}
			title={label}
			onClick={handleClick}
		>
			<ThemeMorphIcon maskId={maskId} />
		</button>
	);
}

function ThemeMorphIcon({ maskId }: { maskId: string }) {
	return (
		<svg
			className="theme-toggle-icon"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
			focusable="false"
		>
			<defs>
				<mask id={maskId}>
					<rect x="0" y="0" width="24" height="24" fill="white" />
					<circle className="theme-toggle-mask-cutout" cx="17" cy="7" r="7" fill="black" />
				</mask>
			</defs>
			<circle
				className="theme-toggle-core"
				cx="12"
				cy="12"
				r="8"
				fill="currentColor"
				mask={`url(#${maskId})`}
			/>
			<g
				className="theme-toggle-rays"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			>
				<line x1="12" y1="2" x2="12" y2="4.2" />
				<line x1="12" y1="19.8" x2="12" y2="22" />
				<line x1="4.93" y1="4.93" x2="6.49" y2="6.49" />
				<line x1="17.51" y1="17.51" x2="19.07" y2="19.07" />
				<line x1="2" y1="12" x2="4.2" y2="12" />
				<line x1="19.8" y1="12" x2="22" y2="12" />
				<line x1="6.49" y1="17.51" x2="4.93" y2="19.07" />
				<line x1="19.07" y1="4.93" x2="17.51" y2="6.49" />
			</g>
		</svg>
	);
}
