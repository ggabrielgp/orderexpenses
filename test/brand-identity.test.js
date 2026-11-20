import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("index.html declares favicon, manifest and share metadata", async () => {
	const html = await read("index.html");
	const description =
		"Conecta tu Gmail y entiende tus gastos del mes: cuánto te queda, cuánto puedes gastar por día y si vas en ritmo.";
	assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
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
	assert.match(html, /<meta name="theme-color" content="#f6f5f2"/);
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
	]);
});

test("favicon is the month gauge mark as an svg", async () => {
	const svg = await read("public/favicon.svg");
	assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
	assert.match(svg, /viewBox="0 0 56 56"/);
	assert.match(svg, /#0b7a6b/);
	assert.match(svg, /rotate\(240 28 28\)/);
	assert.match(svg, /<\/svg>\s*$/);
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
		"src/client/components/landing/LandingPhoneFrame.tsx",
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
