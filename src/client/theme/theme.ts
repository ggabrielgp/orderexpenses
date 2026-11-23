export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "gastos-theme";

export const THEME_COLORS: Record<ResolvedTheme, string> = {
	light: "#f6f5f2",
	dark: "#131b2e",
};

export interface ThemeStorageLike {
	getItem(key: string): string | null;
	setItem?(key: string, value: string): void;
	removeItem?(key: string): void;
}

export interface ThemeMetaLike {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
}

export interface ThemeDocumentLike {
	documentElement: {
		dataset: Record<string, string | undefined>;
		style: { colorScheme: string };
	};
	getElementById(id: string): { href: string } | null;
	querySelectorAll(selector: string): Iterable<ThemeMetaLike>;
}

export function parseThemePreference(raw: unknown): ThemePreference {
	if (raw === "light" || raw === "dark" || raw === "system") {
		return raw;
	}
	return "system";
}

export function resolveTheme(
	preference: ThemePreference,
	systemPrefersDark: boolean,
): ResolvedTheme {
	if (preference === "light" || preference === "dark") {
		return preference;
	}
	return systemPrefersDark ? "dark" : "light";
}

export function getNextTheme(resolvedTheme: ResolvedTheme): ResolvedTheme {
	return resolvedTheme === "dark" ? "light" : "dark";
}

export function readStoredThemePreference(
	storage: ThemeStorageLike | null | undefined = typeof window !== "undefined"
		? window.localStorage
		: null,
): ThemePreference {
	if (!storage) return "system";
	try {
		return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
	} catch {
		return "system";
	}
}

export function writeStoredThemePreference(
	preference: ThemePreference,
	storage: ThemeStorageLike | null | undefined = typeof window !== "undefined"
		? window.localStorage
		: null,
): void {
	if (!storage) return;
	try {
		if (preference === "system") {
			storage.removeItem?.(THEME_STORAGE_KEY);
		} else {
			storage.setItem?.(THEME_STORAGE_KEY, preference);
		}
	} catch {
		// Ignore storage restrictions (private mode, sandboxed frames, quota errors).
	}
}

export function applyThemeToDocument(
	resolvedTheme: ResolvedTheme,
	preference: ThemePreference,
	doc: ThemeDocumentLike | null | undefined = typeof document !== "undefined"
		? (document as unknown as ThemeDocumentLike)
		: null,
): void {
	if (!doc) return;
	doc.documentElement.dataset.theme = resolvedTheme;
	doc.documentElement.dataset.themePreference = preference;
	doc.documentElement.style.colorScheme = resolvedTheme;

	const appleTouchIcon = doc.getElementById("apple-touch-icon");
	if (appleTouchIcon) {
		appleTouchIcon.href =
			resolvedTheme === "dark" ? "/apple-touch-icon-dark.png" : "/apple-touch-icon.png";
	}

	const activeColor = THEME_COLORS[resolvedTheme];
	for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
		meta.setAttribute("content", activeColor);
	}
}
