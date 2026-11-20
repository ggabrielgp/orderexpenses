import { useLayoutEffect, useRef } from "react";

type Geometry = { left: string; top: string; width: string; height: string };

/** One decorative surface travels behind normal-flow controls/rows. */
export function useSelectionIndicatorMotion(key: string, reducedMotion: boolean, selector: string) {
	const containerRef = useRef<HTMLElement | null>(null);
	const indicatorRef = useRef<HTMLSpanElement | null>(null);
	const previous = useRef<{ key: string; geometry: Geometry } | null>(null);
	useLayoutEffect(() => {
		const container = containerRef.current;
		const indicator = indicatorRef.current;
		if (!container || !indicator) return;
		let animation: Animation | null = null;
		const measure = (element: Element): Geometry => {
			const rect = element.getBoundingClientRect();
			const origin = container.getBoundingClientRect();
			return {
				left: `${rect.left - origin.left - container.clientLeft + container.scrollLeft}px`,
				top: `${rect.top - origin.top - container.clientTop + container.scrollTop}px`,
				width: `${rect.width}px`, height: `${rect.height}px`,
			};
		};
		const update = (animate: boolean) => {
			const selected = container.querySelector(selector);
			animation?.cancel();
			animation = null;
			if (!selected) {
				container.removeAttribute("data-selection-motion");
				previous.current = null;
				return;
			}
			const geometry = measure(selected);
			const before = previous.current;
			Object.assign(indicator.style, geometry);
			container.setAttribute("data-selection-motion", "true");
			previous.current = { key, geometry };
			if (animate && before && before.key !== key && !reducedMotion && typeof indicator.animate === "function") {
				animation = indicator.animate([before.geometry, geometry], { duration: 200, easing: "ease-out" });
			}
		};
		update(true);
		// Layout changes are not selection gestures: snap and refresh the next starting point.
		const resize = () => {
			const selected = container.querySelector(selector);
			if (!selected || JSON.stringify(measure(selected)) !== JSON.stringify(previous.current?.geometry)) update(false);
		};
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
		observer?.observe(container);
		for (const child of Array.from(container.children)) {
			if (child !== indicator) observer?.observe(child);
		}
		window.addEventListener?.("resize", resize);
		return () => {
			// Sample before cancellation so rapid selections continue from the visible surface.
			if (animation && previous.current) previous.current.geometry = measure(indicator);
			animation?.cancel();
			observer?.disconnect();
			window.removeEventListener?.("resize", resize);
			container.removeAttribute("data-selection-motion");
		};
	});
	return { containerRef, indicatorRef };
}
