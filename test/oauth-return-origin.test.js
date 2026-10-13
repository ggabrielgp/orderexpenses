import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import "./helpers/isolation.js";
import { configureGoogleFixtures, googleCalls } from "./helpers/fixtures.js";
import { request } from "./helpers/request.js";

const { default: handler } = await import("../src/server.js");
const callbackEmail = "origin-return@example.com";
const sessionCookie = (response) => decodeURIComponent(String(response.headers["set-cookie"]).match(/^finance_session=([^;]+)/)[1]);
function googleFixture() {
	configureGoogleFixtures({ exchange: { tokens: { access_token: "synthetic-origin-token" } }, profile: { data: { email: callbackEmail, name: "Origin fixture" } } });
}
async function anonymousSession() {
	const response = await request(handler, "/api/session/profile");
	assert.equal(response.status, 200);
	assert.equal(JSON.parse(response.body).authenticated, false);
	return sessionCookie(response);
}
async function begin(sessionId, origin, path = "/auth/google") {
	return request(handler, `${path}${origin === undefined ? "" : `?returnOrigin=${encodeURIComponent(origin)}`}`, { sessionId });
}
async function callback(state, path = "/auth/google/callback") {
	return request(handler, `${path}?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { host: "127.0.0.1:3000" } });
}
function environment(t, values) {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	t.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	});
}

test("login returns to the initiating hostname and arbitrary port, preserving its original browser session", async () => {
	for (const origin of ["http://localhost:5173", "http://127.0.0.1:4317", "http://[::1]:6001"]) {
		googleFixture();
		const id = await anonymousSession();
		const started = await begin(id, origin);
		assert.equal(started.status, 302);
		const authorization = new URL(started.headers.location);
		assert.equal(authorization.searchParams.get("redirect_uri"), "http://localhost:3000/auth/google/callback");
		const finished = await callback(authorization.searchParams.get("state"));
		assert.equal(finished.status, 302);
		assert.equal(finished.headers.location, `${origin}/app?gmail=connected`);
		assert.equal(sessionCookie(finished), id);
		assert.match(String(finished.headers["set-cookie"]), /Path=\/; HttpOnly; SameSite=Lax;/);
		assert.doesNotMatch(finished.headers.location, /finance_session|synthetic-origin-token/);
		const profile = await request(handler, "/api/session/profile", { sessionId: id, headers: { host: new URL(origin).host } });
		assert.equal(profile.status, 200);
		assert.equal(JSON.parse(profile.body).authenticated, true);
		assert.equal(JSON.parse(profile.body).profile.email, callbackEmail);
		assert.equal(googleCalls.exchange.length, 1);
	}
});

test("configured deployment origins return to the actual allowed domain, without enabling development destinations", async (t) => {
	environment(t, { NODE_ENV: "production", APP_BASE_URL: "https://expenses.example", VERCEL_URL: "preview.example" });
	for (const origin of ["https://expenses.example", "https://preview.example"]) {
		googleFixture();
		const id = await anonymousSession();
		const started = await begin(id, origin);
		assert.equal(started.status, 302);
		const finished = await callback(new URL(started.headers.location).searchParams.get("state"));
		assert.equal(finished.status, 302);
		assert.equal(finished.headers.location, `${origin}/app?gmail=connected`);
		assert.match(String(finished.headers["set-cookie"]), /; Secure$/);
	}
	const id = await anonymousSession();
	for (const origin of ["http://localhost:5173", "https://expenses.example.evil.example", "https://expenses.example:444"]) {
		const rejected = await begin(id, origin);
		assert.equal(rejected.status, 403);
		assert.equal(JSON.parse(rejected.body).error, "OAuth return origin is not allowed");
	}
});

test("malformed and attacker destinations are rejected before authorization or account changes", async () => {
	const id = await anonymousSession();
	for (const [origin, message] of [
		["https://attacker.example", "OAuth return origin is not allowed"],
		["http://localhost.attacker.example:5173", "OAuth return origin is not allowed"],
		["//localhost:5173", "Invalid OAuth return origin"],
		["javascript:alert(1)", "Invalid OAuth return origin"],
		["http://user:pass@localhost:5173", "Invalid OAuth return origin"],
		["http://localhost:5173/other", "Invalid OAuth return origin"],
		["http://localhost:5173?next=evil", "Invalid OAuth return origin"],
		["http://localhost:5173#evil", "Invalid OAuth return origin"],
		["null", "Invalid OAuth return origin"],
		["", "Invalid OAuth return origin"],
	]) {
		googleFixture();
		const rejected = await begin(id, origin);
		assert.equal(rejected.status, 403, origin);
		assert.equal(JSON.parse(rejected.body).error, message);
		assert.equal(rejected.headers.location, undefined);
		assert.equal(googleCalls.exchange.length, 0);
		assert.equal(googleCalls.profile.length, 0);
		const profile = await request(handler, "/api/session/profile", { sessionId: id });
		assert.equal(JSON.parse(profile.body).authenticated, false);
		assert.equal(JSON.parse(profile.body).gmail.connected, false);
	}
});

test("tampered origin metadata cannot consume the original state, exchange tokens or bypass single-use protection", async () => {
	googleFixture();
	const id = await anonymousSession();
	const started = await begin(id, "http://localhost:5173");
	const state = new URL(started.headers.location).searchParams.get("state");
	assert.match(state, /^[a-f0-9]{64}\.return-v1\.[A-Za-z0-9_-]+$/);
	const tampered = state.slice(0, state.lastIndexOf(".") + 1) + Buffer.from("https://attacker.example").toString("base64url");
	const rejected = await callback(tampered);
	assert.equal(rejected.status, 400);
	assert.equal(JSON.parse(rejected.body).error, "Invalid OAuth state");
	assert.equal(googleCalls.exchange.length, 0);
	assert.equal(JSON.parse((await request(handler, "/api/session/profile", { sessionId: id })).body).authenticated, false);
	const valid = await callback(state);
	assert.equal(valid.status, 302);
	assert.equal(valid.headers.location, "http://localhost:5173/app?gmail=connected");
	const replay = await callback(state);
	assert.equal(replay.status, 400);
	assert.equal(JSON.parse(replay.body).error, "Invalid OAuth state");
	assert.equal(googleCalls.exchange.length, 1);
	assert.equal(googleCalls.profile.length, 1);
});

test("expired return-origin state is rejected without token exchange and cannot be replayed", async (t) => {
	googleFixture();
	const id = await anonymousSession();
	const started = await begin(id, "http://localhost:5173");
	const state = new URL(started.headers.location).searchParams.get("state");
	const now = Date.now();
	t.mock.method(Date, "now", () => now + 10 * 60 * 1000);
	const response = await callback(state);
	assert.equal(response.status, 400);
	assert.equal(JSON.parse(response.body).error, "Invalid OAuth state");
	assert.equal(googleCalls.exchange.length, 0);
	assert.equal((await callback(state)).status, 400);
	t.mock.restoreAll();
	assert.equal(JSON.parse((await request(handler, "/api/session/profile", { sessionId: id })).body).authenticated, false);
});

test("stored return origin is revalidated before token exchange when deployment configuration changes", async (t) => {
	googleFixture();
	const id = await anonymousSession();
	const started = await begin(id, "http://localhost:5173");
	const state = new URL(started.headers.location).searchParams.get("state");
	environment(t, { NODE_ENV: "production", APP_BASE_URL: "https://expenses.example", VERCEL_URL: undefined });
	const response = await callback(state);
	assert.equal(response.status, 403);
	assert.equal(JSON.parse(response.body).error, "OAuth return origin is not allowed");
	assert.equal(googleCalls.exchange.length, 0);
	assert.equal(googleCalls.profile.length, 0);
	assert.equal(JSON.parse((await request(handler, "/api/session/profile", { sessionId: id })).body).authenticated, false);
});

test("legacy login and auth alias preserve relative callback and existing random-state contract", async () => {
	for (const alias of ["/auth/google", "/api/auth/google"]) {
		googleFixture();
		const id = await anonymousSession();
		const started = await begin(id, undefined, alias);
		const state = new URL(started.headers.location).searchParams.get("state");
		assert.match(state, /^[a-f0-9]{64}$/);
		const response = await callback(state, `${alias}/callback`);
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, "/app?gmail=connected");
		assert.equal(sessionCookie(response), id);
		assert.equal(googleCalls.exchange.length, 1);
	}
});

test("trusted origin metadata also applies to the API auth alias", async () => {
	googleFixture();
	const id = await anonymousSession();
	const started = await begin(id, "http://localhost:6180", "/api/auth/google");
	const finished = await callback(new URL(started.headers.location).searchParams.get("state"), "/api/auth/google/callback");
	assert.equal(finished.status, 302);
	assert.equal(finished.headers.location, "http://localhost:6180/app?gmail=connected");
});

test("browser login helper and all landing/demo entry points preserve actual origin without changing consent decisions", async (t) => {
	const vite = await createServer({ configFile: false, envFile: false, appType: "custom", optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
	t.after(() => vite.close());
	const { getGoogleLoginUrl } = await vite.ssrLoadModule("/src/client/api/googleLogin.ts");
	const origin = "http://localhost:6180";
	assert.equal(getGoogleLoginUrl("/auth/google", origin), "/auth/google?returnOrigin=http%3A%2F%2Flocalhost%3A6180");
	assert.equal(getGoogleLoginUrl("/api/auth/google?existing=keep", origin), "/api/auth/google?existing=keep&returnOrigin=http%3A%2F%2Flocalhost%3A6180");
	assert.equal(getGoogleLoginUrl("/app", origin), "/app");
	assert.equal(getGoogleLoginUrl("https://other.example/auth/google", origin), "https://other.example/auth/google");
	assert.equal(getGoogleLoginUrl("/auth/google"), "/auth/google");
	const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
	Object.defineProperty(globalThis, "location", { configurable: true, value: { origin } });
	t.after(() => { if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation); else delete globalThis.location; });
	const [{ LandingHeader }, { LandingHero }, { DemoDashboardPage }] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/landing/LandingHeader.tsx"),
		vite.ssrLoadModule("/src/client/components/landing/LandingHero.tsx"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
	]);
	const { createDemoDashboardData } = await vite.ssrLoadModule("/src/client/demo-data.ts");
	const data = createDemoDashboardData(JSON.parse(await readFile(new URL("../public/demo-data.json", import.meta.url), "utf8")));
	for (const element of [createElement(LandingHeader, { session: null }), createElement(LandingHero), createElement(DemoDashboardPage, { data })]) {
		const markup = renderToStaticMarkup(element);
		const links = [...markup.matchAll(/href="([^\"]*\/auth\/google[^\"]*)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
		assert.ok(links.length > 0);
		assert.ok(links.every((href) => new URL(href, origin).searchParams.get("returnOrigin") === origin));
	}
	const consentSource = await readFile(new URL("../src/client/components/gmail/GmailConsentDialog.tsx", import.meta.url), "utf8");
	assert.equal(/location\.assign\(getGoogleLoginUrl\(url\)\)/.test(consentSource), true);
});
