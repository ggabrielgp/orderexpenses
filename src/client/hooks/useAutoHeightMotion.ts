import { useLayoutEffect, useRef } from "react";

/** Animate only the replaced region's geometry; its content is already interactive. */
export function animateAutoHeight(
	element: Pick<HTMLElement, "animate">,
	from: number,
	to: number,
	reducedMotion: boolean,
): Animation | null {
	if (reducedMotion || from <= 0 || to <= 0 || Math.abs(from - to) < 1 ||
		!Number.isFinite(from) || !Number.isFinite(to) || typeof element.animate !== "function") return null;
	return element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
		duration: 200,
		easing: "ease-out",
	});
}

export function useAutoHeightMotion(viewKey: string | null, reducedMotion: boolean) {
	const ref = useRef<HTMLDivElement | null>(null);
	const previous = useRef<{ key: string | null; height: number } | null>(null);
	const animation = useRef<Animation | null>(null);
	// Measure on every committed render, but only animate an actual legend/detail replacement.
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const before = previous.current;
		const from = animation.current?.playState === "running"
			? element.getBoundingClientRect().height : before?.height ?? 0;
		animation.current?.cancel();
		const height = element.getBoundingClientRect().height;
		previous.current = { key: viewKey, height };
		animation.current = before && before.key !== viewKey
			? animateAutoHeight(element, from, height, reducedMotion) : null;
	});
	useLayoutEffect(() => () => animation.current?.cancel(), []);
	return ref;
}
