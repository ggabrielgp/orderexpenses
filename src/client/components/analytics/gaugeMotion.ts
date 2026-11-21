/**
 * Entrance motion of the month gauge (identity B, S11): the ring sweeps and the number counts up over
 * 700ms with an ease-out, once, when the gauge first renders.
 *
 * It is a pure scheduler over an injected host (`window` in the browser) so the rules are provable
 * without a DOM: nothing animates under `prefers-reduced-motion` or when the host has no animation
 * API, and in that case it never reports a partial progress, so the markup rendered by the server
 * (the final values) simply stays on screen.
 */

export const GAUGE_ANIMATION_MS = 700;

export interface GaugeMotionHost {
	matchMedia?: (query: string) => { matches: boolean };
	requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
	cancelAnimationFrame?: (handle: number) => void;
}

/** Cubic ease-out, clamped to the unit interval. */
export const easeOutCubic = (t: number): number => {
	const clamped = Math.min(Math.max(t, 0), 1);
	return 1 - (1 - clamped) ** 3;
};

export const prefersReducedMotion = (host: GaugeMotionHost): boolean =>
	typeof host.matchMedia === "function" && host.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reports eased progress 0..1 to `onProgress`: first `0`, then once per frame, last exactly `1`.
 * Returns a cancel function. Under reduced motion, or without `requestAnimationFrame`, it reports
 * nothing and schedules nothing.
 */
export function runGaugeEntrance(
	host: GaugeMotionHost,
	onProgress: (progress: number) => void,
): () => void {
	const { requestAnimationFrame, cancelAnimationFrame } = host;
	if (prefersReducedMotion(host) || typeof requestAnimationFrame !== "function") return () => {};

	let handle: number | null = null;
	let startedAt: number | null = null;
	let cancelled = false;
	const step = (timestamp: number) => {
		if (cancelled) return;
		startedAt ??= timestamp;
		const t = Math.min((timestamp - startedAt) / GAUGE_ANIMATION_MS, 1);
		onProgress(easeOutCubic(t));
		handle = t < 1 ? requestAnimationFrame.call(host, step) : null;
	};
	onProgress(0);
	handle = requestAnimationFrame.call(host, step);
	return () => {
		cancelled = true;
		if (handle !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame.call(host, handle);
		handle = null;
	};
}
