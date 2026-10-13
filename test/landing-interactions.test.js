import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../src/client/styles.css", import.meta.url), "utf8");

function declarations(selector, source = styles) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
	assert.ok(match, `Missing CSS rule: ${selector}`);
	return match[1];
}

test("landing anchors scroll smoothly only when motion is allowed and clear the sticky header", async () => {
	const motion = styles.match(/@media\s*\(prefers-reduced-motion: no-preference\)\s*\{([^]*?)\n\}/);
	assert.ok(motion, "Smooth scrolling must respect reduced motion");
	assert.match(declarations("html:has(.landing-page)", motion[1]), /scroll-behavior:\s*smooth\s*;/);
	// The scrolling viewport, not the landing wrapper, owns native anchor scrolling.
	assert.doesNotMatch(styles.replace(motion[0], ""), /scroll-behavior:\s*smooth/);
	const headerHeight = Number(declarations(".landing-header-content").match(/height:\s*(\d+)px/)[1]);
	const sectionOffset = Number(declarations(".landing-page section[id]").match(/scroll-margin-top:\s*(\d+)px/)[1]);
	assert.ok(sectionOffset >= headerHeight + 16, "Anchor headings need clearance below the header");
	assert.match(declarations(".landing-page main[id]"), /scroll-margin-top:\s*94px\s*;/);

	const header = await readFile(new URL("../src/client/components/landing/LandingHeader.tsx", import.meta.url), "utf8");
	for (const id of ["producto", "como-funciona", "compatibilidad", "seguridad", "contenido"]) {
		assert.ok(header.includes(`href="#${id}"`), `Preserve native navigation to ${id}`);
	}
	assert.doesNotMatch(header, /preventDefault|onClick/);
});

test("the landing header stays sticky without a scrolling overflow ancestor", () => {
	const header = declarations(".landing-header");
	assert.match(header, /position:\s*sticky\s*;/);
	assert.match(header, /top:\s*0\s*;/);
	assert.match(declarations(".landing-page"), /overflow-x:\s*clip\s*;/);
	assert.match(declarations("body:has(.landing-page)"), /overflow-x:\s*clip\s*;/);
	assert.doesNotMatch(declarations(".landing-page"), /overflow(?:-y)?:\s*(?:auto|scroll|hidden)/);
	// Keep the existing header height and clearance used by smooth anchors.
	assert.match(declarations(".landing-header-content"), /height:\s*78px\s*;/);
	assert.match(declarations(".landing-page section[id]"), /scroll-margin-top:\s*94px\s*;/);
});

test("the Google sign-in icon has a separate rounded badge without padding or clipping the SVG", async () => {
	const badge = declarations(".landing-google-badge");
	assert.match(badge, /width:\s*24px\s*;/);
	assert.match(badge, /height:\s*24px\s*;/);
	assert.match(badge, /border-radius:\s*50%\s*;/);
	assert.match(badge, /background:\s*white\s*;/);
	assert.match(badge, /flex-shrink:\s*0\s*;/);
	assert.match(badge, /place-items:\s*center\s*;/);
	const icon = declarations(".landing-google-icon");
	assert.match(icon, /display:\s*block\s*;/);
	assert.match(icon, /width:\s*16px\s*;/);
	assert.match(icon, /height:\s*16px\s*;/);
	assert.doesNotMatch(icon, /padding|background|border-radius|overflow:\s*hidden/);
	const header = await readFile(new URL("../src/client/components/landing/LandingHeader.tsx", import.meta.url), "utf8");
	assert.match(header, /!isAuthenticated && <span className="landing-google-badge" aria-hidden="true"><GoogleIcon \/><\/span>/);
	assert.match(header, /viewBox="0 0 18 18"/);
	for (const color of ["#4285F4", "#34A853", "#FBBC05", "#EA4335"]) {
		assert.ok(header.includes(color), `Preserve Google brand color ${color}`);
	}
});

test("the floating illustration cannot be selected without disabling landing text or links", async () => {
	const illustration = declarations(".landing-stage");
	assert.match(illustration, /-webkit-user-select:\s*none\s*;/);
	assert.match(illustration, /(?<!-)user-select:\s*none\s*;/);
	assert.doesNotMatch(declarations(".landing-page"), /user-select|pointer-events/);
	assert.doesNotMatch(illustration, /pointer-events:\s*none/);

	const hero = await readFile(new URL("../src/client/components/landing/LandingHero.tsx", import.meta.url), "utf8");
	assert.match(hero, /<figure className="landing-stage" aria-label="Vista ilustrativa/);
	assert.match(hero, /<figcaption className="landing-stage-caption">Vista ilustrativa · datos de ejemplo<\/figcaption>/);
	assert.match(hero, /href=\{getGoogleLoginUrl\(\)\}/);
	assert.match(hero, /href="\/app\/demo"/);
});
