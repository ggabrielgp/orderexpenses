import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	THEME_COLORS,
	THEME_STORAGE_KEY,
	applyThemeToDocument,
	getNextTheme,
	parseThemePreference,
	readStoredThemePreference,
	resolveTheme,
	writeStoredThemePreference,
} from "../src/client/theme/theme.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("parseThemePreference normalizes valid values and falls back to system", () => {
	assert.equal(parseThemePreference("light"), "light");
	assert.equal(parseThemePreference("dark"), "dark");
	assert.equal(parseThemePreference("system"), "system");
	assert.equal(parseThemePreference(null), "system");
	assert.equal(parseThemePreference(undefined), "system");
	assert.equal(parseThemePreference(""), "system");
	assert.equal(parseThemePreference("sepia"), "system");
});

test("resolveTheme detects system mode by default and respects explicit user overrides", () => {
	assert.equal(resolveTheme("system", false), "light");
	assert.equal(resolveTheme("system", true), "dark");
	assert.equal(resolveTheme("light", true), "light");
	assert.equal(resolveTheme("light", false), "light");
	assert.equal(resolveTheme("dark", false), "dark");
	assert.equal(resolveTheme("dark", true), "dark");
});

test("getNextTheme toggles between light and dark", () => {
	assert.equal(getNextTheme("light"), "dark");
	assert.equal(getNextTheme("dark"), "light");
});

test("readStoredThemePreference and writeStoredThemePreference persist light/dark and clear system", () => {
	const store = new Map();
	const storage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => {
			store.set(key, String(value));
		},
		removeItem: (key) => {
			store.delete(key);
		},
	};

	assert.equal(readStoredThemePreference(storage), "system");

	writeStoredThemePreference("dark", storage);
	assert.equal(store.get(THEME_STORAGE_KEY), "dark");
	assert.equal(readStoredThemePreference(storage), "dark");

	writeStoredThemePreference("light", storage);
	assert.equal(store.get(THEME_STORAGE_KEY), "light");
	assert.equal(readStoredThemePreference(storage), "light");

	writeStoredThemePreference("system", storage);
	assert.equal(store.has(THEME_STORAGE_KEY), false);
	assert.equal(readStoredThemePreference(storage), "system");
});

test("storage helpers degrade gracefully when storage is unavailable or throws", () => {
	const throwingStorage = {
		getItem() {
			throw new Error("SecurityError");
		},
		setItem() {
			throw new Error("QuotaExceededError");
		},
		removeItem() {
			throw new Error("SecurityError");
		},
	};

	assert.equal(readStoredThemePreference(null), "system");
	assert.equal(readStoredThemePreference(throwingStorage), "system");
	assert.doesNotThrow(() => writeStoredThemePreference("dark", null));
	assert.doesNotThrow(() => writeStoredThemePreference("dark", throwingStorage));
	assert.doesNotThrow(() => writeStoredThemePreference("system", throwingStorage));
});

test("applyThemeToDocument updates root attributes, color-scheme, apple-touch-icon, and active theme-color", () => {
	const appleTouchIcon = { href: "/apple-touch-icon.png" };
	const lightMeta = {
		attributes: new Map([
			["name", "theme-color"],
			["content", "#f6f5f2"],
			["media", "(prefers-color-scheme: light)"],
		]),
		getAttribute(name) {
			return this.attributes.get(name) ?? null;
		},
		setAttribute(name, value) {
			this.attributes.set(name, value);
		},
	};
	const darkMeta = {
		attributes: new Map([
			["name", "theme-color"],
			["content", "#131b2e"],
			["media", "(prefers-color-scheme: dark)"],
		]),
		getAttribute(name) {
			return this.attributes.get(name) ?? null;
		},
		setAttribute(name, value) {
			this.attributes.set(name, value);
		},
	};
	const doc = {
		documentElement: {
			dataset: {},
			style: { colorScheme: "" },
		},
		getElementById(id) {
			return id === "apple-touch-icon" ? appleTouchIcon : null;
		},
		querySelectorAll(selector) {
			return selector === 'meta[name="theme-color"]' ? [lightMeta, darkMeta] : [];
		},
	};

	applyThemeToDocument("dark", "dark", doc);
	assert.equal(doc.documentElement.dataset.theme, "dark");
	assert.equal(doc.documentElement.dataset.themePreference, "dark");
	assert.equal(doc.documentElement.style.colorScheme, "dark");
	assert.equal(appleTouchIcon.href, "/apple-touch-icon-dark.png");
	assert.equal(lightMeta.getAttribute("content"), THEME_COLORS.dark);
	assert.equal(darkMeta.getAttribute("content"), THEME_COLORS.dark);

	applyThemeToDocument("light", "system", doc);
	assert.equal(doc.documentElement.dataset.theme, "light");
	assert.equal(doc.documentElement.dataset.themePreference, "system");
	assert.equal(doc.documentElement.style.colorScheme, "light");
	assert.equal(appleTouchIcon.href, "/apple-touch-icon.png");
	assert.equal(lightMeta.getAttribute("content"), THEME_COLORS.light);
	assert.equal(darkMeta.getAttribute("content"), THEME_COLORS.light);
});

