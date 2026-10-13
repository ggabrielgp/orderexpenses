interface FeedbackNoticeProps {
	className: string;
	tone: string;
	message: string;
}

/** A check belongs to an actual settled success, never a warning, error or pending request. */
export function FeedbackNotice({ className, tone, message }: FeedbackNoticeProps) {
	return (
		<p className={`${className} react-feedback-notice`} role="status">
			{tone === "success" && (
				<svg className="react-success-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="m5 12 4 4 10-10" pathLength="1" />
				</svg>
			)}
			<span>{message}</span>
		</p>
	);
}
