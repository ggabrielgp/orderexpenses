interface FeedbackNoticeProps {
	className: string;
	tone: string;
	message: string;
	/** Optional inline action, e.g. "Deshacer" after a recategorization. */
	action?: { label: string; onClick: () => void; disabled?: boolean };
}

/** A check belongs to an actual settled success, never a warning, error or pending request. */
export function FeedbackNotice({ className, tone, message, action }: FeedbackNoticeProps) {
	return (
		<p className={`${className} react-feedback-notice`} role="status">
			{tone === "success" && (
				<svg className="react-success-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="m5 12 4 4 10-10" pathLength="1" />
				</svg>
			)}
			<span>{message}</span>
			{action && (
				<button className="react-feedback-notice-action" type="button" onClick={action.onClick} disabled={action.disabled}>
					{action.label}
				</button>
			)}
		</p>
	);
}
