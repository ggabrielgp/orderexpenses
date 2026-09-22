import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.VERCEL = "1";
process.env.TURSO_DATABASE_URL = "file:./data/finance.db";
const { default: handleRequest } = await import("../src/server.js");

function request(pathname) {
	return new Promise((resolve, reject) => {
		const response = {
			headers: {},
			setHeader(name, value) {
				this.headers[name.toLowerCase()] = value;
			},
			writeHead(status, headers = {}) {
				this.status = status;
				Object.assign(this.headers, headers);
			},
			end(body = "") {
				resolve({ status: this.status, headers: this.headers, body: String(body) });
			},
		};

		Promise.resolve(
			handleRequest(
				{ url: pathname, method: "GET", headers: { host: "localhost:3000" } },
				response,
			),
		).catch(reject);
	});
}

test("serves the React shell at the production root", async () => {
	const response = await request("/");
	assert.equal(response.status, 200);
	assert.match(response.headers["content-type"], /^text\/html/);
	assert.match(response.body, /id="root"/);
	assert.match(response.body, /\/assets\//);
	assert.doesNotMatch(response.body, /id="dashboard"/);
});

test("npm start builds production assets before serving /app", async () => {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	assert.equal(packageJson.scripts.prestart, "npm run build");
	assert.equal(packageJson.scripts.start, "node src/server.js");
});

test("serves the React shell from the clean app route", async () => {
	for (const pathname of ["/app", "/app/"]) {
		const response = await request(pathname);
		assert.equal(response.status, 200);
		assert.match(response.body, /id="root"/);
		assert.match(response.body, /\/assets\//);
		assert.doesNotMatch(response.body, /id="dashboard"/);
	}
});

test("redirects the retired legacy dashboard route to the React app", async () => {
	for (const pathname of ["/legacy-app", "/legacy-app/"]) {
		const response = await request(pathname);
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, "/app");
		assert.equal(response.body, "");
	}
});

test("redirects the legacy demo query to the canonical demo route", async () => {
	for (const pathname of ["/app?demo", "/app/?demo"]) {
		const response = await request(pathname);
		assert.equal(response.status, 302);
		assert.equal(response.headers.location, "/app/demo");
		assert.equal(response.body, "");
	}
});

test("keeps every canonical React route on the React shell", async () => {
	for (const pathname of [
		"/app",
		"/app/",
		"/app/demo",
		"/app/demo/",
		"/app?gmail=connected",
	]) {
		const response = await request(pathname);
		assert.equal(response.status, 200);
		assert.match(response.body, /id="root"/);
		assert.match(response.body, /\/assets\//);
		assert.doesNotMatch(response.body, /id="dashboard"/);
	}
});

test("no longer serves the application stylesheets from the public root", async () => {
	for (const pathname of ["/app.css", "/design-tokens.css"]) {
		const response = await request(pathname);
		assert.equal(
			response.status,
			404,
			`${pathname} now lives under src/client and must not be served from public`,
		);
	}
});

test("serves the retained shared review-period module", async () => {
	const response = await request("/src/shared/review-period.js");
	assert.equal(response.status, 200);
	assert.match(response.headers["content-type"], /^text\/javascript/);
	assert.match(response.body, /ReviewPeriod/);
});

test("retired legacy assets are no longer served", async () => {
	for (const pathname of [
		"/account-menu.js",
		"/app.html",
		"/app.js",
		"/dashboard-period.js",
		"/dashboard-startup.js",
		"/date-format.js",
		"/financial-cycle.js",
		"/index.html",
		"/index.js",
		"/review-period.js",
		"/styles.css",
	]) {
		const response = await request(pathname);
		assert.equal(response.status, 404, `${pathname} must not be served`);
	}
});

test("the React shell shares the active visual design contract", async () => {
	const [tokens, appStyles] = await Promise.all([
		readFile(new URL("../src/client/design-tokens.css", import.meta.url), "utf8"),
		readFile(new URL("../src/client/app.css", import.meta.url), "utf8"),
	]);

	for (const contract of [
		/--color-canvas:\s*#f6f5f2/,
		/--color-ink:\s*#131b2e/,
		/--color-blue-deep:\s*#003594/,
		/--color-blue-standard:\s*#004ac6/,
		/--color-blue-bright:\s*#2878e5/,
		/--color-success:/,
		/--color-warning:/,
		/--color-danger:/,
		/--color-violet:/,
		/--radius-control:\s*12px/,
		/--radius-card:\s*16px/,
		/--radius-featured:\s*20px/,
		/--font-display:\s*"Sora"/,
	]) {
		assert.match(tokens, contract);
	}

	assert.match(
		appStyles,
		/\.primary-money-card strong\s*\{[^}]*font-family:\s*var\(--font-display\)/s,
	);

	const primaryRules = [
		...appStyles.matchAll(/(?:^|\n)\s*\.primary-money-card\s*\{([^}]*)\}/g),
	];
	const backgroundRules = primaryRules
		.map((match) => match[1])
		.filter((body) => /\bbackground\s*:/.test(body));
	assert.ok(backgroundRules.length > 0);
	assert.match(backgroundRules.at(-1), /var\(--anchor-background\)/);
	assert.match(
		backgroundRules.at(-1),
		/border-radius:\s*var\(--radius-featured\)/,
	);
});

test("the shared design tokens publish the marketing palette contract", async () => {
	const tokens = await readFile(
		new URL("../src/client/design-tokens.css", import.meta.url),
		"utf8",
	);

	for (const contract of [
		/--marketing-canvas:\s*#faf8ff/,
		/--marketing-surface-subtle:\s*#f1f2fc/,
		/--marketing-primary:\s*#174ea6/,
		/--marketing-primary-hover:\s*#0d3f91/,
		/--marketing-ink:\s*#182033/,
		/--marketing-muted:\s*#687086/,
		/--marketing-line:\s*#e3e5ef/,
	]) {
		assert.match(tokens, contract);
	}
});

test("the shared design tokens publish the light marketing stage roles", async () => {
	const tokens = await readFile(
		new URL("../src/client/design-tokens.css", import.meta.url),
		"utf8",
	);

	assert.match(
		tokens,
		/--marketing-stage-background:\s*linear-gradient\([^;]+#ffffff[^;]+#f1f2fc[^;]+\)/s,
	);
	assert.match(tokens, /--marketing-stage-border:\s*#d7ddea/);
});

test("view switch options keep the shared control radius in the final cascade", async () => {
	const styles = await readFile(
		new URL("../src/client/app.css", import.meta.url),
		"utf8",
	);
	const optionRules = [
		...styles.matchAll(/(?:^|\n)\s*\.view-switch-option\s*\{([^}]*)\}/g),
	];

	assert.ok(optionRules.length > 0, "expected a .view-switch-option rule");
	assert.match(
		optionRules.at(-1)[1],
		/border-radius:\s*var\(--radius-control\)/,
	);
	assert.doesNotMatch(optionRules.at(-1)[1], /border-radius:\s*8px/);
});

test("OAuth success returns users to the dashboard with auto-sync enabled", async () => {
	const source = await readFile(
		new URL("../src/server.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /location: "\/app\?gmail=connected"/);
});
