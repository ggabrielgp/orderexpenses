/** Small decorative glyphs of the cycle dialogs (artboard 08); the text next to them carries the meaning. */
export function CalendarGlyph() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<rect x="3" y="5" width="18" height="16" rx="3" />
			<path d="M8 3v4M16 3v4M3 10h18" />
		</svg>
	);
}

export function AlertGlyph() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7.5v5.5M12 16.5v.01" />
		</svg>
	);
}
