import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("index.html declares light and dark favicons, theme colors, manifest and share metadata", async () => {
	const html = await read("index.html");
	const description =
		"Conecta tu Gmail y entiende tus gastos del mes: cuánto te queda, cuánto puedes gastar por día y si vas en ritmo.";
	assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" media="\(prefers-color-scheme: light\)"/);
	assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon-dark\.svg" media="\(prefers-color-scheme: dark\)"/);
	assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
	assert.ok(html.includes(`<meta name="description" content="${description}"`));
	assert.match(html, /<meta property="og:type" content="website"/);
	assert.match(html, /<meta property="og:title" content="Gastos Controlados"/);
	assert.ok(html.includes(`<meta property="og:description" content="${description}"`));
	assert.match(html, /<meta property="og:locale" content="es_CL"/);
	assert.match(html, /<meta name="twitter:card" content="summary"/);
	assert.match(html, /<meta name="twitter:title" content="Gastos Controlados"/);
	assert.ok(html.includes(`<meta name="twitter:description" content="${description}"`));
	// Existing document basics stay.
	assert.match(html, /<html lang="es">/);
	assert.match(html, /name="viewport"/);
	assert.match(html, /<meta name="theme-color" content="#f6f5f2" media="\(prefers-color-scheme: light\)"/);
	assert.match(html, /<meta name="theme-color" content="#131b2e" media="\(prefers-color-scheme: dark\)"/);
	assert.match(html, /<title>Gastos Controlados<\/title>/);
});

