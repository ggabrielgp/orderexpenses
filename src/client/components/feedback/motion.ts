import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Phase 2 motion (identity B, S15): the view crossfade and the edited-row highlight.
 *
 * Both are pure over injected hosts so the rules are provable without a DOM. The CSS owns the visuals
 * (`motion.css`, built on the 150 / 300 / 700ms tokens); this module only decides *when* a state
 * changes. Under `prefers-reduced-motion`, or without the browser API, every change is immediate.
 */

/** How long the row that was just edited stays highlighted. */
export const EDIT_HIGHLIGHT_MS = 1200;

export interface ViewTransitionHost {
	startViewTransition?: (update: () => void) => unknown;
	matchMedia?: (query: string) => { matches: boolean };
}

/**
 * Runs `update` (the synchronous state change that swaps the view) inside a native view transition,
 * which crossfades the old and new page for the CSS-set 300ms without touching layout, focus or scroll.
 * `update` always runs exactly once: immediately when motion is reduced, the API is missing or refuses.
 */
export function runViewTransition(host: ViewTransitionHost | undefined, update: () => void): void {
	const reduced = typeof host?.matchMedia === "function" && host.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (reduced || typeof host?.startViewTransition !== "function") {
		update();
		return;
	}
	let ran = false;
	const once = () => {
		if (ran) return;
		ran = true;
		update();
	};
	try {
		host.startViewTransition(once);
	} catch {
		once();
	}
}

export interface EditHighlightOptions {
	onChange: (movementId: string | null) => void;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	ms?: number;
}

/** Highlights one movement id for `ms`, restarting on a new one; an absent id never highlights. */
export function createEditHighlight({
	onChange,
	setTimer = (callback, ms) => setTimeout(callback, ms),
	clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	ms = EDIT_HIGHLIGHT_MS,
}: EditHighlightOptions) {
	let handle: unknown = null;
	const stop = () => {
		if (handle !== null) clearTimer(handle);
		handle = null;
	};
	return {
		flash(movementId: string | null | undefined) {
			if (!movementId) return;
			stop();
			onChange(movementId);
			handle = setTimer(() => {
				handle = null;
				onChange(null);
			}, ms);
		},
		dispose: stop,
	};
}

/** The browser's host: the view transition lives on `document`, the motion preference on `window`. */
function browserHost(): ViewTransitionHost | undefined {
	if (typeof document === "undefined" || typeof window === "undefined") return undefined;
	return {
		startViewTransition: typeof document.startViewTransition === "function"
			? (update) => document.startViewTransition(update)
			: undefined,
		matchMedia: typeof window.matchMedia === "function" ? (query) => window.matchMedia(query) : undefined,
	};
}

/** `useState` for the active view whose setter crossfades the content (immediate under reduced motion). */
export function useAnimatedView<T>(initial: T): [T, (next: T) => void] {
	const [view, setRawView] = useState<T>(initial);
	const setView = useCallback((next: T) => {
		runViewTransition(browserHost(), () => flushSync(() => setRawView(next)));
	}, []);
	return [view, setView];
}

/** The id of the movement to highlight now, and the function that flashes a freshly edited one. */
export function useEditHighlight(): [string | null, (movementId: string | null | undefined) => void] {
	const [highlightedId, setHighlightedId] = useState<string | null>(null);
	const highlight = useRef<ReturnType<typeof createEditHighlight> | null>(null);
	if (highlight.current === null) highlight.current = createEditHighlight({ onChange: setHighlightedId });
	useEffect(() => () => highlight.current?.dispose(), []);
	const flash = useCallback((movementId: string | null | undefined) => highlight.current?.flash(movementId), []);
	return [highlightedId, flash];
}
