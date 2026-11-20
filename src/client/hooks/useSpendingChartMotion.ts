import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAutoHeightMotion } from "./useAutoHeightMotion";
import { useSelectionIndicatorMotion } from "./useSelectionIndicatorMotion";

/** Keep controls mounted: only geometry and a quiet tab-content emphasis change. */
export function useSpendingChartMotion(tabKey: string, dayKey: string | null) {
	const [reducedMotion, setReducedMotion] = useState(() =>
		typeof window !== "undefined" && typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(preference.matches);
		update();
		preference.addEventListener("change", update);
		return () => preference.removeEventListener("change", update);
	}, []);

	const chartRef = useAutoHeightMotion(tabKey, reducedMotion);
	const summaryRef: { current: HTMLElement | null } = useAutoHeightMotion(tabKey, reducedMotion);
	const dayRef = useAutoHeightMotion(JSON.stringify([tabKey, dayKey]), reducedMotion);
	const previousTab = useRef(tabKey);
	useLayoutEffect(() => {
		const changed = previousTab.current !== tabKey;
		previousTab.current = tabKey;
		if (!changed || reducedMotion) return;
		// The summary usually keeps the same height; a small emphasis makes its new active row legible.
		const animations = [chartRef.current, summaryRef.current].flatMap((element) =>
			element && typeof element.animate === "function"
				? [element.animate([{ opacity: 0.85 }, { opacity: 1 }], { duration: 200, easing: "ease-out" })]
				: [],
		);
		return () => animations.forEach((animation) => animation.cancel());
	}, [tabKey, reducedMotion, chartRef, summaryRef]);
	const tabsSelection = useSelectionIndicatorMotion(tabKey, reducedMotion, '[aria-pressed="true"]');
	const summarySelection = useSelectionIndicatorMotion(tabKey, reducedMotion, '[aria-current="true"]');
	return { chartRef, summaryRef, dayRef, tabsSelection, summarySelection };
}
