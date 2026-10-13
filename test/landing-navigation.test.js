import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createServer } from "vite";

async function withVite(t) {
	const vite = await createServer({
		envFile: false,
		configFile: false,
		// SSR module loading needs neither browser HMR nor a WebSocket listener.
		server: { middlewareMode: true, hmr: false, ws: false },
		appType: "custom",
	});
	t.after(() => vite.close());
	return vite;
}

test("landing navigation follows the visible section on scroll and resize, including the short final section", async (t) => {
	const vite = await withVite(t);
	const { watchLandingSections } = await vite.ssrLoadModule("/src/client/components/landing/landingNavigation.ts");
	const listeners = new Map();
	const frames = new Map();
	let nextFrame = 0;
	let offset = 94;
	let scroll = 0;
	const changes = [];
	const viewport = {
		innerHeight: 800,
		addEventListener: (event, handler, options) => {
			assert.equal(options.passive, true);
			listeners.set(event, handler);
		},
		removeEventListener: (event, handler) => {
			assert.equal(listeners.get(event), handler);
			listeners.delete(event);
		},
		requestAnimationFrame: (handler) => {
			frames.set(++nextFrame, handler);
			return nextFrame;
		},
		cancelAnimationFrame: (id) => frames.delete(id),
	};
	const sections = [
		["producto", 1000, 1800],
		["como-funciona", 2100, 3100],
		["compatibilidad", 1800, 2100],
		["seguridad", 3100, 3400],
	].map(([id, top, bottom]) => ({
		id,
		getBoundingClientRect: () => ({ top: top - scroll, bottom: bottom - scroll }),
	}));
	const stop = watchLandingSections(sections, () => offset, (id) => changes.push(id), viewport);
	assert.deepEqual(changes, [null], "The hero must not permanently highlight Producto");

	function move(nextScroll, event = "scroll") {
		scroll = nextScroll;
		listeners.get(event)();
		listeners.get(event)();
		assert.equal(frames.size, 1, "Batch layout reads into one animation frame");
		for (const [id, handler] of frames) {
			frames.delete(id);
			handler();
		}
		return changes.at(-1);
	}
	assert.equal(move(1000 - offset), "producto");
	assert.equal(move(1800 - offset), "compatibilidad", "Follow page geometry, not navigation order");
	assert.equal(move(2100 - offset), "como-funciona");
	assert.equal(move(2600), "seguridad", "Highlight a fully visible final section even when it cannot reach the header");
	assert.equal(move(1100), "producto", "Scrolling back updates the current section");
	offset = 50;
	assert.equal(move(950, "resize"), "producto", "Read current header clearance after resizing");
	assert.equal(move(0), null);
	listeners.get("scroll")();
	stop();
	assert.equal(listeners.size, 0);
	assert.equal(frames.size, 0, "Unmount cancels pending work");
});

test("clicking a header anchor keeps its destination highlighted throughout smooth scrolling", async (t) => {
	const vite = await withVite(t);
	const { watchLandingSections } = await vite.ssrLoadModule("/src/client/components/landing/landingNavigation.ts");
	const listeners = new Map();
	const navListeners = new Map();
	const frames = new Map();
	let nextFrame = 0;
	let scroll = 906;
	const changes = [];
	function eventTarget(handlers) {
		return {
			addEventListener: (event, handler) => handlers.set(event, handler),
			removeEventListener: (event, handler) => {
				assert.equal(handlers.get(event), handler);
				handlers.delete(event);
			},
		};
	}
	const navigation = eventTarget(navListeners);
	const viewport = {
		...eventTarget(listeners),
		innerHeight: 800,
		requestAnimationFrame: (handler) => { frames.set(++nextFrame, handler); return nextFrame; },
		cancelAnimationFrame: (id) => frames.delete(id),
	};
	const sections = [
		["producto", 1000, 1800], ["compatibilidad", 1800, 2100],
		["como-funciona", 2100, 3100], ["seguridad", 3100, 3400],
	].map(([id, top, bottom]) => ({
		id, getBoundingClientRect: () => ({ top: top - scroll, bottom: bottom - scroll }),
	}));
	const stop = watchLandingSections(sections, () => 94, (id) => changes.push(id), viewport, navigation);
	function flush() {
		for (const [id, handler] of frames) { frames.delete(id); handler(); }
	}
	function move(position) { scroll = position; listeners.get("scroll")(); flush(); }
	function click(id, extra = {}) {
		const anchor = { getAttribute: () => `#${id}` };
		navListeners.get("click")?.({
			button: 0, defaultPrevented: false, target: { closest: () => anchor },
			preventDefault: () => assert.fail("Do not intercept native anchor scrolling"), ...extra,
		});
		flush();
	}
	assert.deepEqual(changes, ["producto"]);
	click("seguridad");
	assert.equal(changes.at(-1), "seguridad", "Select the clicked destination immediately");
	const start = changes.length;
	move(1750); move(2150); move(2600);
	assert.ok(changes.slice(start).every((id) => id === "seguridad"), "Do not highlight intermediate sections");
	move(1750);
	assert.equal(changes.at(-1), "compatibilidad", "Resume visible-section tracking after arrival");

	click("producto");
	move(1650);
	assert.equal(changes.at(-1), "producto", "Keep the target when navigating upwards too");
	click("como-funciona");
	move(1600);
	assert.equal(changes.at(-1), "como-funciona", "A new click replaces the previous target");
	listeners.get("wheel")({ type: "wheel" }); flush();
	assert.equal(changes.at(-1), "producto", "Manual scrolling cancels the navigation lock");

	for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
		click("seguridad", extra);
		assert.equal(changes.at(-1), "producto", "Do not change this page for modified or canceled clicks");
	}
	for (const [type, key] of [["touchstart"], ["pointerdown"], ["keydown", "PageDown"]]) {
		click("seguridad");
		listeners.get(type)({ type, key }); flush();
		assert.equal(changes.at(-1), "producto", `${type} restores manual tracking`);
	}
	click("seguridad");
	listeners.get("keydown")({ type: "keydown", key: "Tab" }); flush();
	assert.equal(changes.at(-1), "seguridad", "Non-scrolling keys do not cancel navigation");
	listeners.get("scroll")();
	stop();
	assert.equal(listeners.size, 0);
	assert.equal(navListeners.size, 0);
	assert.equal(frames.size, 0);
});

test("landing header preserves native links and session CTAs without declaring a fixed current section", async (t) => {
	const vite = await withVite(t);
	const { LandingHeader } = await vite.ssrLoadModule("/src/client/components/landing/LandingHeader.tsx");
	for (const [session, destination] of [
		[null, "/auth/google"],
		[{ authenticated: true, profile: { name: "Test User", email: "test@example.com" } }, "/app"],
	]) {
		const markup = renderToStaticMarkup(createElement(LandingHeader, { session }));
		assert.ok(markup.includes(`href="${destination}"`));
		for (const id of ["producto", "como-funciona", "compatibilidad", "seguridad", "contenido"]) {
			assert.ok(markup.includes(`href="#${id}"`));
		}
		assert.doesNotMatch(markup, /class="is-current"|aria-current="location"/);
	}
	const header = await readFile(new URL("../src/client/components/landing/LandingHeader.tsx", import.meta.url), "utf8");
	for (const id of ["producto", "como-funciona", "compatibilidad", "seguridad"]) {
		assert.ok(header.includes(`aria-current={activeSection === "${id}" ? "location" : undefined}`));
	}
	assert.doesNotMatch(header, /preventDefault|onClick/);
});
