import { useEffect, useSyncExternalStore } from "react";
import {
	THEME_STORAGE_KEY,
	applyThemeToDocument,
	getNextTheme,
	readStoredThemePreference,
	resolveTheme,
	writeStoredThemePreference,
	type ResolvedTheme,
	type ThemePreference,
} from "./theme";

interface ThemeSnapshot {
	preference: ThemePreference;
	resolvedTheme: ResolvedTheme;
}

export interface ThemeTransitionOrigin {
	x: number;
	y: number;
}

interface ViewTransitionLike {
	ready: Promise<void>;
	finished: Promise<void>;
}

type DocumentWithViewTransition = Document & {
	startViewTransition?: (callback: () => void) => ViewTransitionLike;
};

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const VIEW_TRANSITION_DURATION_MS = 700;
const FALLBACK_TRANSITION_DURATION_MS = 560;

let initialized = false;
let fallbackTransitionTimer: number | undefined;
let currentSnapshot: ThemeSnapshot = {
	preference: "system",
	resolvedTheme: "light",
};
const listeners = new Set<() => void>();

function getSystemPrefersDark(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}
	return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}
	return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function emit(): void {
	for (const listener of listeners) {
		listener();
	}
}

function updateSnapshot(preference: ThemePreference, systemPrefersDark: boolean): void {
	const resolvedTheme = resolveTheme(preference, systemPrefersDark);
	if (
		currentSnapshot.preference === preference &&
		currentSnapshot.resolvedTheme === resolvedTheme
	) {
		applyThemeToDocument(resolvedTheme, preference);
		return;
	}
	currentSnapshot = { preference, resolvedTheme };
	applyThemeToDocument(resolvedTheme, preference);
	emit();
}

function ensureInitialized(): void {
	if (initialized || typeof window === "undefined") return;
	initialized = true;

	const preference = readStoredThemePreference();
	const systemPrefersDark = getSystemPrefersDark();
	currentSnapshot = {
		preference,
		resolvedTheme: resolveTheme(preference, systemPrefersDark),
	};
	applyThemeToDocument(currentSnapshot.resolvedTheme, currentSnapshot.preference);

	if (typeof window.matchMedia === "function") {
		const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
		const onMediaChange = (event: MediaQueryListEvent) => {
			if (currentSnapshot.preference === "system") {
				updateSnapshot("system", event.matches);
			}
		};
		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", onMediaChange);
		}
	}

	window.addEventListener("storage", (event) => {
		if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
		const nextPreference = readStoredThemePreference();
		updateSnapshot(nextPreference, getSystemPrefersDark());
	});
}

function subscribe(listener: () => void): () => void {
	ensureInitialized();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot(): ThemeSnapshot {
	ensureInitialized();
	return currentSnapshot;
}

function getServerSnapshot(): ThemeSnapshot {
	return { preference: "system", resolvedTheme: "light" };
}

export function setThemePreference(preference: ThemePreference): void {
	ensureInitialized();
	writeStoredThemePreference(preference);
	updateSnapshot(preference, getSystemPrefersDark());
}

export function toggleThemeMode(origin?: ThemeTransitionOrigin): void {
	ensureInitialized();
	const next = getNextTheme(currentSnapshot.resolvedTheme);

	if (typeof window === "undefined" || typeof document === "undefined" || prefersReducedMotion()) {
		setThemePreference(next);
		return;
	}

	const doc = document as DocumentWithViewTransition;
	if (typeof doc.startViewTransition === "function") {
		const x = origin?.x ?? window.innerWidth / 2;
		const y = origin?.y ?? window.innerHeight / 2;
		const endRadius = Math.hypot(
			Math.max(x, window.innerWidth - x),
			Math.max(y, window.innerHeight - y),
		);

		const transition = doc.startViewTransition(() => {
			setThemePreference(next);
		});

		transition.ready
			.then(() => {
				document.documentElement.animate(
					{
						clipPath: [
							`circle(0px at ${x}px ${y}px)`,
							`circle(${endRadius}px at ${x}px ${y}px)`,
						],
					},
					{
						duration: VIEW_TRANSITION_DURATION_MS,
						easing: "cubic-bezier(0.4, 0, 0.2, 1)",
						pseudoElement: "::view-transition-new(root)",
					},
				);
			})
			.catch(() => {});
		return;
	}

	if (fallbackTransitionTimer !== undefined) {
		window.clearTimeout(fallbackTransitionTimer);
	}
	document.documentElement.dataset.themeTransition = "true";
	setThemePreference(next);
	fallbackTransitionTimer = window.setTimeout(() => {
		delete document.documentElement.dataset.themeTransition;
		fallbackTransitionTimer = undefined;
	}, FALLBACK_TRANSITION_DURATION_MS);
}

export function useTheme() {
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

	useEffect(() => {
		applyThemeToDocument(snapshot.resolvedTheme, snapshot.preference);
	}, [snapshot.resolvedTheme, snapshot.preference]);

	return {
		preference: snapshot.preference,
		resolvedTheme: snapshot.resolvedTheme,
		setPreference: setThemePreference,
		toggleTheme: toggleThemeMode,
	};
}
