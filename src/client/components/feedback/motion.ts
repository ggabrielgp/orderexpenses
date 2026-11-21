import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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

/** Exit durations of the dialog CSS in `motion.css`: 300ms as a bottom sheet (<=760px), 150ms on desktop. */
export const DIALOG_EXIT_SHEET_MS = 300;
export const DIALOG_EXIT_DESKTOP_MS = 150;
/** The fallback timer outlives the CSS exit slightly so the last frame is never cut. */
const DIALOG_EXIT_SLACK_MS = 40;

/** How long a closing dialog must stay rendered for its exit to play; 0 (immediate) under reduced motion. */
export function getDialogExitMs(host: ViewTransitionHost | undefined): number {
	if (typeof host?.matchMedia !== "function") return 0;
	if (host.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
	return host.matchMedia("(max-width: 760px)").matches ? DIALOG_EXIT_SHEET_MS : DIALOG_EXIT_DESKTOP_MS;
}

export interface DeferredUnmountOptions {
	/** Exit duration; 0 releases immediately without a timer. */
	ms: number;
	onUnmount: () => void;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

/**
 * Releases a closing dialog's retained content once its exit finished: `finish` (a `transitionend`)
 * releases early, otherwise a fallback timer does. Releases at most once per `begin`; `cancel` (the
 * dialog reopened) drops the pending release.
 */
export function createDeferredUnmount({
	ms,
	onUnmount,
	setTimer = (callback, delay) => setTimeout(callback, delay),
	clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: DeferredUnmountOptions) {
	let handle: unknown = null;
	let pending = false;
	const clear = () => {
		if (handle !== null) clearTimer(handle);
		handle = null;
	};
	const finish = () => {
		if (!pending) return;
		pending = false;
		clear();
		onUnmount();
	};
	return {
		begin() {
			clear();
			pending = true;
			if (ms <= 0) {
				finish();
				return;
			}
			handle = setTimer(() => {
				handle = null;
				finish();
			}, ms + DIALOG_EXIT_SLACK_MS);
		},
		finish,
		cancel() {
			pending = false;
			clear();
		},
	};
}

/**
 * For a dialog the page "unmounts" by passing `null`: returns the live value, or the last one while the
 * exit animation plays, so the closing sheet keeps its content instead of vanishing. `onTransitionEnd`
 * (wire it on the `<dialog>`) releases early; a timer is the fallback; reduced motion releases at once.
 * A new value cancels the release, and the retained value is dropped afterwards so stale content never
 * reappears.
 */
export function useRetainedWhileClosing<T>(value: T | null): {
	value: T | null;
	onTransitionEnd: (event: { target: unknown; currentTarget: unknown }) => void;
} {
	const last = useRef<T | null>(null);
	const exit = useRef<ReturnType<typeof createDeferredUnmount> | null>(null);
	const [, rerender] = useReducer((count: number) => count + 1, 0);
	if (value !== null) last.current = value;
	const closed = value === null;
	useEffect(() => {
		if (!closed) return;
		if (last.current === null) return;
		const deferred = createDeferredUnmount({
			ms: getDialogExitMs(browserHost()),
			onUnmount: () => {
				last.current = null;
				rerender();
			},
		});
		exit.current = deferred;
		deferred.begin();
		return () => {
			deferred.cancel();
			if (exit.current === deferred) exit.current = null;
		};
	}, [closed]);
	const onTransitionEnd = useCallback((event: { target: unknown; currentTarget: unknown }) => {
		if (event.target === event.currentTarget) exit.current?.finish();
	}, []);
	return { value: value ?? last.current, onTransitionEnd };
}

/**
 * For a dialog whose content derives from live props and only carries an `isOpen` flag: `mounted` stays
 * true while the exit plays (and until `onTransitionEnd` or the fallback timer releases it), so the
 * closing sheet keeps rendering instead of unmounting abruptly. Same release rules as
 * `useRetainedWhileClosing` (reduced motion releases at once, reopening cancels the release).
 */
export function useRetainedOpen(isOpen: boolean): {
	mounted: boolean;
	onTransitionEnd: (event: { target: unknown; currentTarget: unknown }) => void;
} {
	const shown = useRetainedWhileClosing(isOpen ? true : null);
	return { mounted: shown.value === true, onTransitionEnd: shown.onTransitionEnd };
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
