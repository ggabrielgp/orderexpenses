export interface BrandMarkProps {
	/** Rendered width and height in CSS pixels. */
	size?: number;
	/** Accessible name. Omit it when a surrounding link or label already names the product. */
	title?: string;
	className?: string;
}

/**
 * Month gauge logo (identity direction B): a ring with a calm arc, the "today" tick and a center
 * dot. Decorative by default (`aria-hidden`) so a surrounding link keeps its own label; pass
 * `title` to expose it as a standalone image. Colors read the design tokens with the hex values
 * as fallback so the mark also works outside the token scope.
 */
export function BrandMark({ size = 28, title, className }: BrandMarkProps) {
	const ink = "var(--color-ink, #131b2e)";
	return (
		<svg
			className={className ? `brand-mark ${className}` : "brand-mark"}
			width={size}
			height={size}
			viewBox="0 0 56 56"
			focusable="false"
			style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle" }}
			{...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
		>
			{title ? <title>{title}</title> : null}
			<circle cx="28" cy="28" r="22" fill="none" stroke="#e3e1dc" strokeWidth="7" />
			<circle
				cx="28"
				cy="28"
				r="22"
				fill="none"
				stroke="var(--state-calm, #0b7a6b)"
				strokeWidth="7"
				strokeLinecap="round"
				strokeDasharray="86 138.2"
				transform="rotate(-90 28 28)"
			/>
			<path d="M28 2v9" stroke={ink} strokeWidth="3" strokeLinecap="round" transform="rotate(240 28 28)" />
			<circle cx="28" cy="28" r="5" fill={ink} />
		</svg>
	);
}