test("web manifest describes the installable app", async () => {
	const manifest = JSON.parse(await read("public/manifest.webmanifest"));
	assert.equal(manifest.name, "Gastos Controlados");
	assert.equal(manifest.short_name, "Gastos");
	assert.equal(manifest.start_url, "/app");
	assert.equal(manifest.display, "standalone");
	assert.equal(manifest.background_color, "#f6f5f2");
	assert.equal(manifest.theme_color, "#f6f5f2");
	assert.equal(manifest.lang, "es-CL");
	assert.deepEqual(manifest.icons, [
		{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
		{ src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
		{ src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
	]);
});

// iOS ignores SVG and manifest icons for "Agregar a inicio": without an opaque PNG it screenshots the page.
test("home screen icons (light and dark) are opaque PNGs at their declared size", async () => {
	const html = await read("index.html");
	assert.match(html, /<link[^>]*rel="apple-touch-icon"[^>]*sizes="180x180"[^>]*href="\/apple-touch-icon\.png"/);
	assert.match(html, /\/apple-touch-icon-dark\.png/);
	assert.match(html, /prefers-color-scheme:\s*dark/);
	assert.match(html, /<meta name="apple-mobile-web-app-title" content="Gastos"/);
	for (const [file, size] of [
		["apple-touch-icon.png", 180],
		["icon-192.png", 192],
		["icon-512.png", 512],
		["apple-touch-icon-dark.png", 180],
		["icon-192-dark.png", 192],
		["icon-512-dark.png", 512],
	]) {
		const png = await readFile(new URL(`../public/${file}`, import.meta.url));
		assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", file);
		assert.equal(png.readUInt32BE(16), size, `${file} width`);
		assert.equal(png.readUInt32BE(20), size, `${file} height`);
		// Colour type 2 = truecolour without alpha, so iOS never fills transparency with black.
		assert.equal(png[25], 2, `${file} must be opaque RGB`);
	}
});

test("favicon is the month gauge mark as an svg and adapts automatically to dark mode", async () => {
	const svg = await read("public/favicon.svg");
	assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
	assert.match(svg, /viewBox="0 0 56 56"/);
	assert.match(svg, /#0b7a6b/);
	assert.match(svg, /@media\s*\(prefers-color-scheme:\s*dark\)/);
	assert.match(svg, /#2ab5a0/);
	assert.match(svg, /#f8fbff/);
	assert.match(svg, /rotate\(240 28 28\)/);
	assert.match(svg, /<\/svg>\s*$/);

	const darkSvg = await read("public/favicon-dark.svg");
	assert.match(darkSvg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
	assert.match(darkSvg, /viewBox="0 0 56 56"/);
	assert.match(darkSvg, /#2a3650/);
	assert.match(darkSvg, /#2ab5a0/);
	assert.match(darkSvg, /#f8fbff/);
	assert.match(darkSvg, /rotate\(240 28 28\)/);
	assert.match(darkSvg, /<\/svg>\s*$/);
});

// The mark's centre is a peso sign drawn as a path (never font-dependent text), identical in every copy.
const PESO_SIGN = "M33 21.6C32.1 19.7 30.3 18.6 28 18.6c-2.9 0-4.9 1.6-4.9 3.9 0 2.6 2.3 3.6 4.9 4.3 2.9.8 5.1 1.9 5.1 4.6 0 2.5-2.2 4.2-5.1 4.2-2.4 0-4.3-1.2-5.2-3.2M28 15.5v25";
test("every copy of the brand mark centres the peso sign instead of a dot", async () => {
	for (const path of [
		"public/favicon.svg",
		"public/favicon-dark.svg",
		"src/client/components/brand/BrandMark.tsx",
		"scripts/brand/app-icon.svg",
		"scripts/brand/app-icon-dark.svg",
	]) {
		const source = await read(path);
		assert.ok(source.includes(`d="${PESO_SIGN}"`), `${path} must draw the peso sign`);
		assert.doesNotMatch(source, /r="5"/, `${path} must not keep the centre dot`);
		assert.doesNotMatch(source, /<text/, `${path} must not depend on a font`);
	}
	const darkTile = await read("scripts/brand/app-icon-dark.svg");
	assert.match(darkTile, /<rect width="100" height="100" fill="#131b2e"/);
});

test("design tokens add the Semáforo sereno palette and keep the base ones", async () => {
	const css = await read("src/client/design-tokens.css");
	const tokens = {
		"--state-calm": "#0b7a6b",
		"--state-calm-soft": "#e2f3ef",
		"--state-tight": "#9a6700",
		"--state-tight-soft": "#fdf3d8",
		"--state-over": "#b4412f",
		"--state-over-soft": "#fbe9e5",
		"--color-track": "#efeee9",
		"--color-canvas": "#f6f5f2",
		"--color-ink": "#131b2e",
	};
	for (const [name, value] of Object.entries(tokens)) {
		assert.ok(css.includes(`${name}: ${value};`), `${name} must be ${value}`);
	}
});

test("BrandMark is a decorative inline svg by default", async () => {
	const source = await read("src/client/components/brand/BrandMark.tsx");
	assert.match(source, /export function BrandMark/);
	assert.match(source, /viewBox="0 0 56 56"/);
	assert.match(source, /rotate\(240 28 28\)/);
	assert.match(source, /aria-hidden/);
	assert.match(source, /var\(--state-calm, #0b7a6b\)/);
});

test("app and landing chrome render BrandMark instead of the wallet glyph", async () => {
	for (const path of [
		"src/client/components/shell/AppHeader.tsx",
		"src/client/components/landing/LandingHeader.tsx",
		"src/client/components/landing/LandingFooter.tsx",
	]) {
		const source = await read(path);
		assert.ok(!source.includes("account_balance_wallet"), `${path} still uses the wallet glyph`);
		assert.match(source, /<BrandMark/, `${path} must render BrandMark`);
	}
	const header = await read("src/client/components/shell/AppHeader.tsx");
	assert.match(header, /className="react-app-brand"/);
	assert.match(header, /href="\/"/);
	assert.match(header, /aria-label="Gastos Controlados, inicio"/);
});

// Neutral, friendly Spanish: no Rioplatense vocabulary and no blaming tone in user-facing copy.
test("user-facing copy is neutral Spanish", async () => {
	const files = [
		"src/client/components/analytics/CategoryDistributionPanel.tsx",
		"src/client/components/landing/LandingTourSection.tsx",
		"src/client/components/gmail/gmailConnection.ts",
		"src/client/components/movements/EditMovementDialog.tsx",
		"src/client/components/movements/CreateManualExpenseDialog.tsx",
		"src/client/components/financial-cycle/cycleCompletion.ts",
	];
	for (const path of files) {
		const source = await read(path);
		assert.doesNotMatch(source, /\bplata\b/, `${path} says "plata"`);
		assert.doesNotMatch(source, /el servidor rechaza|no hay ninguna acción de tu parte|número positivo en pesos/, `${path} keeps cold copy`);
	}
	assert.match(await read("src/client/components/analytics/CategoryDistributionPanel.tsx"), /<h3 id=\{titleId\}>¿A dónde se fue tu dinero\?<\/h3>/);
});