test("index.html initializes theme before paint without FOUC", async () => {
	const html = await read("index.html");
	assert.match(html, /gastos-theme/);
	assert.match(html, /prefers-color-scheme:\s*dark/);
	assert.match(html, /dataset\.theme/);
});

test("dark-mode.css loads last and defines dark palette aligned with brand identity", async () => {
	const main = await read("src/client/main.tsx");
	const identityIdx = main.indexOf("./identity-b.css");
	const darkIdx = main.indexOf("./dark-mode.css");
	assert.ok(identityIdx >= 0, "main.tsx must import identity-b.css");
	assert.ok(darkIdx > identityIdx, "main.tsx must import dark-mode.css after identity-b.css");

	const css = await read("src/client/dark-mode.css");
	assert.match(css, /:root\[data-theme="dark"\]/);
	assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
	assert.match(css, /color-scheme:\s*dark/);
	assert.match(css, /--state-calm:\s*#2ab5a0/);
	assert.match(css, /--color-ink:\s*#dce3ee/);
	assert.match(css, /--color-track:\s*#2a3650/);
	assert.doesNotMatch(css, /:root\[data-theme="dark"\]\s+button:not\(/);
	assert.doesNotMatch(css, /:root\[data-theme="dark"\]\s+\.(?:panel|card)\s*,/);
	assert.match(css, /\.react-spending-chart-selection-indicator/);
	assert.match(css, /\.react-analytics-body\s+\.react-spending-chart-tab\[aria-pressed="true"\]/);
	assert.match(css, /::view-transition-new\(root\)/);
	assert.match(css, /:root\[data-theme-transition="true"\]/);
	assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
	assert.match(css, /body:has\(\.react-movements-page\)/);
	assert.match(css, /\.react-movements-table-card/);
	assert.match(css, /\.landing-tour-arrow/);
	assert.match(css, /\.landing-security-section/);
	assert.match(css, /\.landing-compatibility-section/);
	assert.match(css, /--channel-1:\s*#6b84ad/);
	assert.match(css, /dialog\.cycle-dialog \.cycle-body/);
	assert.match(css, /dialog\.cycle-dialog \.cycle-actions \.cycle-btn-primary/);
	assert.match(css, /#edit-movement-occurred-at/);
	assert.match(css, /\.landing-connected \.landing-info-icon/);
});

test("LandingHeader and AppHeader expose the theme toggle with accessible Spanish labels", async () => {
	const [landingHeader, appHeader, toggle] = await Promise.all([
		read("src/client/components/landing/LandingHeader.tsx"),
		read("src/client/components/shell/AppHeader.tsx"),
		read("src/client/components/theme/ThemeToggle.tsx"),
	]);

	assert.match(landingHeader, /<ThemeToggle/);
	assert.match(appHeader, /<ThemeToggle/);
	assert.match(toggle, /Cambiar a modo claro/);
	assert.match(toggle, /Cambiar a modo oscuro/);
	assert.match(toggle, /data-theme-state/);
	assert.match(toggle, /useId/);
	assert.match(toggle, /<mask\b/);
	assert.match(toggle, /getBoundingClientRect\(\)/);
	assert.match(toggle, /toggleTheme\(\{/);
});

test("CategoryDistributionPanel and BrandMark adapt colors for dark mode", async () => {
	const [donut, brand] = await Promise.all([
		read("src/client/components/analytics/CategoryDistributionPanel.tsx"),
		read("src/client/components/brand/BrandMark.tsx"),
	]);

	assert.match(donut, /useTheme/);
	assert.match(brand, /var\(--color-line,\s*#e3e1dc\)/);
});
