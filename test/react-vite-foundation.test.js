import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { createServer as createViteServer, loadConfigFromFile } from "vite";

process.env.VERCEL = "1";
process.env.TURSO_DATABASE_URL = "file::memory:";

const { resolveStaticAsset } = await import("../src/server.js");
const { ReviewPeriod: sharedReviewPeriod } = await import(
	"../src/shared/review-period.js"
);

test("Vite provides the React development entry point", async () => {
	const [index, packageJson] = await Promise.all([
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../package.json", import.meta.url), "utf8"),
	]);

	const parsedPackage = JSON.parse(packageJson);

	assert.match(index, /<div id="root"><\/div>/);
	assert.match(index, /src="\/src\/client\/main\.tsx"/);
	assert.equal(
		parsedPackage.scripts.dev,
		'concurrently --kill-others "npm run dev:server" "vite"',
	);
	assert.ok(parsedPackage.devDependencies.concurrently);
	assert.equal(parsedPackage.scripts["dev:server"], "node --watch src/server.js");
	assert.equal(parsedPackage.scripts.start, "node src/server.js");
});

test("Vite development serves /app and proxies legacy backend paths", async (t) => {
	const backendRequestUrls = [];
	const backend = createHttpServer((request, response) => {
		backendRequestUrls.push(request.url);
		response.end(request.url);
	});
	backend.listen(0, "127.0.0.1");
	await once(backend, "listening");
	t.after(() => new Promise((resolve) => backend.close(resolve)));

	const backendAddress = backend.address();
	assert.ok(backendAddress && typeof backendAddress !== "string");
	const backendTarget = `http://127.0.0.1:${backendAddress.port}`;
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const config = loadedConfig?.config;
	const proxies = Object.values(config?.server?.proxy ?? {});
	assert.equal(proxies.length, 4);
	for (const proxy of proxies) {
		assert.ok(proxy && typeof proxy === "object");
		proxy.target = backendTarget;
	}

	const vite = await createViteServer({
		...config,
		configFile: false,
		optimizeDeps: { noDiscovery: true },
		server: {
			...config.server,
			host: "127.0.0.1",
			port: 5174,
			strictPort: false,
			hmr: false,
		},
	});
	t.after(() => vite.close());
	await vite.listen();

	const viteAddress = vite.httpServer?.address();
	assert.ok(viteAddress && typeof viteAddress !== "string");
	for (const path of ["/", "/app", "/app/", "/app/demo", "/app/demo/"]) {
		const appResponse = await fetch(`http://127.0.0.1:${viteAddress.port}${path}`, {
			headers: { accept: "text/html" },
		});
		assert.equal(appResponse.status, 200);
		assert.match(await appResponse.text(), /<div id="root"><\/div>/);
	}

	// The application stylesheets moved under src/client and are imported by the entry module, so
	// Vite serves them through the module graph instead of the retired public `/app.css` route.
	const appStylesheet = await fetch(
		`http://127.0.0.1:${viteAddress.port}/src/client/app.css`,
	);
	assert.equal(appStylesheet.status, 200);
	assert.match(appStylesheet.headers.get("content-type") ?? "", /^text\/javascript/);
	const retiredAppStylesheet = await fetch(`http://127.0.0.1:${viteAddress.port}/app.css`);
	assert.doesNotMatch(
		retiredAppStylesheet.headers.get("content-type") ?? "",
		/^text\/css/,
	);

	for (const path of ["/app?demo", "/api/health", "/auth/session", "/legacy-app"]) {
		const response = await fetch(`http://127.0.0.1:${viteAddress.port}${path}`);
		assert.equal(response.status, 200);
		assert.equal(await response.text(), path);
	}
	assert.deepEqual(backendRequestUrls, [
		"/app?demo",
		"/api/health",
		"/auth/session",
		"/legacy-app",
	]);
});

test("production mounts the React shell at the root and /app while the retired legacy route is a redirect", () => {
	assert.deepEqual(resolveStaticAsset("/"), {
		directory: "dist",
		pathname: "/index.html",
	});
	assert.deepEqual(resolveStaticAsset("/app"), {
		directory: "dist",
		pathname: "/index.html",
	});
	assert.deepEqual(resolveStaticAsset("/app/"), {
		directory: "dist",
		pathname: "/index.html",
	});
	for (const pathname of ["/app/demo", "/app/demo/"]) {
		assert.deepEqual(resolveStaticAsset(pathname), {
			directory: "dist",
			pathname: "/index.html",
		});
	}
	// The legacy demo query is a request-level redirect, so the static resolver must never
	// fall back to the legacy `public/app.html` document for the canonical app route.
	assert.deepEqual(resolveStaticAsset("/app", new URLSearchParams("demo")), {
		directory: "dist",
		pathname: "/index.html",
	});
	assert.deepEqual(resolveStaticAsset("/demo-data.json"), {
		directory: "public",
		pathname: "/demo-data.json",
	});
});

test("no React surface links back to the retired legacy dashboard", async () => {
	const [route, page] = await Promise.all([
		readFile(new URL("../src/client/hooks/DashboardRoute.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);

	assert.doesNotMatch(route, /legacy-app/);
	assert.doesNotMatch(page, /legacy-app/);
});

test("React loads only the session before gating financial data and never auto-syncs Gmail", async () => {
	const [app, dashboardRoute, page] = await Promise.all([
		readFile(new URL("../src/client/App.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/hooks/DashboardRoute.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);

	assert.match(app, /<DashboardRoute\s*\/>/);
	assert.match(dashboardRoute, /getSessionProfile\(controller\.signal\)/);
	assert.doesNotMatch(dashboardRoute, /getGmailStatus|syncGmail|\/api\/gmail\/sync|gmail"\) !== "connected"/);
	assert.match(dashboardRoute, /Unable to load the account/);
	assert.match(dashboardRoute, /<button type="button" onClick=\{retry\}>Retry<\/button>/);
	assert.match(page, /if \(!session\.authenticated\)/);
	assert.match(page, /<FinancialSummary \/>/);
});

test("the React root composes the bounded landing header and hero with its session CTA contract", async () => {
	const [app, page, header, hero, reveal, sessionHook, styles] = await Promise.all([
		readFile(new URL("../src/client/App.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/pages/LandingPage.tsx", import.meta.url), "utf8"),
		readFile(
			new URL("../src/client/components/landing/LandingHeader.tsx", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../src/client/components/landing/LandingHero.tsx", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../src/client/components/landing/RevealOnScroll.tsx", import.meta.url),
			"utf8",
		),
		readFile(new URL("../src/client/hooks/useLandingSession.ts", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	assert.match(app, /window\.location\.pathname\s*===\s*"\/"/);
	assert.match(app, /<LandingPage\s*\/>/);
	assert.match(page, /<LandingHeader\s+session=\{session\}\s*\/>/);
	assert.match(page, /<LandingHero\s*\/>/);
	assert.match(header, /href=\{isAuthenticated \? "\/app" : "\/auth\/google"\}/);
	assert.match(header, /Ir al dashboard/);
	assert.match(header, /profile\?\.name \|\| profile\?\.email/);
	assert.match(hero, /aria-labelledby="hero-title"/);
	assert.match(hero, /href="\/app\/demo"/);
	assert.match(reveal, /IntersectionObserver/);
	assert.match(reveal, /prefers-reduced-motion: reduce/);
	assert.match(styles, /\.landing-reveal \{ opacity: 0; transform: translateY\(20px\)/);
	assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.landing-reveal \{ opacity: 1; transform: none/);
	assert.match(sessionHook, /getSessionProfile/);
});

test("the React landing composes accessible problem and product sections with reveal motion", async () => {
	const [page, problem, product] = await Promise.all([
		readFile(new URL("../src/client/pages/LandingPage.tsx", import.meta.url), "utf8"),
		readFile(
			new URL("../src/client/components/landing/LandingProblemSection.tsx", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../src/client/components/landing/LandingProductSection.tsx", import.meta.url),
			"utf8",
		),
	]);

	assert.match(page, /<LandingProblemSection\s*\/>/);
	assert.match(page, /<LandingProductSection\s*\/>/);
	assert.match(problem, /<section[^>]*\bid="problema"[^>]*aria-labelledby="problem-title"/);
	assert.match(problem, /<RevealOnScroll/);
	assert.match(problem, /Información dispersa/);
	assert.match(problem, /Difícil de corregir/);
	assert.match(product, /<section[^>]*\bid="producto"[^>]*aria-labelledby="product-title"/);
	assert.match(product, /<RevealOnScroll/);
	assert.match(product, /Sincronización por periodo/);
	assert.match(product, /Resumen y detalle mensual/);
});

test("the React landing composes compatible banking and how-it-works sections with accessible reveals", async () => {
	const [page, compatibility, howItWorks] = await Promise.all([
		readFile(new URL("../src/client/pages/LandingPage.tsx", import.meta.url), "utf8"),
		readFile(
			new URL("../src/client/components/landing/LandingCompatibilitySection.tsx", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../src/client/components/landing/LandingHowItWorksSection.tsx", import.meta.url),
			"utf8",
		),
	]);

	assert.match(page, /<LandingCompatibilitySection\s*\/>/);
	assert.match(page, /<LandingHowItWorksSection\s*\/>/);
	assert.match(compatibility, /<section[^>]*\bid="compatibilidad"[^>]*aria-labelledby="compatibility-title"/);
	assert.match(compatibility, /<RevealOnScroll/);
	assert.match(compatibility, /Disponible actualmente para Banco de Chile\./);
	assert.match(compatibility, /account_balance/);
	assert.match(howItWorks, /<section[^>]*\bid="como-funciona"[^>]*aria-labelledby="steps-title"/);
	assert.match(howItWorks, /<RevealOnScroll/);
	assert.match(howItWorks, /const steps/);
	assert.match(howItWorks, /steps\.map/);
	assert.match(howItWorks, /Autoriza Gmail/);
	assert.match(howItWorks, /Revisa y ajusta/);
});

test("the React landing composes the accessible security section and footer after how-it-works", async () => {
	const [page, header, security, footer, styles] = await Promise.all([
		readFile(new URL("../src/client/pages/LandingPage.tsx", import.meta.url), "utf8"),
		readFile(
			new URL("../src/client/components/landing/LandingHeader.tsx", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../src/client/components/landing/LandingSecuritySection.tsx", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../src/client/components/landing/LandingFooter.tsx", import.meta.url),
			"utf8",
		),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	assert.match(page, /<LandingHowItWorksSection\s*\/>\s*<LandingSecuritySection\s*\/>\s*<\/main>\s*<LandingFooter\s*\/>/);
	assert.equal((header.match(/href="#seguridad"/g) ?? []).length, 1);
	assert.equal((security.match(/\bid="seguridad"/g) ?? []).length, 1);
	assert.match(security, /<section[^>]*\bid="seguridad"[^>]*aria-labelledby="security-title"/);
	assert.match(security, /<RevealOnScroll/);
	assert.match(security, /Acceso autorizado y acotado\./);
	assert.match(security, /Se consultan mensajes compatibles de Banco de Chile para el periodo seleccionado\./);
	assert.match(security, /Correcciones, reglas, movimientos manuales, categorías y presupuesto pueden persistir\./);
	assert.match(footer, /<footer/);
	assert.match(footer, /aria-label="Navegación del pie"/);
	assert.match(footer, /href="#seguridad"/);
	assert.match(footer, /href="\/app"/);
	assert.match(styles, /\.landing-security-section/);
	assert.match(styles, /\.landing-footer/);
});

test("the React financial summary loads the configured period before transactions and recognizes only supported expenses", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [client, page] = await Promise.all([
		vite.ssrLoadModule("/src/client/api/client.ts"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
	]);
	const calls = [];
	let configured = true;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (path, options) => {
		calls.push([path, options]);
		return {
			ok: true,
			json: async () =>
				path === "/api/financial-cycle"
					? {
							selectedPeriod: configured
								? {
										startDate: "2028-02-29",
										endDateExclusive: "2028-03-01",
									}
								: null,
							incomeAmount: 900000,
							completedAt: null,
						}
					: {
							transactions: [
								{ direction: "outflow", kind: "purchase", amount: 1200 },
								{ direction: "outflow", kind: "payment", amount: null },
								{ direction: "outflow", kind: "transfer", amount: "unknown" },
								{ direction: "inflow", kind: "purchase", amount: 800 },
								{ direction: "outflow", kind: "unknown", amount: 500 },
							],
							warning: "Gmail data may be incomplete.",
						},
			};
	};
	try {
		const data = await client.loadFinancialDashboardData();
		assert.deepEqual(calls.map(([path]) => path), [
			"/api/financial-cycle",
			"/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01",
		]);
		assert.deepEqual(calls.map(([, options]) => options?.method), [undefined, undefined]);
		assert.deepEqual(page.summarizeRecognizedExpenses(data.transactions), {
			count: 1,
			totalSpending: 1200,
			pendingAmountCount: 2,
		});
		assert.equal(
			page.formatPeriodLabel(data.cycle.selectedPeriod),
			"29/02/2028 a 29/02/2028",
		);
		// The displayed range is `DD/MM/YYYY a DD/MM/YYYY`; the stored period stays ISO.
		assert.equal(
			page.formatPeriodLabel({ startDate: "2026-08-28", endDateExclusive: "2026-09-22" }),
			"28/08/2026 a 21/09/2026",
		);

		configured = false;
		calls.length = 0;
		const unconfigured = await client.loadFinancialDashboardData();
		assert.equal(unconfigured.cycle.selectedPeriod, null);
		assert.deepEqual(unconfigured.transactions, []);
		assert.deepEqual(calls.map(([path]) => path), ["/api/financial-cycle"]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the React financial dashboard cache serves a tab reload without a request and only trusts a valid response", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const client = await vite.ssrLoadModule("/src/client/api/client.ts");

	const originalFetch = globalThis.fetch;
	// Node has no `sessionStorage`, so the tab storage is stubbed with the same small surface the
	// client reads and written through the client's own writer; the key is discovered, not hard-coded,
	// so the test describes behavior instead of pinning a private constant.
	const store = new Map();
	const sessionStorage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => {
			store.set(key, String(value));
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	};
	const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: sessionStorage });
	t.after(() => {
		globalThis.fetch = originalFetch;
		if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
		else delete globalThis.sessionStorage;
	});

	const calls = [];
	globalThis.fetch = async (path) => {
		calls.push(path);
		return {
			ok: true,
			json: async () =>
				path === "/api/financial-cycle"
					? {
							selectedPeriod: { startDate: "2028-02-29", endDateExclusive: "2028-03-01" },
							incomeAmount: 900000,
							completedAt: null,
						}
					: {
							transactions: [{ direction: "outflow", kind: "purchase", amount: 1200 }],
							warning: null,
						},
		};
	};

	const seeded = {
		cycle: {
			selectedPeriod: { startDate: "2028-02-29", endDateExclusive: "2028-03-01" },
			incomeAmount: 900000,
			completedAt: null,
		},
		transactions: [
			{ id: "m-1", direction: "outflow", kind: "purchase", amount: 500, category: "Food" },
		],
		warning: "cached",
	};

	// Cache hit: the stored period and its movements are served exactly, with no request at all.
	store.clear();
	calls.length = 0;
	client.writeFinancialDashboardCache(" Owner@Example.com ", seeded);
	const cacheKey = [...store.keys()][0];
	assert.ok(cacheKey, "the client must have stored the dashboard under some key");
	assert.deepEqual(client.readFinancialDashboardCache("owner@example.com"), seeded);
	assert.deepEqual(await client.loadFinancialDashboardWithCache("OWNER@example.com"), seeded);
	assert.deepEqual(calls, []);
	assert.deepEqual(JSON.parse(store.get(cacheKey)), { userEmail: "owner@example.com", data: seeded });

	// An identity mismatch evicts the prior user's dashboard before any network request.
	assert.equal(client.readFinancialDashboardCache("other@example.com"), null);
	assert.equal(store.has(cacheKey), false);
	client.writeFinancialDashboardCache("owner@example.com", seeded);
	calls.length = 0;
	const other = await client.loadFinancialDashboardWithCache("other@example.com");
	assert.equal(other.transactions[0].amount, 1200);
	assert.deepEqual(calls, [
		"/api/financial-cycle",
		"/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01",
	]);
	assert.deepEqual(JSON.parse(store.get(cacheKey)), { userEmail: "other@example.com", data: other });

	// The old identity field cannot authorize an otherwise valid v2 response.
	store.set(cacheKey, JSON.stringify({ email: "other@example.com", data: seeded }));
	assert.equal(client.readFinancialDashboardCache("other@example.com"), null);
	assert.equal(store.has(cacheKey), false);
	client.writeFinancialDashboardCache("other@example.com", other);

	// Legacy unbound responses are never usable; clear touches only dashboard-owned keys.
	store.set("gastos-controlados:financial-dashboard:v1", JSON.stringify(seeded));
	store.set("unrelated", "keep");
	assert.deepEqual(client.readFinancialDashboardCache("other@example.com"), other);
	assert.equal(store.has("gastos-controlados:financial-dashboard:v1"), false);
	client.clearFinancialDashboardCache();
	assert.equal(store.has(cacheKey), false);
	assert.equal(store.get("unrelated"), "keep");
	store.set(cacheKey, JSON.stringify(seeded));
	assert.equal(client.readFinancialDashboardCache("owner@example.com"), null);
	assert.equal(store.has(cacheKey), false);

	// Corrupted storage (invalid JSON) falls back to the normal cycle-first request and repairs it.
	store.set(cacheKey, "{not json");
	calls.length = 0;
	const recovered = await client.loadFinancialDashboardWithCache("owner@example.com");
	assert.deepEqual(calls, [
		"/api/financial-cycle",
		"/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01",
	]);
	assert.equal(recovered.transactions[0].amount, 1200);
	assert.deepEqual(client.readFinancialDashboardCache("owner@example.com"), recovered);

	// A valid JSON body that is not a dashboard response is still a miss, not data to render.
	store.set(cacheKey, JSON.stringify({ cycle: { unexpected: true }, transactions: [] }));
	calls.length = 0;
	await client.loadFinancialDashboardWithCache("owner@example.com");
	assert.deepEqual(calls, [
		"/api/financial-cycle",
		"/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01",
	]);

	// Force refresh bypasses the cache, reads current data and replaces the stored response.
	client.writeFinancialDashboardCache("owner@example.com", seeded);
	calls.length = 0;
	const refreshed = await client.refreshFinancialDashboardData("owner@example.com");
	assert.deepEqual(calls, [
		"/api/financial-cycle",
		"/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01",
	]);
	assert.equal(refreshed.transactions[0].amount, 1200);
	assert.deepEqual(client.readFinancialDashboardCache("owner@example.com"), refreshed);

	// Even if fetch resolves after an abort, neither fresh nor cache-first loads can repopulate storage.
	const normalFetch = globalThis.fetch;
	for (const loader of [client.loadFinancialDashboardWithCache, client.refreshFinancialDashboardData]) {
		client.clearFinancialDashboardCache();
		let release;
		globalThis.fetch = () => new Promise((resolve) => {
			release = () => resolve({ ok: true, json: async () => ({ ...seeded.cycle, selectedPeriod: null }) });
		});
		const controller = new AbortController();
		const pending = loader("owner@example.com", controller.signal);
		controller.abort();
		release();
		await assert.rejects(pending, { name: "AbortError" });
		assert.equal(store.has(cacheKey), false);
	}
	// Logout also invalidates an already-running fetch even before its component unmounts.
	let releaseAfterLogout;
	globalThis.fetch = () => new Promise((resolve) => {
		releaseAfterLogout = () => resolve({ ok: true, json: async () => ({ ...seeded.cycle, selectedPeriod: null }) });
	});
	const pendingLogoutLoad = client.refreshFinancialDashboardData("owner@example.com");
	client.clearFinancialDashboardCache();
	releaseAfterLogout();
	await assert.rejects(pendingLogoutLoad, { name: "AbortError" });
	assert.equal(store.has(cacheKey), false);
	globalThis.fetch = normalFetch;

	// Unavailable storage fails safe: reads miss and writes are a no-op, so the load still happens.
	const deniedStorage = {
		getItem: () => {
			throw new Error("storage denied");
		},
		setItem: () => {
			throw new Error("storage denied");
		},
		removeItem: () => {},
		clear: () => {},
		key: () => null,
		length: 0,
	};
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: deniedStorage });
	calls.length = 0;
	assert.equal(client.readFinancialDashboardCache("owner@example.com"), null);
	assert.doesNotThrow(() => client.writeFinancialDashboardCache("owner@example.com", seeded));
	assert.doesNotThrow(() => client.clearFinancialDashboardCache());
	const fallback = await client.loadFinancialDashboardWithCache("owner@example.com");
	assert.equal(fallback.transactions[0].amount, 1200);
	assert.deepEqual(calls, [
		"/api/financial-cycle",
		"/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01",
	]);
});

test("the account route remounts by identity and logout clears the tab cache before navigation", async () => {
	const route = await readFile(new URL("../src/client/hooks/DashboardRoute.tsx", import.meta.url), "utf8");
	const page = await readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8");
	const client = await readFile(new URL("../src/client/api/client.ts", import.meta.url), "utf8");
	assert.match(route, /<DashboardPage key=\{state\.session\.profile\?\.email\?\.trim\(\)\.toLowerCase\(\) \?\? ""\}/);
	assert.match(page, /<FinancialSummary[\s\S]*?key=\{profile\?\.email\?\.trim\(\)\.toLowerCase\(\) \?\? ""\}[\s\S]*?email=\{profile\?\.email \?\? ""\}/);
	assert.match(page, /href="\/auth\/logout"[\s\S]*?onClick=\{clearFinancialDashboardCache\}/);
	assert.match(page, /refreshFinancialDashboardData\(email, controller\.signal\)/);
	assert.match(page, /loadFinancialDashboardWithCache\(email, controller\.signal\)/);
	assert.match(page, /activeLoad\.current\?\.abort\(\)/);
	assert.match(client, /if \(signal\?\.aborted \|\| generation !== cacheGeneration\) throw new DOMException\("Dashboard load aborted", "AbortError"\);\s*writeFinancialDashboardCache\(email, data\)/);
});

test("the React financial summary breaks recognized spending down by kind without counting unknown amounts", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	assert.deepEqual(
		page.summarizeRecognizedExpensesByKind([
			{ direction: "outflow", kind: "purchase", amount: 1200 },
			{ direction: "outflow", kind: "purchase", amount: null },
			{ direction: "outflow", kind: "transfer", amount: 800 },
			{ direction: "outflow", kind: "payment", amount: "unknown" },
			{ direction: "outflow", kind: "payment", amount: Number.NaN },
			{ direction: "outflow", kind: "transfer", amount: Number.POSITIVE_INFINITY },
			{ direction: "inflow", kind: "payment", amount: 500 },
			{ direction: "outflow", kind: "other", amount: 900 },
		]),
		{ purchase: 1200, transfer: 800, payment: 0 },
	);

	const source = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);
	// The section is one Stitch-style card: a segmented distribution bar plus an icon legend, not a
	// repeated per-kind progress track. The legend names every kind with free solid iconography, and
	// each marker reuses its segment's colour token.
	assert.match(source, /<section className="react-spending-breakdown"/);
	assert.match(source, /Distribución de gastos/);
	assert.match(source, /className="react-spending-breakdown-bar"/);
	assert.match(source, /react-spending-breakdown-segment-\$\{bar\.key\}/);
	assert.match(source, /className="react-spending-breakdown-legend"/);
	assert.match(source, /faCartShopping/);
	assert.match(source, /faArrowRightArrowLeft/);
	assert.match(source, /faReceipt/);
	// The decorative upper-right glyph is a free solid chart icon in its own hidden container.
	assert.match(source, /faChartPie/);
	assert.match(source, /className="react-spending-breakdown-header-icon" aria-hidden="true"/);
	// The legend item and its marker both carry the kind token, so the colour can match the segment.
	assert.match(source, /react-spending-breakdown-legend-item-\$\{bar\.key\}/);
	assert.match(source, /react-spending-breakdown-icon-\$\{bar\.key\}/);
	assert.doesNotMatch(source, /react-breakdown-track|react-breakdown-fill/);
});

test("the React financial summary selects the latest valid recognized expense within the configured period", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	const period = sharedReviewPeriod.create({
		startDate: "2028-02-29",
		endDateExclusive: "2028-03-02",
	});
	const firstAtLatestTime = {
		direction: "outflow",
		kind: "payment",
		amount: 700,
		occurredAt: "2028-03-01T14:30",
		counterparty: "  First merchant  ",
	};
	const latest = page.selectLatestRecognizedExpense(
		[
			{ direction: "outflow", kind: "purchase", amount: 100, occurredAt: "2028-02-29" },
			firstAtLatestTime,
			{ direction: "outflow", kind: "transfer", amount: 900, occurredAt: "2028-03-01T14:30:00", counterparty: "Later equal" },
			{ direction: "outflow", kind: "purchase", amount: 50, occurredAt: "2028-03-02" },
			{ direction: "outflow", kind: "purchase", amount: 50, occurredAt: "2028-02-30" },
			{ direction: "outflow", kind: "purchase", amount: 50, occurredAt: "2028-03-01T24:00" },
			{ direction: "outflow", kind: "purchase", amount: 50, occurredAt: "2028-03-01T14:30Z" },
			{ direction: "outflow", kind: "purchase", amount: Number.POSITIVE_INFINITY, occurredAt: "2028-03-01T23:00" },
			{ direction: "outflow", kind: "purchase", amount: 50, occurredAt: null },
		],
		period,
	);

	assert.equal(latest, firstAtLatestTime);
	assert.equal(page.getRecognizedExpenseIdentity(latest), "First merchant");
	assert.equal(
		page.getRecognizedExpenseIdentity({ description: "  Grocery shopping  " }),
		"Grocery shopping",
	);
	assert.equal(page.getRecognizedExpenseIdentity({ counterparty: "   ", description: null }), "Unidentified expense");
	assert.equal(page.selectLatestRecognizedExpense([], period), null);

	const source = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /new Date\(occurredAt\)/);
	assert.match(source, /<section className="react-latest-expense" aria-labelledby="react-latest-expense-title">/);
	assert.match(source, /<h3 id="react-latest-expense-title">Latest recognized expense<\/h3>/);
	assert.match(source, /<dt>Merchant<\/dt>/);
	assert.match(source, /<dt>When<\/dt>/);
});

test("the React financial summary exposes pending recognized amounts without inventing a balance", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [page, source, styles] = await Promise.all([
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);
	assert.deepEqual(
		page.summarizeRecognizedExpenses([
			{ direction: "outflow", kind: "purchase", amount: 1200 },
			{ direction: "outflow", kind: "payment", amount: null },
			{ direction: "outflow", kind: "transfer", amount: Number.NaN },
			{ direction: "outflow", kind: "purchase", amount: Number.POSITIVE_INFINITY },
			{ direction: "outflow", kind: "other", amount: null },
		]),
		{ count: 1, totalSpending: 1200, pendingAmountCount: 3 },
	);
	assert.match(source, /Pending amounts/);
	assert.match(source, /summary\.pendingAmountCount/);
	assert.doesNotMatch(source, /Remaining balance|remainingBalance/);
	assert.match(source, /return amount < 0 \? `-\$\{formatted\}` : formatted/);
	assert.match(styles, /\.react-financial-grid\s*\{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
	assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.react-financial-grid\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("the React movements view derives safe, finite recognized expense rows", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
	assert.deepEqual(
		page.getRecognizedExpenseMovements([
			{
				direction: "outflow",
				kind: "purchase",
				amount: -1200,
				counterparty: "  Coffee shop  ",
				occurredAt: "2028-02-29",
				category: "  Food  ",
			},
			{
				direction: "outflow",
				kind: "transfer",
				amount: 300,
				description: "  Rent transfer  ",
				occurredAt: "2028-02-29T14:30",
				category: null,
			},
			{ direction: "outflow", kind: "payment", amount: 200, occurredAt: "invalid" },
			{ direction: "outflow", kind: "purchase", amount: Number.NaN },
			{ direction: "outflow", kind: "purchase", amount: Number.POSITIVE_INFINITY },
			{ direction: "inflow", kind: "purchase", amount: 500 },
			{ direction: "outflow", kind: "unknown", amount: 500 },
		]),
		[
			{
				id: null,
				counterparty: "Coffee shop",
				amount: -1200,
				date: "2028-02-29",
				category: "Food",
				description: "",
				kind: "purchase",
				status: null,
				source: null,
				occurredAt: "2028-02-29T00:00:00",
				hasTime: false,
			},
			{
				id: null,
				counterparty: "Rent transfer",
				amount: 300,
				date: "2028-02-29",
				category: "Sin categoría",
				description: "Rent transfer",
				kind: "transfer",
				status: null,
				source: null,
				occurredAt: "2028-02-29T14:30:00",
				hasTime: true,
			},
			{
				id: null,
				counterparty: "Gasto sin identificar",
				amount: 200,
				date: "—",
				category: "Sin categoría",
				description: "",
				kind: "payment",
				status: null,
				source: null,
				occurredAt: null,
				hasTime: false,
			},
		],
	);

	const source = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);
	assert.match(source, /view === "summary" \?/);
	assert.match(source, /<MovementsTable/);
	assert.match(source, /Contraparte/);
	assert.match(source, /Monto/);
	assert.match(source, /Fecha/);
	assert.match(source, /Categoría/);
	assert.match(source, /No se encontraron gastos reconocidos para este periodo\./);
	assert.doesNotMatch(source, /legacy-app/);
	assert.match(source, /\}, \[retryToken\]\);/);
});

test("the demo fixture adapter validates and safely rebases movements without API access", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const demo = await vite.ssrLoadModule("/src/client/demo-data.ts");
	const source = await readFile(
		new URL("../src/client/demo-data.ts", import.meta.url),
		"utf8",
	);
	const fixture = [
		{
			id: "expense",
			occurredAt: "2024-02-29T12:30:00",
			amount: 25000,
			direction: "outflow",
			kind: "purchase",
			counterparty: "Mercado",
			category: "Comida",
		},
		{
			id: "income",
			occurredAt: "2024-02-28T08:00:00",
			amount: 900000,
			direction: "inflow",
			kind: "transfer",
			counterparty: "Empleador",
			category: null,
		},
	];
	const data = demo.createDemoDashboardData(fixture, new Date("2025-02-01T12:00:00Z"));

	assert.equal(data.movements[0].occurredAt, "2025-02-28T12:30:00");
	assert.deepEqual(data.period, {
		startDate: "2025-02-01",
		endDateExclusive: "2025-03-01",
	});
	assert.equal(data.currentPeriodSpending, 25000);
	assert.equal(data.currentPeriodInflow, 900000);
	assert.throws(
		() => demo.createDemoDashboardData([{ ...fixture[0], amount: "25000" }], new Date("2025-02-01T12:00:00Z")),
		/Demo fixture/,
	);

	const calls = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (path) => {
		calls.push(path);
		return { ok: true, json: async () => fixture };
	};
	try {
		await demo.loadDemoDashboardData();
		assert.deepEqual(calls, ["/demo-data.json"]);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.doesNotMatch(source, /getSessionProfile|getGmailStatus|syncGmail|\/api\//);
});

test("the demo route renders Spanish read-only data and keeps session and sync calls out of the demo branch", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, page, route, hero] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/hooks/DashboardRoute.tsx"),
		readFile(new URL("../src/client/components/landing/LandingHero.tsx", import.meta.url), "utf8"),
	]);
	const markup = renderer.renderToStaticMarkup(
		React.createElement(page.DemoDashboardPage, {
			data: {
				period: { startDate: "2025-02-01", endDateExclusive: "2025-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [{ id: "expense", occurredAt: "2025-02-28T12:30:00", amount: 25000, direction: "outflow", kind: "purchase", counterparty: "Mercado", category: "Comida" }],
			},
		}),
	);

	assert.equal(route.isDemoDashboardRoute("/app/demo"), true);
	assert.equal(route.isDemoDashboardRoute("/app/demo/"), true);
	assert.equal(route.isDemoDashboardRoute("/app"), false);
	assert.match(markup, /Demo/);
	assert.match(markup, /Solo lectura/);
	assert.match(markup, /Mercado/);
	// The demo reuses the authenticated chrome: the same header and Resumen/Movimientos navigation
	// shape, with the stable demo identity in the account slot.
	assert.match(markup, /class="react-app-header"/);
	assert.match(markup, /aria-label="Vistas del panel"/);
	assert.match(
		markup,
		/<button type="button" class="react-app-navigation-link react-app-navigation-link-active" aria-pressed="true">Resumen<\/button>/,
	);
	assert.match(
		markup,
		/<button type="button" class="react-app-navigation-link" aria-pressed="false">Movimientos<\/button>/,
	);
	assert.match(markup, /<strong class="react-account-name">Usuario demo<\/strong>/);
	assert.match(markup, /<span class="react-account-email">demo@demo\.com<\/span>/);
	// The account menu's only action leaves demo mode; the footer keeps its read-only login too.
	assert.match(markup, /<a href="\/auth\/google" role="menuitem"[^>]*>Iniciar sesión<\/a>/);
	assert.match(markup, /Inicia sesión para editar/);
	// Inert navigation: the demo mounts no authenticated movements surface behind the chrome.
	assert.doesNotMatch(markup, /Filtrar tabla por categoría|Nuevo gasto|react-financial-view-toggle/);
	assert.match(markup, /href="\/auth\/google"/);
	assert.match(hero, /href="\/app\/demo"/);
	const demoBranch = route.DemoDashboardRoute.toString();
	assert.doesNotMatch(demoBranch, /getSessionProfile|getGmailStatus|syncGmail|\/api\//);
});

test("the React financial-cycle setup validates inclusive dates and reloads through the cycle-first path", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [client, page, source, styles] = await Promise.all([
		vite.ssrLoadModule("/src/client/api/client.ts"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);
	assert.deepEqual(
		page.createFinancialCycleSetupPayload("2028-02-29", "2028-02-29", "900000"),
		{
			selectedPeriod: { startDate: "2028-02-29", endDateExclusive: "2028-03-01" },
			incomeAmount: 900000,
		},
	);
	assert.equal(
		page.createFinancialCycleSetupPayload("2028-02-29", "2028-02-29", "").incomeAmount,
		null,
	);
	assert.equal(
		page.createFinancialCycleSetupPayload("2028-02-29", "2028-02-29", "900.000").incomeAmount,
		900000,
	);
	assert.throws(
		() => page.createFinancialCycleSetupPayload("2028-02-29", "2028-02-28", "1000"),
		/startDate must be before endDateExclusive/,
	);
	assert.throws(
		() => page.createFinancialCycleSetupPayload("2028-02-29", "2028-02-29", "1000.50"),
		/positive whole safe CLP integer/,
	);
	assert.throws(
		() => page.createFinancialCycleSetupPayload("2028-02-29", "2028-02-29", "9007199254740992"),
		/positive whole safe CLP integer/,
	);

	const calls = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (path, options) => {
		calls.push([path, options]);
		return {
			ok: true,
			json: async () =>
				path === "/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01"
					? { transactions: [], warning: null }
					: {
							selectedPeriod: { startDate: "2028-02-29", endDateExclusive: "2028-03-01" },
							incomeAmount: 900000,
							completedAt: null,
						},
		};
	};
	try {
		await client.updateFinancialCycle({
			selectedPeriod: { startDate: "2028-02-29", endDateExclusive: "2028-03-01" },
			incomeAmount: 900000,
		});
		await client.loadFinancialDashboardData();
		assert.deepEqual(calls.map(([path]) => path), [
			"/api/financial-cycle",
			"/api/financial-cycle",
			"/api/transactions?startDate=2028-02-29&endDateExclusive=2028-03-01",
		]);
		assert.equal(calls[0][1]?.method, "PUT");
		assert.deepEqual(JSON.parse(calls[0][1]?.body), {
			selectedPeriod: { startDate: "2028-02-29", endDateExclusive: "2028-03-01" },
			incomeAmount: 900000,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.match(source, /ReviewPeriod\.currentMonth\(\)/);
	assert.match(source, /ReviewPeriod\.fromInclusive\(startDate, endDate\)/);
	assert.match(source, /<form[^>]*onSubmit=\{handleSubmit\}/);
	assert.match(source, /type="date"/);
	assert.match(source, /disabled=\{isSaving\}/);
	assert.match(source, /aria-live="polite"/);
	// The unconfigured first-login setup is a real modal through the shared helper and its own shell.
	assert.match(source, /syncNativeModalDialog/);
	assert.match(source, /react-financial-setup-dialog/);
	assert.match(styles, /\.react-financial-setup-dialog/);
	assert.doesNotMatch(
		source.slice(
			source.indexOf("function FinancialCycleSetupForm"),
			source.indexOf("function MovementsTable"),
		),
		/legacy-app/,
	);
	assert.match(styles, /\.react-financial-setup-form/);
});

test("the React category settings module validates drafts before any request and derives the display catalog", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const settings = await vite.ssrLoadModule(
		"/src/client/components/settings/categorySettings.ts",
	);

	assert.deepEqual(settings.createCategoryDraft(), { name: "", color: "#22c55e" });
	assert.equal(settings.validateCategoryDraft({ name: "   ", color: "#22c55e" }).ok, false);
	assert.equal(settings.validateCategoryDraft({ name: "Comida", color: "22c55e" }).ok, false);
	assert.equal(settings.validateCategoryDraft({ name: "Comida", color: "#22c55" }).ok, false);
	assert.equal(settings.validateCategoryDraft({ name: "Comida", color: "#22c55ez" }).ok, false);
	assert.deepEqual(
		settings.validateCategoryDraft({ name: "  Comida    saludable  ", color: " #22C55E " }),
		{ ok: true, payload: { name: "Comida saludable", color: "#22C55E" } },
	);
	// The server's own rule is mirrored: whitespace collapses and the name is sliced to 40 characters.
	const longName = settings.validateCategoryDraft({
		name: `  ${"a".repeat(60)}  `,
		color: "#22c55e",
	});
	assert.equal(longName.ok, true);
	assert.equal(longName.payload.name.length, settings.MAX_CATEGORY_NAME_LENGTH);
	assert.equal(longName.payload.name, "a".repeat(40));

	// Merge/derivation: sorted and labelled, a builtin falls back to the shared grey, and only a
	// custom row can be deleted.
	assert.deepEqual(
		settings.getCategoryDisplayRows([
			{ name: "  Súper mercado  ", color: "#ff8800", builtin: false },
			{ name: "Comida", color: "not-a-color", builtin: true },
			{ name: "Transporte", builtin: true },
			{ name: "   ", color: "#ffffff" },
		]),
		[
			{
				name: "Comida",
				color: "#64748b",
				label: "Predeterminada",
				builtin: true,
				canDelete: false,
			},
			{
				name: "Súper mercado",
				color: "#ff8800",
				label: "Personalizada",
				builtin: false,
				canDelete: true,
			},
			{
				name: "Transporte",
				color: "#64748b",
				label: "Predeterminada",
				builtin: true,
				canDelete: false,
			},
		],
	);
	assert.deepEqual(settings.getCategoryDisplayRows([]), []);

	// Deleting a category never reassigns anything: the stored movement categories survive.
	const confirmation = settings.getCategoryDeleteConfirmation("  Casa  ");
	assert.equal(confirmation.name, "Casa");
	assert.match(confirmation.title, /Casa/);
	assert.match(confirmation.message, /conservan su categoría/);
	assert.match(confirmation.message, /no se reasigna/);
	assert.equal(confirmation.confirmLabel, "Eliminar categoría");
	assert.equal(confirmation.cancelLabel, "Cancelar");
});

test("the React category mutations send the exact request and surface the server message", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const client = await vite.ssrLoadModule("/src/client/api/client.ts");
	const calls = [];
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (path, options) => {
		calls.push([path, options]);
		return path === "/api/categories"
			? {
					ok: true,
					json: async () => ({
						category: {
							name: "Comida",
							color: "#22c55e",
							createdAt: "2025-01-01 00:00:00",
							updatedAt: "2025-01-01 00:00:00",
						},
					}),
				}
			: { ok: true, json: async () => ({ ok: true }) };
	};
	try {
		const saved = await client.upsertCategory({ name: "Comida", color: "#22c55e" });
		assert.deepEqual(saved, {
			category: {
				name: "Comida",
				color: "#22c55e",
				createdAt: "2025-01-01 00:00:00",
				updatedAt: "2025-01-01 00:00:00",
			},
		});
		assert.equal(calls[0][0], "/api/categories");
		assert.equal(calls[0][1]?.method, "PUT");
		assert.deepEqual(calls[0][1]?.headers, { "content-type": "application/json" });
		assert.deepEqual(JSON.parse(calls[0][1]?.body), { name: "Comida", color: "#22c55e" });

		assert.deepEqual(await client.deleteCategory("Casa y hogar"), { ok: true });
		assert.equal(calls[1][0], "/api/categories/Casa%20y%20hogar");
		assert.equal(calls[1][1]?.method, "DELETE");
		assert.equal(calls[1][1]?.body, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}

	// A rejected mutation must carry the server's own Spanish message: `getJson` deliberately never
	// reads the `{ error }` body, so the category mutations cannot use it.
	const rejections = [
		{ status: 400, error: "name es obligatorio" },
		{ status: 400, error: "color inválido" },
		{ status: 404, error: "Category not found" },
	];
	globalThis.fetch = async () => {
		const rejection = rejections.shift();
		return {
			ok: false,
			status: rejection.status,
			json: async () => ({ error: rejection.error }),
		};
	};
	try {
		const isApiErrorMessage = (message) => (error) =>
			error instanceof client.ApiError && error.message === message;
		await assert.rejects(
			() => client.upsertCategory({ name: "   ", color: "#22c55e" }),
			isApiErrorMessage("name es obligatorio"),
		);
		await assert.rejects(
			() => client.upsertCategory({ name: "Comida", color: "#22c55e" }),
			isApiErrorMessage("color inválido"),
		);
		await assert.rejects(
			() => client.deleteCategory("Casa"),
			isApiErrorMessage("Category not found"),
		);
	} finally {
		globalThis.fetch = originalFetch;
	}

	// A body that carries no usable message still reports the status the server answered.
	rejections.length = 0;
	globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
	try {
		await assert.rejects(
			() => client.upsertCategory({ name: "Comida", color: "#22c55e" }),
			(error) =>
				error instanceof client.ApiError && /\(503\)/.test(error.message),
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the React category submitter holds a single in-flight mutation and only sends a valid draft", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [settings, client] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/settings/categorySettings.ts"),
		vite.ssrLoadModule("/src/client/api/client.ts"),
	]);

	const lock = { current: false };
	const calls = [];
	let settle = null;
	const submit = settings.createCategoryMutationSubmitter({
		upsertCategory: async (payload) => {
			calls.push(["PUT", payload]);
			await new Promise((resolve) => {
				settle = resolve;
			});
			return { category: { ...payload } };
		},
		deleteCategory: async (name) => {
			calls.push(["DELETE", name]);
			return { ok: true };
		},
		lock,
	});

	// An invalid draft is refused by the submitter itself, so no request can leave and the lock is
	// never taken.
	assert.deepEqual(
		await submit({ type: "upsert", draft: { name: "   ", color: "#22c55e" } }),
		{ status: "failed", message: settings.CATEGORY_NAME_REQUIRED_MESSAGE },
	);
	assert.deepEqual(
		await submit({ type: "upsert", draft: { name: "Comida", color: "nope" } }),
		{ status: "failed", message: settings.CATEGORY_COLOR_INVALID_MESSAGE },
	);
	assert.deepEqual(await submit({ type: "delete", name: "   " }), {
		status: "failed",
		message: settings.CATEGORY_NAME_REQUIRED_MESSAGE,
	});
	assert.deepEqual(calls, []);
	assert.equal(lock.current, false);

	// Two submissions in the same tick: the second finds the lock held and sends nothing.
	const first = submit({
		type: "upsert",
		draft: { name: "  Comida  ", color: "#22c55e" },
	});
	const second = submit({
		type: "upsert",
		draft: { name: "  Comida  ", color: "#22c55e" },
	});
	assert.deepEqual(await second, { status: "busy" });
	assert.deepEqual(calls, [["PUT", { name: "Comida", color: "#22c55e" }]]);
	settle();
	assert.deepEqual(await first, { status: "saved" });
	assert.equal(lock.current, false);

	// A rejected mutation surfaces the server's message and releases the lock, so it stays retryable.
	const rejecting = settings.createCategoryMutationSubmitter({
		upsertCategory: async () => {
			throw new client.ApiError("color inválido");
		},
		deleteCategory: async () => {
			throw new client.ApiError("Category not found");
		},
		lock,
	});
	assert.deepEqual(
		await rejecting({ type: "upsert", draft: { name: "Comida", color: "#22c55e" } }),
		{ status: "failed", message: "color inválido" },
	);
	assert.deepEqual(await rejecting({ type: "delete", name: "Casa" }), {
		status: "failed",
		message: "Category not found",
	});
	assert.equal(lock.current, false);

	// A failure that carries no server message still reports a truthful one, and the next attempt
	// on the same submitter can proceed.
	const generic = settings.createCategoryMutationSubmitter({
		upsertCategory: async () => {
			throw new TypeError("boom");
		},
		deleteCategory: async (name) => {
			calls.push(["DELETE", name]);
			return { ok: true };
		},
		lock,
	});
	const genericOutcome = await generic({
		type: "upsert",
		draft: { name: "Comida", color: "#22c55e" },
	});
	assert.equal(genericOutcome.status, "failed");
	assert.equal(typeof genericOutcome.message, "string");
	assert.ok(genericOutcome.message.length > 0);
	assert.deepEqual(await generic({ type: "delete", name: "Casa" }), { status: "deleted" });
	assert.deepEqual(calls.at(-1), ["DELETE", "Casa"]);

	// The catalog refresh keeps a known list instead of erasing it, and reports the failure.
	let catalog = settings.createCategoryCatalogState();
	assert.deepEqual(catalog, { phase: "idle", categories: [], errorMessage: null });
	catalog = settings.reduceCategoryCatalog(catalog, { type: "loaded", categories: [{ name: "Casa" }] });
	assert.equal(catalog.phase, "ready");
	catalog = settings.reduceCategoryCatalog(catalog, { type: "loadStarted" });
	assert.equal(catalog.phase, "loading");
	assert.deepEqual(catalog.categories, [{ name: "Casa" }]);
	catalog = settings.reduceCategoryCatalog(catalog, { type: "loadFailed" });
	assert.equal(catalog.phase, "failed");
	assert.deepEqual(catalog.categories, [{ name: "Casa" }]);
	assert.match(catalog.errorMessage, /última versión conocida/);

	const empty = settings.reduceCategoryCatalog(settings.createCategoryCatalogState(), {
		type: "loadFailed",
	});
	assert.deepEqual(empty.categories, []);
	assert.match(empty.errorMessage, /No se pudieron cargar las categorías/);
});

test("the React category settings dialog renders the catalog controls and the truthful delete confirmation", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, settings, dialog, dialogSource] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/settings/categorySettings.ts"),
		vite.ssrLoadModule("/src/client/components/settings/CategorySettingsDialog.tsx"),
		readFile(
			new URL("../src/client/components/settings/CategorySettingsDialog.tsx", import.meta.url),
			"utf8",
		),
	]);

	const noop = () => {};
	const derivedRows = settings.getCategoryDisplayRows([
		{ name: "Comida", builtin: true },
		{ name: "Casa", color: "#ff8800", builtin: false },
	]);
	// The derivation sorts in Spanish, so the rows are located by provenance instead of by input
	// order.
	const builtin = derivedRows.find((row) => row.builtin);
	const custom = derivedRows.find((row) => !row.builtin);
	assert.ok(builtin);
	assert.ok(custom);
	const renderRow = (row, confirmation = null) =>
		renderer.renderToStaticMarkup(
			React.createElement(dialog.CategorySettingsRow, {
				row,
				confirmation,
				busy: false,
				onRequestDelete: noop,
				onCancelDelete: noop,
				onConfirmDelete: noop,
			}),
		);

	// A builtin is listed and labelled, and offers no delete control at all.
	const builtinMarkup = renderRow(builtin);
	assert.match(builtinMarkup, /Comida/);
	assert.match(builtinMarkup, /Predeterminada/);
	assert.doesNotMatch(builtinMarkup, /Eliminar/);

	const customMarkup = renderRow(custom);
	assert.match(customMarkup, /Casa/);
	assert.match(customMarkup, /Personalizada/);
	assert.match(customMarkup, /Eliminar<\/button>/);
	assert.match(customMarkup, /--category-color:#ff8800/);

	// The confirmation states the real consequence: existing movements keep the category and
	// nothing is reassigned.
	const confirmationMarkup = renderRow(
		custom,
		settings.getCategoryDeleteConfirmation("Casa"),
	);
	assert.match(confirmationMarkup, /¿Eliminar la categoría Casa\?/);
	assert.match(confirmationMarkup, /conservan su categoría/);
	assert.match(confirmationMarkup, /no se reasigna/);
	assert.match(confirmationMarkup, /Eliminar categoría/);
	assert.match(confirmationMarkup, /Cancelar/);

	const submitMutation = async () => ({ status: "saved" });
	const dialogMarkup = renderer.renderToStaticMarkup(
		React.createElement(dialog.CategorySettingsDialog, {
			isOpen: true,
			onClose: noop,
			submitMutation,
		}),
	);
	assert.match(dialogMarkup, /<dialog/);
	assert.match(dialogMarkup, /Configuración/);
	assert.match(dialogMarkup, /Categorías/);
	// React 19 serializes the `maxLength` prop in camelCase; HTML attribute names are
	// case-insensitive, so the parsed DOM attribute is the legacy `maxlength="40"`.
	assert.match(dialogMarkup, /maxlength="40"/i);
	assert.doesNotMatch(dialogMarkup, /maxlength="41"/i);
	assert.match(dialogMarkup, /type="color"/);
	assert.match(dialogMarkup, /Guardar categoría/);
	assert.match(dialogMarkup, /Cerrar/);
	assert.equal(
		renderer.renderToStaticMarkup(
			React.createElement(dialog.CategorySettingsDialog, {
				isOpen: false,
				onClose: noop,
				submitMutation,
			}),
		),
		"",
	);

	// A real modal through the shared helper, and the catalog is only requested while it is open.
	assert.match(dialogSource, /syncNativeModalDialog\(dialogRef\.current, isOpen\)/);
	assert.match(dialogSource, /if \(!isOpen\) return;/);
	assert.match(dialogSource, /getCategories\(controller\.signal\)/);
	// The in-flight phase decision is not re-implemented in the component: the runner asks the
	// tested predicate whether this outcome settles the attempt (behaviour covered above in the
	// dedicated phase test).
	assert.match(dialogSource, /shouldClearCategoryMutationPhase\(outcome\)/);
});

test("the React dashboard owns category management instead of redirecting to the legacy dashboard", async () => {
	const [page, styles] = await Promise.all([
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	// The claim this unit makes false is gone.
	assert.doesNotMatch(page, /La gestión de categorías/);
	// The single settings entry and the unified dialog live in the authenticated header, and the
	// category body reaches the dashboard through the same submitted mutation contract as before.
	assert.match(page, />\s*Configuración\s*<\/button>/);
	assert.equal((page.match(/>\s*Configuración\s*<\/button>/g) ?? []).length, 1);
	assert.match(page, /onClick=\{\(\) => setIsAccountSettingsOpen\(true\)\}/);
	assert.match(
		page,
		/import \{ AccountSettingsDialog \} from "\.\.\/components\/settings\/AccountSettingsDialog";/,
	);
	assert.equal((page.match(/<AccountSettingsDialog/g) ?? []).length, 1);
	assert.match(
		page,
		/<AccountSettingsDialog[\s\S]{0,400}?isOpen=\{isAccountSettingsOpen\}/,
	);
	assert.match(page, /submitCategoryMutation=\{submitCategoryMutation\}/);

	// Demo is protected structurally, not by a guard function: the read-only demo tree never mounts
	// the settings surface or its trigger.
	const demoTree = page.slice(
		page.indexOf("export function DemoDashboardPage"),
		page.indexOf("export interface DashboardLeadViewProps"),
	);
	assert.ok(demoTree.length > 0);
	assert.doesNotMatch(demoTree, /AccountSettingsDialog|isAccountSettingsOpen|Configuración/);

	// Scoped styles under the React prefixes; the legacy `.settings-*` / `.category-*` classes are
	// not imported or copied.
	assert.match(styles, /\.react-settings-dialog \{/);
	assert.match(styles, /\.react-category-list \{/);
	assert.match(styles, /\.react-category-row \{/);
	assert.match(styles, /\.react-category-delete-confirmation \{/);
	assert.doesNotMatch(styles, /\.settings-[a-z]/);
	assert.doesNotMatch(styles, /\.category-form\b/);
});

test("the React category mutation phase is cleared only by an outcome that settled", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const settings = await vite.ssrLoadModule(
		"/src/client/components/settings/categorySettings.ts",
	);

	// `busy` means no request of this attempt left: the lock belongs to an earlier attempt that is
	// still in flight, so this outcome must leave the phase alone. Clearing it there would re-enable
	// the submit and delete controls while that unresolved request still owns the surface.
	assert.equal(settings.shouldClearCategoryMutationPhase({ status: "busy" }), false);

	// Every settled outcome owns the phase and releases it, failure included, so no path can leave
	// the surface locked forever.
	assert.equal(settings.shouldClearCategoryMutationPhase({ status: "saved" }), true);
	assert.equal(settings.shouldClearCategoryMutationPhase({ status: "deleted" }), true);
	assert.equal(
		settings.shouldClearCategoryMutationPhase({ status: "failed", message: "boom" }),
		true,
	);
});

test("the React category catalog derivation protects a row whose builtin flag is absent", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const settings = await vite.ssrLoadModule(
		"/src/client/components/settings/categorySettings.ts",
	);

	// The server stamps the flag on every row it merges today, so an absent flag is unknown
	// provenance, not proof of a custom category. The fail-safe direction for a protection rule is
	// to protect: the row offers no delete control, and its label states the protection instead of
	// claiming a provenance the server never reported.
	assert.deepEqual(settings.getCategoryDisplayRows([{ name: "Casa", color: "#ff8800" }]), [
		{
			name: "Casa",
			color: "#ff8800",
			label: "Protegida",
			builtin: false,
			canDelete: false,
		},
	]);

	// Only an explicit non-builtin flag is deletable, and it keeps the custom label so the label and
	// the control always agree.
	assert.deepEqual(
		settings.getCategoryDisplayRows([{ name: "Casa", color: "#ff8800", builtin: false }]),
		[
			{
				name: "Casa",
				color: "#ff8800",
				label: "Personalizada",
				builtin: false,
				canDelete: true,
			},
		],
	);

	// A non-boolean flag is unknown too, so it cannot sneak a delete control in either.
	const [nonBooleanFlag] = settings.getCategoryDisplayRows([
		{ name: "Casa", color: "#ff8800", builtin: "true" },
	]);
	assert.equal(nonBooleanFlag.canDelete, false);
	assert.equal(nonBooleanFlag.label, "Protegida");
});

test("the React counterparty key mirror matches the server normalization over a fixture set", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const client = await vite.ssrLoadModule(
		"/src/client/components/settings/counterpartyRules.ts",
	);
	const { normalizeCounterpartyKey: serverKey } = await import("../src/movements.js");

	// Every fixture is compared against the real server function, so changing either implementation
	// fails this test instead of leaving a rule that silently never matches a movement.
	const fixtures = [
		"José Pérez",
		"Jose\u0301 Pe\u0301rez",
		"  SÚPER  MERCADO   ÑUÑOA ",
		"   STA ISABEL CASAS   ",
		"sta isabel casas",
		"Pago: tarjeta ***1234, sucursal Ñuñoa!",
		"12345678",
		"\u0301\u0301",
		"",
		"   ",
		"ÁÉÍÓÚÜÑ  áéíóúüñ",
	];
	for (const fixture of fixtures) {
		assert.equal(
			client.normalizeCounterpartyKey(fixture),
			serverKey(fixture),
			`the mirror diverged from the server for ${JSON.stringify(fixture)}`,
		);
	}

	// The pinned values keep the contract visible: accents are stripped, casing is lowered,
	// surrounding and repeated whitespace collapse, and an empty value stays an empty key.
	assert.equal(client.normalizeCounterpartyKey("José Pérez"), "jose perez");
	assert.equal(client.normalizeCounterpartyKey("  SÚPER   mercado  "), "super mercado");
	assert.equal(client.normalizeCounterpartyKey("12345678"), "12345678");
	assert.equal(client.normalizeCounterpartyKey("Pago: tarjeta ***1234!"), "pago: tarjeta ***1234!");
	assert.equal(client.normalizeCounterpartyKey(""), "");
	assert.equal(client.normalizeCounterpartyKey("   "), "");
	assert.equal(client.normalizeCounterpartyKey(undefined), "");

	// The server's own values are pinned to the same literals, so a change on the server side fails
	// this test even if the mirror were changed to track it exactly.
	assert.equal(serverKey("José Pérez"), "jose perez");
	assert.equal(serverKey("  SÚPER   mercado  "), "super mercado");
	assert.equal(serverKey("Pago: tarjeta ***1234!"), "pago: tarjeta ***1234!");
	assert.equal(serverKey(""), "");
});

test("the React counterparty rule module validates a draft before any request and derives truthful states", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const rules = await vite.ssrLoadModule(
		"/src/client/components/settings/counterpartyRules.ts",
	);

	// An untouched draft has no category chosen, so the default submission can never clear a rule.
	assert.deepEqual(rules.createCounterpartyRuleDraft(), { counterparty: "", category: null });

	assert.equal(
		rules.validateCounterpartyRuleDraft({ counterparty: "   ", category: "Comida" }).ok,
		false,
	);
	// Combining marks only: the display name is not blank, but the mirrored key normalizes to nothing,
	// which is the same rule the server enforces with a 400.
	const markOnly = rules.validateCounterpartyRuleDraft({
		counterparty: "\u0301\u0301",
		category: "Comida",
	});
	assert.equal(markOnly.ok, false);
	assert.equal(markOnly.message, rules.COUNTERPARTY_NAME_REQUIRED_MESSAGE);
	// A category that was never chosen is a draft that has not been decided yet, not a clearing.
	const unchosen = rules.validateCounterpartyRuleDraft({ counterparty: "Netflix", category: null });
	assert.equal(unchosen.ok, false);
	assert.equal(unchosen.message, rules.COUNTERPARTY_CATEGORY_REQUIRED_MESSAGE);

	// The payload is the value the server would store: the key is normalized, the display name is only
	// trimmed (the server keeps internal whitespace as written), and the category is trimmed.
	assert.deepEqual(
		rules.validateCounterpartyRuleDraft({
			counterparty: "  José   Pérez ",
			category: " Comida ",
		}),
		{
			ok: true,
			payload: {
				counterpartyKey: "jose perez",
				displayName: "José   Pérez",
				category: "Comida",
			},
		},
	);
	// The documented clearing path is the same payload with an empty category.
	assert.deepEqual(
		rules.validateCounterpartyRuleDraft({
			counterparty: "José Pérez",
			category: rules.NO_CATEGORY_VALUE,
		}),
		{
			ok: true,
			payload: { counterpartyKey: "jose perez", displayName: "José Pérez", category: "" },
		},
	);

	// The display order is the server's (`updated_at DESC, counterparty_key ASC`), a blank display
	// name falls back to the key, a blank category reads as `Sin categoría`, and a row without a usable
	// key is dropped because no control could act on it.
	assert.deepEqual(
		rules.getCounterpartyRuleRows([
			{ counterpartyKey: "jose perez", displayName: "José Pérez", category: "Comida" },
			{ counterpartyKey: "netflix", displayName: "   ", category: "   " },
			{ counterpartyKey: "   ", displayName: "Sin clave", category: "Comida" },
		]),
		[
			{
				key: "jose perez",
				displayName: "José Pérez",
				category: "Comida",
				categoryLabel: "Comida",
			},
			{
				key: "netflix",
				displayName: "netflix",
				category: "",
				categoryLabel: "Sin categoría",
			},
		],
	);
	assert.equal(rules.NO_CATEGORY_LABEL, "Sin categoría");

	// Loading, loaded-and-empty and failed are three different truths, and a failed refresh keeps the
	// last known list instead of erasing it from the screen.
	let list = rules.createCounterpartyRuleListState();
	assert.deepEqual(list, { phase: "idle", rules: [], errorMessage: null });
	const stored = [{ counterpartyKey: "netflix", displayName: "Netflix", category: "Comida" }];
	list = rules.reduceCounterpartyRuleList(list, { type: "loaded", rules: stored });
	assert.equal(list.phase, "ready");
	list = rules.reduceCounterpartyRuleList(list, { type: "loadStarted" });
	assert.equal(list.phase, "loading");
	assert.deepEqual(list.rules, stored);
	list = rules.reduceCounterpartyRuleList(list, { type: "loadFailed" });
	assert.equal(list.phase, "failed");
	assert.deepEqual(list.rules, stored);
	assert.match(list.errorMessage, /última versión conocida/);

	const neverLoaded = rules.reduceCounterpartyRuleList(
		rules.createCounterpartyRuleListState(),
		{ type: "loadFailed" },
	);
	assert.deepEqual(neverLoaded.rules, []);
	assert.match(neverLoaded.errorMessage, /No se pudieron cargar las reglas/);

	// A stored rule and a cleared one are two outcomes, and each one says whether the movements list on
	// screen was refreshed: "saved" is never reported as a refresh that did not happen.
	const savedFresh = rules.getCounterpartyRuleNotice({ status: "saved", reloadFailed: false });
	const savedStale = rules.getCounterpartyRuleNotice({ status: "saved", reloadFailed: true });
	const clearedFresh = rules.getCounterpartyRuleNotice({ status: "cleared", reloadFailed: false });
	const clearedStale = rules.getCounterpartyRuleNotice({ status: "cleared", reloadFailed: true });
	assert.equal(savedFresh.tone, "success");
	assert.match(savedFresh.message, /Regla guardada y lista de movimientos actualizada/);
	assert.equal(savedStale.tone, "warning");
	assert.match(savedStale.message, /no se pudo actualizar/);
	assert.equal(clearedFresh.tone, "success");
	assert.match(clearedFresh.message, /Regla eliminada y lista de movimientos actualizada/);
	assert.equal(clearedStale.tone, "warning");
	assert.match(clearedStale.message, /no se pudo actualizar/);
	assert.equal(
		new Set([
			savedFresh.message,
			savedStale.message,
			clearedFresh.message,
			clearedStale.message,
		]).size,
		4,
	);

	// `busy` settled nothing, so it must leave the in-flight phase to the attempt that owns the lock;
	// every other outcome releases it, failures included.
	assert.equal(rules.shouldClearCounterpartyRuleMutationPhase({ status: "busy" }), false);
	assert.equal(
		rules.shouldClearCounterpartyRuleMutationPhase({ status: "saved", reloadFailed: false }),
		true,
	);
	assert.equal(
		rules.shouldClearCounterpartyRuleMutationPhase({ status: "cleared", reloadFailed: true }),
		true,
	);
	assert.equal(
		rules.shouldClearCounterpartyRuleMutationPhase({ status: "failed", message: "boom" }),
		true,
	);
});

test("the React counterparty rule client sends the exact request and reads both server outcomes", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const client = await vite.ssrLoadModule("/src/client/api/client.ts");
	const calls = [];
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (path, options) => {
		calls.push([path, options]);
		const body = options?.body ? JSON.parse(options.body) : null;
		if (body?.category) {
			return {
				ok: true,
				json: async () => ({
					rule: {
						counterpartyKey: body.counterpartyKey,
						displayName: body.displayName,
						category: body.category,
						createdAt: "2025-01-01 00:00:00",
						updatedAt: "2025-01-01 00:00:00",
					},
				}),
			};
		}
		if (body) return { ok: true, json: async () => ({ ok: true, deleted: true }) };
		return {
			ok: true,
			json: async () => ({
				rules: [{ counterpartyKey: "netflix", displayName: "Netflix", category: "Comida" }],
			}),
		};
	};
	try {
		assert.deepEqual(await client.getCounterpartyRules(), [
			{ counterpartyKey: "netflix", displayName: "Netflix", category: "Comida" },
		]);
		assert.equal(calls[0][0], "/api/counterparty-rules");
		assert.equal(calls[0][1]?.method, undefined);
		assert.equal(calls[0][1]?.credentials, "same-origin");

		const saved = await client.upsertCounterpartyRule({
			counterpartyKey: "netflix",
			displayName: "Netflix",
			category: "Comida",
		});
		assert.equal(saved.outcome, "saved");
		assert.deepEqual(saved.rule, {
			counterpartyKey: "netflix",
			displayName: "Netflix",
			category: "Comida",
			createdAt: "2025-01-01 00:00:00",
			updatedAt: "2025-01-01 00:00:00",
		});
		assert.equal(calls[1][0], "/api/counterparty-rules");
		assert.equal(calls[1][1]?.method, "PUT");
		assert.deepEqual(calls[1][1]?.headers, { "content-type": "application/json" });
		assert.deepEqual(JSON.parse(calls[1][1]?.body), {
			counterpartyKey: "netflix",
			displayName: "Netflix",
			category: "Comida",
		});

		// The documented clearing path. The union has no `rule` on this branch, so a caller cannot read
		// a deleted rule as a stored one.
		assert.deepEqual(
			await client.upsertCounterpartyRule({
				counterpartyKey: "netflix",
				displayName: "Netflix",
				category: "",
			}),
			{ outcome: "cleared" },
		);
		assert.deepEqual(JSON.parse(calls[2][1]?.body), {
			counterpartyKey: "netflix",
			displayName: "Netflix",
			category: "",
		});

		// The dedicated DELETE endpoint deliberately has no client function: the empty-category PUT is
		// the only clearing path this surface uses, so an exported function would be dead code.
		assert.equal(client.deleteCounterpartyRule, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}

	// A rejected mutation must surface the server's own text: `getJson` never reads the `{ error }`
	// body, so these mutations cannot use it.
	const rejections = [
		{ status: 400, error: "counterpartyKey es obligatorio" },
		{ status: 404, error: "Rule not found" },
	];
	globalThis.fetch = async () => {
		const rejection = rejections.shift();
		return {
			ok: false,
			status: rejection.status,
			json: async () => ({ error: rejection.error }),
		};
	};
	try {
		const isApiErrorMessage = (message) => (error) =>
			error instanceof client.ApiError && error.message === message;
		await assert.rejects(
			() =>
				client.upsertCounterpartyRule({
					counterpartyKey: "",
					displayName: "",
					category: "Comida",
				}),
			isApiErrorMessage("counterpartyKey es obligatorio"),
		);
		await assert.rejects(
			() =>
				client.upsertCounterpartyRule({
					counterpartyKey: "netflix",
					displayName: "Netflix",
					category: "",
				}),
			isApiErrorMessage("Rule not found"),
		);
	} finally {
		globalThis.fetch = originalFetch;
	}

	// A 200 that confirms neither outcome is reported as an error instead of being read as a save.
	globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
	try {
		await assert.rejects(
			() =>
				client.upsertCounterpartyRule({
					counterpartyKey: "netflix",
					displayName: "Netflix",
					category: "Comida",
				}),
			(error) => error instanceof client.ApiError,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the React counterparty rule submitter holds a single in-flight mutation and reports the reload truthfully", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const rules = await vite.ssrLoadModule(
		"/src/client/components/settings/counterpartyRules.ts",
	);
	const client = await vite.ssrLoadModule("/src/client/api/client.ts");

	const calls = [];
	const lock = { current: false };
	let reloadCalls = 0;
	let settle = () => {};
	let blocked = true;
	const submit = rules.createCounterpartyRuleSubmitter({
		upsertRule: async (payload) => {
			calls.push(payload);
			// Only the first call is held open, so the same-tick double submission below has a real
			// request in flight while every later call settles immediately.
			if (blocked) {
				blocked = false;
				await new Promise((resolve) => {
					settle = resolve;
				});
			}
			return payload.category
				? { outcome: "saved", rule: { ...payload } }
				: { outcome: "cleared" };
		},
		reload: async () => {
			reloadCalls += 1;
			return true;
		},
		lock,
	});

	// An invalid draft is refused by the submitter itself, so no request can leave and the lock is
	// never taken.
	assert.deepEqual(await submit({ counterparty: "   ", category: "Comida" }), {
		status: "failed",
		message: rules.COUNTERPARTY_NAME_REQUIRED_MESSAGE,
	});
	assert.deepEqual(await submit({ counterparty: "\u0301", category: "Comida" }), {
		status: "failed",
		message: rules.COUNTERPARTY_NAME_REQUIRED_MESSAGE,
	});
	assert.deepEqual(await submit({ counterparty: "Netflix", category: null }), {
		status: "failed",
		message: rules.COUNTERPARTY_CATEGORY_REQUIRED_MESSAGE,
	});
	assert.deepEqual(calls, []);
	assert.equal(reloadCalls, 0);
	assert.equal(lock.current, false);

	// Two submissions in the same tick: the second finds the lock held and sends nothing.
	const first = submit({ counterparty: "  Netflix  ", category: "Comida" });
	const second = submit({ counterparty: "Netflix", category: "Comida" });
	assert.deepEqual(await second, { status: "busy" });
	assert.deepEqual(calls, [
		{ counterpartyKey: "netflix", displayName: "Netflix", category: "Comida" },
	]);
	settle();
	assert.deepEqual(await first, { status: "saved", reloadFailed: false });
	assert.equal(reloadCalls, 1);
	assert.equal(lock.current, false);

	// The clearing path sends an empty category and reports `cleared`, not `saved`, and it reloads the
	// period too: the movements the rule was recategorizing only change when the server loads them.
	assert.deepEqual(await submit({ counterparty: "Netflix", category: rules.NO_CATEGORY_VALUE }), {
		status: "cleared",
		reloadFailed: false,
	});
	assert.deepEqual(calls.at(-1), {
		counterpartyKey: "netflix",
		displayName: "Netflix",
		category: "",
	});
	assert.equal(reloadCalls, 2);
	assert.equal(lock.current, false);

	// A rejected mutation surfaces the server's message, skips the reload, and releases the lock so the
	// next attempt can proceed.
	const rejecting = rules.createCounterpartyRuleSubmitter({
		upsertRule: async () => {
			throw new client.ApiError("counterpartyKey es obligatorio");
		},
		reload: async () => {
			reloadCalls += 1;
			return true;
		},
		lock,
	});
	assert.deepEqual(await rejecting({ counterparty: "Netflix", category: "Comida" }), {
		status: "failed",
		message: "counterpartyKey es obligatorio",
	});
	assert.equal(reloadCalls, 2);
	assert.equal(lock.current, false);

	// A rejection with no server message still reports a truthful one.
	const generic = rules.createCounterpartyRuleSubmitter({
		upsertRule: async () => {
			throw new TypeError("boom");
		},
		reload: null,
		lock,
	});
	const genericOutcome = await generic({ counterparty: "Netflix", category: "Comida" });
	assert.equal(genericOutcome.status, "failed");
	assert.equal(typeof genericOutcome.message, "string");
	assert.ok(genericOutcome.message.length > 0);
	assert.equal(lock.current, false);

	// A stored rule whose refresh failed is a stale list, never a failed save; a missing handle and a
	// throwing one are reported the same way, because neither refreshed anything.
	const storedRule = {
		counterpartyKey: "netflix",
		displayName: "Netflix",
		category: "Comida",
	};
	const staleReload = rules.createCounterpartyRuleSubmitter({
		upsertRule: async () => ({ outcome: "saved", rule: storedRule }),
		reload: async () => false,
		lock,
	});
	assert.deepEqual(await staleReload({ counterparty: "Netflix", category: "Comida" }), {
		status: "saved",
		reloadFailed: true,
	});
	assert.equal(lock.current, false);

	const noHandle = rules.createCounterpartyRuleSubmitter({
		upsertRule: async () => ({ outcome: "saved", rule: storedRule }),
		reload: null,
		lock,
	});
	assert.deepEqual(await noHandle({ counterparty: "Netflix", category: "Comida" }), {
		status: "saved",
		reloadFailed: true,
	});
	assert.equal(lock.current, false);

	const throwingReload = rules.createCounterpartyRuleSubmitter({
		upsertRule: async () => ({ outcome: "cleared" }),
		reload: async () => {
			throw new Error("boom");
		},
		lock,
	});
	assert.deepEqual(await throwingReload({ counterparty: "Netflix", category: "" }), {
		status: "cleared",
		reloadFailed: true,
	});
	assert.equal(lock.current, false);
});

test("the React counterparty rules dialog renders the stored rules, the Sin categoría option and truthful states", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, rules, dialog, dialogSource] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/settings/counterpartyRules.ts"),
		vite.ssrLoadModule("/src/client/components/settings/CounterpartyRulesDialog.tsx"),
		readFile(
			new URL(
				"../src/client/components/settings/CounterpartyRulesDialog.tsx",
				import.meta.url,
			),
			"utf8",
		),
	]);

	const noop = () => {};
	const [row] = rules.getCounterpartyRuleRows([
		{ counterpartyKey: "jose perez", displayName: "José Pérez", category: "Comida" },
	]);
	assert.ok(row);

	// A stored rule shows the name the user wrote and the category the server holds, and nothing else:
	// the free-entry form above updates or clears a rule by retyping the counterparty, so the row owns
	// no edit control at all.
	const rowMarkup = renderer.renderToStaticMarkup(
		React.createElement(dialog.CounterpartyRuleRow, { row }),
	);
	assert.match(rowMarkup, /José Pérez/);
	assert.match(rowMarkup, /Comida/);
	assert.match(rowMarkup, /react-counterparty-rule-row/);
	assert.doesNotMatch(rowMarkup, /<button|Editar/);

	const renderList = (state) =>
		renderer.renderToStaticMarkup(
			React.createElement(dialog.CounterpartyRulesList, { state }),
		);

	// Loading, loaded-and-empty, never-loaded and stale are four different statements: an empty list is
	// not "loading", and a failed load is never reported as an empty catalog.
	assert.match(renderList(rules.createCounterpartyRuleListState()), /Cargando reglas de contraparte/);
	const emptyList = renderList(
		rules.reduceCounterpartyRuleList(rules.createCounterpartyRuleListState(), {
			type: "loaded",
			rules: [],
		}),
	);
	assert.match(emptyList, /No hay reglas guardadas todavía/);
	assert.doesNotMatch(emptyList, /Cargando reglas/);
	assert.match(
		renderList(
			rules.reduceCounterpartyRuleList(rules.createCounterpartyRuleListState(), {
				type: "loadFailed",
			}),
		),
		/No se pudieron cargar las reglas de contraparte/,
	);
	const staleList = renderList(
		rules.reduceCounterpartyRuleList(
			rules.reduceCounterpartyRuleList(rules.createCounterpartyRuleListState(), {
				type: "loaded",
				rules: [
					{ counterpartyKey: "netflix", displayName: "Netflix", category: "Comida" },
				],
			}),
			{ type: "loadFailed" },
		),
	);
	assert.match(staleList, /No se pudo actualizar la lista de reglas/);
	// The known list stays on screen instead of disappearing behind the failure.
	assert.match(staleList, /Netflix/);

	const submitMutation = async () => ({ status: "saved", reloadFailed: false });
	const dialogMarkup = renderer.renderToStaticMarkup(
		React.createElement(dialog.CounterpartyRulesDialog, {
			isOpen: true,
			onClose: noop,
			submitMutation,
		}),
	);
	assert.match(dialogMarkup, /<dialog/);
	assert.match(dialogMarkup, /Reglas de contraparte/);
	assert.match(dialogMarkup, /Contraparte/);
	assert.match(dialogMarkup, />Sin categoría<\/option>/);
	assert.match(dialogMarkup, /Guardar regla/);
	assert.match(dialogMarkup, /Cerrar/);
	// The form is the only mutation surface: no per-rule edit control exists anywhere in the dialog.
	assert.doesNotMatch(dialogMarkup, /Editar/);
	assert.match(dialogMarkup, /react-settings-dialog/);
	assert.match(dialogMarkup, /react-counterparty-dialog/);
	assert.equal(
		renderer.renderToStaticMarkup(
			React.createElement(dialog.CounterpartyRulesDialog, {
				isOpen: false,
				onClose: noop,
				submitMutation,
			}),
		),
		"",
	);

	// A real modal through the shared helper, both loads only while open, and the in-flight phase
	// decision delegated to the tested predicate instead of re-implemented here.
	assert.match(dialogSource, /syncNativeModalDialog\(dialogRef\.current, isOpen\)/);
	assert.match(dialogSource, /if \(!isOpen\) return;/);
	assert.match(dialogSource, /getCounterpartyRules\(controller\.signal\)/);
	assert.match(dialogSource, /getCategories\(controller\.signal\)/);
	assert.match(dialogSource, /shouldClearCounterpartyRuleMutationPhase\(outcome\)/);
	// Choosing Sin categoría is the clearing path: the select value is the empty category the server
	// deletes on, so no second control with the same outcome exists.
	assert.match(dialogSource, /<option value=\{NO_CATEGORY_VALUE\}>\{NO_CATEGORY_LABEL\}<\/option>/);
});

test("the React counterparty rules cannot send the category placeholder as a category", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, rules, dialog] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/settings/counterpartyRules.ts"),
		vite.ssrLoadModule("/src/client/components/settings/CounterpartyRulesDialog.tsx"),
	]);

	// The placeholder is a rendering device, never a category. A draft carrying it is refused with the
	// same message as an unchosen category, so the sentinel literal can never leave as a payload.
	const placeholder = rules.validateCounterpartyRuleDraft({
		counterparty: "Netflix",
		category: rules.UNCHOSEN_CATEGORY_VALUE,
	});
	assert.equal(placeholder.ok, false);
	assert.equal(placeholder.message, rules.COUNTERPARTY_CATEGORY_REQUIRED_MESSAGE);

	// The sentinel must not be a name the server could ever store, and the proof is the server's own
	// rule rather than a remembered length. Every stored category name goes through
	// `normalizeCategoryName` (`src/server.js:773-778`) — trim, collapse whitespace, slice to 40 — so
	// every name the catalog can contain is a fixed point of that rule. A value the rule changes
	// cannot be produced by the server, which is why the sentinel is chosen outside that name space;
	// if it is ever shortened back into it, it becomes a fixed point and this assertion fails.
	const serverNormalizeCategoryName = (value) =>
		String(value ?? "")
			.trim()
			.replace(/\s+/g, " ")
			.slice(0, 40);
	assert.notEqual(
		serverNormalizeCategoryName(rules.UNCHOSEN_CATEGORY_VALUE),
		rules.UNCHOSEN_CATEGORY_VALUE,
		"the sentinel must not be a fixed point of the server's category-name rule",
	);
	// A genuine category name is a fixed point, which is what makes the assertion above a statement
	// about the server's name space instead of about any arbitrary string.
	assert.equal(serverNormalizeCategoryName("Comida"), "Comida");

	// The request boundary: the submitter is what turns a draft into a PUT body, so refusing the
	// placeholder here is the proof that the literal cannot reach the wire even if a caller tries.
	const bodies = [];
	const submit = rules.createCounterpartyRuleSubmitter({
		upsertRule: async (payload) => {
			bodies.push(payload);
			return { outcome: "saved", rule: { ...payload } };
		},
		reload: async () => true,
		lock: { current: false },
	});
	assert.deepEqual(
		await submit({ counterparty: "Netflix", category: rules.UNCHOSEN_CATEGORY_VALUE }),
		{ status: "failed", message: rules.COUNTERPARTY_CATEGORY_REQUIRED_MESSAGE },
	);
	assert.deepEqual(bodies, []);

	// The select cannot offer it as a choice either: a disabled option is unreachable from the UI, so
	// the only route left to the sentinel is a future caller, which validation above still refuses.
	const dialogMarkup = renderer.renderToStaticMarkup(
		React.createElement(dialog.CounterpartyRulesDialog, {
			isOpen: true,
			onClose: () => {},
			submitMutation: async () => ({ status: "saved", reloadFailed: false }),
		}),
	);
	const placeholderOption = dialogMarkup.match(
		new RegExp(`<option[^>]*value="${rules.UNCHOSEN_CATEGORY_VALUE}"[^>]*>`),
	);
	assert.ok(placeholderOption, "the placeholder option is still rendered");
	assert.match(placeholderOption[0], /disabled/);
});

test("the React dashboard exposes counterparty rules only in the authenticated tree", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, dialog, page, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/settings/CounterpartyRulesDialog.tsx"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	// The single settings entry opens the unified surface, which embeds the counterparty body while
	// the dashboard keeps wiring its submitter and reload. This stays a source assertion on purpose:
	// rendering the authenticated page needs a live session and effect-driven loads, so a static
	// render cannot show that wiring, while the demo side below is rendered for real.
	assert.match(page, />\s*Configuración\s*<\/button>/);
	assert.doesNotMatch(page, />\s*Reglas de contraparte\s*<\/button>/);
	assert.match(
		page,
		/import \{ AccountSettingsDialog \} from "\.\.\/components\/settings\/AccountSettingsDialog";/,
	);
	assert.equal((page.match(/<AccountSettingsDialog/g) ?? []).length, 1);
	assert.match(
		page,
		/<AccountSettingsDialog[\s\S]{0,900}?submitCounterpartyRule=\{submitCounterpartyRule\}/,
	);

	// The reload is the handle the financial summary publishes, and a handle that does not exist yet is
	// passed as `null`, which the submitter reports as "could not refresh" instead of as a refresh.
	assert.match(page, /import \{ createCounterpartyRuleSubmitter \} from "\.\.\/components\/settings\/counterpartyRules";/);
	assert.match(
		page,
		/createCounterpartyRuleSubmitter\(\{[\s\S]{0,300}?reload: financialDashboard\?\.reload \?\? null/,
	);
	assert.match(page, /counterpartyRulesLock/);

	// Demo protection is behavioural: the read-only demo composition is rendered with the real trigger
	// and dialog modules already loaded, and its markup carries no counterparty-rules trigger, dialog
	// or mutation surface at all. Asserting the render is what makes this a statement about the tree
	// the demo route actually mounts, not about a slice of source text.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period: { startDate: "2025-02-01", endDateExclusive: "2025-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2025-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	// A positive marker first, so the absences below cannot pass on an empty render.
	assert.match(demoMarkup, /Solo lectura/);
	assert.match(demoMarkup, /Mercado/);
	// Rendered markup only carries text and attributes, so this pattern stays on the visible label. The
	// two identifier alternatives that used to sit here (`isCounterpartyRulesOpen`,
	// `CounterpartyRulesDialog`) are JavaScript names that cannot appear in
	// `renderToStaticMarkup` output, so that half of the assertion could never fail. Their wiring is
	// asserted on the authenticated source above, where the identifiers are actually observable.
	assert.doesNotMatch(demoMarkup, /Reglas de contraparte/);
	assert.doesNotMatch(demoMarkup, /<dialog|<form|<select|<input/);
	// The demo now mounts the read-only analytics selection controls, so the read-only guarantee is
	// stated on the buttons themselves: every button is an explicit `type="button"`, and no submit or
	// mutation control appears.
	assert.equal(
		(demoMarkup.match(/<button/g) ?? []).length,
		(demoMarkup.match(/<button type="button"/g) ?? []).length,
	);
	assert.doesNotMatch(demoMarkup, /type="submit"|Nuevo gasto|Cambiar período|Cerrar período/);

	// Sensitivity control: every absence pattern certified above must match the same surface when it is
	// actually mounted, so each demo assertion observes a real absence instead of a pattern that could
	// never match. Removing the select or the input from the dialog would fail its pattern below.
	const mountedSurface = renderer.renderToStaticMarkup(
		React.createElement(dialog.CounterpartyRulesDialog, {
			isOpen: true,
			onClose: () => {},
			submitMutation: async () => ({ status: "saved", reloadFailed: false }),
		}),
	);
	assert.match(mountedSurface, /Reglas de contraparte/);
	assert.match(mountedSurface, /<dialog/);
	assert.match(mountedSurface, /<form/);
	assert.match(mountedSurface, /<select/);
	assert.match(mountedSurface, /<input/);
	assert.match(mountedSurface, /<button/);

	// Scoped styles under the `react-` prefix, on the global primitives. CSS has no behavioural
	// alternative: nothing renders a stylesheet here, so this stays a source assertion.
	assert.match(styles, /\.react-counterparty-dialog \{/);
	assert.match(styles, /\.react-counterparty-list \{/);
	assert.match(styles, /\.react-counterparty-rule-row \{/);
	assert.match(styles, /\.react-counterparty-form(?:,|\s*\{)/);
	assert.match(styles, /\.react-counterparty-status-success \{/);
	assert.match(styles, /\.react-counterparty-status-warning \{/);
});

test("the React financial-cycle edit module derives the draft, validates it and states the closure consequence", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const settings = await vite.ssrLoadModule(
		"/src/client/components/financial-cycle/cycleSettings.ts",
	);

	const configured = {
		selectedPeriod: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
		incomeAmount: 900000,
		completedAt: null,
	};

	// The draft shows what the two date inputs and the income field need: the inclusive end date the
	// server stores exclusively, and the income as the field itself renders an amount.
	assert.deepEqual(settings.createCycleEditDraft(configured), {
		startDate: "2026-02-01",
		endDate: "2026-02-28",
		incomeValue: "900.000",
	});
	// No configured income is an empty field, never a zero the user would then save by accident, and a
	// cycle without a period derives to the immutable empty draft.
	assert.deepEqual(settings.createCycleEditDraft({ ...configured, incomeAmount: null }), {
		startDate: "2026-02-01",
		endDate: "2026-02-28",
		incomeValue: "",
	});
	assert.deepEqual(
		settings.createCycleEditDraft({
			selectedPeriod: null,
			incomeAmount: null,
			completedAt: null,
		}),
		settings.EMPTY_CYCLE_EDIT_DRAFT,
	);

	// The four messages are the legacy wizard's own copy, in its own order.
	const { validateCycleEditDraft: validate } = settings;
	assert.deepEqual(validate({ startDate: "", endDate: "2026-02-28", incomeValue: "" }), {
		ok: false,
		message: settings.CYCLE_START_REQUIRED_MESSAGE,
	});
	assert.deepEqual(validate({ startDate: "2026-02-01", endDate: "", incomeValue: "" }), {
		ok: false,
		message: settings.CYCLE_END_REQUIRED_MESSAGE,
	});
	assert.deepEqual(
		validate({ startDate: "2026-03-01", endDate: "2026-02-28", incomeValue: "" }),
		{ ok: false, message: settings.CYCLE_END_BEFORE_START_MESSAGE },
	);
	assert.deepEqual(validate({ startDate: "2026-02-01", endDate: "2026-02-28", incomeValue: "0" }), {
		ok: false,
		message: settings.CYCLE_INCOME_INVALID_MESSAGE,
	});
	for (const incomeValue of ["-5", "1000.50", "abc", "9007199254740992"]) {
		assert.deepEqual(validate({ startDate: "2026-02-01", endDate: "2026-02-28", incomeValue }), {
			ok: false,
			message: settings.CYCLE_INCOME_INVALID_MESSAGE,
		});
	}
	// The date range is validated before the income, exactly like the legacy wizard, so a draft that
	// fails both reports the reason the user has to fix first.
	assert.deepEqual(
		validate({ startDate: "2026-03-01", endDate: "2026-02-01", incomeValue: "abc" }),
		{ ok: false, message: settings.CYCLE_END_BEFORE_START_MESSAGE },
	);

	// The payload is the exact `{selectedPeriod, incomeAmount}` shape `validateFinancialCycle`
	// accepts (`src/server.js:476-498`): the inclusive end date becomes the exclusive boundary through
	// the same shared helper the setup form uses, a single-day range is one day long, an empty field is
	// `null`, and the field's own thousands separator is accepted so reopening and saving unchanged
	// income cannot fail.
	assert.deepEqual(validate({ startDate: "2026-02-01", endDate: "2026-02-28", incomeValue: "" }), {
		ok: true,
		payload: {
			selectedPeriod: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
			incomeAmount: null,
		},
	});
	assert.deepEqual(
		validate({ startDate: "2026-02-10", endDate: "2026-02-10", incomeValue: "900.000" }),
		{
			ok: true,
			payload: {
				selectedPeriod: { startDate: "2026-02-10", endDateExclusive: "2026-02-11" },
				incomeAmount: 900000,
			},
		},
	);
	// Surrounding whitespace is not a validation failure, and the field's own rendering of an amount is
	// what a reopened form hands back untouched.
	assert.deepEqual(
		validate({ startDate: " 2026-02-01 ", endDate: " 2026-02-28 ", incomeValue: " 900.000 " }),
		{
			ok: true,
			payload: {
				selectedPeriod: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
				incomeAmount: 900000,
			},
		},
	);

	// A `completedAt` is a UTC instant (`new Date().toISOString()`, `src/server.js:452`), so the date
	// the user sees is a local calendar date. This fixture is deliberately around midnight: the UTC
	// calendar date is a day later than the date in the viewer's zone, so a first-ten-characters slice
	// and a local rendering cannot both be right, and the assertion below pins which one this is.
	const completedAt = "2026-02-14T02:30:00.000Z";
	assert.equal(completedAt.slice(0, 10), "2026-02-14");
	assert.equal(settings.getCycleClosureDate(completedAt, "America/Santiago"), "13 de febrero de 2026");
	// The same instant reads as a different day in another zone, which is what makes this a rendering
	// of the instant in a zone instead of a substring of the timestamp.
	assert.equal(settings.getCycleClosureDate(completedAt, "Asia/Tokyo"), "14 de febrero de 2026");
	// The zone is an explicit seam for the suite; production passes nothing. The expectation below is
	// rebuilt from the resolved zone with `Intl` directly instead of calling the same function a second
	// time through its own `timeZone` parameter, so it does not pass just because the two code paths
	// agree. It proves the default is the viewer's resolved zone rather than a hard-coded one, and only
	// when the runner's zone is not UTC: on a UTC runner a hard-coded UTC default would agree trivially,
	// which is why this pins the resolved-zone default and not "the default is not UTC".
	const resolvedZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	assert.equal(
		settings.getCycleClosureDate(completedAt),
		new Intl.DateTimeFormat("es-CL", {
			timeZone: resolvedZone,
			year: "numeric",
			month: "long",
			day: "numeric",
		}).format(Date.parse(completedAt)),
	);
	assert.equal(settings.getCycleClosureDate(null, "America/Santiago"), null);
	assert.equal(settings.getCycleClosureDate("not-a-timestamp", "America/Santiago"), null);

	// The mark is informational and says so: nothing on the server blocks an edit, a manual movement or
	// a re-synchronization because a period was completed (`src/server.js:403-407`), so a mark that
	// read as a lock would be false.
	const mark = settings.getCycleClosureMark(completedAt, "America/Santiago");
	assert.match(mark, /^Cierre registrado el 13 de febrero de 2026\./);
	assert.match(mark, /sigue siendo editable/);
	assert.equal(settings.getCycleClosureMark(null, "America/Santiago"), null);
	// An unreadable timestamp loses the date, never the fact that a closure was recorded.
	assert.match(
		settings.getCycleClosureMark("not-a-timestamp", "America/Santiago"),
		/^Cierre registrado\. Es un registro informativo/,
	);

	// The completion consequence, derived from the server's real behavior: `upsertFinancialCycleSettings`
	// keeps `completed_at` for the same range through `COALESCE` and inserts a new row with
	// `completed_at = NULL` for a different one (`src/db.js:176-181`, `:198`).
	const closed = { ...configured, completedAt };
	const unchanged = settings.getCycleClosureNotice(
		closed,
		{ startDate: "2026-02-01", endDate: "2026-02-28", incomeValue: "900.000" },
		"America/Santiago",
	);
	assert.equal(unchanged.rangeChanged, false);
	assert.match(unchanged.closedMessage, /cierre registrado el 13 de febrero de 2026/);
	assert.match(unchanged.consequenceMessage, /se conserva/);

	const moved = settings.getCycleClosureNotice(
		closed,
		{ startDate: "2026-01-01", endDate: "2026-02-28", incomeValue: "900.000" },
		"America/Santiago",
	);
	assert.equal(moved.rangeChanged, true);
	// The copy has to stay true for a range that was never closed and for one that already carries a
	// record: `financial_periods` is keyed by range (`src/db.js:176-181`) and the upsert keeps the record
	// of the range it lands on (`completed_at = COALESCE(excluded.completed_at,
	// financial_periods.completed_at)`, `src/db.js:198`). Only the current closure is guaranteed to stay
	// behind, so claiming the new period has no record is false when the user moves back onto a range
	// that was completed before.
	assert.equal(
		moved.consequenceMessage,
		"Al guardar, el rango cambia: el cierre registrado no se traslada al nuevo periodo. El nuevo rango mantiene el registro de cierre que ya tuviera, si existe.",
	);
	assert.doesNotMatch(moved.consequenceMessage, /sin registro de cierre/);

	// A draft that cannot be submitted performs no write, so it has no consequence to announce: the
	// range statement is derived from a submittable draft only. An incomplete date is the clearest such
	// draft, and the fact it still states is the one the draft cannot change.
	const incomplete = settings.getCycleClosureNotice(
		closed,
		{ startDate: "", endDate: "2026-02-28", incomeValue: "" },
		"America/Santiago",
	);
	assert.equal(incomplete.rangeChanged, false);
	assert.equal(incomplete.consequenceMessage, null);
	assert.match(incomplete.closedMessage, /cierre registrado/);

	// Submittable means what `validateCycleEditDraft` accepts, not merely a comparable range: an
	// invalid income blocks the save just as an incomplete date does, so it announces no consequence
	// either — while a submittable draft that keeps the range still states preservation.
	const invalidIncome = settings.getCycleClosureNotice(
		closed,
		{ startDate: "2026-01-01", endDate: "2026-02-28", incomeValue: "abc" },
		"America/Santiago",
	);
	assert.equal(invalidIncome.rangeChanged, false);
	assert.equal(invalidIncome.consequenceMessage, null);
	assert.match(invalidIncome.closedMessage, /cierre registrado/);

	// No closure record means no statement at all, even when the range moves.
	const openCycle = settings.getCycleClosureNotice(
		configured,
		{ startDate: "2026-01-01", endDate: "2026-02-28", incomeValue: "" },
		"America/Santiago",
	);
	assert.equal(openCycle.closedMessage, null);
	assert.equal(openCycle.consequenceMessage, null);
	assert.equal(
		settings.getCycleClosureNotice(
			{ selectedPeriod: null, incomeAmount: null, completedAt: null },
			{ startDate: "2026-01-01", endDate: "2026-02-28", incomeValue: "" },
			"America/Santiago",
		).closedMessage,
		null,
	);
});

test("the React financial-cycle edit submitter sends the exact PUT body, holds one in-flight mutation and reports the reload separately", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [settings, client] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/financial-cycle/cycleSettings.ts"),
		vite.ssrLoadModule("/src/client/api/client.ts"),
	]);

	const moved = { startDate: "2026-01-01", endDate: "2026-01-31", incomeValue: "" };
	const calls = [];
	let reloadCalls = 0;
	let settle = () => {};
	let blocked = true;
	const lock = { current: false };
	const submit = settings.createCycleEditSubmitter({
		updateCycle: async (payload) => {
			calls.push(payload);
			// Only the first call is held open, so the same-tick double submission below has a real
			// request in flight while every later call settles immediately.
			if (blocked) {
				blocked = false;
				await new Promise((resolve) => {
					settle = resolve;
				});
			}
			return {
				selectedPeriod: payload.selectedPeriod,
				incomeAmount: payload.incomeAmount,
				completedAt: null,
			};
		},
		reload: async () => {
			reloadCalls += 1;
			return true;
		},
		lock,
	});

	// An invalid draft is refused by the submitter itself, so no request can leave, the reload is not
	// attempted, and the lock is never taken.
	assert.deepEqual(await submit({ startDate: "", endDate: "", incomeValue: "" }), {
		status: "failed",
		message: settings.CYCLE_START_REQUIRED_MESSAGE,
	});
	assert.deepEqual(await submit({ startDate: "2026-01-01", endDate: "2026-01-31", incomeValue: "x" }), {
		status: "failed",
		message: settings.CYCLE_INCOME_INVALID_MESSAGE,
	});
	assert.deepEqual(calls, []);
	assert.equal(reloadCalls, 0);
	assert.equal(lock.current, false);

	// Two submissions in the same tick: the second finds the lock held and sends nothing.
	const first = submit(moved);
	const second = submit(moved);
	assert.deepEqual(await second, { status: "busy" });
	assert.deepEqual(calls, [
		{
			selectedPeriod: { startDate: "2026-01-01", endDateExclusive: "2026-02-01" },
			incomeAmount: null,
		},
	]);
	settle();
	assert.deepEqual(await first, { status: "saved", reloadFailed: false });
	assert.equal(reloadCalls, 1);
	assert.equal(lock.current, false);

	// The request boundary against the real client function: the method, path and body the server
	// validates, with an empty income becoming `null` instead of `0` or `""`.
	const bodies = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (path, options) => {
		bodies.push([path, options]);
		return {
			ok: true,
			json: async () => ({
				selectedPeriod: { startDate: "2026-04-01", endDateExclusive: "2026-05-01" },
				incomeAmount: 900000,
				completedAt: null,
			}),
		};
	};
	try {
		const live = settings.createCycleEditSubmitter({
			updateCycle: client.updateFinancialCycle,
			reload: async () => true,
			lock: { current: false },
		});
		assert.deepEqual(await live({ startDate: "2026-04-01", endDate: "2026-04-30", incomeValue: "" }), {
			status: "saved",
			reloadFailed: false,
		});
		assert.equal(bodies.length, 1);
		assert.equal(bodies[0][0], "/api/financial-cycle");
		assert.equal(bodies[0][1]?.method, "PUT");
		assert.deepEqual(JSON.parse(bodies[0][1]?.body), {
			selectedPeriod: { startDate: "2026-04-01", endDateExclusive: "2026-05-01" },
			incomeAmount: null,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}

	// A rejected save surfaces the server's status truthfully, skips the reload, and releases the lock
	// so the attempt stays retryable.
	const reloadsBefore = reloadCalls;
	const rejected = settings.createCycleEditSubmitter({
		updateCycle: async () => {
			throw new client.ApiError("Request to /api/financial-cycle failed (400)");
		},
		reload: async () => {
			reloadCalls += 1;
			return true;
		},
		lock,
	});
	assert.deepEqual(await rejected(moved), {
		status: "failed",
		message: "Request to /api/financial-cycle failed (400)",
	});
	assert.equal(reloadCalls, reloadsBefore);
	assert.equal(lock.current, false);

	// A rejection with no server message still reports a truthful one instead of an internal string.
	const generic = settings.createCycleEditSubmitter({
		updateCycle: async () => {
			throw new TypeError("boom");
		},
		reload: null,
		lock,
	});
	const genericOutcome = await generic(moved);
	assert.equal(genericOutcome.status, "failed");
	assert.ok(genericOutcome.message.length > 0);
	assert.equal(lock.current, false);

	// A stored period whose refresh failed is stale data, never a failed save; a missing handle and a
	// throwing one report the same thing, because neither refreshed anything.
	const response = {
		selectedPeriod: { startDate: "2026-01-01", endDateExclusive: "2026-02-01" },
		incomeAmount: null,
		completedAt: null,
	};
	const staleReload = settings.createCycleEditSubmitter({
		updateCycle: async () => response,
		reload: async () => false,
		lock,
	});
	assert.deepEqual(await staleReload(moved), { status: "saved", reloadFailed: true });
	assert.equal(lock.current, false);
	const noHandle = settings.createCycleEditSubmitter({
		updateCycle: async () => response,
		reload: null,
		lock,
	});
	assert.deepEqual(await noHandle(moved), { status: "saved", reloadFailed: true });
	assert.equal(lock.current, false);
	const throwingReload = settings.createCycleEditSubmitter({
		updateCycle: async () => response,
		reload: async () => {
			throw new Error("boom");
		},
		lock,
	});
	assert.deepEqual(await throwingReload(moved), { status: "saved", reloadFailed: true });
	assert.equal(lock.current, false);

	// The save and the refresh are two statements: a saved period with a failed refresh is a warning
	// that names the stale data, and only a real refresh claims the summary was updated.
	assert.match(settings.getCycleEditNotice({ status: "saved", reloadFailed: false }).message, /resumen actualizado/);
	assert.equal(settings.getCycleEditNotice({ status: "saved", reloadFailed: true }).tone, "warning");
	assert.match(
		settings.getCycleEditNotice({ status: "saved", reloadFailed: true }).message,
		/puede estar desactualizado/,
	);

	// `busy` settled nothing, so the phase it reports must stay: every other outcome owns the attempt.
	assert.equal(settings.shouldClearCycleEditPhase({ status: "busy" }), false);
	assert.equal(settings.shouldClearCycleEditPhase({ status: "saved", reloadFailed: false }), true);
	assert.equal(settings.shouldClearCycleEditPhase({ status: "failed", message: "boom" }), true);
	assert.equal(
		settings.shouldClearCycleEditPhase({
			status: "failed",
			message: settings.getCycleEditFailureMessage(new TypeError("boom")),
		}),
		true,
	);
});

test("the React financial-cycle edit dialog renders the prefilled fields and states the closure consequence before saving", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, settings, dialog, dialogSource] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/financial-cycle/cycleSettings.ts"),
		vite.ssrLoadModule(
			"/src/client/components/financial-cycle/FinancialCycleEditDialog.tsx",
		),
		readFile(
			new URL(
				"../src/client/components/financial-cycle/FinancialCycleEditDialog.tsx",
				import.meta.url,
			),
			"utf8",
		),
	]);

	const noop = () => {};
	const configured = {
		selectedPeriod: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
		incomeAmount: 900000,
		completedAt: null,
	};
	const configuredDraft = settings.createCycleEditDraft(configured);

	const dialogMarkup = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleEditDialog, {
			isOpen: true,
			cycle: configured,
			onClose: noop,
			submitCycle: async () => ({ status: "saved", reloadFailed: false }),
			onSaved: noop,
		}),
	);

	// A real dialog, the same three fields as the setup form (including the inclusive end date and the
	// income as the field renders it), and the exact labels this unit specifies.
	assert.match(dialogMarkup, /<dialog/);
	assert.match(dialogMarkup, /Cambiar período/);
	assert.match(dialogMarkup, /Fecha de inicio/);
	assert.match(dialogMarkup, /Fecha de término \(inclusive\)/);
	assert.match(dialogMarkup, /Ingreso mensual \(opcional\)/);
	assert.equal((dialogMarkup.match(/type="date"/g) ?? []).length, 2);
	assert.match(dialogMarkup, /value="2026-02-01"/);
	assert.match(dialogMarkup, /value="2026-02-28"/);
	assert.match(dialogMarkup, /value="900\.000"/);
	assert.match(dialogMarkup, /id="financial-cycle-start-date"/);
	assert.match(dialogMarkup, /id="financial-cycle-end-date"/);
	assert.match(dialogMarkup, /id="financial-cycle-income"/);
	assert.match(dialogMarkup, /Guardar cambios<\/button>/);
	assert.match(dialogMarkup, /Cancelar<\/button>/);
	assert.match(dialogMarkup, /react-financial-cycle-dialog/);
	// Nothing in the rendered dialog claims an outcome before or instead of saving one: the success
	// wording is the summary's notice, reached only through a settled save.
	assert.doesNotMatch(dialogMarkup, /guardad|actualizad/i);

	// An open period has no completion consequence to state, and a closed one states it before the save
	// through the same detail the summary's mark uses.
	const noNote = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleClosureNote, {
			cycle: configured,
			draft: configuredDraft,
		}),
	);
	assert.equal(noNote, "");

	const closedCycle = { ...configured, completedAt: "2026-02-14T02:30:00.000Z" };
	const expectedDate = settings.getCycleClosureDate(closedCycle.completedAt);
	assert.ok(expectedDate);
	const unchangedNote = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleClosureNote, {
			cycle: closedCycle,
			draft: configuredDraft,
		}),
	);
	assert.match(unchangedNote, /Este periodo tiene un cierre registrado/);
	assert.match(unchangedNote, new RegExp(expectedDate));
	assert.match(unchangedNote, /se conserva/);
	assert.doesNotMatch(unchangedNote, /no se traslada/);

	const movedNote = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleClosureNote, {
			cycle: closedCycle,
			draft: { ...configuredDraft, startDate: "2026-01-01" },
		}),
	);
	assert.match(movedNote, /no se traslada/);
	assert.match(movedNote, /mantiene el registro de cierre que ya tuviera/);
	assert.doesNotMatch(movedNote, /sin registro de cierre/);
	assert.doesNotMatch(movedNote, /se conserva/);

	// A draft that cannot be saved states no consequence: the note keeps the fact and drops the claim
	// that a save will never make true.
	const incompleteNote = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleClosureNote, {
			cycle: closedCycle,
			draft: { ...configuredDraft, startDate: "" },
		}),
	);
	assert.match(incompleteNote, /Este periodo tiene un cierre registrado/);
	assert.doesNotMatch(incompleteNote, /no se traslada/);
	assert.doesNotMatch(incompleteNote, /se conserva/);

	// The same consequence is part of the real dialog when the configured period is closed.
	const closedDialogMarkup = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleEditDialog, {
			isOpen: true,
			cycle: closedCycle,
			onClose: noop,
			submitCycle: async () => ({ status: "saved", reloadFailed: false }),
			onSaved: noop,
		}),
	);
	assert.match(closedDialogMarkup, /cierre registrado/);
	assert.match(closedDialogMarkup, /se conserva/);

	// Closed means unmounted, exactly like the shipped dialogs, and a missing cycle never renders a form
	// over nothing.
	assert.equal(
		renderer.renderToStaticMarkup(
			React.createElement(dialog.FinancialCycleEditDialog, {
				isOpen: false,
				cycle: configured,
				onClose: noop,
				submitCycle: async () => ({ status: "saved", reloadFailed: false }),
				onSaved: noop,
			}),
		),
		"",
	);
	assert.equal(
		renderer.renderToStaticMarkup(
			React.createElement(dialog.FinancialCycleEditDialog, {
				isOpen: true,
				cycle: null,
				onClose: noop,
				submitCycle: async () => ({ status: "saved", reloadFailed: false }),
				onSaved: noop,
			}),
		),
		"",
	);

	// The decisions are not re-implemented in the component: it opens the native modal through the
	// shared helper, asks the tested predicate whether an outcome settled the attempt, and refuses to
	// close a write that is already on its way.
	assert.match(dialogSource, /syncNativeModalDialog\(dialogRef\.current, isOpen\)/);
	assert.match(dialogSource, /shouldClearCycleEditPhase\(outcome\)/);
	assert.match(dialogSource, /if \(isSaving\) event\.preventDefault\(\)/);
	assert.match(dialogSource, /validateCycleEditDraft\(draft\)/);
});

test("the React financial summary exposes one period edit trigger and reloads through the dashboard handle", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, dialog, page, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule(
			"/src/client/components/financial-cycle/FinancialCycleEditDialog.tsx",
		),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	// The summary publishes one configured-period edit trigger to the dashboard header. The removed
	// heading and closure action must not leave a duplicate control or stale wiring behind.
	assert.match(
		page,
		/import \{ FinancialCycleEditDialog \} from "\.\.\/components\/financial-cycle\/FinancialCycleEditDialog";/,
	);
	assert.match(page, /from "\.\.\/components\/financial-cycle\/cycleSettings";/);
	assert.match(page, /createCycleEditSubmitter,/);
	assert.equal((page.match(/className="react-dashboard-period"/g) ?? []).length, 1);
	assert.match(
		page,
		/<button\s+className="react-dashboard-period"\s+type="button"\s+onClick=\{financialDashboard\.onEditPeriod\}/,
	);
	assert.match(page, /onEditPeriod: openCycleEdit/);
	assert.match(page, /aria-label=\{`Editar periodo: \$\{formatPeriodLabel\(financialDashboard\.period\)\}`\}/);
	assert.match(page, /<section className="react-financial-summary" aria-label="Resumen financiero del periodo">/);
	assert.doesNotMatch(page, /react-financial-summary-title|aria-labelledby="react-financial-summary-title"/);
	assert.doesNotMatch(page, /FinancialPeriodHeading|CompleteCycleDialog|onCompletePeriod|openCycleCompletion/);
	assert.doesNotMatch(page, /Cerrar período|react-financial-cycle-closure|Cierre registrado/);
	// The header capsule is a real button that opens the configured-period dialog through the
	// summary-owned trigger, so the visible range is interactive instead of decorative while the
	// summary body keeps the full editable control.
	assert.match(
		page,
		/<button\s+className="react-dashboard-period"\s+type="button"\s+onClick=\{financialDashboard\.onEditPeriod\}/,
	);
	assert.match(
		page,
		/react-dashboard-controls[\s\S]{0,900}?react-dashboard-period-range[\s\S]{0,300}?formatPeriodLabel\(financialDashboard\.period\)/,
	);
	// The header refresh uses a guarded progress handler that delegates to the cycle-first reload,
	// not the route/session retry, and names its state for assistive tech.
	assert.match(page, /const refreshFromHeader = async \(\) => \{[\s\S]{0,250}?await financialDashboard\.reload\(\)/);
	assert.match(
		page,
		/<button\s+className="secondary react-dashboard-refresh"\s+type="button"\s+onClick=\{refreshFromHeader\}\s+disabled=\{isRefreshing\}\s+aria-busy=\{isRefreshing\}/,
	);
	assert.match(page, /aria-label=\{isRefreshing \? "Actualizando gastos del periodo" : "Actualizar gastos del periodo"\}/);
	assert.match(
		page,
		/className="secondary react-dashboard-refresh"[\s\S]{0,700}?<FontAwesomeIcon icon=\{faArrowsRotate\} aria-hidden="true" \/>[\s\S]{0,50}?Actualizar/,
	);
	// The route retry prop is unused by the ready page after this correction, so it is gone entirely.
	assert.doesNotMatch(page, /onRetry/);
	assert.doesNotMatch(page, /Actualizar estado de la conexión|Volver al inicio/);
	assert.equal((page.match(/<FinancialCycleEditDialog/g) ?? []).length, 1);
	assert.match(
		page,
		/<FinancialCycleEditDialog[\s\S]{0,200}?isOpen=\{isCycleEditOpen\}/,
	);
	assert.match(page, /cycleEditLock/);
	// The reload is the one the summary publishes as the dashboard handle, and the saved period and the
	// refresh are reported separately through the tested notice.
	assert.match(
		page,
		/createCycleEditSubmitter\(\{[\s\S]{0,300}?reload: reloadFinancialDashboard/,
	);
	assert.match(page, /getCycleEditNotice\(/);
	assert.match(page, /updateCycle: updateFinancialCycle/);
	// Demo protection is structural: no read-only tree mounts the control or the dialog.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period,
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	// A positive marker first, so the absences below cannot pass on an empty render.
	assert.match(demoMarkup, /Solo lectura/);
	assert.match(demoMarkup, /Mercado/);
	assert.doesNotMatch(demoMarkup, /Cambiar período/);
	assert.doesNotMatch(demoMarkup, /Cierre registrado/);
	assert.doesNotMatch(demoMarkup, /<dialog|<form|<input/);
	// Read-only analytics selection buttons are allowed; a submit or mutation control is not.
	assert.equal(
		(demoMarkup.match(/<button/g) ?? []).length,
		(demoMarkup.match(/<button type="button"/g) ?? []).length,
	);
	assert.doesNotMatch(demoMarkup, /type="submit"|Nuevo gasto|Cambiar período|Cerrar período/);
	// Sensitivity control: the mounted edit dialog remains independently reachable, while the removed
	// heading and closure action stay absent from the dashboard surface.
	const mountedDialog = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleEditDialog, {
			isOpen: true,
			cycle: { selectedPeriod: period, incomeAmount: null, completedAt: null },
			onClose: noop,
			submitCycle: async () => ({ status: "saved", reloadFailed: false }),
			onSaved: noop,
		}),
	);
	assert.match(mountedDialog, /<dialog/);
	assert.match(mountedDialog, /<form/);
	assert.match(mountedDialog, /<input/);

	// Scoped styles on the global primitives; the dialog reuses the setup form's field grid instead of
	// a second copy of it.
	assert.match(styles, /\.react-financial-cycle-closure \{/);
	assert.match(styles, /\.react-financial-cycle-dialog \{/);
	assert.match(styles, /\.react-financial-cycle-closure-note \{/);
	assert.match(styles, /\.react-financial-cycle-status-error \{/);
});

test("the React setup form and the financial-cycle module share one income rule", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [page, settings, pageSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/financial-cycle/cycleSettings.ts"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);

	// One rule, owned by the cycle module: the setup form consumes `parseCycleIncome` instead of
	// carrying a second copy of it.
	assert.doesNotMatch(pageSource, /function parseIncomeAmount/);
	assert.match(pageSource, /parseCycleIncome/);

	// Equivalence over the shipped surface: the setup payload and the module's own rule agree on every
	// outcome — the value for a valid CLP integer, the same thrown message otherwise — so replacing one
	// with the other cannot change behavior.
	for (const incomeValue of [
		"",
		"   ",
		"1",
		"900000",
		"900.000",
		"1.234.567",
		" 900.000 ",
		"0",
		"-5",
		"1000.50",
		"abc",
		"9007199254740992",
		"1.",
		".5",
		"1.2.3",
	]) {
		const moduleOutcome = (() => {
			try {
				return { ok: true, value: settings.parseCycleIncome(incomeValue) };
			} catch (error) {
				return { ok: false, message: error.message };
			}
		})();
		const setupOutcome = (() => {
			try {
				return {
					ok: true,
					value: page.createFinancialCycleSetupPayload(
						"2028-02-29",
						"2028-02-29",
						incomeValue,
					).incomeAmount,
				};
			} catch (error) {
				return { ok: false, message: error.message };
			}
		})();
		assert.deepEqual(
			setupOutcome,
			moduleOutcome,
			`income rule mismatch for ${JSON.stringify(incomeValue)}`,
		);
	}

	// The shipped behavior itself, so the shared rule is pinned rather than merely self-consistent:
	// empty is `null`, a positive safe integer is accepted, and the dotted CLP form the field renders
	// is read back.
	assert.equal(settings.parseCycleIncome(""), null);
	assert.equal(settings.parseCycleIncome("   "), null);
	assert.equal(settings.parseCycleIncome("900000"), 900000);
	assert.equal(settings.parseCycleIncome("900.000"), 900000);
	assert.equal(settings.parseCycleIncome("1.234.567"), 1234567);
	assert.throws(() => settings.parseCycleIncome("0"), /positive whole safe CLP integer/);
	assert.throws(() => settings.parseCycleIncome("1000.50"), /positive whole safe CLP integer/);
	assert.throws(
		() => settings.parseCycleIncome("9007199254740992"),
		/positive whole safe CLP integer/,
	);
});

test("the React financial-cycle completion client sends the exact period body and reads the four outcomes as data", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const client = await vite.ssrLoadModule("/src/client/api/client.ts");
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const calls = [];
	const originalFetch = globalThis.fetch;
	const respond = (status, body) => async (path, options) => {
		calls.push([path, options]);
		return { ok: status >= 200 && status < 300, status, json: async () => body };
	};

	try {
		globalThis.fetch = respond(200, {
			outcome: "success",
			scanned: 12,
			transactions: 3,
			completedAt: "2026-02-14T02:30:00.000Z",
		});
		assert.deepEqual(await client.completeFinancialCycle(period), {
			outcome: "success",
			scanned: 12,
			transactions: 3,
			completedAt: "2026-02-14T02:30:00.000Z",
		});
		// The body key this endpoint validates is `period` (`src/server.js:415`); `selectedPeriod`,
		// which the other cycle endpoint takes, would be a 400 here.
		assert.equal(calls[0][0], "/api/financial-cycle/complete");
		assert.equal(calls[0][1]?.method, "POST");
		assert.deepEqual(calls[0][1]?.headers, { "content-type": "application/json" });
		assert.deepEqual(JSON.parse(calls[0][1]?.body), { period });
		assert.equal(JSON.parse(calls[0][1]?.body).selectedPeriod, undefined);
		assert.equal(calls[0][1]?.credentials, "same-origin");

		// 207: the synchronization was partial and the server wrote no closure. The outcome is data the
		// caller has to state, never an error, and `completedAt: null` is the server's own record of it.
		globalThis.fetch = respond(207, {
			outcome: "partial",
			scanned: 12,
			transactions: 3,
			failedCount: 2,
			retryable: true,
			completedAt: null,
		});
		assert.deepEqual(await client.completeFinancialCycle(period), {
			outcome: "partial",
			scanned: 12,
			transactions: 3,
			failedCount: 2,
			retryable: true,
			completedAt: null,
		});

		// 409: disconnected. The server's own action is carried faithfully; rendering it is the caller's
		// decision, and the React surface deliberately routes the user to its consent-gated control.
		globalThis.fetch = respond(409, {
			outcome: "disconnected",
			action: { label: "Connect with Google", href: "/auth/google" },
			retryable: true,
			completedAt: null,
		});
		assert.deepEqual(await client.completeFinancialCycle(period), {
			outcome: "disconnected",
			action: { label: "Connect with Google", href: "/auth/google" },
			retryable: true,
			completedAt: null,
		});

		// 502: the handler's catch wraps the synchronization, the read-back and the write
		// (`src/server.js:430-471`), so a closure may already have been applied and `completedAt: null`
		// says nothing about whether one was recorded.
		globalThis.fetch = respond(502, {
			outcome: "error",
			retryable: true,
			completedAt: null,
		});
		assert.deepEqual(await client.completeFinancialCycle(period), {
			outcome: "error",
			retryable: true,
			completedAt: null,
		});

		// A status and a body that disagree are not read as whichever half is convenient: the status
		// picks the branch and the body has to corroborate it.
		const contradictions = [
			[
				200,
				{
					outcome: "partial",
					scanned: 1,
					transactions: 0,
					failedCount: 1,
					retryable: true,
					completedAt: null,
				},
			],
			[200, { outcome: "success", scanned: 1, transactions: 0, completedAt: "   " }],
			[
				200,
				{ outcome: "success", scanned: -1, transactions: 0, completedAt: "2026-02-14T02:30:00.000Z" },
			],
			[207, { outcome: "success", scanned: 1, transactions: 0, retryable: true, completedAt: null }],
			// A 207 that claimed a closure timestamp would make "nothing was recorded" false.
			[
				207,
				{
					outcome: "partial",
					scanned: 1,
					transactions: 0,
					failedCount: 1,
					retryable: true,
					completedAt: "2026-02-14T02:30:00.000Z",
				},
			],
			[502, { outcome: "error", retryable: false, completedAt: null }],
			[409, { outcome: "disconnected", retryable: true, completedAt: null }],
		];
		for (const [status, body] of contradictions) {
			globalThis.fetch = respond(status, body);
			await assert.rejects(
				() => client.completeFinancialCycle(period),
				(error) => error instanceof client.ApiError,
				`${status} with ${JSON.stringify(body)} must not be readable as an outcome`,
			);
		}

		// A request the server refuses is not one of the four outcomes, so it throws instead of being
		// reported as data: a 401 session failure here, an unusable body in the test below.
		globalThis.fetch = respond(401, {
			error: { code: "unauthorized", message: "Authentication is required" },
		});
		await assert.rejects(
			() => client.completeFinancialCycle(period),
			(error) => error instanceof client.ApiError,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the React financial-cycle completion client throws instead of reporting a closure when the response body is unreadable", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const client = await vite.ssrLoadModule("/src/client/api/client.ts");
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const originalFetch = globalThis.fetch;

	try {
		// The reader turns an unreadable body into `null`, and every branch has to throw on the keys it
		// then cannot find. A body this client could not read is never an outcome it hands to a caller:
		// the status alone would have it claim a closure it has no evidence for either way.
		for (const status of [200, 207, 409, 502]) {
			globalThis.fetch = async () => ({
				ok: status >= 200 && status < 300,
				status,
				json: async () => {
					throw new SyntaxError("Unexpected end of JSON input");
				},
			});
			await assert.rejects(
				() => client.completeFinancialCycle(period),
				(error) => error instanceof client.ApiError,
				`${status} with an unreadable body must not be readable as a closure outcome`,
			);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the React financial-cycle completion module states each outcome truthfully and tells a re-closure from a fresh one", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const completion = await vite.ssrLoadModule(
		"/src/client/components/financial-cycle/cycleCompletion.ts",
	);
	const closedAt = "2026-02-14T02:30:00.000Z";
	const closed = {
		status: "closed",
		completedAt: closedAt,
		alreadyClosed: false,
		reloadFailed: false,
	};

	// Every outcome of the server has its own copy, and no two of them read alike: a partial
	// synchronization can never be mistaken for a closure, in the notice or in the caller's hands.
	const notices = {
		closed: completion.getCycleCompletionNotice(closed, "UTC"),
		reclosed: completion.getCycleCompletionNotice(
			{ ...closed, alreadyClosed: true, completedAt: "2026-03-01T12:00:00.000Z" },
			"UTC",
		),
		partial: completion.getCycleCompletionNotice({ status: "partial", failedCount: 2 }),
		disconnected: completion.getCycleCompletionNotice({ status: "disconnected" }),
		error: completion.getCycleCompletionNotice({ status: "error" }),
		failed: completion.getCycleCompletionNotice({ status: "failed" }),
	};
	assert.equal(new Set(Object.values(notices).map((notice) => notice.message)).size, 6);

	// A fresh closure states the closure and the stored timestamp, formatted from the instant with the
	// pinned zone instead of the runner's own. The counts the server reports stay in the response:
	// this copy renders neither the scan nor a transaction count.
	assert.equal(notices.closed.tone, "success");
	assert.match(notices.closed.message, /Periodo cerrado/);
	assert.match(notices.closed.message, /Cierre registrado el 14 de febrero de 2026/);
	assert.match(notices.closed.message, /resumen financiero se actualizó/);

	// A re-closure keeps the original closure: the server reuses a stored `completed_at`, so the copy
	// says the change did not happen now instead of announcing a second closure.
	assert.match(notices.reclosed.message, /ya tenía un cierre registrado el 1 de marzo de 2026/);
	assert.match(notices.reclosed.message, /se conserva ese registro/);
	assert.doesNotMatch(notices.reclosed.message, /^Periodo cerrado/);

	// A completed closure whose reload failed is stale data with a warning tone, never a failed write.
	const stale = completion.getCycleCompletionNotice({ ...closed, reloadFailed: true }, "UTC");
	assert.equal(stale.tone, "warning");
	assert.match(stale.message, /Cierre registrado el 14 de febrero de 2026/);
	assert.match(stale.message, /no se pudo actualizar y puede estar desactualizado/);

	// Only the two outcomes the server answers before it touches the closure may say nothing was
	// recorded and that the period stays open (`src/server.js:419-447`): a `partial` synchronization
	// and a disconnected account both return before the write.
	for (const key of ["partial", "disconnected"]) {
		assert.match(notices[key].message, /El cierre no se registró/);
		assert.match(notices[key].message, /el periodo sigue abierto/);
	}
	assert.equal(notices.partial.tone, "warning");
	assert.match(notices.partial.message, /2 consultas a Gmail no se pudieron completar/);
	assert.equal(notices.disconnected.tone, "warning");
	// The disconnected outcome points at the control this surface already has, and never at the href
	// the server returned: connecting is gated behind the consent dialog in React.
	assert.match(notices.disconnected.message, /Conectar Gmail/);
	assert.match(notices.disconnected.message, /panel de conexión/);
	assert.doesNotMatch(notices.disconnected.message, /auth\/google/);
	assert.equal(notices.error.tone, "error");
	// The 502 catch wraps `syncPeriod`, `readPeriod` and `complete` (`src/server.js:430-471`), and
	// `completeFinancialCyclePeriod` upserts the closure before it reads it back (`src/db.js:176-181`),
	// so a throw after the write still answers `completedAt: null` over a closure that happened. The
	// copy therefore states that the closure could not be completed and that the record is unknown,
	// naming no step as the failing one and never denying the closure it cannot rule out.
	assert.match(notices.error.message, /El cierre no se pudo completar/);
	assert.match(notices.error.message, /no es posible confirmar si quedó registrado/);
	assert.match(notices.error.message, /Vuelve a cargar el resumen para ver el estado real/);
	assert.match(notices.error.message, /reintentar el cierre es seguro/);
	assert.doesNotMatch(notices.error.message, /El cierre no se registró/);
	assert.doesNotMatch(notices.error.message, /el periodo sigue abierto/);

	// A refused request, or a response this client could not read, cannot claim either way: a 200 whose
	// body was unusable may still have left a closure behind.
	assert.equal(notices.failed.tone, "error");
	assert.match(notices.failed.message, /No es posible confirmar si el cierre quedó registrado/);
	assert.match(notices.failed.message, /Vuelve a cargar el resumen para ver el estado real/);
	assert.doesNotMatch(notices.failed.message, /no se registró/);

	// The zone is a seam, not the host default: the same instant is a different calendar day on each
	// side of it, and the closure date must not be shifted silently.
	assert.match(
		completion.getCycleCompletionNotice(closed, "America/Santiago").message,
		/Cierre registrado el 13 de febrero de 2026/,
	);

	// Idempotency is decided by the closure the summary already had loaded, compared as instants so a
	// different serialization of the same closure is still the same closure.
	assert.equal(completion.isCycleAlreadyClosed(closedAt, closedAt), true);
	assert.equal(completion.isCycleAlreadyClosed(closedAt, "2026-02-14T02:30:00+00:00"), true);
	assert.equal(completion.isCycleAlreadyClosed(closedAt, "2026-01-01T00:00:00.000Z"), false);
	assert.equal(completion.isCycleAlreadyClosed(closedAt, null), false);
	assert.equal(completion.isCycleAlreadyClosed(closedAt, undefined), false);
	// An unreadable timestamp has no instant to compare, so only the exact same record counts as the
	// same closure; anything else is a record this comparison cannot vouch for.
	assert.equal(completion.isCycleAlreadyClosed("ayer", "ayer"), true);
	assert.equal(completion.isCycleAlreadyClosed("ayer", closedAt), false);

	// The in-flight copy names no percentage and no estimate: the handler reports no progress at all.
	assert.match(completion.CYCLE_COMPLETION_PENDING_MESSAGE, /Cerrando el periodo/);
	assert.match(completion.CYCLE_COMPLETION_PENDING_MESSAGE, /no es posible mostrar un avance/);
	assert.doesNotMatch(completion.CYCLE_COMPLETION_PENDING_MESSAGE, /%/);
	// A request that never settles would otherwise leave the dialog impossible to close, because `Esc`
	// is prevented and the cancel control is disabled while the phase is pending. The copy names the
	// two honest escapes — the window becomes closable when the review finishes, and reloading the
	// page abandons the wait — instead of promising a cancellation this surface does not perform.
	assert.match(
		completion.CYCLE_COMPLETION_PENDING_MESSAGE,
		/Puedes cerrar esta ventana cuando la revisión termine/,
	);
	assert.match(completion.CYCLE_COMPLETION_PENDING_MESSAGE, /recargar la página abandona la espera/);
});

test("the React financial-cycle completion submitter holds a single in-flight closure and releases the lock on a refused request", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [client, completion] = await Promise.all([
		vite.ssrLoadModule("/src/client/api/client.ts"),
		vite.ssrLoadModule("/src/client/components/financial-cycle/cycleCompletion.ts"),
	]);

	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const lock = { current: false };
	const requests = [];
	let settle;
	const inFlight = new Promise((resolve) => {
		settle = resolve;
	});
	const submit = completion.createCycleCompletionSubmitter({
		complete: (received) => {
			requests.push(received);
			return inFlight;
		},
		reload: async () => true,
		loadedCompletedAt: null,
		lock,
	});

	const first = submit(period);
	// The lock is taken before the first await, so a second click in the same tick cannot issue a
	// second closure: it reports `busy` and changes nothing.
	assert.equal(lock.current, true);
	assert.deepEqual(await submit(period), { status: "busy" });
	assert.equal(requests.length, 1);

	// `busy` settled nothing, so the phase belongs to the attempt that is still in flight. Every other
	// outcome owns it, failures included, so no path can leave the surface locked forever.
	assert.equal(completion.shouldClearCycleCompletionPhase({ status: "busy" }), false);
	for (const settled of [
		{
			status: "closed",
			completedAt: "2026-02-14T02:30:00.000Z",
			alreadyClosed: false,
			reloadFailed: false,
		},
		{ status: "partial", failedCount: 1 },
		{ status: "disconnected" },
		{ status: "error" },
		{ status: "failed" },
	]) {
		assert.equal(completion.shouldClearCycleCompletionPhase(settled), true);
	}

	settle({
		outcome: "success",
		scanned: 4,
		transactions: 1,
		completedAt: "2026-02-14T02:30:00.000Z",
	});
	// The request carried the configured period, and a closure reloads the period the summary shows.
	assert.deepEqual(await first, {
		status: "closed",
		completedAt: "2026-02-14T02:30:00.000Z",
		alreadyClosed: false,
		reloadFailed: false,
	});
	assert.deepEqual(requests, [period]);
	assert.equal(lock.current, false);

	// The closure the summary already had decides that a second close kept the original record instead
	// of registering a new one, and a failed reload is reported against an succeeded closure.
	const recloseReloads = [];
	const reclose = completion.createCycleCompletionSubmitter({
		complete: async () => ({
			outcome: "success",
			scanned: 2,
			transactions: 0,
			completedAt: "2026-02-14T02:30:00.000Z",
		}),
		reload: async () => {
			recloseReloads.push("reload");
			return false;
		},
		loadedCompletedAt: "2026-02-14T02:30:00.000Z",
		lock: { current: false },
	});
	assert.deepEqual(await reclose(period), {
		status: "closed",
		completedAt: "2026-02-14T02:30:00.000Z",
		alreadyClosed: true,
		reloadFailed: true,
	});
	assert.equal(recloseReloads.length, 1);

	// A partial synchronization is data, not an error, and nothing reloads: the server wrote nothing, so
	// a refresh would only present the same period as if the closure had happened.
	const noReload = [];
	const partial = completion.createCycleCompletionSubmitter({
		complete: async () => ({
			outcome: "partial",
			scanned: 7,
			transactions: 2,
			failedCount: 3,
			retryable: true,
			completedAt: null,
		}),
		reload: async () => {
			noReload.push("reload");
			return true;
		},
		loadedCompletedAt: null,
		lock: { current: false },
	});
	assert.deepEqual(await partial(period), { status: "partial", failedCount: 3 });

	// The other two outcomes the server can answer with are mapped to themselves, never to a closure.
	for (const [body, expected] of [
		[
			{
				outcome: "disconnected",
				action: { label: "Connect with Google", href: "/auth/google" },
				retryable: true,
				completedAt: null,
			},
			{ status: "disconnected" },
		],
		[{ outcome: "error", retryable: true, completedAt: null }, { status: "error" }],
	]) {
		const submitOther = completion.createCycleCompletionSubmitter({
			complete: async () => body,
			reload: async () => {
				noReload.push("reload");
				return true;
			},
			loadedCompletedAt: null,
			lock: { current: false },
		});
		assert.deepEqual(await submitOther(period), expected);
	}
	assert.deepEqual(noReload, []);

	// A refused request is a truthful failure and the lock is released, so the attempt stays retryable
	// instead of leaving the control disabled with no explanation.
	const refusalLock = { current: false };
	const attempts = [];
	const refusing = completion.createCycleCompletionSubmitter({
		complete: async () => {
			attempts.push("attempt");
			if (attempts.length === 1) {
				throw new client.ApiError("Request to /api/financial-cycle/complete failed (401)");
			}
			return { outcome: "error", retryable: true, completedAt: null };
		},
		reload: async () => true,
		loadedCompletedAt: null,
		lock: refusalLock,
	});
	assert.deepEqual(await refusing(period), { status: "failed" });
	assert.equal(refusalLock.current, false);
	assert.deepEqual(await refusing(period), { status: "error" });
	assert.equal(attempts.length, 2);
	assert.equal(refusalLock.current, false);
});

test("the React financial-cycle completion dialog consents to the mailbox read and keeps the closure out of the demo", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, dialogModule, dialogSource, page, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule(
			"/src/client/components/financial-cycle/CompleteCycleDialog.tsx",
		),
		readFile(
			new URL("../src/client/components/financial-cycle/CompleteCycleDialog.tsx", import.meta.url),
			"utf8",
		),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const cycle = { selectedPeriod: period, incomeAmount: null, completedAt: null };
	const noop = () => {};
	const renderDialog = (props) =>
		renderer.renderToStaticMarkup(
			React.createElement(dialogModule.CompleteCycleDialog, {
				isOpen: true,
				cycle,
				onClose: noop,
				submitCompletion: async () => ({ status: "failed" }),
				...props,
			}),
		);

	const confirmation = renderDialog({});
	assert.match(confirmation, /<dialog/);
	// It wears the shipped cycle dialog shell and the shipped cycle form stack, so its styling is the
	// shipped one instead of a second copy of it.
	assert.match(confirmation, /react-financial-cycle-dialog/);
	assert.match(confirmation, /react-financial-cycle-form/);
	// The consent copy is the shipped closure note box, and the status line the shipped status base class
	// plus the tone, which only renders once an outcome exists.
	assert.match(confirmation, /react-financial-cycle-closure-note/);
	assert.match(dialogSource, /react-financial-cycle-status react-financial-cycle-status-\$\{status\.tone\}/);
	assert.match(confirmation, /Cerrar período/);
	// The confirmation states the read the user is consenting to and the condition the closure depends
	// on, instead of letting the user discover that closing the period reads the mailbox.
	assert.match(confirmation, /lee tu correo de Gmail/);
	assert.match(confirmation, /solo registra el cierre si esa sincronización se completa/);
	assert.match(confirmation, /01\/02\/2026 a 28\/02\/2026/);
	// A re-close keeps the original record, which is said before confirming rather than only after.
	assert.match(confirmation, /se conserva el registro original/);
	// The disconnected instruction is text, not a link: this surface gates connecting behind its own
	// consent dialog, and the server-provided href would bypass it.
	assert.doesNotMatch(confirmation, /<a |auth\/google/);
	assert.doesNotMatch(dialogSource, /action\.href|action\?\.href/);
	// No progress signal is rendered, because the handler exposes none.
	assert.doesNotMatch(dialogSource, /%/);
	assert.doesNotMatch(dialogSource, /\bETA\b|porcentaje|minutos|segundos/i);
	assert.doesNotMatch(confirmation, /%/);

	// The dialog is a real native modal through the shipped helper, and `Esc` cannot dismiss a closure
	// that is already on its way.
	assert.match(dialogSource, /syncNativeModalDialog/);
	assert.match(dialogSource, /onCancel/);
	assert.match(dialogSource, /if \(isClosing\) event\.preventDefault\(\)/);
	// Nothing renders while the parent says it is closed, or without a configured cycle to close.
	assert.equal(renderDialog({ isOpen: false }), "");
	assert.equal(renderDialog({ cycle: null }), "");

	// The dashboard keeps only the configured-period edit trigger; the removed heading and closure
	// surface are not imported, mounted, or wired into the summary.
	assert.equal((page.match(/className="react-dashboard-period"/g) ?? []).length, 1);
	assert.match(
		page,
		/<button\s+className="react-dashboard-period"\s+type="button"\s+onClick=\{financialDashboard\.onEditPeriod\}/,
	);
	assert.doesNotMatch(
		page,
		/FinancialPeriodHeading|CompleteCycleDialog|createCycleCompletionSubmitter|cycleCompletionLock|completeFinancialCycle|isCycleCompletionOpen|onCompletePeriod|openCycleCompletion/,
	);
	assert.doesNotMatch(page, /Cerrar período|react-financial-cycle-closure|Cierre registrado/);

	// Demo protection is structural: the read-only tree never mounts the control or the dialog.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period,
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	// A positive marker first, so the absences below cannot pass on an empty render.
	assert.match(demoMarkup, /Solo lectura/);
	assert.match(demoMarkup, /Mercado/);
	assert.doesNotMatch(demoMarkup, /Cerrar período/);
	assert.doesNotMatch(demoMarkup, /<dialog/);
	// Read-only analytics selection buttons are allowed; a submit or mutation control is not.
	assert.equal(
		(demoMarkup.match(/<button/g) ?? []).length,
		(demoMarkup.match(/<button type="button"/g) ?? []).length,
	);
	assert.doesNotMatch(demoMarkup, /type="submit"|Nuevo gasto|Cambiar período|Cerrar período/);
	// Sensitivity control: the completion dialog remains independently mounted by this test, but not
	// through the dashboard page.
	assert.match(confirmation, /<dialog/);
	assert.match(confirmation, /<button/);

	// No stylesheet rule was added for this dialog beyond the two missing status tones: the shell, the stack
	// and the note box are the shipped ones, so nothing here can drift away from them.
	assert.doesNotMatch(styles, /completion/);
	assert.match(styles, /\.react-financial-cycle-dialog \{/);
	assert.match(styles, /\.react-financial-cycle-form \{/);
	assert.match(styles, /\.react-financial-cycle-closure-note \{/);
	assert.match(styles, /\.react-financial-cycle-status-success \{/);
	assert.match(styles, /\.react-financial-cycle-status-warning \{/);
});

test("the React movement filter module derives the loaded categories and narrows the rows without a request", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [filters, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/movements/movementFilters.ts"),
		readFile(
			new URL("../src/client/components/movements/movementFilters.ts", import.meta.url),
			"utf8",
		),
	]);

	const february = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const march = { startDate: "2026-03-01", endDateExclusive: "2026-04-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		// Same category key as the two rows above: case and surrounding whitespace are not a second
		// category (legacy `categoryKey`, `public/app.js:3311`).
		{ id: "c", counterparty: "Café", amount: 3500, date: "2026-02-04", category: " comida " },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
		{ id: "e", counterparty: "Supermercado", amount: 12000, date: "2026-02-06", category: "Supermercado" },
		// The projection's own fallback label, so the option is the category the table itself shows.
		{ id: "f", counterparty: "Sin identificar", amount: 1000, date: "—", category: "" },
	];

	// A row whose amount cannot be summed still belongs to its option and must not poison the order:
	// the option states how many rows it would show, not how much money they carry.
	const withUnknownAmount = [
		...rows,
		{ id: "g", counterparty: "Sin monto", amount: Number.NaN, date: "2026-02-07", category: "Comida" },
	];

	// Filtering is an in-memory narrowing, so the module must never issue a request. Every call below
	// runs under this stub, which fails the test loudly if one happens.
	const originalFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = (...args) => {
		requests.push(args);
		throw new Error("filtering must not issue a request");
	};

	let fresh;
	let comidaView;
	let clearedView;
	let canonicalView;
	let otherPeriodView;
	let vanishedView;
	let guardedView;
	try {
		fresh = filters.getMovementFilterView(
			filters.createMovementFilterSelection(february),
			february,
			rows,
		);
		comidaView = filters.getMovementFilterView(
			filters.selectMovementFilterCategory("Comida", february),
			february,
			rows,
		);
		clearedView = filters.getMovementFilterView(
			filters.createMovementFilterSelection(february),
			february,
			rows,
		);
		canonicalView = filters.getMovementFilterView(
			filters.selectMovementFilterCategory("  comida ", february),
			february,
			rows,
		);
		otherPeriodView = filters.getMovementFilterView(
			filters.selectMovementFilterCategory("Comida", february),
			march,
			rows,
		);
		vanishedView = filters.getMovementFilterView(
			filters.selectMovementFilterCategory("Vacaciones", february),
			february,
			rows,
		);
		guardedView = filters.getMovementFilterView(
			filters.selectMovementFilterCategory("Comida", february),
			february,
			withUnknownAmount,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.deepEqual(requests, []);
	// The module cannot request anything even in principle, and it is a decision module, not a
	// component: no fetch, no API layer, no React.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);

	// Only the categories the loaded rows carry are offered, "Todas las categorías" first, and the
	// accented/cased duplicate is one option. The order mirrors legacy's breakdown (largest amount
	// first, `buildCategoryBreakdown`, `public/app.js:2911-2935`).
	assert.deepEqual(fresh.options, [
		{ value: "", label: "Todas las categorías", count: 6 },
		{ value: "Arriendo", label: "Arriendo", count: 1 },
		{ value: "Comida", label: "Comida", count: 3 },
		{ value: "Supermercado", label: "Supermercado", count: 1 },
		{ value: "Sin categoría", label: "Sin categoría", count: 1 },
	]);
	// No option for a category the period does not have: it could only produce an empty table.
	assert.equal(fresh.options.some((option) => option.value === "Vacaciones"), false);
	assert.deepEqual(fresh.rows, rows);
	assert.equal(fresh.activeCategory, filters.ALL_CATEGORIES_FILTER);
	assert.equal(fresh.count.isActive, false);

	// Selecting one narrows the rows to exactly that category, in the loaded order, and the merged
	// duplicate row comes with it.
	assert.equal(comidaView.activeCategory, "Comida");
	assert.deepEqual(comidaView.rows.map((row) => row.id), ["a", "b", "c"]);
	assert.equal(comidaView.count.shown, 3);
	assert.equal(comidaView.count.total, 6);
	// The control receives the option's own value, not the raw string the change event carried.
	assert.equal(canonicalView.activeCategory, "Comida");

	// Clearing restores every loaded row, untouched and in order.
	assert.equal(clearedView.activeCategory, filters.ALL_CATEGORIES_FILTER);
	assert.deepEqual(clearedView.rows, rows);
	assert.equal(clearedView.count.isActive, false);
	assert.equal(clearedView.count.message, null);

	// A selection belongs to the period it was made in. The same selection resolved against another
	// period applies nothing, so the reload of a different period cannot narrow its rows.
	assert.equal(otherPeriodView.activeCategory, filters.ALL_CATEGORIES_FILTER);
	assert.deepEqual(otherPeriodView.rows, rows);
	assert.equal(otherPeriodView.count.isActive, false);
	assert.equal(filters.getMovementFilterPeriodKey(february), "2026-02-01..2026-03-01");
	assert.notEqual(
		filters.getMovementFilterPeriodKey(february),
		filters.getMovementFilterPeriodKey(march),
	);
	// `reconcileMovementFilterSelection` is what the table commits when the period changes: it returns
	// the stored selection itself while it applies to the loaded period and rows — the same object, so
	// the caller can compare identity and commit only on a change — and a fresh unfiltered selection
	// otherwise, period mismatch or vanished category alike.
	const storedSelection = filters.selectMovementFilterCategory("Comida", february);
	assert.equal(
		filters.reconcileMovementFilterSelection(storedSelection, february, rows),
		storedSelection,
	);
	assert.deepEqual(
		filters.reconcileMovementFilterSelection(storedSelection, march, rows),
		filters.createMovementFilterSelection(march),
	);

	// A selection whose category is no longer among the loaded rows is dropped at render, like legacy's
	// guard (`activeTableCategoryFilter`, `public/app.js:1225-1235`), and
	// `reconcileMovementFilterSelection` clears it from the stored selection the way legacy did
	// (`state.tableCategoryFilter = ""`, `:1233`), so the table can never be narrowed to nothing by a
	// category nobody can see, nor re-narrowed by one nobody re-selected.
	assert.equal(vanishedView.activeCategory, filters.ALL_CATEGORIES_FILTER);
	assert.deepEqual(vanishedView.rows, rows);
	assert.equal(vanishedView.count.isActive, false);

	// Degenerate input still has an honest answer: no rows, no category options.
	const emptyView = filters.getMovementFilterView(
		filters.createMovementFilterSelection(february),
		february,
		[],
	);
	assert.deepEqual(emptyView.options, [{ value: "", label: "Todas las categorías", count: 0 }]);
	assert.deepEqual(emptyView.rows, []);
	assert.equal(emptyView.count.message, null);

	// The row without a summable amount is still counted in its option and in the total, and the
	// finite guard keeps the order by amount intact instead of degrading it to insertion order.
	assert.deepEqual(guardedView.rows.map((row) => row.id), ["a", "b", "c", "g"]);
	assert.equal(guardedView.count.shown, 4);
	assert.equal(guardedView.count.total, 7);
	assert.equal(guardedView.options[0].count, 7);
	assert.equal(guardedView.options[1].value, "Arriendo");
	assert.equal(guardedView.options[2].count, 4);
	// The module narrows a copy: the caller's loaded rows are never mutated.
	assert.equal(rows.length, 6);
	assert.notEqual(guardedView.rows, withUnknownAmount);
});

test("the React movement filter count states the filtered rows out of the period's total without claiming the summary was filtered", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const filters = await vite.ssrLoadModule(
		"/src/client/components/movements/movementFilters.ts",
	);
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		{ id: "c", counterparty: "Café", amount: 3500, date: "2026-02-04", category: "Comida" },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
	];

	const unfiltered = filters.getMovementFilterView(
		filters.createMovementFilterSelection(period),
		period,
		rows,
	).count;
	// No statement while the table shows every row: there is nothing to disambiguate.
	assert.deepEqual(unfiltered, {
		isActive: false,
		category: "",
		shown: 4,
		total: 4,
		message: null,
	});

	const filtered = filters.getMovementFilterView(
		filters.selectMovementFilterCategory("Comida", period),
		period,
		rows,
	).count;
	assert.equal(filtered.isActive, true);
	assert.equal(filtered.category, "Comida");
	assert.equal(filtered.shown, 3);
	assert.equal(filtered.total, 4);
	// The active status describes the table's subset, not the period-wide financial metrics (whose
	// separate "Periodo completo, sin filtros" label is checked in the rendered card test below).
	assert.match(filtered.message, /^Filtro activo: Comida\. 3 de 4 movimientos\.$/);
	assert.doesNotMatch(filtered.message, /resumen financiero|total gastado/i);
	assert.notEqual(filtered.message, unfiltered.message);
});

test("the React movements filter control renders the labelled group, the active count and the clear action, and stays out of the demo", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, filters, page, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/movements/movementFilters.ts"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		{ id: "c", counterparty: "Café", amount: 3500, date: "2026-02-04", category: "Comida" },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
	];
	const viewOf = (selection) => filters.getMovementFilterView(selection, period, rows);
	const renderBar = (count, options = viewOf(filters.createMovementFilterSelection(period)).options) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.MovementFilterBar, {
				options,
				count,
				onSelect: noop,
				onClear: noop,
			}),
		);

	// The unfiltered control keeps its labelled category select and only the loaded rows' categories,
	// each with the number of rows it would show, without an introductory heading or instructions.
	const idle = renderBar(viewOf(filters.createMovementFilterSelection(period)).count);
	assert.match(idle, /role="group" aria-label="Filtrar tabla por categoría"/);
	assert.match(idle, /Categoría<\/span>/);
	assert.match(idle, /<select><option/);
	assert.match(idle, /<option[^>]*value="" selected="">Todas las categorías · 4<\/option>/);
	assert.match(idle, /Comida · 3/);
	assert.match(idle, /Arriendo · 1/);
	assert.doesNotMatch(idle, /Vacaciones/);
	assert.doesNotMatch(idle, /Filtrar detalle|Elige una categoría para limpiar el ruido\./);
	// Nothing to clear and nothing to state while no filter is active.
	assert.doesNotMatch(idle, /Limpiar filtro/);
	assert.doesNotMatch(idle, /role="status"/);

	// The active control selects the category, announces exactly the table subset, and offers a clear
	// action without the old instruction or a sentence about the period-wide summary.
	const activeCount = viewOf(filters.selectMovementFilterCategory("Comida", period)).count;
	const active = renderBar(activeCount);
	assert.match(active, /<option[^>]*value="Comida" selected="">Comida · 3<\/option>/);
	assert.match(active, /Limpiar filtro<\/button>/);
	assert.match(active, /<p class="react-movements-filter-count" role="status">Filtro activo: Comida\. 3 de 4 movimientos\.<\/p>/);
	assert.doesNotMatch(active, /Estás viendo solo una categoría\.|Se muestran 3 de 4 gastos reconocidos del periodo|El filtro solo afecta a esta tabla/);

	// The table itself owns the selection, derives the view from the loaded rows on every render, and
	// states the count only while the statement exists. The loaded period and rows are what make a
	// stale selection reset: `reconcileMovementFilterSelection` replaces it as soon as the period
	// differs or its category left the rows, and the table commits the returned selection above its
	// empty-rows return instead of merely ignoring the old one.
	assert.match(
		page,
		/import \{[\s\S]{0,400}?\} from "\.\.\/components\/movements\/movementFilters";/,
	);
	assert.match(
		page,
		/import \{[\s\S]{0,400}?getMovementFilterView,[\s\S]{0,400}?reconcileMovementFilterSelection,[\s\S]{0,400}?selectMovementFilterCategory,[\s\S]{0,400}?\} from "\.\.\/components\/movements\/movementFilters";/,
	);
	// The control itself is part of the movements view, exported so its two states are provable.
	assert.match(page, /export function MovementFilterBar\(/);
	assert.match(page, /reconcileMovementFilterSelection/);
	assert.match(page, /setSelection\(selectMovementFilterCategory\(/);
	assert.match(page, /setSelection\(createMovementFilterSelection\(period\)\)/);
	// The count statement is proved by the render above instead of by the shape of the guard: the idle
	// control announces nothing and the active one announces the statement the pure module decided.
	assert.doesNotMatch(idle, /role="status"/);
	assert.match(active, /<p class="react-movements-filter-count" role="status">Filtro activo: Comida\./);
	assert.match(page, /<MovementsTable[\s\S]{0,200}?period=\{selectedPeriod!\}/);

	// Demo protection is structural: the read-only composition never mounts the table or the control.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period,
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	// A positive marker first, so the absences below cannot pass on an empty render.
	assert.match(demoMarkup, /Solo lectura/);
	assert.match(demoMarkup, /Mercado/);
	assert.doesNotMatch(demoMarkup, /Filtrar tabla por categoría/);
	assert.doesNotMatch(demoMarkup, /Limpiar filtro/);
	assert.doesNotMatch(demoMarkup, /<select/);
	// Sensitivity control: the same patterns do match the authenticated control.
	assert.match(active, /Filtrar tabla por categoría/);
	assert.match(active, /Limpiar filtro/);
	assert.match(active, /<select/);

	// Scoped styles under the shipped `react-` prefix.
	assert.match(styles, /\.react-movements-filters \{/);
	assert.match(styles, /\.react-movements-filter-field \{/);
	assert.match(styles, /\.react-movements-filter-field select \{/);
	assert.match(styles, /\.react-movements-filter-clear \{/);
	assert.match(styles, /\.react-movements-filter-count \{/);
	assert.doesNotMatch(styles, /\.react-movements-filter-intro\b/);
});

test("the React movements view and the demo share the Stitch card header with a decorative glyph", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [pageModule, React, renderer, styles] = await Promise.all([
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		import("react"),
		import("react-dom/server"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
	];
	const table = renderer.renderToStaticMarkup(
		React.createElement(pageModule.MovementsTable, {
			period,
			movements: rows,
			editableMovements: [],
			onEdit: noop,
			onRemove: noop,
		}),
	);

	// Positive marker first: the authenticated card opens with the shared header band, before the filter
	// control band it used to open with, and the glyph is decorative.
	assert.match(table, /<div class="react-movements-view"><header class="react-movements-header">/);
	assert.match(table, /<section class="react-movements-metrics" aria-label="Indicadores del periodo">[\s\S]*?<span>Total gastado<\/span><strong>\$25\.000<\/strong><small>Periodo completo, sin filtros<\/small>/);
	assert.match(table, /<h2>Actividad del periodo<\/h2>/);
	assert.match(table, /<span class="react-card-icon" aria-hidden="true">/);
	assert.ok(
		table.indexOf("react-movements-header") < table.indexOf("react-movements-filters"),
		"the header band must render before the filter control band",
	);
	// The table semantics are untouched: the header adds no column and no cell-level glyph.
	assert.match(table, /<table class="react-movements-table">/);
	assert.doesNotMatch(table, /<th[^>]*react-card-icon/);

	// The demo card keeps its exact class name, reuses the glyph, and stays read-only.
	const demo = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period,
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	assert.match(demo, /class="demo-movements"/);
	assert.match(demo, /<header class="demo-movements-header">/);
	assert.match(demo, /<h2 id="demo-movements-title">Actividad del periodo<\/h2>/);
	assert.match(demo, /<span class="react-card-icon" aria-hidden="true">/);
	assert.doesNotMatch(demo, /<form|<input|<select|<dialog/);

	// Scoped movement/demo CSS only, aligned to the shipped card tokens and the shared glyph.
	assert.match(styles, /\.react-movements-header \{/);
	assert.match(styles, /\.react-movements-header h2 \{/);
	assert.match(styles, /\.react-movements-metrics \{/);
	assert.match(styles, /\.demo-movements-header \{/);
	assert.match(styles, /\.demo-movements-heading \{/);
	assert.match(styles, /\.react-card-icon \{/);
	assert.match(
		styles,
		/\.react-movements-header,\s*\n\t\.demo-movements-header \{\s*\n\t\tflex-direction: column;/,
	);
});

test("the React movement filter reconciliation clears a category the loaded rows no longer carry and never restores it", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const filters = await vite.ssrLoadModule(
		"/src/client/components/movements/movementFilters.ts",
	);
	const february = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
	];
	// The category leaves the loaded rows without the period changing: the same situation an edit
	// that recategorizes the last matching movement produces.
	const withoutComida = rows.filter((row) => row.category !== "Comida");
	const selected = filters.selectMovementFilterCategory("Comida", february);

	// Render-level guarding is not enough on its own: the view already drops the vanished category.
	assert.equal(
		filters.getMovementFilterView(selected, february, withoutComida).activeCategory,
		filters.ALL_CATEGORIES_FILTER,
	);

	// The reconciliation the table commits is what must clear the stored selection, because legacy
	// cleared the stored state too (`state.tableCategoryFilter = ""`, `public/app.js:1233`).
	const reconciled = filters.reconcileMovementFilterSelection(selected, february, withoutComida);
	assert.equal(reconciled.category, filters.ALL_CATEGORIES_FILTER);
	assert.equal(reconciled.periodKey, filters.getMovementFilterPeriodKey(february));
	// Idempotent: a cleared selection is already the reconciled one, so the commit settles at once.
	assert.equal(
		filters.reconcileMovementFilterSelection(reconciled, february, withoutComida),
		reconciled,
	);

	// A later edit reintroduces "Comida", and nobody re-selected it: the filter must stay off.
	const reintroducedView = filters.getMovementFilterView(reconciled, february, rows);
	assert.equal(reintroducedView.activeCategory, filters.ALL_CATEGORIES_FILTER);
	assert.deepEqual(reintroducedView.rows, rows);
	assert.equal(reintroducedView.count.isActive, false);
	// Sensitivity control: the selection the user never cleared would still narrow the rows, so the
	// assertions above cannot pass on a module that ignores a selected category.
	assert.deepEqual(
		filters
			.getMovementFilterView(filters.selectMovementFilterCategory("Comida", february), february, rows)
			.rows.map((row) => row.id),
		["a"],
	);
});

test("the React movements table reconciles the filter reset before the empty rows return so a stale category cannot come back", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [filters, page] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/movements/movementFilters.ts"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);

	// The table's own order is the guarantee: the reconciliation and its commit run above the
	// empty-rows return, so a period with no rows still replaces the selection it inherited instead of
	// carrying it into the next period. Legacy cleared the stored filter unconditionally
	// (`public/app.js:1008`, `:424`).
	const tableSource = page.slice(page.indexOf("export function MovementsTable"));
	assert.notEqual(tableSource, "", "the MovementsTable source must be locatable");
	const reconcileIndex = tableSource.indexOf("reconcileMovementFilterSelection(selection, period");
	const commitIndex = tableSource.indexOf("setSelection(currentSelection)");
	const emptyReturnIndex = tableSource.indexOf("movements.length === 0");
	assert.notEqual(reconcileIndex, -1, "the table must reconcile the stored selection");
	assert.notEqual(commitIndex, -1, "the table must commit the reconciled selection");
	assert.notEqual(emptyReturnIndex, -1, "the table must keep its empty-rows state");
	assert.ok(
		reconcileIndex < emptyReturnIndex,
		"the reconciliation must run before the empty-rows return",
	);
	assert.ok(
		commitIndex < emptyReturnIndex,
		"the reset must commit before the empty-rows return",
	);

	// The same sequence at module level: a filtered period A, a period B with zero rows, then A again.
	// Committing the reconciliation at every step — the empty one included — leaves A unfiltered.
	const periodA = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const periodB = { startDate: "2026-03-01", endDateExclusive: "2026-04-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
	];
	let stored = filters.selectMovementFilterCategory("Comida", periodA);
	stored = filters.reconcileMovementFilterSelection(stored, periodB, []);
	assert.equal(stored.periodKey, filters.getMovementFilterPeriodKey(periodB));
	assert.equal(stored.category, filters.ALL_CATEGORIES_FILTER);
	stored = filters.reconcileMovementFilterSelection(stored, periodA, rows);
	// Idempotent: the selection committed for A is already the reconciled one.
	assert.equal(
		filters.reconcileMovementFilterSelection(stored, periodA, rows),
		stored,
	);
	const restoredView = filters.getMovementFilterView(stored, periodA, rows);
	assert.equal(restoredView.activeCategory, filters.ALL_CATEGORIES_FILTER);
	assert.deepEqual(restoredView.rows, rows);
	assert.equal(restoredView.count.isActive, false);
});

test("the React movement sorting module mirrors legacy's four sortable keys, its neutral cycle and its total order", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [sorting, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/movements/movementSorting.ts"),
		readFile(
			new URL("../src/client/components/movements/movementSorting.ts", import.meta.url),
			"utf8",
		),
	]);

	// Sorting is an in-memory ordering, so the module must never issue a request, and it is a decision
	// module rather than a component: no fetch, no API layer, no React.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);

	// Legacy starts with both keys null (`state.sortKey`/`state.sortDir`, `public/app.js:142-143`).
	assert.deepEqual(sorting.createMovementSortState(), { key: null, direction: null });

	// `cycleSort` line for line (`public/app.js:3567-3578`): a first activation sorts ascending, a
	// second one descends, and a third one returns to the neutral state the `▬` indicator implies. The
	// neutral state is real, and it is what makes the loaded order reachable again.
	const neutral = sorting.createMovementSortState();
	const dateAsc = sorting.cycleMovementSort(neutral, "date");
	const dateDesc = sorting.cycleMovementSort(dateAsc, "date");
	const dateNeutral = sorting.cycleMovementSort(dateDesc, "date");
	assert.deepEqual(dateAsc, { key: "date", direction: "asc" });
	assert.deepEqual(dateDesc, { key: "date", direction: "desc" });
	assert.deepEqual(dateNeutral, { key: null, direction: null });
	// A different header starts a fresh ascending sort instead of continuing the previous cycle, and the
	// transition never mutates the state it was handed.
	assert.deepEqual(sorting.cycleMovementSort(dateDesc, "amount"), { key: "amount", direction: "asc" });
	assert.deepEqual(sorting.cycleMovementSort(dateNeutral, "amount"), { key: "amount", direction: "asc" });
	assert.deepEqual(dateAsc, { key: "date", direction: "asc" });

	// Indicators mirror `sortIndicator` (`public/app.js:3562-3565`) and `aria-sort` mirrors
	// `renderTableHead` (`:3545-3553`).
	const ascAmount = { key: "amount", direction: "asc" };
	const descAmount = { key: "amount", direction: "desc" };
	assert.equal(sorting.getMovementSortIndicator(neutral, "amount"), "\u25ac");
	assert.equal(sorting.getMovementSortIndicator(ascAmount, "amount"), "\u25b2");
	assert.equal(sorting.getMovementSortIndicator(descAmount, "amount"), "\u25bc");
	assert.equal(sorting.getMovementSortIndicator(ascAmount, "date"), "\u25ac");
	assert.equal(sorting.getMovementSortAriaSort(neutral, "amount"), "none");
	assert.equal(sorting.getMovementSortAriaSort(ascAmount, "amount"), "ascending");
	assert.equal(sorting.getMovementSortAriaSort(descAmount, "amount"), "descending");
	assert.equal(sorting.getMovementSortAriaSort(ascAmount, "date"), "none");

	const rows = [
		{ id: "a", counterparty: "Zapater\u00eda", amount: 25000, date: "2026-02-05", category: "Comida" },
		{ id: "b", counterparty: "\u00c1vila", amount: 5000, date: "2026-02-03", category: "Transporte" },
		// `a` and `c` share an amount: the tie is what proves the ordering is total and stable.
		{ id: "c", counterparty: "Mercado", amount: 25000, date: "2026-02-01", category: "Arriendo" },
		// A non-finite amount must not poison the order with NaN, and the shipped projection's own
		// fallbacks are what the label keys order by.
		{ id: "d", counterparty: "Sin monto", amount: Number.NaN, date: "2026-02-04", category: "" },
		{ id: "e", counterparty: "   ", amount: 7000, date: "2026-02-02", category: "  " },
	];
	const idsOf = (list) => list.map((row) => row.id);

	// No key is legacy's `if (!state.sortKey) return transactions` (`public/app.js:929`): the loaded
	// order is the answer, on a copy the caller cannot reorder the loaded rows through.
	assert.deepEqual(idsOf(sorting.sortMovements(rows, neutral)), ["a", "b", "c", "d", "e"]);
	assert.notEqual(sorting.sortMovements(rows, neutral), rows);

	// Amount: legacy subtracted `Number(value) || 0` (`public/app.js:935`), so a missing or non-finite
	// amount is a zero and the ordering stays finite and total.
	assert.deepEqual(idsOf(sorting.sortMovements(rows, ascAmount)), ["d", "b", "e", "a", "c"]);
	assert.deepEqual(idsOf(sorting.sortMovements(rows, descAmount)), ["a", "c", "e", "b", "d"]);

	// Date: legacy compared the raw `occurredAt` strings (`public/app.js:934`) instead of parsing them,
	// so the date-only `YYYY-MM-DD` values are never shifted by a timezone.
	assert.deepEqual(idsOf(sorting.sortMovements(rows, { key: "date", direction: "asc" })), [
		"c", "e", "b", "d", "a",
	]);
	assert.deepEqual(idsOf(sorting.sortMovements(rows, { key: "date", direction: "desc" })), [
		"a", "d", "b", "e", "c",
	]);

	// Counterparty and category: legacy used the `es` collation (`public/app.js:937-942`), and the
	// shipped fallbacks label a blank field instead of ordering it as an empty string.
	assert.deepEqual(idsOf(sorting.sortMovements(rows, { key: "counterparty", direction: "asc" })), [
		"b", "e", "c", "d", "a",
	]);
	assert.deepEqual(idsOf(sorting.sortMovements(rows, { key: "counterparty", direction: "desc" })), [
		"a", "d", "c", "e", "b",
	]);
	assert.deepEqual(idsOf(sorting.sortMovements(rows, { key: "category", direction: "asc" })), [
		"c", "a", "d", "e", "b",
	]);
	assert.deepEqual(idsOf(sorting.sortMovements(rows, { key: "category", direction: "desc" })), [
		"b", "d", "e", "a", "c",
	]);

	// A tie keeps the loaded order in both directions instead of flipping with the direction, because
	// legacy relied on a stable sort and negating a zero comparison is still a zero.
	assert.deepEqual(
		idsOf(sorting.sortMovements(rows, ascAmount)).filter((id) => id === "a" || id === "c"),
		["a", "c"],
	);
	assert.deepEqual(
		idsOf(sorting.sortMovements(rows, descAmount)).filter((id) => id === "a" || id === "c"),
		["a", "c"],
	);

	// The comparator is total and deterministic: every pair yields a finite number and it is
	// antisymmetric, so the `NaN` amount never leaks into the result.
	const sortKeys = ["date", "amount", "counterparty", "category"];
	for (const key of sortKeys) {
		for (const left of rows) {
			for (const right of rows) {
				const forward = sorting.compareMovements(left, right, key);
				const backward = sorting.compareMovements(right, left, key);
				assert.equal(Number.isFinite(forward), true, `${key} must stay finite`);
				assert.equal(forward + backward, 0, `${key} must be antisymmetric`);
			}
		}
	}
	// A real tie is reported as zero by the raw comparator and only the ordering step breaks it, which is
	// why the tie assertions above are the ones that prove determinism.
	assert.equal(sorting.compareMovements(rows[0], rows[2], "amount"), 0);
	assert.notEqual(sorting.compareMovements(rows[0], rows[2], "date"), 0);
	assert.notEqual(sorting.compareMovements(rows[0], rows[2], "counterparty"), 0);
	assert.notEqual(sorting.compareMovements(rows[0], rows[2], "category"), 0);

	// The module orders a copy: the caller's loaded rows keep their order and their identity.
	assert.deepEqual(idsOf(rows), ["a", "b", "c", "d", "e"]);
});

test("the React movements table headers expose the accessible sort control for the four legacy columns only", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, sorting, page, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/movements/movementSorting.ts"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const renderHead = (sort) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.MovementsTableHeader, { sort, onActivate: noop }),
		);

	// The neutral table: every legacy-sortable column is an activatable header whose indicator is the
	// flat `▬`, and `aria-sort="none"` is stated instead of being left implicit.
	const neutral = renderHead(sorting.createMovementSortState());
	assert.match(neutral, /<th scope="col" aria-sort="none"><button type="button"[^>]*aria-label="Ordenar por Contraparte"[^>]*>Contraparte \u25ac<\/button><\/th>/);
	assert.match(neutral, /<th scope="col" aria-sort="none"><button type="button"[^>]*aria-label="Ordenar por Monto"[^>]*>Monto \u25ac<\/button><\/th>/);
	assert.match(neutral, /<th scope="col" aria-sort="none"><button type="button"[^>]*aria-label="Ordenar por Fecha"[^>]*>Fecha \u25ac<\/button><\/th>/);
	assert.match(neutral, /<th scope="col" aria-sort="none"><button type="button"[^>]*aria-label="Ordenar por Categor\u00eda"[^>]*>Categor\u00eda \u25ac<\/button><\/th>/);
	assert.equal((neutral.match(/aria-sort="none"/g) ?? []).length, 4);
	assert.doesNotMatch(neutral, /aria-sort="ascending"|aria-sort="descending"/);
	// The actions column is not sortable in legacy (`renderTableHead`, `public/app.js:3506-3520`) and it
	// must not become a control here: no aria-sort, no button, no indicator.
	assert.match(neutral, /<th scope="col">Acciones<\/th>/);
	assert.doesNotMatch(neutral, /aria-label="Ordenar por Acciones"/);
	assert.equal((neutral.match(/\u25ac/g) ?? []).length, 4);

	// Ascending: exactly one header carries the direction, and it is the activated column.
	const ascending = renderHead({ key: "amount", direction: "asc" });
	assert.match(
		ascending,
		/<th scope="col" aria-sort="ascending" class="react-movement-sort-active"><button type="button"[^>]*aria-label="Ordenar por Monto"[^>]*>Monto \u25b2<\/button><\/th>/,
	);
	assert.equal((ascending.match(/aria-sort="ascending"/g) ?? []).length, 1);
	assert.equal((ascending.match(/aria-sort="none"/g) ?? []).length, 3);
	assert.match(ascending, />Contraparte \u25ac<\/button>/);
	assert.doesNotMatch(ascending, /aria-sort="descending"/);

	// Descending: the same column, the other direction, and the filled indicator.
	const descending = renderHead({ key: "amount", direction: "desc" });
	assert.match(
		descending,
		/<th scope="col" aria-sort="descending" class="react-movement-sort-active"><button type="button"[^>]*aria-label="Ordenar por Monto"[^>]*>Monto \u25bc<\/button><\/th>/,
	);
	assert.equal((descending.match(/aria-sort="descending"/g) ?? []).length, 1);
	assert.equal((descending.match(/aria-sort="none"/g) ?? []).length, 3);

	// The header is exported so both states are provable from a static render, and the table wires it to
	// the pure cycle instead of keeping a second transition of its own.
	assert.match(page, /export function MovementsTableHeader\(/);
	assert.match(page, /getMovementSortIndicator/);
	assert.match(page, /getMovementSortAriaSort/);
	assert.match(page, /<MovementsTableHeader/);
	assert.match(page, /cycleMovementSort/);

	// Scoped styles under the shipped `react-` prefix.
	assert.match(styles, /\.react-movement-sort-button \{/);
	assert.match(styles, /\.react-movement-sort-active \{/);
});

test("the React movement sorting orders the filtered rows without changing the filter's count, its rows or its reset", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [filters, sorting, React, renderer, pageModule, page] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/movements/movementFilters.ts"),
		vite.ssrLoadModule("/src/client/components/movements/movementSorting.ts"),
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	// The filtered rows are loaded in an order that is neither their ascending nor their descending
	// amount order, so the sorted expectations below cannot be satisfied by a sort that does nothing.
	const rows = [
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "c", counterparty: "Caf\u00e9", amount: 3500, date: "2026-02-04", category: "Comida" },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
	];
	const selection = filters.selectMovementFilterCategory("Comida", period);
	const view = filters.getMovementFilterView(selection, period, rows);
	const idsOf = (list) => list.map((row) => row.id);
	const loadedIds = idsOf(view.rows);
	const descRows = sorting.sortMovements(view.rows, { key: "amount", direction: "desc" });
	const ascRows = sorting.sortMovements(view.rows, { key: "amount", direction: "asc" });

	// Sorting is applied to the rows the filter left visible, so it can only reorder them: the visible
	// set is exactly the same, which is the property the count statement depends on.
	assert.deepEqual(loadedIds, ["b", "a", "c"]);
	assert.deepEqual(idsOf(descRows), ["a", "b", "c"]);
	assert.deepEqual(idsOf(ascRows), ["c", "b", "a"]);
	// The fixture discriminates: the loaded order is neither sorted order and the two directions differ
	// from each other, so a no-op sort and a direction-blind sort both fail the assertions above.
	assert.notDeepEqual(idsOf(descRows), loadedIds);
	assert.notDeepEqual(idsOf(ascRows), loadedIds);
	assert.notDeepEqual(idsOf(ascRows), idsOf(descRows));
	// Permutation: the same rows, only reordered, which is what keeps the count statement true.
	assert.deepEqual([...idsOf(descRows)].sort(), [...loadedIds].sort());
	assert.deepEqual([...idsOf(ascRows)].sort(), [...loadedIds].sort());
	// The filtered set the module returned was not reordered in place either.
	assert.deepEqual(idsOf(view.rows), ["b", "a", "c"]);

	// The count keeps describing the filtered set: same shown, same total, same statement, and the
	// sorted list has exactly that many rows. A count derived from the sorted list would be identical
	// only because sorting is a permutation, so the statement is compared verbatim, not just counted.
	assert.equal(view.count.isActive, true);
	assert.equal(view.count.category, "Comida");
	assert.equal(view.count.shown, 3);
	assert.equal(view.count.total, 4);
	assert.match(view.count.message, /3 de 4 movimientos\./);
	assert.equal(view.count.shown, descRows.length);
	const recount = filters.getMovementFilterView(selection, period, rows).count;
	assert.deepEqual(recount, view.count);

	// Sorting the same selection again is the same answer: nothing about the sort reached the filter,
	// so the filter cannot have been reset or narrowed by ordering the table.
	assert.deepEqual(
		filters.getMovementFilterView(selection, period, rows).rows.map((row) => row.id),
		["b", "a", "c"],
	);
	// An empty filtered set sorts to the empty answer, not to the loaded rows.
	const emptyView = filters.getMovementFilterView(
		filters.createMovementFilterSelection(period),
		period,
		[],
	);
	assert.deepEqual(emptyView.rows, []);
	assert.deepEqual(sorting.sortMovements(emptyView.rows, { key: "date", direction: "asc" }), []);
	assert.deepEqual(sorting.sortMovements([], { key: "amount", direction: "desc" }), []);

	// The proof is the rendered output, not the page's source shape: the rows appear in the order the
	// sort decided and the count statement is the one the filter decided. The view component renders one
	// already-decided state, so the container is rendered for its initial state and the view for an
	// explicit one. A no-op sort would render the loaded order [Feria, Mercado, Caf\u00e9] for both
	// directions and fail these assertions. The counterparty cell follows the selection cell when the
	// table renders with its selection layer, so the helper targets that cell in both shapes.
	const counterpartiesOf = (markup) =>
		[
			...markup.matchAll(
				/<tr>(?:<td class="react-movements-select-column">[\s\S]*?<\/td>)?<td>([^<]*)<\/td>/g,
			),
		].map((match) => match[1]);
	const renderView = (filteredView, sort) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.MovementsTableView, {
				filteredView,
				sort,
				editableMovements: [],
				onActivate: noop,
				onSelect: noop,
				onClear: noop,
				onEdit: noop,
				onRemove: noop,
			}),
		);

	const neutralMarkup = renderView(view, sorting.createMovementSortState());
	assert.deepEqual(counterpartiesOf(neutralMarkup), ["Feria", "Mercado", "Caf\u00e9"]);
	const descendingMarkup = renderView(view, { key: "amount", direction: "desc" });
	assert.deepEqual(counterpartiesOf(descendingMarkup), ["Mercado", "Feria", "Caf\u00e9"]);
	const ascendingMarkup = renderView(view, { key: "amount", direction: "asc" });
	assert.deepEqual(counterpartiesOf(ascendingMarkup), ["Caf\u00e9", "Feria", "Mercado"]);
	// The count statement in the markup is the filter's own, so an ordering cannot silently restate it.
	assert.ok(
		descendingMarkup.includes(view.count.message),
		"the table must render the count statement the filter decided",
	);
	assert.match(
		descendingMarkup,
		/<p class="react-movements-filter-count" role="status">Filtro activo: Comida\./,
	);

	// The container's initial state is the neutral one, and an inactive filter states no count at all.
	const containerMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.MovementsTable, {
			period,
			movements: rows,
			editableMovements: [],
			onEdit: noop,
			onRemove: noop,
		}),
	);
	assert.deepEqual(counterpartiesOf(containerMarkup), ["Feria", "Mercado", "Caf\u00e9", "Arriendo"]);
	assert.equal((containerMarkup.match(/aria-sort="none"/g) ?? []).length, 4);
	assert.doesNotMatch(containerMarkup, /Filtro activo/);
	const unfilteredView = filters.getMovementFilterView(
		filters.createMovementFilterSelection(period),
		period,
		rows,
	);
	assert.equal(unfilteredView.count.message, null);
	assert.doesNotMatch(
		renderView(unfilteredView, { key: "amount", direction: "desc" }),
		/role="status">/,
	);

	// Wiring a static render cannot exercise: activating a header only cycles the sort state and never
	// touches the selection. The transition itself is proved by the pure-module test above.
	const containerSource = page.slice(page.indexOf("export function MovementsTable"));
	assert.notEqual(containerSource, "", "the MovementsTable container must be locatable");
	assert.match(containerSource, /onActivate=\{\(key\) => setSort\(cycleMovementSort\(sort, key\)\)\}/);
	assert.doesNotMatch(containerSource, /onActivate=\{[^}]*setSelection/);
});

test("the React movement sorting pins where an unusable date lands, because the sentinel is not a date", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const sorting = await vite.ssrLoadModule("/src/client/components/movements/movementSorting.ts");
	const idsOf = (list) => list.map((row) => row.id);

	// The projection renders an unusable `occurredAt` as the sentinel the table displays
	// (`formatMovementDate`, `pages/DashboardPage.tsx:186-189`), and a row whose date is not even a
	// string falls back to the empty text. Both are read as literal text, so the sentinel's position is
	// the default collation's: arbitrary, but deterministic for a given runtime. This test pins that
	// position so a change to it cannot pass unnoticed.
	const rows = [
		{ id: "sentinel", counterparty: "Sin fecha", amount: 100, date: "\u2014", category: "Comida" },
		{ id: "missing", counterparty: "Sin dato", amount: 200, date: null, category: "Comida" },
		{ id: "old", counterparty: "Antiguo", amount: 300, date: "2026-01-15", category: "Comida" },
		{ id: "new", counterparty: "Reciente", amount: 400, date: "2026-02-01", category: "Comida" },
	];
	const asc = { key: "date", direction: "asc" };
	const desc = { key: "date", direction: "desc" };

	// The comparator reports the literal comparison, so the sentinel is neither a missing date nor a
	// zero: it is the string the table shows.
	assert.equal(sorting.compareMovements(rows[0], rows[1], "date"), "\u2014".localeCompare(""));
	assert.equal(
		sorting.compareMovements(rows[0], rows[2], "date"),
		"\u2014".localeCompare("2026-01-15"),
	);
	// Sensitivity control: the sentinel and the missing-date text are distinguishable, so the pinned
	// order below really does depend on comparing the sentinel as the table displays it. Collapsing the
	// sentinel to the missing-date text would tie the first two rows and leave them in loaded order.
	assert.notEqual("\u2014".localeCompare(""), "".localeCompare(""));
	assert.deepEqual(idsOf(sorting.sortMovements(rows, asc)), ["missing", "sentinel", "old", "new"]);
	assert.deepEqual(idsOf(sorting.sortMovements(rows, desc)), ["new", "old", "sentinel", "missing"]);
});

test("the React period analytics averages only the movements with a usable amount and states its divisor", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [analytics, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/analytics/periodAnalytics.ts"),
		readFile(
			new URL("../src/client/components/analytics/periodAnalytics.ts", import.meta.url),
			"utf8",
		),
	]);

	// The metrics come from the movements the summary already loaded, so the module must never issue a
	// request, and it is a decision module rather than a component: no fetch, no API layer, no React.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);

	// One period's loaded movements. "needs review" and "no usable amount" are deliberately different
	// sets — the review count is 2 while 3 recognized expenses carry no usable amount — so a number
	// folded from one fact into the other cannot satisfy both statements below.
	const periodTransactions = [
		{ direction: "outflow", kind: "purchase", amount: 10000, occurredAt: "2026-02-05", counterparty: "Mercado", status: "detected" },
		{ direction: "outflow", kind: "transfer", amount: 25000, occurredAt: "2026-02-03", counterparty: "  Arriendo  ", status: "needs_review" },
		{ direction: "outflow", kind: "payment", amount: 7500, occurredAt: "2026-02-01T14:30", counterparty: "Caf\u00e9", status: "manual" },
		{ direction: "outflow", kind: "purchase", amount: null, occurredAt: "2026-02-04", counterparty: "Feria", status: "needs_review" },
		{ direction: "outflow", kind: "transfer", amount: "unknown", occurredAt: "2026-02-02", status: "detected" },
		{ direction: "outflow", kind: "payment", amount: Number.NaN, occurredAt: "2026-02-06", status: "detected" },
		// Not recognized expenses: an inflow and an unknown kind never enter the average, the largest
		// expense or the unknown-amount statement.
		{ direction: "inflow", kind: "purchase", amount: 900000, occurredAt: "2026-02-01", status: "detected" },
		{ direction: "outflow", kind: "other", amount: 5000, occurredAt: "2026-02-07", status: "detected" },
	];

	// The average divides only by the movements carrying a usable amount, and the copy states how many
	// those were. (10000 + 25000 + 7500) / 3 = 14166.67, rounded to a whole peso because CLP has no cents.
	const view = analytics.getPeriodAnalytics(periodTransactions);
	assert.equal(view.average.amount, 14167);
	assert.equal(view.average.divisor, 3);
	assert.equal(view.average.emptyValue, null);
	assert.match(
		view.average.detail,
		/Promedio de 3 gastos reconocidos del periodo con monto conocido\./,
	);

	// The largest expense names its counterparty with the surface's own fallback and carries both its
	// amount and its date.
	assert.deepEqual(view.largest, {
		label: "Mayor gasto",
		counterparty: "Arriendo",
		amount: 25000,
		date: "2026-02-03",
	});

	// Two facts, two statements: the review count reads `status`; the unknown-amount statement counts
	// recognized expenses without a usable amount. Neither is folded into the other, and their numbers
	// differ so a folded number fails one of them.
	assert.equal(view.review.count, 2);
	assert.deepEqual(view.review.details, [
		"2 movimientos del periodo necesitan confirmaci\u00f3n.",
		"3 salidas reconocidas del periodo sin monto conocido.",
	]);
	assert.notEqual(view.review.count, 3);

	// A description stands in for a missing counterparty; a movement with neither falls back to the label
	// the rest of the surface uses, and an unusable date keeps the sentinel the table renders.
	const identified = analytics.getPeriodAnalytics([
		{ direction: "outflow", kind: "transfer", amount: 3000, description: "  Transferencia  ", occurredAt: "2026-02-09" },
	]);
	assert.deepEqual(identified.largest, {
		label: "Mayor gasto",
		counterparty: "Transferencia",
		amount: 3000,
		date: "2026-02-09",
	});
	const unnamed = analytics.getPeriodAnalytics([
		{ direction: "outflow", kind: "purchase", amount: 1200, occurredAt: "invalido" },
	]);
	assert.deepEqual(unnamed.largest, {
		label: "Mayor gasto",
		counterparty: "Gasto sin identificar",
		amount: 1200,
		date: "\u2014",
	});
	// A tie is decided by the loaded order, like legacy's first-wins reduce.
	const tie = analytics.getPeriodAnalytics([
		{ direction: "outflow", kind: "purchase", amount: 5000, counterparty: "Primero", occurredAt: "2026-02-01" },
		{ direction: "outflow", kind: "purchase", amount: 5000, counterparty: "Segundo", occurredAt: "2026-02-02" },
	]);
	assert.equal(tie.largest.counterparty, "Primero");
	assert.equal(tie.largest.date, "2026-02-01");

	// No usable amount, but the period does have recognized expenses: no average at all, and an honest
	// substitute instead of the zero legacy fabricated (`knownExpenses.length ? ... : 0`).
	const noAmount = analytics.getPeriodAnalytics([
		{ direction: "outflow", kind: "purchase", amount: null, occurredAt: "2026-02-04", status: "detected" },
		{ direction: "outflow", kind: "transfer", amount: "unknown", occurredAt: "2026-02-02", status: "detected" },
	]);
	assert.equal(noAmount.average.amount, null);
	assert.notEqual(noAmount.average.amount, 0);
	assert.equal(noAmount.average.divisor, 0);
	assert.equal(noAmount.average.emptyValue, "\u2014");
	assert.match(
		noAmount.average.detail,
		/Ninguno de los 2 gastos reconocidos del periodo tiene un monto conocido/,
	);
	assert.match(noAmount.average.detail, /no hay promedio ni mayor gasto que mostrar/);
	assert.equal(noAmount.largest, null);
	assert.deepEqual(noAmount.review.details, [
		"Nada urgente por corregir.",
		"2 salidas reconocidas del periodo sin monto conocido.",
	]);
	// One recognized expense and no usable amount is its own sentence, not a plural one built around it.
	const singleAmountless = analytics.getPeriodAnalytics([
		{ direction: "outflow", kind: "purchase", amount: null, occurredAt: "2026-02-04", status: "detected" },
	]);
	assert.match(
		singleAmountless.average.detail,
		/El \u00fanico gasto reconocido del periodo no tiene un monto conocido/,
	);
	assert.equal(singleAmountless.average.amount, null);

	// A period with no recognized expense at all says that instead of borrowing the other statement.
	const empty = analytics.getPeriodAnalytics([]);
	assert.equal(empty.average.amount, null);
	assert.equal(empty.average.divisor, 0);
	assert.equal(empty.average.emptyValue, "\u2014");
	assert.match(empty.average.detail, /No hay gastos reconocidos en el periodo/);
	assert.equal(empty.largest, null);
	assert.equal(empty.review.count, 0);
	assert.deepEqual(empty.review.details, ["Nada urgente por corregir."]);

	// The copy is scoped to the period the surface is showing, never to the calendar month, and it stays
	// in neutral Spanish.
	const allCopy = JSON.stringify([view, identified, unnamed, tie, noAmount, singleAmountless, empty]);
	assert.doesNotMatch(allCopy, /este mes/i);
	assert.doesNotMatch(allCopy, /\bvos\b|ten[e\u00e9]s|quer[e\u00e9]s|pod[e\u00e9]s|hac[e\u00e9]|and[a\u00e1]/i);
});

test("the React period analytics summary renders the three metrics and keeps the two review facts apart", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, analytics, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/analytics/periodAnalytics.ts"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	// The panel renders one already-decided state, so both the populated and the empty markup are
	// provable from a static render even though the live summary needs a session and effect-driven loads.
	const renderPanel = (transactions) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.PeriodAnalyticsPanel, {
				analytics: analytics.getPeriodAnalytics(transactions),
			}),
		);

	const periodTransactions = [
		{ direction: "outflow", kind: "purchase", amount: 10000, occurredAt: "2026-02-05", counterparty: "Mercado", status: "detected" },
		{ direction: "outflow", kind: "transfer", amount: 25000, occurredAt: "2026-02-03", counterparty: "Arriendo", status: "needs_review" },
		{ direction: "outflow", kind: "payment", amount: 7500, occurredAt: "2026-02-01T14:30", counterparty: "Caf\u00e9", status: "manual" },
		{ direction: "outflow", kind: "purchase", amount: null, occurredAt: "2026-02-04", counterparty: "Feria", status: "needs_review" },
		{ direction: "outflow", kind: "transfer", amount: "unknown", occurredAt: "2026-02-02", status: "detected" },
		{ direction: "outflow", kind: "payment", amount: Number.NaN, occurredAt: "2026-02-06", status: "detected" },
	];
	const markup = renderPanel(periodTransactions);

	// The three metrics, in the shipped card convention: the average states the divisor it used, the
	// largest carries its amount and its date next to the counterparty, and the review card states the
	// count that comes from `status`.
	assert.match(
		markup,
		/<span>Gasto promedio<\/span><strong>\$14\.167<\/strong><p>Promedio de 3 gastos reconocidos del periodo con monto conocido\.<\/p>/,
	);
	assert.match(
		markup,
		/<span>Mayor gasto<\/span><strong>\$25\.000<\/strong><p>Arriendo \u00b7 2026-02-03<\/p>/,
	);
	assert.match(markup, /<span>Qu\u00e9 revisar<\/span><strong>2<\/strong>/);

	// The two facts stay two statements, each with its own number and its own paragraph: the review
	// count is 2 while 3 recognized expenses carry no known amount, so a folded number cannot render
	// both. Legacy's `pendingReviewCount || unknownExpenseCount` is exactly what this rules out.
	assert.match(
		markup,
		/<p>2 movimientos del periodo necesitan confirmaci\u00f3n\.<\/p><p>3 salidas reconocidas del periodo sin monto conocido\.<\/p>/,
	);
	assert.notEqual(analytics.getPeriodAnalytics(periodTransactions).review.count, 3);

	// The new region does not duplicate or reword the four cards this surface already had.
	assert.doesNotMatch(
		markup,
		/Ingreso configurado|Gasto total|Gastos reconocidos|Montos pendientes/,
	);

	// No recognized expense with a usable amount, but the period does have recognized expenses: the
	// average shows no number at all, never the zero legacy fabricated, and the largest expense is not
	// shown because there is none.
	const noAmountMarkup = renderPanel([
		{ direction: "outflow", kind: "purchase", amount: null, occurredAt: "2026-02-04", counterparty: "Feria", status: "needs_review" },
		{ direction: "outflow", kind: "transfer", amount: "unknown", occurredAt: "2026-02-02", status: "detected" },
	]);
	assert.match(noAmountMarkup, /<span>Gasto promedio<\/span><strong>\u2014<\/strong>/);
	assert.doesNotMatch(noAmountMarkup, /\$0/);
	assert.match(
		noAmountMarkup,
		/Ninguno de los 2 gastos reconocidos del periodo tiene un monto conocido: no hay promedio ni mayor gasto que mostrar\./,
	);
	assert.doesNotMatch(noAmountMarkup, /Mayor gasto/);
	assert.match(
		noAmountMarkup,
		/<strong>1<\/strong><p>1 movimiento del periodo necesita confirmaci\u00f3n\.<\/p><p>2 salidas reconocidas del periodo sin monto conocido\.<\/p>/,
	);

	// A period with no movements at all states its own absence, and its review card is a measured zero
	// with the calm copy, not a substitute for a number it could not compute.
	const emptyMarkup = renderPanel([]);
	assert.match(emptyMarkup, /<span>Gasto promedio<\/span><strong>\u2014<\/strong>/);
	assert.match(emptyMarkup, /No hay gastos reconocidos en el periodo/);
	assert.doesNotMatch(emptyMarkup, /\$0|Mayor gasto/);
	assert.match(emptyMarkup, /<span>Qu\u00e9 revisar<\/span><strong>0<\/strong><p>Nada urgente por corregir\.<\/p>/);
	// Sensitivity control: the patterns certified absent above match the same component when the state
	// they describe is actually rendered, so each absence observes a real absence.
	assert.match(markup, /Mayor gasto/);
	assert.match(markup, /<strong>\$14\.167<\/strong>/);

	// Each fact is stated alone when it is the only one.
	const onlyReviewMarkup = renderPanel([
		{ direction: "outflow", kind: "purchase", amount: 1000, occurredAt: "2026-02-04", status: "needs_review" },
	]);
	assert.match(onlyReviewMarkup, /<strong>1<\/strong><p>1 movimiento del periodo necesita confirmaci\u00f3n\.<\/p>/);
	assert.doesNotMatch(onlyReviewMarkup, /sin monto conocido/);
	const onlyUnknownMarkup = renderPanel([
		{ direction: "outflow", kind: "purchase", amount: null, occurredAt: "2026-02-04", status: "detected" },
	]);
	assert.match(
		onlyUnknownMarkup,
		/<strong>0<\/strong><p>Nada urgente por corregir\.<\/p><p>1 salida reconocida del periodo sin monto conocido\.<\/p>/,
	);

	// The rendered copy never borrows the calendar month this product stopped navigating by.
	assert.doesNotMatch(markup, /este mes/i);

	// Scoped styles under the shipped `react-` prefix; the region reuses the card and grid primitives.
	assert.match(styles, /\.react-period-analytics \{/);
	assert.match(styles, /\.react-period-analytics h3 \{/);
});

test("the React authenticated summary mounts the period analytics panel without adding a request", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, page] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);

	// The summary's ready state needs a live session and effect-driven loads, so a static render only
	// ever shows its loading state: what the authenticated container does with the decided analytics is
	// provable from the wiring, and the metrics themselves are proved by the render test above.
	assert.match(page, /from "\.\.\/components\/analytics\/periodAnalytics"/);
	assert.match(page, /\bgetPeriodAnalytics\b/);
	assert.match(page, /const periodAnalytics = getPeriodAnalytics\(state\.data\.transactions\);/);
	// The shared analytics body mounts the panel once for both the authenticated summary and the demo.
	assert.equal((page.match(/<PeriodAnalyticsPanel/g) ?? []).length, 1);
	assert.match(page, /<PeriodAnalyticsPanel analytics=\{analytics\} \/>/);
	assert.match(page, /export function PeriodAnalyticsPanel\(/);
	// The metrics are derived, never fetched: the module owns no request and the page adds none.
	assert.doesNotMatch(page, /loadPeriodAnalytics|fetch\("\/api\/analytics/);

	// The same read-only panel is reused by the demo tree, checked against a render that is provably
	// not empty.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	assert.match(demoMarkup, /Solo lectura/);
	// The demo now mounts the same read-only period metrics as the authenticated summary.
	assert.match(demoMarkup, /react-period-analytics/);
	assert.match(demoMarkup, /Gasto promedio/);
	assert.match(page, /className="react-period-analytics"/);
});

test("the React category ranking groups recognized outflows by raw totals, merges the tail and discloses the unknown amounts", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [ranking, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/analytics/categoryRanking.ts"),
		readFile(
			new URL("../src/client/components/analytics/categoryRanking.ts", import.meta.url),
			"utf8",
		),
	]);

	// The ranking is a decision module over the rows the summary already loaded, so it must never
	// issue a request, and it renders nothing: no fetch, no API layer, no React.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);

	// Six categories. " comida " is the same category as "Comida" (legacy `categoryKey`,
	// `public/app.js:3311`), so it merges into one group and the first-seen label is kept.
	const movements = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		{ id: "c", counterparty: "Caf\u00e9", amount: 3500, date: "2026-02-04", category: " comida " },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
		{ id: "e", counterparty: "Supermercado", amount: 12000, date: "2026-02-06", category: "Supermercado" },
		{ id: "f", counterparty: "Sin identificar", amount: 1000, date: "2026-02-07", category: "Sin categoría" },
		{ id: "g", counterparty: "Cine", amount: 8000, date: "2026-02-08", category: "Entretenimiento" },
		{ id: "h", counterparty: "Bus", amount: 2000, date: "2026-02-09", category: "Transporte" },
	];

	// Three recognized outflows of the period carry no usable amount: they are excluded from every
	// total and disclosed, never silently dropped.
	const view = ranking.getCategoryRanking(movements, 3);
	assert.equal(view.total, 456500);
	assert.equal(view.unknownAmountCount, 3);
	assert.equal(
		view.disclosure,
		"3 salidas reconocidas del periodo no tienen monto conocido y no se incluyen en esta distribución.",
	);

	// Top three by raw total, then the tail merged after the third. The merged row carries the raw
	// tail total, the summed count and the tail's own share of the grand total.
	assert.deepEqual(view.rows.map((row) => row.category), [
		"Arriendo",
		"Comida",
		"Supermercado",
		"Otras categorías",
	]);
	assert.deepEqual(view.rows.map((row) => row.total), [400000, 33500, 12000, 11000]);
	assert.deepEqual(view.rows.map((row) => row.count), [1, 3, 1, 3]);
	// Shares are computed from raw totals and rounded once: 400000/456500, 33500/456500,
	// 12000/456500 and 11000/456500.
	assert.deepEqual(view.rows.map((row) => row.share), [88, 7, 3, 2]);
	assert.deepEqual(view.rows.map((row) => row.mergesTail), [false, false, false, true]);

	// The merged row lists the categories it absorbed, ranked, and no counterparties; a real category
	// lists its own counterparties, ranked, and no children.
	assert.deepEqual(view.rows[3].children, [
		{ category: "Entretenimiento", total: 8000, count: 1 },
		{ category: "Transporte", total: 2000, count: 1 },
		{ category: "Sin categoría", total: 1000, count: 1 },
	]);
	assert.deepEqual(view.rows[3].counterparties, []);
	assert.deepEqual(view.rows[1].counterparties, [
		{ counterparty: "Mercado", total: 25000, count: 1 },
		{ counterparty: "Feria", total: 5000, count: 1 },
		{ counterparty: "Caf\u00e9", total: 3500, count: 1 },
	]);
	assert.deepEqual(view.rows[0].children, []);

	// The exact display label is a decision the surface reads back: selection and the jump into the
	// filter both match on it case- and accent-insensitively.
	assert.equal(ranking.findCategoryRankingRow(view, "  comida ").category, "Comida");
	assert.equal(ranking.findCategoryRankingRow(view, "otras categor\u00edas").mergesTail, true);
	assert.equal(ranking.findCategoryRankingRow(view, "Vacaciones"), null);

	// Three categories or fewer are all shown: nothing is merged and there are no children.
	const small = ranking.getCategoryRanking([movements[0], movements[3]], 0);
	assert.deepEqual(small.rows.map((row) => row.category), ["Arriendo", "Comida"]);
	assert.equal(small.rows.some((row) => row.mergesTail), false);
	assert.equal(small.disclosure, null);

	// A single excluded outflow is stated as one, not pluralised around a digit.
	assert.match(
		ranking.getCategoryRanking(movements, 1).disclosure,
		/^1 salida reconocida del periodo no tiene monto conocido y no se incluye en esta distribución\.$/,
	);

	// The merged share is the raw tail ratio rounded once, not the sum of the already-rounded shares
	// of the children — the legacy insight bug (`public/app.js:2925`) this port must not reproduce.
	const roundingFixture = [
		{ id: "1", counterparty: "A", amount: 400, date: "", category: "A" },
		{ id: "2", counterparty: "B", amount: 200, date: "", category: "B" },
		{ id: "3", counterparty: "C", amount: 100, date: "", category: "C" },
		{ id: "4", counterparty: "D", amount: 75, date: "", category: "D" },
		{ id: "5", counterparty: "E", amount: 75, date: "", category: "E" },
		{ id: "6", counterparty: "F", amount: 75, date: "", category: "F" },
		{ id: "7", counterparty: "G", amount: 75, date: "", category: "G" },
	];
	const rounding = ranking.getCategoryRanking(roundingFixture, 0);
	const tail = rounding.rows.find((row) => row.mergesTail);
	assert.equal(tail.total, 300);
	assert.equal(tail.share, 30);
	// The four child rows each round to 8%, which would sum to 32%; the tail's own share is not 32.
	assert.equal(Math.round((75 / 1000) * 100) * 4, 32);
	assert.notEqual(tail.share, 32);

	// Degenerate input stays honest: no rows, no total, no disclosure, and the empty list is not a
	// category the surface could select.
	const empty = ranking.getCategoryRanking([], 0);
	assert.deepEqual(empty.rows, []);
	assert.equal(empty.total, 0);
	assert.equal(empty.unknownAmountCount, 0);
	assert.equal(empty.disclosure, null);
	assert.equal(ranking.findCategoryRankingRow(empty, "Comida"), null);

	// Neutral Spanish throughout, and never the calendar month this product stopped navigating by.
	const allCopy = JSON.stringify([view, small, rounding, empty]);
	assert.doesNotMatch(allCopy, /este mes/i);
	assert.doesNotMatch(allCopy, /\bvos\b|ten[e\u00e9]s|quer[e\u00e9]s|pod[e\u00e9]s|hac[e\u00e9]|and[a\u00e1]/i);
});

test("the React category ranking view renders the ranked rows, the counterparty detail and the merged tail without a jump", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, analytics, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/analytics/categoryRanking.ts"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const movements = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		{ id: "c", counterparty: "Caf\u00e9", amount: 3500, date: "2026-02-04", category: "Comida" },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
		{ id: "e", counterparty: "Supermercado", amount: 12000, date: "2026-02-06", category: "Supermercado" },
		{ id: "f", counterparty: "Sin identificar", amount: 1000, date: "2026-02-07", category: "Sin categoría" },
		{ id: "g", counterparty: "Cine", amount: 8000, date: "2026-02-08", category: "Entretenimiento" },
		{ id: "h", counterparty: "Bus", amount: 2000, date: "2026-02-09", category: "Transporte" },
	];
	const view = analytics.getCategoryRanking(movements, 3);

	// The view renders one already-decided state, so both the list and the detail markup are provable
	// from a static render even though the live summary needs a session.
	const renderView = (selectedCategory, ranking = view) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.CategoryRankingView, {
				ranking,
				selectedCategory,
				onSelect: noop,
				onClearSelection: noop,
				onJumpToCategory: noop,
			}),
		);

	// The ranked list: the title, the unknown-amount disclosure, and one row per category with the
	// amount, the integer share and the movement count.
	const list = renderView(null);
	assert.match(list, /<h3 id="react-category-ranking-title">Gasto reconocido por categoría<\/h3>/);
	assert.match(
		list,
		/<p class="react-category-ranking-disclosure" role="status">3 salidas reconocidas del periodo no tienen monto conocido y no se incluyen en esta distribución\.<\/p>/,
	);
	assert.match(list, /<strong>Arriendo<\/strong><small>\$400\.000 \u00b7 88% \u00b7 1 movimiento<\/small>/);
	assert.match(list, /<strong>Comida<\/strong><small>\$33\.500 \u00b7 7% \u00b7 3 movimientos<\/small>/);
	assert.match(list, /<strong>Otras categorías<\/strong><small>\$11\.000 \u00b7 2% \u00b7 3 movimientos<\/small>/);
	assert.match(list, /class="react-category-ranking-list"/);
	assert.doesNotMatch(list, /react-category-detail/);

	// The detail of a real category: its own header and the counterparties inside it, each with its
	// amount and count, plus the jump into the movement filter and the way back.
	const comidaDetail = renderView("Comida");
	assert.match(
		comidaDetail,
		/<header class="react-category-detail-header"><strong>Comida<\/strong><small>\$33\.500 \u00b7 7% \u00b7 3 movimientos<\/small><\/header>/,
	);
	assert.match(comidaDetail, /<article class="react-category-detail-row"><strong>Mercado<\/strong><small>\$25\.000 \u00b7 1 movimiento<\/small><\/article>/);
	assert.match(comidaDetail, /<article class="react-category-detail-row"><strong>Feria<\/strong><small>\$5\.000 \u00b7 1 movimiento<\/small><\/article>/);
	assert.match(comidaDetail, /<article class="react-category-detail-row"><strong>Caf\u00e9<\/strong><small>\$3\.500 \u00b7 1 movimiento<\/small><\/article>/);
	assert.match(comidaDetail, /Ver gastos de esta categoría/);
	assert.match(comidaDetail, /\u2190 Todas las categorías/);
	assert.doesNotMatch(comidaDetail, /react-category-ranking-list/);

	// The merged tail has no category of its own to jump to, so it offers no jump control and lists
	// the categories it merged instead of counterparties.
	const tailDetail = renderView("Otras categorías");
	assert.match(tailDetail, /<header class="react-category-detail-header"><strong>Otras categorías<\/strong>/);
	assert.match(tailDetail, /<article class="react-category-detail-row"><strong>Entretenimiento<\/strong><small>\$8\.000 \u00b7 1 movimiento<\/small><\/article>/);
	assert.match(tailDetail, /<article class="react-category-detail-row"><strong>Transporte<\/strong><small>\$2\.000 \u00b7 1 movimiento<\/small><\/article>/);
	assert.match(tailDetail, /<article class="react-category-detail-row"><strong>Sin categoría<\/strong><small>\$1\.000 \u00b7 1 movimiento<\/small><\/article>/);
	assert.doesNotMatch(tailDetail, /Ver gastos de esta categoría/);
	assert.match(tailDetail, /\u2190 Todas las categorías/);
	// Sensitivity control: the real-category detail does render the jump the tail withholds.
	assert.match(comidaDetail, /Ver gastos de esta categoría/);

	// A period with nothing to rank states its own absence instead of an empty list, and the
	// disclosure appears only when there is an excluded outflow to disclose.
	const empty = renderView(null, analytics.getCategoryRanking([], 0));
	assert.match(empty, /class="react-category-ranking-empty"/);
	assert.match(empty, /Aún no hay gastos con monto conocido para distribuir por categoría/);
	assert.doesNotMatch(empty, /react-category-ranking-list/);
	assert.doesNotMatch(empty, /react-category-ranking-disclosure/);
	assert.doesNotMatch(renderView(null, analytics.getCategoryRanking(movements, 0)), /react-category-ranking-disclosure/);

	// The copy never borrows the calendar month this product stopped navigating by.
	assert.doesNotMatch(list, /este mes/i);

	// Demo protection is structural: the read-only tree mounts neither the ranking nor its class, and
	// the absences are checked against a render that is provably not empty.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	assert.match(demoMarkup, /Solo lectura/);
	assert.match(demoMarkup, /Mercado/);
	assert.doesNotMatch(demoMarkup, /react-category-ranking|Gasto reconocido por categoría|Otras categorías/);

	// Scoped styles under the shipped `react-` prefix.
	assert.match(styles, /\.react-category-ranking \{/);
	assert.match(styles, /\.react-category-ranking-disclosure \{/);
	assert.match(styles, /\.react-category-ranking-list \{/);
	assert.match(styles, /\.react-category-ranking-row \{/);
	assert.match(styles, /\.react-category-detail \{/);
	assert.match(styles, /\.react-category-detail-header \{/);
	assert.match(styles, /\.react-category-detail-row \{/);
	assert.match(styles, /\.react-category-detail-actions \{/);
});

test("the React authenticated summary composes the category ranking and jumps into the in-memory movement filter", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, page] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const rows = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		{ id: "c", counterparty: "Caf\u00e9", amount: 3500, date: "2026-02-04", category: "Comida" },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
	];
	// The counterparty cell follows the selection cell when the table renders with its selection
	// layer, so the helper targets that cell in both shapes.
	const counterpartiesOf = (markup) =>
		[
			...markup.matchAll(
				/<tr>(?:<td class="react-movements-select-column">[\s\S]*?<\/td>)?<td>([^<]*)<\/td>/g,
			),
		].map((match) => match[1]);

	// The jump the ranking performs is the requested category handed to the movements table, which
	// consumes it when it mounts. The container's initial state is therefore behaviourally provable
	// from a static render: this is the same wiring the summary mounts after switching view.
	const renderTable = (requestedCategory) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.MovementsTable, {
				period,
				movements: rows,
				editableMovements: [],
				...(requestedCategory === undefined ? {} : { requestedCategory }),
				onEdit: noop,
				onRemove: noop,
			}),
		);

	const jumped = renderTable("Comida");
	assert.deepEqual(counterpartiesOf(jumped), ["Mercado", "Feria", "Caf\u00e9"]);
	assert.match(jumped, /Filtro activo: Comida/);
	assert.match(jumped, /<option[^>]*value="Comida" selected=""/);
	assert.match(jumped, /Limpiar filtro<\/button>/);

	// No request, no jump: the unfiltered table shows every loaded row.
	const plain = renderTable(undefined);
	assert.deepEqual(counterpartiesOf(plain), ["Mercado", "Feria", "Caf\u00e9", "Arriendo"]);
	assert.doesNotMatch(plain, /Filtro activo/);
	assert.match(plain, /<option[^>]*value="" selected=""/);

	// A jumped category the loaded rows no longer carry clears instead of hiding every row: the
	// table's existing reconciliation still owns the reset.
	const vanished = renderTable("Vacaciones");
	assert.deepEqual(counterpartiesOf(vanished), ["Mercado", "Feria", "Caf\u00e9", "Arriendo"]);
	assert.doesNotMatch(vanished, /Filtro activo/);

	// The ranking is derived from the rows and the pending count the summary already computed, so the
	// page composes it and adds no request of its own.
	assert.match(page, /from "\.\.\/components\/analytics\/categoryRanking"/);
	assert.match(page, /\bgetCategoryRanking\b/);
	assert.match(page, /const categoryRanking = getCategoryRanking\(movements, summary\.pendingAmountCount\);/);
	// The shared analytics body mounts the ranking wrapper once for both the authenticated summary and
	// the read-only demo, so the wrapper keeps a single mount site.
	assert.equal((page.match(/<CategoryRankingPanel/g) ?? []).length, 1);
	assert.match(page, /onJumpToCategory=\{/);
	assert.match(page, /setRequestedCategory\(category\)/);
	// The requested category is handed to the table the jump switches to.
	assert.match(page, /<MovementsTable[\s\S]{0,400}?requestedCategory=/);
	const tableSource = page.slice(page.indexOf("export function MovementsTable"));
	assert.notEqual(tableSource, "", "the MovementsTable container must be locatable");
	assert.match(tableSource, /requestedCategory/);
	// No analytics request was introduced anywhere in the page.
	assert.doesNotMatch(page, /loadCategoryRanking|fetch\("\/api\/analytics/);
});

test("the React spending chart buckets the configured period into Monday-to-Sunday weeks and discloses the excluded outflows", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [chart, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts"),
		readFile(
			new URL("../src/client/components/analytics/spendingChart.ts", import.meta.url),
			"utf8",
		),
	]);

	// The chart is a decision module over the rows the summary already loaded, so it must never
	// issue a request, and it renders nothing: no fetch, no API layer, no React.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);
	// Date arithmetic is UTC/date-string based so the runner's timezone cannot shift a day.
	assert.match(moduleSource, /Date\.UTC|getUTCDay/);
	assert.doesNotMatch(moduleSource, /\.getDay\(/);

	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const movements = [
		{ id: "a", counterparty: "A", amount: 1000, date: "2026-02-01", category: "Comida" },
		{ id: "b", counterparty: "B", amount: 2000, date: "2026-02-02", category: "Comida" },
		{ id: "c", counterparty: "C", amount: 100, date: "2026-02-03", category: "Comida" },
		{ id: "d", counterparty: "D", amount: 3000, date: "2026-02-08", category: "Comida" },
		{ id: "e", counterparty: "E", amount: 4000, date: "2026-02-28", category: "Comida" },
		// A recognized outflow whose date is unusable is disclosed, never placed on a day.
		{ id: "f", counterparty: "F", amount: 500, date: "\u2014", category: "Comida" },
	];
	const view = chart.getSpendingChart(movements, period, 2);

	// Five Monday-to-Sunday weeks cover Feb 1 (a Sunday) through Feb 28.
	assert.equal(view.weeks.length, 5);
	assert.deepEqual(view.weeks.map((week) => week.id), ["week-0", "week-1", "week-2", "week-3", "week-4"]);
	assert.deepEqual(view.weeks.map((week) => week.label), ["Semana 1", "Semana 2", "Semana 3", "Semana 4", "Semana 5"]);
	// Week 1 starts on Jan 26 but only Feb 1 is inside the period: the six padded days carry no total.
	assert.equal(view.weeks[0].range, "1 feb al 1 feb");
	assert.deepEqual(view.weeks[0].days.map((day) => day.isInPeriod), [false, false, false, false, false, false, true]);
	assert.deepEqual(view.weeks[0].days.map((day) => day.detail), ["", "", "", "", "", "", "1 feb"]);
	// Week 5 ends on Mar 1 but only Feb 23-28 are inside the period.
	assert.equal(view.weeks[4].range, "23 feb al 28 feb");
	assert.deepEqual(view.weeks[4].days.map((day) => day.isInPeriod), [true, true, true, true, true, true, false]);
	// Weekday labels always run Monday to Sunday.
	assert.deepEqual(
		view.weeks[1].days.map((day) => day.label),
		["lun", "mar", "mi\u00e9", "jue", "vie", "s\u00e1b", "dom"],
	);
	// Totals land on the day they belong to, and only in-period days receive them.
	assert.deepEqual(view.weeks[1].days.map((day) => day.total), [2000, 100, 0, 0, 0, 0, 3000]);
	assert.equal(view.weeks[0].days[6].total, 1000);
	assert.equal(view.weeks[4].days[5].total, 4000);

	// The full period aggregates by weekday, not by week.
	assert.deepEqual(
		view.periodDays.map((day) => day.key),
		["weekday-0", "weekday-1", "weekday-2", "weekday-3", "weekday-4", "weekday-5", "weekday-6"],
	);
	assert.deepEqual(view.periodDays.map((day) => day.total), [2000, 100, 0, 0, 0, 4000, 4000]);

	// Tabs: one per week plus the full period.
	assert.deepEqual(
		view.tabs.map((tab) => tab.id),
		["week-0", "week-1", "week-2", "week-3", "week-4", "period"],
	);
	assert.deepEqual(
		view.tabs.map((tab) => tab.label),
		["Semana 1", "Semana 2", "Semana 3", "Semana 4", "Semana 5", "Periodo completo"],
	);

	// Raw finite recognized outflow totals only, with both exclusions disclosed as separate facts.
	assert.equal(view.total, 10100);
	assert.equal(view.countedCount, 5);
	assert.equal(view.hasData, true);
	assert.equal(view.emptyMessage, null);
	assert.equal(view.unknownAmountCount, 2);
	assert.equal(view.unknownDateCount, 1);
	assert.deepEqual(view.disclosures, [
		"2 salidas reconocidas del periodo no tienen monto conocido y no se incluyen en este gr\u00e1fico.",
		"1 salida reconocida del periodo con monto conocido no tiene una fecha v\u00e1lida y no se puede ubicar en el gr\u00e1fico.",
	]);

	// Proportional heights per selected series, with the legacy 12% floor: a small positive day stays
	// visible at 12% instead of collapsing to its raw 3%.
	const fullSeries = chart.getSpendingChartSeries(view, "period");
	assert.equal(fullSeries.detail, "01/02/2026 a 28/02/2026");
	assert.equal(fullSeries.ariaLabel, "Periodo completo, total gastado por cada d\u00eda de la semana");
	assert.deepEqual(fullSeries.days.map((day) => day.heightPercent), [50, 12, 0, 0, 0, 100, 100]);
	// The weekday aggregate carries the period-wide weekday detail the native tooltip restores.
	assert.equal(fullSeries.days[0].titleDetail, "Total del periodo por lunes");
	const week2 = chart.getSpendingChartSeries(view, "week-1");
	assert.equal(week2.label, "Semana 2");
	assert.equal(week2.ariaLabel, "Semana 2, gasto diario de lunes a domingo");
	assert.deepEqual(week2.days.map((day) => day.heightPercent), [67, 12, 0, 0, 0, 0, 100]);
	assert.equal(week2.days[1].heightPercent, 12);
	// An unknown tab id falls back to the full period, like legacy `selectedChartSeries`.
	assert.equal(chart.getSpendingChartSeries(view, "nope").id, "period");

	// No countable data: no bars, an explicit message, and no disclosures to state.
	const empty = chart.getSpendingChart([], period, 0);
	assert.equal(empty.hasData, false);
	assert.equal(empty.total, 0);
	assert.match(empty.emptyMessage, /^A\u00fan no hay/);
	assert.deepEqual(empty.disclosures, []);
	// Rows that add up to nothing are their own state, not a claim that no movement exists.
	const zero = chart.getSpendingChart(
		[{ id: "z", counterparty: "Z", amount: 0, date: "2026-02-02", category: "Comida" }],
		period,
		0,
	);
	assert.equal(zero.countedCount, 1);
	assert.equal(zero.hasData, false);
	assert.match(zero.emptyMessage, /no suman un monto positivo/);
	// A single unknown outflow is stated as one, not pluralised around a digit.
	assert.match(
		chart.getSpendingChart([], period, 1).disclosures[0],
		/^1 salida reconocida del periodo no tiene monto conocido y no se incluye en este gr\u00e1fico\.$/,
	);

	// Neutral Spanish throughout.
	const allCopy = JSON.stringify([view, empty, zero]);
	assert.doesNotMatch(allCopy, /\bvos\b|ten[e\u00e9]s|quer[e\u00e9]s|pod[e\u00e9]s|hac[e\u00e9]|and[a\u00e1]/i);
});

test("the spending chart shows zero days as $0 and selects without automatic page scrolling", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, page, analytics, source, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);
	const chart = analytics.getSpendingChart(
		[{ id: "a", amount: 2000, date: "2026-02-01", counterparty: "Mercado", category: "Comida" }],
		{ startDate: "2026-02-01", endDateExclusive: "2026-02-04" },
		0,
	);
	const renderDay = (selectedTab, selectedDayKey) => renderer.renderToStaticMarkup(
		React.createElement(page.SpendingChartView, {
			chart,
			selectedTab,
			onSelectTab: () => {},
			selectedDayKey,
			onSelectDay: () => {},
			detailMovements: [{ id: "a", label: "Mercado", kindLabel: "Compras", amount: 2000, dateKey: "2026-02-01", time: "" }],
		}),
	);
	const week = renderDay("week-1", "2026-02-02");
	assert.match(week, /aria-label="Ver detalle de lun 2 feb: \$0"/);
	assert.match(week, /aria-controls="react-spending-chart-day-detail"/);
	assert.match(week, /<span class="react-spending-chart-value" aria-hidden="true">\$0<\/span>/);
	assert.match(week, /title="lun · 2 feb: \$0"/);
	assert.match(week, /<header class="react-spending-chart-day-header"><h4>Detalle del lunes 2 feb<\/h4><strong class="react-spending-chart-day-total">\$0<\/strong><\/header><p class="react-spending-chart-day-empty">/);
	assert.match(week, /No hay gastos con monto conocido para este día\./);
	assert.doesNotMatch(week, /Sin gasto cuantificado|sin gasto cuantificado/);
	const positive = renderDay("week-0", "2026-02-01");
	assert.match(positive, /<span class="react-spending-chart-value react-spending-chart-value-positive" aria-hidden="true">\$2\.000<\/span>/);
	assert.match(positive, /title="dom · 1 feb: \$2\.000"/);
	assert.match(positive, /<header class="react-spending-chart-day-header"><h4>Detalle del domingo 1 feb<\/h4><strong class="react-spending-chart-day-total">\$2\.000<\/strong><\/header><div class="react-spending-chart-day-group">/);
	const unselected = renderDay("week-0", null);
	assert.match(unselected, /<header class="react-spending-chart-day-header"><h4>Selecciona una barra<\/h4><\/header>/);
	assert.doesNotMatch(unselected.slice(unselected.indexOf('class="react-spending-chart-day-panel"')), /react-spending-chart-day-total/);
	const panelRule = styles.match(/\.react-spending-chart-day-panel \{([^}]*)\}/)?.[1] ?? "";
	assert.match(panelRule, /overflow-y: auto;/);
	const headerRule = styles.match(/\.react-spending-chart-day-header \{([^}]*)\}/)?.[1] ?? "";
	assert.match(headerRule, /position: sticky;/);
	assert.match(headerRule, /top: 0;/);
	assert.match(headerRule, /z-index: 1;/);
	assert.match(headerRule, /background: var\(--surface-subtle\);/);
	assert.match(positive, /title="lun: fuera del periodo"/);
	assert.doesNotMatch(positive, /aria-label="Ver detalle de lun 26 ene: \$0"/);

	const chartView = source.slice(
		source.indexOf("export function SpendingChartView("),
		source.indexOf("export interface SpendingChartPanelProps"),
	);
	assert.ok(chartView.length > 0);
	assert.match(chartView, /onClick=\{\(\) => onSelectDay\(day\.key\)\}/);
	assert.match(chartView, /id=\{DAY_DETAIL_ID\}/);
	assert.doesNotMatch(chartView, /scrollIntoView|scrollToDayDetail|pendingScrollDayRef|dayDetailRef|handleSelectDay/);
});

test("the React spending chart view renders selectable proportional bars, the read-only day detail and a truthful empty state", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, analytics, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const movements = [
		{ id: "a", counterparty: "A", amount: 1000, date: "2026-02-01", category: "Comida" },
		{ id: "b", counterparty: "B", amount: 2000, date: "2026-02-02", category: "Comida" },
		{ id: "c", counterparty: "C", amount: 100, date: "2026-02-03", category: "Comida" },
		{ id: "d", counterparty: "D", amount: 3000, date: "2026-02-08", category: "Comida" },
		{ id: "e", counterparty: "E", amount: 4000, date: "2026-02-28", category: "Comida" },
		{ id: "f", counterparty: "F", amount: 500, date: "\u2014", category: "Comida" },
	];
	const chart = analytics.getSpendingChart(movements, period, 2);
	// The read-only detail reads the same loaded transactions through the richer projection.
	const transactions = [
		{
			id: "b",
			occurredAt: "2026-02-02T09:30:00",
			amount: 2000,
			direction: "outflow",
			kind: "purchase",
			counterparty: "Verdulería",
			description: "",
		},
		{
			id: "c",
			occurredAt: "2026-02-03",
			amount: 100,
			direction: "outflow",
			kind: "payment",
			counterparty: "",
			description: "Café",
		},
		{
			id: "e",
			occurredAt: "2026-02-28T22:15:00",
			amount: 4000,
			direction: "outflow",
			kind: "transfer",
			counterparty: "Arriendo",
			description: "",
		},
	];
	const detailMovements = pageModule.getSpendingChartDetailMovements(transactions);

	const renderView = (selectedTab = "period", model = chart, selectedDayKey = null) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.SpendingChartView, {
				chart: model,
				selectedTab,
				onSelectTab: () => {},
				selectedDayKey,
				onSelectDay: () => {},
				detailMovements,
			}),
		);

	const full = renderView();
	assert.match(full, /<h3 id="react-spending-chart-title">Gasto por d\u00eda de la semana<\/h3>/);
	// Tabs are the only controls; the full period is pressed by default and each week is selectable.
	assert.match(full, /aria-label="Periodo del gr\u00e1fico de gastos"/);
	assert.match(full, /<button type="button" class="react-spending-chart-tab" aria-pressed="true">Periodo completo<\/button>/);
	assert.match(full, /<button type="button" class="react-spending-chart-tab" aria-pressed="false">Semana 1<\/button>/);
	// Both excluded facts are disclosed as separate statements.
	assert.match(full, /2 salidas reconocidas del periodo no tienen monto conocido/);
	assert.match(full, /1 salida reconocida del periodo con monto conocido no tiene una fecha v\u00e1lida/);
	// The heading names the selected series total and range.
	assert.match(full, /\$10\.100 \u00b7 01\/02\/2026 a 28\/02\/2026/);
	// Bars are selectable controls again, like legacy: each one is a button with aria-pressed and
	// aria-controls for the read-only day detail.
	assert.match(full, /role="region" aria-label="Periodo completo, total gastado por cada d\u00eda de la semana"/);
	// The body reads bars, then the month summary, then the selected-day detail, so the DOM order
	// matches the visual layout: graph and totals on the top row, detail spanning the full width below.
	const barsIndex = full.indexOf('class="react-spending-chart-bars"');
	const summaryIndex = full.indexOf('class="react-spending-chart-summary"');
	const detailIndex = full.indexOf('class="react-spending-chart-day-panel"');
	assert.ok(barsIndex > -1);
	assert.ok(barsIndex < summaryIndex);
	assert.ok(summaryIndex < detailIndex);
	const bars = full.slice(barsIndex, summaryIndex);
	assert.match(bars, /<button/);
	assert.match(bars, /aria-controls="react-spending-chart-day-detail"/);
	assert.match(bars, /aria-pressed=/);
	// No bar is selected while the caller passes no selected key, and the panel states the prompt.
	assert.doesNotMatch(bars, /aria-pressed="true"/);
	assert.match(full, /<header class="react-spending-chart-day-header"><h4>Selecciona una barra[^<]*<\/h4><\/header>/);
	assert.doesNotMatch(full.slice(detailIndex), /react-spending-chart-day-total/);
	// Proportional fill heights with the legacy 12% floor: the small day is drawn at 12%, not its raw 3%.
	assert.match(full, /<span class="react-spending-chart-fill" style="height:100%"><\/span>/);
	assert.match(full, /<span class="react-spending-chart-fill" style="height:12%"><\/span>/);
	// Every bar track keeps the native `title` tooltip, including the period-wide weekday wording.
	assert.match(full, /title="lun · Total del periodo por lunes: \$2\.000"/);
	assert.match(full, /title="mar · Total del periodo por martes: \$100"/);
	// The full-period series aggregates by weekday, so its day details are blank.
	assert.match(full, /<strong class="react-spending-chart-day">lun<\/strong><small class="react-spending-chart-detail"><\/small>/);

	// A week series shows each day's own date and pads the days outside the period with a literal `$0`
	// value and an "outside the period" tooltip instead of a blank cell.
	const week = renderView("week-0");
	assert.match(week, /aria-pressed="true">Semana 1<\/button>/);
	assert.match(week, /<small class="react-spending-chart-detail">1 feb<\/small>/);
	assert.match(week, /<span class="react-spending-chart-value">\$0<\/span><span class="react-spending-chart-track react-spending-chart-track-empty" title="lun: fuera del mes">/);
	assert.equal((week.match(/react-spending-chart-track-empty/g) ?? []).length, 6);
	// Every padded day outside the period is disabled and cannot be selected.
	assert.equal((week.match(/<button[^>]*disabled=""/g) ?? []).length, 6);

	// A week selection lists exactly that calendar day's movements with time, identity, kind and amount.
	const weekDetail = renderView("week-1", chart, "2026-02-02");
	assert.match(weekDetail, /<aside id="react-spending-chart-day-detail" class="react-spending-chart-day-panel" aria-live="polite"><header class="react-spending-chart-day-header"><h4>Detalle del lunes 2 feb<\/h4><strong class="react-spending-chart-day-total">\$2\.000<\/strong><\/header><div class="react-spending-chart-day-group">/);
	assert.match(weekDetail, /09:30 · Verdulería/);
	assert.match(weekDetail, /<small>Compras<\/small>/);
	assert.match(weekDetail, /react-spending-chart-day-amount">\$2\.000<\/strong>/);
	// Each row leads with the free Font Awesome solid person icon, left of the identity, for the
	// inert demo rows as well as the clickable dialog rows.
	assert.match(
		weekDetail,
		/class="react-spending-chart-day-identity"><span class="react-spending-chart-day-person" aria-hidden="true"><svg[^>]*class="svg-inline--fa fa-user"/,
	);
	// A date-only row reports no fabricated time.
	const tuesdayDetail = renderView("week-1", chart, "2026-02-03");
	assert.match(tuesdayDetail, /<strong>Café<\/strong>/);
	assert.doesNotMatch(tuesdayDetail, /00:00/);

	// The full-period selection groups the whole period by date for the chosen weekday.
	const mondayDetail = renderView("period", chart, "weekday-0");
	assert.match(mondayDetail, /<h4>Detalle de lunes de 01\/02\/2026 a 28\/02\/2026<\/h4>/);
	assert.match(mondayDetail, /<span class="react-spending-chart-day-date">lunes 2 feb<\/span>/);

	// The totals grid states every week plus the full period and marks the selected row. The visible
	// heading matches legacy (`Resumen del mes`) while its longer accessible name is preserved.
	assert.match(full, /aria-label="Resumen de gastos del periodo"><h4>Resumen del mes<\/h4>/);
	assert.equal((full.match(/class="react-spending-chart-summary-row/g) ?? []).length, 6);
	assert.match(
		full,
		/<div class="react-spending-chart-summary-row react-spending-chart-summary-row-active" aria-current="true" aria-label="Periodo seleccionado: \$10\.100">/,
	);
	assert.match(full, /<span>Periodo:<\/span><strong>\$10\.100<\/strong>/);
	assert.match(full, /<span>Semana 1:<\/span><strong>\$1\.000<\/strong>/);

	// The default chart keeps every detail row inert: without `onOpenMovement` there is no dialog
	// trigger, and the read-only detail still offers no edit or delete action.
	assert.doesNotMatch(mondayDetail, /react-spending-chart-day-open/);
	// Scope the no-button check to the detail panel itself; it is the last body region, after the bars.
	const mondayDetailPanel = mondayDetail.slice(
		mondayDetail.indexOf('class="react-spending-chart-day-panel"'),
	);
	assert.ok(mondayDetailPanel.length > 0);
	assert.doesNotMatch(mondayDetailPanel, /<button/);

	// Wiring the read-only movement dialog makes an identified row clickable; the markup still offers
	// no Editar/Eliminar action, so the modal can only be read.
	const clickableDetail = renderer.renderToStaticMarkup(
		React.createElement(pageModule.SpendingChartView, {
			chart,
			selectedTab: "week-1",
			onSelectTab: () => {},
			selectedDayKey: "2026-02-02",
			onSelectDay: () => {},
			detailMovements,
			onOpenMovement: () => {},
		}),
	);
	assert.match(clickableDetail, /<button type="button" class="react-spending-chart-day-open"/);
	assert.match(clickableDetail, /09:30 · Verdulería/);
	assert.match(
		clickableDetail,
		/class="react-spending-chart-day-identity"><span class="react-spending-chart-day-person" aria-hidden="true"><svg[^>]*class="svg-inline--fa fa-user"/,
	);
	assert.doesNotMatch(clickableDetail, />Editar<|>Eliminar</);

	// No countable data: an explicit message instead of a row of zero bars, and no tabs to switch.
	const empty = renderView("period", analytics.getSpendingChart([], period, 0));
	assert.match(empty, /class="react-spending-chart-empty" role="status"/);
	assert.doesNotMatch(empty, /react-spending-chart-bars/);
	assert.doesNotMatch(empty, /react-spending-chart-tab/);

	// The container defaults to the full period, like legacy's `chartTab: "month"`.
	const panel = renderer.renderToStaticMarkup(
		React.createElement(pageModule.SpendingChartPanel, { chart }),
	);
	assert.match(panel, /aria-pressed="true">Periodo completo<\/button>/);

	// The same read-only chart is reused by the demo tree.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	assert.match(demoMarkup, /Solo lectura/);
	assert.match(demoMarkup, /Mercado/);
	assert.match(demoMarkup, /react-spending-chart/);
	// The demo selects bars but never wires the movement dialog, so no clickable dialog trigger appears.
	assert.doesNotMatch(demoMarkup, /react-spending-chart-day-open/);

	// Scoped styles under the shipped `react-` prefix, and the reduced-motion respect.
	assert.match(styles, /\.react-spending-chart \{/);
	assert.match(styles, /\.react-spending-chart-tabs \{/);
	assert.match(styles, /\.react-spending-chart-tab\[aria-pressed="true"\] \{/);
	assert.match(styles, /\.react-spending-chart-heading \{/);
	assert.match(styles, /\.react-spending-chart-bars \{/);
	assert.match(styles, /\.react-spending-chart-track \{/);
	assert.match(styles, /\.react-spending-chart-track-empty \{/);
	assert.match(styles, /\.react-spending-chart-fill \{/);
	assert.match(styles, /\.react-spending-chart-body \{/);
	assert.match(styles, /\.react-spending-chart-bar-selected \.react-spending-chart-track \{/);
	assert.match(styles, /\.react-spending-chart-day-panel,/);
	// The person icon has its own scoped hook next to the compact identity row it leads.
	assert.match(styles, /\.react-spending-chart-day-identity \{/);
	assert.match(styles, /\.react-spending-chart-day-person \{/);
	assert.match(styles, /\.react-spending-chart-summary-row-active \{/);
	// The desktop body is a two-column top row (bars, then totals) with the selected-day detail
	// spanning the full width beneath them.
	assert.match(
		styles,
		/\.react-spending-chart-body \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(180px, 260px\);/,
	);
	assert.match(
		styles,
		/\.react-spending-chart-day-panel \{[^}]*grid-column: 1 \/ -1;/,
	);
	// The panel remains the sole scroll container; a surface-backed header keeps the title and total
	// together above the movement groups without hiding them when the panel is scrolled.
	assert.match(
		styles,
		/\.react-spending-chart-day-panel \{[^}]*max-height: 400px;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/,
	);
	const dayHeaderStyle = styles.match(/\.react-spending-chart-day-header \{([^}]*)\}/)?.[1] ?? "";
	assert.match(dayHeaderStyle, /position: sticky;/);
	assert.match(dayHeaderStyle, /top: 0;/);
	assert.match(dayHeaderStyle, /z-index: 1;/);
	assert.match(dayHeaderStyle, /background: var\(--surface-subtle\);/);
	assert.match(dayHeaderStyle, /padding: var\(--space-3\) var\(--space-3\) var\(--space-2\);/);
	// The selected bar carries the whole rounded card, not only a track border.
	assert.match(
		styles,
		/\.react-spending-chart-bar-selected,\s*\.react-spending-chart-bar-selected:hover \{[^}]*border-color: var\(--accent\);[^}]*background: var\(--accent-soft\);[^}]*box-shadow: inset/,
	);
	assert.match(
		styles,
		/\.react-spending-chart-bar-selected \.react-spending-chart-value,\s*\.react-spending-chart-bar-selected strong \{\s*color: var\(--accent\);/,
	);
	// The active summary row is the legacy solid blue with white text and value.
	assert.match(
		styles,
		/\.react-spending-chart-summary-row-active \{[^}]*background: var\(--accent\);[^}]*color: #ffffff;/,
	);
	assert.match(
		styles,
		/\.react-spending-chart-summary-row-active strong \{\s*color: #ffffff;/,
	);
	// The gradient fill keeps the legacy deep-blue to standard-blue ramp.
	assert.match(
		styles,
		/\.react-spending-chart-fill \{[^}]*linear-gradient\(\s*180deg,\s*var\(--primary-container\) 0%,\s*var\(--primary\) 100%\s*\);/,
	);
	assert.match(
		styles,
		/@media \(prefers-reduced-motion: reduce\) \{\s*\.react-spending-chart-fill \{\s*transition: none;\s*\}\s*\}/,
	);
	// Below the wide desktop the top row narrows its totals column while keeping the bar chart and
	// the month summary side by side, with the selected-day detail still spanning underneath.
	assert.match(
		styles,
		/@media \(max-width: 1120px\) \{[^@]*?\.react-spending-chart-body \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(160px, 220px\);\s*\}/,
	);
	// Legacy's 800px tablet breakpoint stacks the chart body before the final 640px mobile stack,
	// resets the spanning totals summary and lets the bar strip scroll, so the widened detail
	// column and the seven 44px bars no longer force horizontal overflow between 641px and 800px.
	assert.match(
		styles,
		/@media \(max-width: 800px\) \{[^@]*?\.react-spending-chart-body \{\s*grid-template-columns: 1fr;\s*\}/,
	);
	assert.match(
		styles,
		/@media \(max-width: 800px\) \{[^@]*?\.react-spending-chart-summary \{\s*grid-column: auto;\s*grid-template-columns: 1fr;\s*\}/,
	);
	// The same breakpoint ports legacy's compact density: tighter inter-bar gap, scrolling strip,
	// zero horizontal bar padding, an 18px track and a vertical value label so all seven bars fit
	// without forcing the page wider than the viewport.
	assert.match(
		styles,
		/@media \(max-width: 800px\) \{[^@]*?\.react-spending-chart-bars \{[^}]*gap: 4px;[^}]*overflow-x: auto;[^}]*padding-bottom: var\(--space-2\);/,
	);
	assert.match(
		styles,
		/@media \(max-width: 800px\) \{[^@]*?\.react-spending-chart-bar \{[^}]*min-width: 44px;[^}]*padding-inline: 0;/,
	);
	assert.match(
		styles,
		/@media \(max-width: 800px\) \{[^@]*?\.react-spending-chart-track \{[^}]*width: 18px;/,
	);
	assert.match(
		styles,
		/@media \(max-width: 800px\) \{[^@]*?\.react-spending-chart-value \{[^}]*writing-mode: vertical-rl;[^}]*justify-self: center;/,
	);
	// On narrow screens the chart body becomes one column, the summary returns to a single column
	// and the bar row scrolls, so the detail panel and the seven 44px bars no longer force
	// horizontal overflow.
	assert.match(
		styles,
		/@media \(max-width: 640px\) \{[^@]*?\.react-spending-chart-body \{\s*grid-template-columns: 1fr;\s*\}/,
	);
	assert.match(
		styles,
		/@media \(max-width: 640px\) \{[^@]*?\.react-spending-chart-summary \{\s*grid-column: auto;\s*grid-template-columns: 1fr;\s*\}/,
	);
	assert.match(
		styles,
		/@media \(max-width: 640px\) \{[^@]*?\.react-spending-chart-bars \{\s*justify-content: flex-start;\s*overflow-x: auto;\s*\}/,
	);
});

test("the React spending chart detail and totals read the loaded transactions without inventing rows", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [analytics, pageModule] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/analytics/spendingChart.ts"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
	]);

	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const transactions = [
		{
			id: "m1",
			occurredAt: "2026-02-02T09:30:00",
			amount: 2000,
			direction: "outflow",
			kind: "purchase",
			counterparty: "Verdulería",
			description: "",
		},
		// Date-only row: no fabricated time.
		{
			id: "m2",
			occurredAt: "2026-02-03",
			amount: 100,
			direction: "outflow",
			kind: "payment",
			counterparty: "",
			description: "Café",
		},
		// Missing id and blank identity: still readable, fallback identity, no edit target.
		{
			occurredAt: "2026-02-02T18:00:00",
			amount: 500,
			direction: "outflow",
			kind: "transfer",
			counterparty: "  ",
			description: "",
		},
		// Not a recognized outflow, non-finite amount, unusable date: all excluded.
		{
			id: "in",
			occurredAt: "2026-02-02T10:00:00",
			amount: 900,
			direction: "inflow",
			kind: "income",
			counterparty: "Sueldo",
			description: "",
		},
		{
			id: "nan",
			occurredAt: "2026-02-02T10:00:00",
			amount: Number.NaN,
			direction: "outflow",
			kind: "purchase",
			counterparty: "Nada",
			description: "",
		},
		{
			id: "bad",
			occurredAt: "\u2014",
			amount: 700,
			direction: "outflow",
			kind: "purchase",
			counterparty: "Sin fecha",
			description: "",
		},
	];
	const rows = pageModule.getSpendingChartDetailMovements(transactions);

	// Only recognized, finite, dated outflows survive; nothing is summed from a rendered height.
	assert.deepEqual(rows, [
		{ id: "m1", label: "Verdulería", kindLabel: "Compras", amount: 2000, dateKey: "2026-02-02", time: "09:30" },
		{ id: "m2", label: "Café", kindLabel: "Pagos", amount: 100, dateKey: "2026-02-03", time: "" },
		{ id: null, label: "Gasto sin identificar", kindLabel: "Transferencias", amount: 500, dateKey: "2026-02-02", time: "18:00" },
	]);
	// An unrecognized kind is stated, never dropped.
	assert.equal(analytics.getSpendingChartKindLabel("unknown"), "Sin clasificar");

	const movements = rows.map((row) => ({
		id: row.id,
		counterparty: row.label,
		amount: row.amount,
		date: row.dateKey,
		category: "Comida",
	}));
	const chart = analytics.getSpendingChart(movements, period, 0);

	// The default bar is Monday for the aggregate and the largest day for a week, like legacy.
	assert.equal(
		analytics.getSpendingChartDefaultDayKey(analytics.getSpendingChartSeries(chart, "period")),
		"weekday-0",
	);
	assert.equal(
		analytics.getSpendingChartDefaultDayKey(analytics.getSpendingChartSeries(chart, "week-1")),
		"2026-02-02",
	);

	// The weekday aggregate groups the whole period by date for the chosen weekday.
	const periodSeries = analytics.getSpendingChartSeries(chart, "period");
	const monday = periodSeries.days.find((day) => day.key === "weekday-0");
	const mondayDetail = analytics.getSpendingChartDayDetail(periodSeries, monday, rows);
	assert.equal(mondayDetail.title, "Detalle de lunes de 01/02/2026 a 28/02/2026");
	assert.equal(mondayDetail.total, 2500);
	assert.equal(mondayDetail.isEmpty, false);
	assert.deepEqual(mondayDetail.groups.map((group) => group.key), ["2026-02-02"]);
	assert.equal(mondayDetail.groups[0].label, "lunes 2 feb");
	assert.deepEqual(mondayDetail.groups[0].movements.map((movement) => movement.id), ["m1", null]);

	// A week selection lists exactly that calendar day; a padded day has no detail at all.
	const weekSeries = analytics.getSpendingChartSeries(chart, "week-0");
	assert.equal(weekSeries.days[0].isInPeriod, false);
	assert.equal(analytics.getSpendingChartDayDetail(weekSeries, weekSeries.days[0], rows).groups.length, 0);
	const feb1Detail = analytics.getSpendingChartDayDetail(weekSeries, weekSeries.days[6], rows);
	assert.equal(feb1Detail.isEmpty, true);
	assert.equal(feb1Detail.title, "Detalle del domingo 1 feb");

	// The totals grid sums in-period days only and marks the selected row.
	const totals = analytics.getSpendingChartTotalsRows(chart, "period");
	assert.deepEqual(
		totals.map((row) => row.id),
		["week-0", "week-1", "week-2", "week-3", "week-4", "period"],
	);
	assert.equal(totals[0].total, 0);
	assert.equal(totals[1].total, 2600);
	assert.equal(totals[5].label, "Periodo");
	assert.equal(totals[5].total, 2600);
	assert.deepEqual(totals.map((row) => row.isActive), [false, false, false, false, false, true]);
	assert.equal(analytics.getSpendingChartTotalsRows(chart, "week-1")[1].isActive, true);

	// Neutral Spanish throughout.
	assert.doesNotMatch(
		JSON.stringify([rows, mondayDetail, totals]),
		/\bvos\b|ten[e\u00e9]s|quer[e\u00e9]s|pod[e\u00e9]s|hac[e\u00e9]|and[a\u00e1]/i,
	);
});

test("the React authenticated summary mounts the spending chart without adding a request", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const page = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);

	// The chart is derived from the rows and the pending count the summary already computed, so the
	// page composes it and adds no request of its own.
	assert.match(page, /from "\.\.\/components\/analytics\/spendingChart"/);
	assert.match(page, /\bgetSpendingChart\b/);
	assert.match(page, /const spendingChart = getSpendingChart\(movements, selectedPeriod!, summary\.pendingAmountCount\);/);
	assert.match(page, /<SpendingChartPanel\s+chart=\{chart\}\s+detailMovements=\{chartDetailMovements\}\s+onOpenMovement=\{onOpenMovement\}\s+\/>/);
	// The chart's detail dialog reuses the read-only movement modal and wires only the identity setter:
	// no edit/remove callback, so a row can open its detail but never a mutation action.
	assert.match(
		page,
		/<ViewMovementDialog\s+movement=\{chartDetailMovement\}\s+editableMovement=\{chartDetailMovementEditable\}\s+onClose=\{\(\) => setChartDetailMovementId\(null\)\}\s+\/>/,
	);
	// The shared analytics body mounts the chart once for both the authenticated summary and the demo.
	assert.equal((page.match(/<SpendingChartPanel/g) ?? []).length, 1);
	assert.match(page, /export function SpendingChartView\(/);
	assert.match(page, /export function SpendingChartPanel\(/);
	// The default series is the full period, like legacy's `chartTab: "month"`.
	assert.match(page, /useState<string>\(FULL_PERIOD_TAB_ID\)/);
	assert.doesNotMatch(page, /loadSpendingChart|fetch\("\/api\/analytics/);

	// The demo tree reuses the same chart over its fixture.
	const demoSource = page.slice(
		page.indexOf("export function DemoDashboardPage"),
		page.indexOf("export interface DashboardLeadViewProps"),
	);
	assert.notEqual(demoSource, "", "the demo tree must be locatable");
	assert.match(demoSource, /SpendingChart/);
	// The demo never wires the chart's movement dialog, so its chart stays read-only selection only.
	assert.doesNotMatch(demoSource, /onOpenMovement/);
});

test("the React account menu derives the profile identity, trigger attributes and menu state without a DOM", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const menu = await vite.ssrLoadModule(
		"/src/client/components/account/accountMenu.ts",
	);

	// A complete profile exposes name, email and picture.
	assert.deepEqual(
		menu.getAccountIdentity({
			name: "Gaby Pérez",
			email: "gaby@example.com",
			picture: "https://example.com/avatar.png",
		}),
		{
			name: "Gaby Pérez",
			email: "gaby@example.com",
			avatarSrc: "https://example.com/avatar.png",
			initials: "GP",
		},
	);

	// A missing, blank or non-string picture never becomes an avatar request; the fallback is text.
	const withoutPicture = menu.getAccountIdentity({
		name: "Gaby",
		email: "gaby@example.com",
		picture: null,
	});
	assert.equal(withoutPicture.avatarSrc, null);
	assert.equal(withoutPicture.initials, "G");
	assert.equal(
		menu.getAccountIdentity({ email: "gaby@example.com", picture: "   " }).avatarSrc,
		null,
	);

	// No profile at all still yields a safe, labelled identity, and the initials fall back to the
	// email when the name is absent so the avatar placeholder is never empty.
	assert.deepEqual(menu.getAccountIdentity(null), {
		name: "Usuario",
		email: "",
		avatarSrc: null,
		initials: "U",
	});
	assert.equal(menu.getAccountIdentity({ email: "gaby@example.com" }).initials, "G");

	// The trigger always points at the menu element it controls, open or closed (legacy parity).
	assert.deepEqual(menu.getAccountMenuTriggerAttributes(false, "react-account-menu"), {
		"aria-haspopup": "menu",
		"aria-expanded": false,
		"aria-controls": "react-account-menu",
	});
	assert.equal(
		menu.getAccountMenuTriggerAttributes(true, "react-account-menu")["aria-expanded"],
		true,
	);

	// Open, close and toggle are reducer transitions, provable without a DOM.
	assert.equal(menu.createAccountMenuState().isOpen, false);
	assert.equal(
		menu.reduceAccountMenu(menu.createAccountMenuState(), { type: "open" }).isOpen,
		true,
	);
	assert.equal(menu.reduceAccountMenu({ isOpen: true }, { type: "close" }).isOpen, false);
	assert.equal(menu.reduceAccountMenu({ isOpen: false }, { type: "toggle" }).isOpen, true);
	assert.equal(menu.reduceAccountMenu({ isOpen: true }, { type: "toggle" }).isOpen, false);

	// Keyboard navigation wraps around the menu and stays inert when there is nothing to focus.
	assert.equal(menu.getMenuNavigationDirection("ArrowDown"), "next");
	assert.equal(menu.getMenuNavigationDirection("ArrowUp"), "previous");
	assert.equal(menu.getMenuNavigationDirection("Home"), "first");
	assert.equal(menu.getMenuNavigationDirection("End"), "last");
	assert.equal(menu.getMenuNavigationDirection("Escape"), null);
	assert.equal(menu.getMenuItemNavigationIndex(-1, 2, "next"), 0);
	assert.equal(menu.getMenuItemNavigationIndex(1, 2, "next"), 0);
	assert.equal(menu.getMenuItemNavigationIndex(0, 2, "previous"), 1);
	assert.equal(menu.getMenuItemNavigationIndex(1, 2, "previous"), 0);
	assert.equal(menu.getMenuItemNavigationIndex(1, 2, "first"), 0);
	assert.equal(menu.getMenuItemNavigationIndex(0, 2, "last"), 1);
	assert.equal(menu.getMenuItemNavigationIndex(0, 0, "next"), -1);
});

test("the React account menu view renders the labelled trigger, the safe avatar and role=menu semantics", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, menuModule] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/account/AccountMenu.tsx"),
	]);

	const noop = () => {};
	const identity = {
		name: "Gaby Pérez",
		email: "gaby@example.com",
		avatarSrc: null,
		initials: "GP",
	};
	const renderMenu = (isOpen, overrides = {}) =>
		renderer.renderToStaticMarkup(
			React.createElement(
				menuModule.AccountMenuView,
				{
					identity,
					isOpen,
					menuId: "react-account-menu",
					onToggle: noop,
					onKeyDown: noop,
					onMenuClick: noop,
					...overrides,
				},
				React.createElement("button", { type: "button" }, "Configuración"),
				React.createElement("button", { type: "button" }, "Reglas de contraparte"),
			),
		);

	const closed = renderMenu(false);
	// The trigger is a labelled disclosure that always names the menu it controls.
	assert.match(closed, /aria-label="Abrir menú de cuenta"/);
	assert.match(closed, /aria-haspopup="menu"/);
	assert.match(closed, /aria-expanded="false"/);
	assert.match(closed, /aria-controls="react-account-menu"/);
	assert.match(closed, /Gaby Pérez/);
	assert.match(closed, /gaby@example.com/);
	// The fallback avatar is text, never an image request the profile did not provide.
	assert.match(closed, /react-account-avatar-fallback[^>]*>GP</);
	assert.doesNotMatch(closed, /<img/);
	// The menu is a real menu region, hidden while closed, and both actions are menuitems with a
	// managed tab stop.
	assert.match(closed, /role="menu"/);
	assert.match(closed, /class="react-account-menu"[^>]*hidden/);
	assert.equal((closed.match(/role="menuitem"/g) ?? []).length, 2);
	assert.equal((closed.match(/tabindex="-1"/g) ?? []).length, 2);
	assert.match(closed, /Configuración/);
	assert.match(closed, /Reglas de contraparte/);

	const open = renderMenu(true);
	assert.match(open, /aria-expanded="true"/);
	assert.doesNotMatch(open, /class="react-account-menu"[^>]*hidden/);

	// A real picture is rendered as the avatar and never as an invented fallback.
	const withPicture = renderMenu(true, {
		identity: {
			name: "Gaby",
			email: "gaby@example.com",
			avatarSrc: "https://example.com/avatar.png",
			initials: "G",
		},
	});
	assert.match(withPicture, /<img[^>]*src="https:\/\/example\.com\/avatar\.png"/);
	// React 19 serializes `referrerPolicy` in camelCase; HTML attribute names are case-insensitive,
	// so the parsed DOM attribute is the expected `referrerpolicy`.
	assert.match(withPicture, /referrerpolicy="no-referrer"/i);
	assert.doesNotMatch(withPicture, /react-account-avatar-fallback/);
});

test("the React authenticated header exposes one Configuración action opening the unified settings surface", async () => {
	const [page, menuSource, styles] = await Promise.all([
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(
			new URL("../src/client/components/account/AccountMenu.tsx", import.meta.url),
			"utf8",
		),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	// The authenticated header gains the account menu as the settings entry point.
	assert.match(page, /import \{ AccountMenu \} from "\.\.\/components\/account\/AccountMenu";/);
	assert.match(page, /<AccountMenu profile=\{profile\}>/);

	// The consolidated settings entry lives under the account menu and opens the unified surface;
	// the two surface bodies and their mutation contracts are unchanged behind it.
	const accountMenuSource = page.slice(
		page.indexOf("<AccountMenu"),
		page.indexOf("</AccountMenu>"),
	);
	assert.notEqual(accountMenuSource, "", "the account menu must be locatable");
	assert.match(accountMenuSource, />\s*Configuración\s*<\/button>/);
	assert.equal((accountMenuSource.match(/<button/g) ?? []).length, 1);
	assert.match(accountMenuSource, /onClick=\{\(\) => setIsAccountSettingsOpen\(true\)\}/);
	assert.doesNotMatch(accountMenuSource, /Reglas de contraparte/);
	assert.match(accountMenuSource, /role="menuitem"/);

	// The authorized sign-out action sits immediately below Configuración in the same menu: it is a
	// plain same-origin anchor to the server route, tagged for the danger styling, and the settings
	// action stays the first menuitem.
	assert.match(
		accountMenuSource,
		/<a\s+href="\/auth\/logout"\s+role="menuitem"\s+className="react-account-logout"\s*>/,
	);
	assert.match(accountMenuSource, /Cerrar sesión/);
	assert.ok(
		accountMenuSource.indexOf("Configuración") <
			accountMenuSource.indexOf("Cerrar sesión"),
		"Configuración must stay above Cerrar sesión in the authenticated menu",
	);
	// The icon is the free solid `faRightFromBracket`, imported once and hidden from the
	// accessibility tree so the visible label keeps naming the action.
	assert.match(page, /\bfaRightFromBracket,/);
	assert.match(
		accountMenuSource,
		/<FontAwesomeIcon icon=\{faRightFromBracket\} aria-hidden="true" \/>/,
	);

	// Gmail keeps its single state-machine owner, but the owner now lives in the one account modal:
	// the dashboard no longer mounts the panel directly and instead hands the modal the session,
	// connect and sync inputs. The menu still offers no connection control.
	assert.equal((page.match(/<GmailConnectionPanel/g) ?? []).length, 0);
	assert.match(page, /authenticated=\{session\.authenticated\}/);
	assert.match(page, /initialConnected=\{connected\}/);
	assert.match(page, /connectControl=\{\(accountConnected\) =>/);
	assert.match(page, /submitSync=\{submitGmailSync\}/);
	assert.doesNotMatch(accountMenuSource, /Gmail|Conectar|Desconectar|Sincronizar/);

	// The dashboard greets the signed-in profile by name with a safe fallback, and the session
	// profile now lives only in the modal instead of a body status grid.
	assert.match(page, /react-dashboard-greeting/);
	assert.match(page, /Hola, \$\{profile\.name\.trim\(\)\}/);
	assert.match(page, /Hola, usuario conectado/);
	assert.doesNotMatch(page, /react-status-grid|react-status-card/);
	assert.equal((page.match(/<AccountSettingsDialog/g) ?? []).length, 1);
	assert.doesNotMatch(page, /<CategorySettingsDialog|<CounterpartyRulesDialog/);

	// The demo composition reuses the account menu, but only for its login action: the settings
	// action, its dialog and every mutation surface stay out of the read-only tree.
	const demoTree = page.slice(
		page.indexOf("export function DemoDashboardPage"),
		page.indexOf("export interface DashboardLeadViewProps"),
	);
	assert.notEqual(demoTree, "", "the demo tree must be locatable");
	assert.doesNotMatch(
		demoTree,
		/Configuración|Reglas de contraparte|AccountSettingsDialog|isAccountSettingsOpen/,
	);
	assert.match(demoTree, /<AccountMenu profile=\{DEMO_PROFILE\}>/);
	assert.match(demoTree, /<a href="\/auth\/google" role="menuitem">Iniciar sesión<\/a>/);

	// The interactive behaviours live in the menu component: opening focuses the first menuitem,
	// Escape closes and restores the trigger focus, and an outside pointer closes the menu.
	assert.match(menuSource, /menuRef\.current\?\.querySelector<HTMLElement>\('\[role="menuitem"\]'\)/);
	assert.match(menuSource, /firstItem\?\.focus\(\)/);
	assert.match(menuSource, /event\.key === "Escape"/);
	assert.match(menuSource, /triggerRef\.current\?\.focus\(\)/);
	assert.match(menuSource, /document\.addEventListener\("pointerdown", handlePointerDown\)/);

	// Scoped styles use the React prefix; the legacy `.account-menu` / `.profile` classes are not
	// imported.
	assert.match(styles, /\.react-account-menu \{/);
	assert.match(styles, /\.react-account-menu\[hidden\] \{/);
	assert.match(styles, /\.react-account-trigger \{/);
	assert.match(styles, /\.react-account-settings-dialog \{/);
	assert.doesNotMatch(styles, /\.account-menu\s*\{/);

	// Only the logout item is coloured with the danger token and separated from the settings action;
	// the shared menu-item rule stays neutral, so demo and every other item are unaffected.
	const logoutRule = styles.match(
		/\.react-account-menu \.react-account-logout \{([^}]*)\}/,
	);
	assert.notEqual(logoutRule, null, "the logout menu-item rule must exist");
	assert.match(logoutRule[1], /color:\s*var\(--danger\)/);
	assert.match(logoutRule[1], /border-top:\s*1px solid var\(--line\)/);
	const menuItemRule = styles.match(
		/\.react-account-menu \[role="menuitem"\] \{([^}]*)\}/,
	);
	assert.notEqual(menuItemRule, null, "the shared menu-item rule must exist");
	assert.doesNotMatch(menuItemRule[1], /--danger/);
});

test("the React unified account settings dialog hosts the profile and both verified sections behind one close control", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, accountDialog, categoryDialog, counterpartyDialog, accountSource] =
		await Promise.all([
			import("react"),
			import("react-dom/server"),
			vite.ssrLoadModule("/src/client/components/settings/AccountSettingsDialog.tsx"),
			vite.ssrLoadModule("/src/client/components/settings/CategorySettingsDialog.tsx"),
			vite.ssrLoadModule("/src/client/components/settings/CounterpartyRulesDialog.tsx"),
			readFile(
				new URL(
					"../src/client/components/settings/AccountSettingsDialog.tsx",
					import.meta.url,
				),
				"utf8",
			),
		]);

	const noop = () => {};
	const submitCategoryMutation = async () => ({ status: "saved" });
	const submitCounterpartyRule = async () => ({ status: "saved", reloadFailed: false });

	const connectControl = (accountConnected) =>
		React.createElement(
			"button",
			{ type: "button", disabled: accountConnected },
			"Conectar Gmail",
		);

	const markup = renderer.renderToStaticMarkup(
		React.createElement(accountDialog.AccountSettingsDialog, {
			isOpen: true,
			onClose: noop,
			profile: { name: "Gaby Pérez", email: "gaby@example.com", picture: null },
			authenticated: true,
			initialConnected: false,
			connectControl,
			submitSync: null,
			submitCategoryMutation,
			submitCounterpartyRule,
		}),
	);

	// One native dialog, not two: the unified surface is itself the modal host.
	assert.equal((markup.match(/<dialog/g) ?? []).length, 1);
	assert.match(markup, /react-settings-dialog/);
	assert.match(markup, /react-account-settings-dialog/);
	assert.match(markup, /Configuración/);

	// The three surfaces are grouped behind one accessible tablist: a tab per surface, each bound to
	// its panel through `aria-controls`, and the modal opens on `Perfil`.
	assert.equal((markup.match(/role="tablist"/g) ?? []).length, 1);
	assert.equal((markup.match(/role="tab"/g) ?? []).length, 3);
	assert.equal((markup.match(/role="tabpanel"/g) ?? []).length, 3);
	assert.match(markup, /<button[^>]*role="tab"[^>]*id="react-account-settings-tab-profile"/);
	assert.match(
		markup,
		/aria-selected="true"[^>]*aria-controls="react-account-settings-panel-profile"/,
	);
	assert.equal((markup.match(/aria-selected="false"/g) ?? []).length, 2);
	assert.match(
		markup,
		/id="react-account-settings-panel-profile"[^>]*aria-labelledby="react-account-settings-tab-profile"/,
	);
	assert.doesNotMatch(markup, /id="react-account-settings-panel-profile"[^>]*hidden/);

	// The profile identity is visible in the default panel, as it is in the body card.
	assert.match(markup, /Perfil/);
	assert.match(markup, /Gaby Pérez/);
	assert.match(markup, /gaby@example\.com/);

	// The Gmail connection is embedded in the same modal through the shipped panel, not a second
	// implementation: the modal carries the section and the panel keeps the state machine.
	assert.match(markup, /react-account-settings-gmail/);
	assert.match(markup, /Conexión con Gmail/);

	// Both verified bodies are embedded in their own tab panels. The inactive panels stay mounted
	// but hidden, so their content is present in the markup without showing while `Perfil` is active,
	// and switching tabs never drops an embedded section's state or in-flight lock.
	assert.match(markup, /id="react-account-settings-panel-categories"[^>]*hidden/);
	assert.match(markup, /id="react-account-settings-panel-counterparty"[^>]*hidden/);
	assert.match(markup, /Categorías/);
	assert.match(markup, /Guardar categoría/);
	assert.match(markup, /Reglas de contraparte/);
	assert.match(markup, /Reglas guardadas/);
	assert.match(markup, /Guardar regla/);

	// One outer close control, because both embedded sections hide their own.
	assert.equal((markup.match(/Cerrar<\/button>/g) ?? []).length, 1);

	// Closed means unmounted.
	assert.equal(
		renderer.renderToStaticMarkup(
			React.createElement(accountDialog.AccountSettingsDialog, {
				isOpen: false,
				onClose: noop,
				profile: null,
				authenticated: true,
				initialConnected: false,
				connectControl,
				submitSync: null,
				submitCategoryMutation,
				submitCounterpartyRule,
			}),
		),
		"",
	);

	// A null profile renders the same labelled fallback the body card uses instead of an empty
	// identity.
	const fallbackMarkup = renderer.renderToStaticMarkup(
		React.createElement(accountDialog.AccountSettingsDialog, {
			isOpen: true,
			onClose: noop,
			profile: null,
			authenticated: true,
			initialConnected: false,
			connectControl,
			submitSync: null,
			submitCategoryMutation,
			submitCounterpartyRule,
		}),
	);
	assert.match(fallbackMarkup, /Usuario conectado/);
	assert.match(fallbackMarkup, /No hay un perfil de Gmail asociado a esta sesión\./);

	// The unified host is a real modal through the shared helper, and it refuses `Esc` while a
	// section reports an in-flight mutation. `Perfil` is the tab each open starts from.
	assert.match(accountSource, /syncNativeModalDialog\(dialogRef\.current, isOpen\)/);
	assert.match(accountSource, /if \(isOpen\) setActiveTab\("profile"\);/);
	assert.match(accountSource, /if \(isMutating\) event\.preventDefault\(\);/);

	// The extracted sections keep their standalone dismissal when the mounted surface passes
	// `onClose`, and hide it when embedded. That is the consolidation's reuse contract.
	const categoryStandalone = renderer.renderToStaticMarkup(
		React.createElement(categoryDialog.CategorySettingsContent, {
			isOpen: true,
			submitMutation: submitCategoryMutation,
			onClose: noop,
		}),
	);
	assert.match(categoryStandalone, /Guardar categoría/);
	assert.equal((categoryStandalone.match(/Cerrar<\/button>/g) ?? []).length, 1);

	const categoryEmbedded = renderer.renderToStaticMarkup(
		React.createElement(categoryDialog.CategorySettingsContent, {
			isOpen: true,
			submitMutation: submitCategoryMutation,
		}),
	);
	assert.match(categoryEmbedded, /Guardar categoría/);
	assert.doesNotMatch(categoryEmbedded, /Cerrar<\/button>/);

	const counterpartyStandalone = renderer.renderToStaticMarkup(
		React.createElement(counterpartyDialog.CounterpartyRulesContent, {
			isOpen: true,
			submitMutation: submitCounterpartyRule,
			onClose: noop,
		}),
	);
	assert.match(counterpartyStandalone, /Guardar regla/);
	assert.equal((counterpartyStandalone.match(/Cerrar<\/button>/g) ?? []).length, 1);

	const counterpartyEmbedded = renderer.renderToStaticMarkup(
		React.createElement(counterpartyDialog.CounterpartyRulesContent, {
			isOpen: true,
			submitMutation: submitCounterpartyRule,
		}),
	);
	assert.match(counterpartyEmbedded, /Guardar regla/);
	assert.doesNotMatch(counterpartyEmbedded, /Cerrar<\/button>/);
});

test("the React DashboardPage keeps the unified settings wiring, submitters and Gmail panel while dropping the standalone mounts", async () => {
	const page = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);

	// One action, one mount, one close path.
	assert.equal((page.match(/>\s*Configuración\s*<\/button>/g) ?? []).length, 1);
	assert.equal((page.match(/<AccountSettingsDialog/g) ?? []).length, 1);
	assert.match(page, /isOpen=\{isAccountSettingsOpen\}/);
	assert.doesNotMatch(page, /<CategorySettingsDialog|<CounterpartyRulesDialog/);

	// The verified submitters and their locks are unchanged, and the reload wiring stays with the
	// counterparty submitter.
	assert.match(page, /createCategoryMutationSubmitter\(\{/);
	assert.match(page, /createCounterpartyRuleSubmitter\(\{/);
	assert.match(page, /categorySettingsLock/);
	assert.match(page, /counterpartyRulesLock/);
	assert.match(page, /reload: financialDashboard\?\.reload \?\? null/);
	assert.match(page, /submitCategoryMutation=\{submitCategoryMutation\}/);
	assert.match(page, /submitCounterpartyRule=\{submitCounterpartyRule\}/);

	// Gmail remains a single panel, now hosted by the unified modal: the dashboard no longer mounts
	// it directly and instead hands the modal the session, connect and sync inputs.
	assert.equal((page.match(/<GmailConnectionPanel/g) ?? []).length, 0);
	assert.match(page, /authenticated=\{session\.authenticated\}/);
	assert.match(page, /initialConnected=\{connected\}/);
	assert.match(page, /connectControl=\{\(accountConnected\) =>/);
	assert.match(page, /submitSync=\{submitGmailSync\}/);
	// The only sign-out added to the page is the authorized same-origin anchor under the account
	// menu; the authenticated body still owns no logout button of its own.
	assert.equal((page.match(/href="\/auth\/logout"/g) ?? []).length, 1);
	assert.doesNotMatch(page, />\s*Cerrar sesión\s*<\/button>/);
});

test("the React app header renders the brand, the bound view navigation and the account slot", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, header, source, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/shell/AppHeader.tsx"),
		readFile(
			new URL("../src/client/components/shell/AppHeader.tsx", import.meta.url),
			"utf8",
		),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const noop = () => {};
	const renderHeader = (view) =>
		renderer.renderToStaticMarkup(
			React.createElement(
				header.AppHeader,
				{ view, onViewChange: noop },
				React.createElement("button", { type: "button" }, "Configuración"),
			),
		);

	const summary = renderHeader("summary");
	// The brand links home, names the product and keeps the mark out of the accessibility tree.
	assert.match(
		summary,
		/<a[^>]*class="react-app-brand"[^>]*href="\/"[^>]*aria-label="Gastos Controlados, inicio"/,
	);
	assert.match(
		summary,
		/<span[^>]*class="react-app-brand-mark material-symbols-outlined"[^>]*aria-hidden="true"[^>]*>account_balance_wallet<\/span>/,
	);
	assert.match(summary, />Gastos Controlados</);

	// One labelled navigation whose active item is exactly the view the header was handed.
	assert.match(summary, /<nav[^>]*class="react-app-navigation"[^>]*aria-label="Vistas del panel">/);
	assert.match(
		summary,
		/<button[^>]*class="react-app-navigation-link react-app-navigation-link-active"[^>]*aria-pressed="true"[^>]*>Resumen<\/button>/,
	);
	assert.match(
		summary,
		/<button[^>]*class="react-app-navigation-link"[^>]*aria-pressed="false"[^>]*>Movimientos<\/button>/,
	);

	const movements = renderHeader("movements");
	assert.match(
		movements,
		/<button[^>]*class="react-app-navigation-link"[^>]*aria-pressed="false"[^>]*>Resumen<\/button>/,
	);
	assert.match(
		movements,
		/<button[^>]*class="react-app-navigation-link react-app-navigation-link-active"[^>]*aria-pressed="true"[^>]*>Movimientos<\/button>/,
	);

	// The account slot renders inside the chrome region, so the page owns its contents.
	assert.match(summary, /<div class="react-app-account">[\s\S]*Configuración[\s\S]*<\/div>/);

	// Every click asks the page for a view; the header stores no view of its own.
	assert.match(source, /onClick=\{\(\) => onViewChange\(item\.view\)\}/);
	assert.doesNotMatch(source, /useState/);

	// Month navigation is deliberately absent from the period-scoped React dashboard.
	assert.doesNotMatch(summary, /Seleccionar periodo|month-picker|monthSelect/i);

	// Scoped chrome styles reuse the retained design tokens instead of the legacy classes.
	assert.match(styles, /\.react-app-header \{/);
	assert.match(styles, /\.react-app-navigation-link-active/);
	assert.match(styles, /\.react-app-brand-mark \{/);
});

test("the React authenticated page composes the app header over a page-owned view state and the demo reuses it with inert navigation", async () => {
	const [page, styles] = await Promise.all([
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	// The header mounts once per tree: the authenticated one reads the page-owned state, and the
	// read-only demo reuses the same chrome with a fixed view and a no-op handler.
	assert.match(
		page,
		/import \{ AppHeader, type DashboardView \} from "\.\.\/components\/shell\/AppHeader";/,
	);
	assert.equal((page.match(/<AppHeader/g) ?? []).length, 2);
	assert.match(page, /<AppHeader view=\{view\} onViewChange=\{setView\}>/);
	assert.match(page, /const \[view, setView\] = useState<DashboardView>\("summary"\);/);

	// The body is driven by the same state instead of owning a second toggle.
	assert.match(
		page,
		/<FinancialSummary[\s\S]{0,160}?view=\{view\}[\s\S]{0,160}?onViewChange=\{setView\}/,
	);
	assert.doesNotMatch(page, /react-financial-view-toggle/);

	// The read-only demo reuses the chrome, but its navigation is inert: the header gets a fixed
	// summary view and a no-op handler, so Movimientos can never mount the authenticated body.
	const demoTree = page.slice(
		page.indexOf("export function DemoDashboardPage"),
		page.indexOf("export interface DashboardLeadViewProps"),
	);
	assert.notEqual(demoTree, "", "the demo tree must be locatable");
	assert.match(demoTree, /<AppHeader view="summary" onViewChange=\{\(\) => \{\}\}>/);

	// Scoped styles exist and no legacy header class leaked into the React stylesheet.
	assert.match(styles, /\.react-app-header \{/);
	assert.match(styles, /\.react-app-navigation \{/);
	assert.match(styles, /\.react-app-navigation-link \{/);
	assert.match(styles, /\.react-app-account \{/);
	assert.doesNotMatch(styles, /\.app-header\s*\{/);
	assert.doesNotMatch(styles, /\.app-navigation-link\s*\{/);
});

test("the React dashboard lead derives the spending detail and a truthful balance only from a configured income", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [lead, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/analytics/dashboardLead.ts"),
		readFile(
			new URL("../src/client/components/analytics/dashboardLead.ts", import.meta.url),
			"utf8",
		),
	]);

	// It is a decision module over the numbers the summary already computed: no request, no API layer,
	// no currency formatting and no React.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);
	assert.doesNotMatch(moduleSource, /Intl\.NumberFormat|new Intl/);
	assert.doesNotMatch(moduleSource, /\bformatClp\s*\(/);

	// A configured income produces a real subtraction, and the detail states only the known-amount
	// count and the pending count: the selected period is not repeated because every value belongs to it.
	const configured = lead.getDashboardLead({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 2,
		incomeAmount: 900000,
	});
	assert.equal(configured.spending.label, "Total gastado");
	assert.equal(configured.spending.amount, 25000);
	assert.equal(configured.spending.knownCount, 3);
	assert.equal(configured.spending.pendingAmountCount, 2);
	assert.equal(
		configured.spending.detail,
		"3 gastos con monto \u00b7 2 sin monto claro",
	);
	// The detail carries no period/date text; the range already lives in the visible period control.
	assert.doesNotMatch(configured.spending.detail, /2026-02-01|01\/02\/2026|2026-02-28|28\/02\/2026/);
	assert.equal(configured.balance.label, "Saldo disponible");
	assert.equal(configured.balance.amount, 875000);
	assert.equal(configured.balance.emptyValue, null);
	assert.equal(configured.balance.incomeAmount, 900000);
	assert.equal(configured.balance.derivationIncomeLabel, "ingreso");
	// The positive balance explains nothing: only the pending caveat remains, with no subtraction prose.
	assert.equal(configured.balance.detail, "2 movimientos sin monto conocido no se descuentan.");
	assert.doesNotMatch(configured.balance.detail, /Ingreso configurado menos/);

	// Sensitivity: the balance is the stated income minus the stated total, not the income alone and not
	// the total alone.
	assert.notEqual(configured.balance.amount, configured.balance.incomeAmount);
	assert.notEqual(configured.balance.amount, configured.spending.amount);

	// No configured income: no number at all, the shipped sentinel, and a truthful explanation.
	const unconfigured = lead.getDashboardLead({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 0,
		incomeAmount: null,
	});
	assert.equal(unconfigured.balance.amount, null);
	assert.notEqual(unconfigured.balance.amount, 0);
	assert.equal(unconfigured.balance.emptyValue, "\u2014");
	assert.equal(unconfigured.balance.incomeAmount, null);
	assert.equal(unconfigured.balance.derivationIncomeLabel, null);
	assert.equal(
		unconfigured.balance.detail,
		"No hay un ingreso configurado para el periodo, as\u00ed que no se puede calcular cu\u00e1nto te queda.",
	);
	// The spending side is unaffected by the missing income.
	assert.equal(unconfigured.spending.amount, 25000);
	assert.equal(unconfigured.spending.detail, "3 gastos con monto");

	// The demo never claims a configured cycle: its net is the fixture's observed inflow sum minus the
	// recognized expenses, labelled and described as demo data, and its absent state is explicit copy
	// instead of a fabricated `$0` or a configured-income claim.
	const demoInflow = lead.getDashboardLead({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 2,
		incomeAmount: 900000,
		incomeSource: "demo-inflow",
	});
	assert.equal(demoInflow.balance.label, "Saldo disponible");
	assert.equal(demoInflow.balance.amount, 875000);
	assert.equal(demoInflow.balance.incomeAmount, 900000);
	assert.equal(demoInflow.balance.emptyValue, null);
	assert.equal(demoInflow.balance.derivationIncomeLabel, "ingresos de la demo");
	// The demo's positive balance stops explaining its observed-inflow subtraction too.
	assert.equal(demoInflow.balance.detail, "2 movimientos sin monto conocido no se descuentan.");
	assert.doesNotMatch(demoInflow.balance.detail, /Ingresos observados en los datos de la demo menos/);
	assert.doesNotMatch(demoInflow.balance.detail, /Ingreso configurado/);
	assert.doesNotMatch(demoInflow.balance.label, /Cu\u00e1nto me queda/);

	const demoAbsent = lead.getDashboardLead({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 0,
		incomeAmount: null,
		incomeSource: "demo-inflow",
	});
	assert.equal(demoAbsent.balance.amount, null);
	assert.notEqual(demoAbsent.balance.amount, 0);
	assert.equal(demoAbsent.balance.emptyValue, "\u2014");
	assert.equal(demoAbsent.balance.incomeAmount, null);
	assert.equal(demoAbsent.balance.derivationIncomeLabel, null);
	assert.match(demoAbsent.balance.detail, /no registran ingresos en el periodo/);
	assert.doesNotMatch(demoAbsent.balance.detail, /Ingreso configurado/);

	// The default source keeps the authenticated configured-cycle claim, so omitting it never turns a
	// cycle income into demo copy.
	const defaultedSource = lead.getDashboardLead({
		periodLabel: "Periodo",
		totalSpending: 25000,
		expenseCount: 1,
		pendingAmountCount: 0,
		incomeAmount: 900000,
	});
	assert.equal(defaultedSource.balance.label, "Saldo disponible");
	assert.equal(defaultedSource.balance.derivationIncomeLabel, "ingreso");
	// A known-amount positive balance carries no detail at all: nothing to explain and nothing pending.
	assert.equal(defaultedSource.balance.detail, "");

	// A negative balance is a real subtraction result and stays negative.
	const overspent = lead.getDashboardLead({
		periodLabel: "Periodo",
		totalSpending: 1200000,
		expenseCount: 4,
		pendingAmountCount: 0,
		incomeAmount: 900000,
	});
	assert.equal(overspent.balance.amount, -300000);

	// One expense and one pending movement are singular; the caveat singularizes with them.
	const singular = lead.getDashboardLead({
		periodLabel: "Periodo",
		totalSpending: 1000,
		expenseCount: 1,
		pendingAmountCount: 1,
		incomeAmount: 5000,
	});
	assert.equal(singular.spending.detail, "1 gasto con monto \u00b7 1 sin monto claro");
	assert.match(singular.balance.detail, /1 movimiento sin monto conocido no se descuenta\./);

	// Defensive normalization: a non-finite total is not a number to show, and non-counts never print.
	const guarded = lead.getDashboardLead({
		periodLabel: "Periodo",
		totalSpending: Number.NaN,
		expenseCount: -2,
		pendingAmountCount: Number.POSITIVE_INFINITY,
		incomeAmount: Number.NaN,
	});
	assert.equal(guarded.spending.amount, 0);
	assert.equal(guarded.spending.knownCount, 0);
	assert.equal(guarded.spending.pendingAmountCount, 0);
	assert.equal(guarded.spending.detail, "0 gastos con monto");
	assert.equal(guarded.balance.amount, null);
	assert.equal(guarded.balance.emptyValue, "\u2014");

	// A blank period label is irrelevant: the detail no longer echoes the period at all.
	const blankPeriod = lead.getDashboardLead({
		periodLabel: "   ",
		totalSpending: 0,
		expenseCount: 0,
		pendingAmountCount: 0,
		incomeAmount: null,
	});
	assert.equal(blankPeriod.spending.detail, "0 gastos con monto");

	// Neutral Spanish: no regional voseo in any of the copy this module produces.
	const allCopy = JSON.stringify([
		configured,
		unconfigured,
		demoInflow,
		demoAbsent,
		overspent,
		singular,
		guarded,
		blankPeriod,
	]);
	assert.doesNotMatch(allCopy, /\bvos\b|ten[e\u00e9]s|quer[e\u00e9]s|pod[e\u00e9]s|hac[e\u00e9]|and[a\u00e1]/i);
});

test("the React dashboard hero renders the prominent total and never a fabricated balance", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, lead, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/analytics/dashboardLead.ts"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const renderHero = (input) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.DashboardLeadView, {
				lead: lead.getDashboardLead(input),
			}),
		);

	const configured = renderHero({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 2,
		incomeAmount: 900000,
	});
	assert.match(configured, /<span class="react-lead-question">Total gastado<\/span>/);
	assert.match(configured, /<strong class="react-lead-amount">\$25\.000<\/strong>/);
	assert.match(configured, /3 gastos con monto \u00b7 2 sin monto claro/);
	// The lead card no longer repeats the selected period; the range lives in the period control only.
	assert.doesNotMatch(configured, /2026-02-01 \u2013 2026-02-28|01\/02\/2026 a 28\/02\/2026/);
	assert.match(configured, /<span class="react-lead-question">Saldo disponible<\/span>/);
	assert.match(configured, /<strong class="react-lead-amount">\$875\.000<\/strong>/);
	// The positive balance card renders only the pending caveat, never the subtraction prose.
	assert.match(
		configured,
		/<p class="react-lead-detail">2 movimientos sin monto conocido no se descuentan\.<\/p>/,
	);
	assert.doesNotMatch(configured, /Ingreso configurado menos los gastos reconocidos del periodo\./);

	// No configured income: the sentinel instead of a number, and the reason instead of a claim.
	const unconfigured = renderHero({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 0,
		incomeAmount: null,
	});
	assert.match(
		unconfigured,
		/<span class="react-lead-question">Saldo disponible<\/span><\/div><strong class="react-lead-amount">\u2014<\/strong>/,
	);
	assert.match(
		unconfigured,
		/No hay un ingreso configurado para el periodo, as\u00ed que no se puede calcular cu\u00e1nto te queda\./,
	);
	assert.doesNotMatch(unconfigured, /react-lead-derivation/);
	assert.doesNotMatch(unconfigured, /\$0/);
	// The prominent total is still shown even without an income.
	assert.match(unconfigured, /<strong class="react-lead-amount">\$25\.000<\/strong>/);

	// The `ingreso − gastos` derivation is gone from the highlighted card: the amount and the
	// percentage row already state the result, so no redundant subtraction line is rendered in either
	// income state. The pure module keeps the balance data it always produced.
	assert.doesNotMatch(configured, /react-lead-derivation|\$900\.000 ingreso \u2212/);
	assert.doesNotMatch(unconfigured, /react-lead-derivation/);

	// The demo source keeps the truthful net but labels it as observed demo data, so the rendered hero
	// never claims a configured income even though the number is preserved.
	const demoInflow = renderHero({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 0,
		incomeAmount: 900000,
		incomeSource: "demo-inflow",
	});
	assert.match(demoInflow, /<span class="react-lead-question">Saldo disponible<\/span>/);
	assert.match(demoInflow, /<strong class="react-lead-amount">\$875\.000<\/strong>/);
	assert.doesNotMatch(demoInflow, /react-lead-derivation|ingresos de la demo \u2212/);
	// With no pending amounts the positive detail is empty, so the amount is followed by the percentage
	// row directly instead of an empty paragraph.
	assert.match(
		demoInflow,
		/<strong class="react-lead-amount">\$875\.000<\/strong><div class="react-lead-balance-status-row">/,
	);
	assert.doesNotMatch(
		demoInflow,
		/Ingresos observados en los datos de la demo menos los gastos reconocidos del periodo\./,
	);
	assert.doesNotMatch(demoInflow, /Ingreso configurado|\$0/);

	// A demo without an observed inflow states that absence explicitly, with no balance, no derivation
	// line and no configured-income claim.
	const demoAbsent = renderHero({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 3,
		pendingAmountCount: 0,
		incomeAmount: null,
		incomeSource: "demo-inflow",
	});
	assert.match(
		demoAbsent,
		/<span class="react-lead-question">Saldo disponible<\/span><\/div><strong class="react-lead-amount">\u2014<\/strong>/,
	);
	assert.match(demoAbsent, /no registran ingresos en el periodo/);
	assert.doesNotMatch(demoAbsent, /Ingreso configurado|\$0|react-lead-derivation/);

	// The highlighted balance card states the truthful share of income still available, with a trend
	// direction, and omits the row entirely rather than fabricating a percentage when there is none.
	// The percentage carries only the number and its tone, without the removed `disponible` suffix, and
	// the adjacent compact flag names that same tone in Spanish instead of restating the number.
	assert.match(configured, /react-lead-balance-percent-positive/);
	assert.match(configured, /<span>97%<\/span>/);
	assert.doesNotMatch(configured, /% disponible/);
	assert.match(configured, /react-lead-balance-status-positive/);
	assert.match(configured, />En control</);
	// The status flag stays inside the same bottom row as the percentage.
	assert.match(
		configured,
		/<span class="react-lead-balance-percent react-lead-balance-percent-positive">[\s\S]*?<\/span><span class="react-lead-balance-status react-lead-balance-status-positive">En control<\/span>/,
	);
	assert.doesNotMatch(configured, /Al l\u00edmite|Peligro/);
	assert.doesNotMatch(configured, /react-lead-balance-status-negative/);
	assert.doesNotMatch(configured, /react-lead-balance-percent-negative/);
	assert.doesNotMatch(unconfigured, /react-lead-balance-percent/);
	assert.doesNotMatch(unconfigured, /react-lead-balance-status/);
	assert.doesNotMatch(demoAbsent, /react-lead-balance-percent/);
	assert.doesNotMatch(demoAbsent, /react-lead-balance-status/);

	// Overspending the income and spending exactly the income take the negative and flat icon tones
	// instead of a positive trend, so the direction is never inferred from the amount alone.
	const overspent = renderHero({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 1,
		pendingAmountCount: 0,
		incomeAmount: 10000,
	});
	assert.match(overspent, /react-lead-balance-percent-negative/);
	assert.match(overspent, /react-lead-balance-status-negative/);
	assert.match(overspent, />En peligro</);
	assert.match(overspent, /<span>-150%<\/span>/);
	const exactIncome = renderHero({
		periodLabel: "2026-02-01 \u2013 2026-02-28",
		totalSpending: 25000,
		expenseCount: 1,
		pendingAmountCount: 0,
		incomeAmount: 25000,
	});
	assert.match(exactIncome, /react-lead-balance-percent-flat/);
	assert.match(exactIncome, /react-lead-balance-status-flat/);
	assert.match(exactIncome, />Al l\u00edmite</);
	assert.match(exactIncome, /<span>0%<\/span>/);

	// The hero replaces the primitive card deck, so it does not repeat those card labels; the check
	// matches the labels as the removed card spans rendered them.
	assert.doesNotMatch(
		configured,
		/<span>Ingreso configurado<\/span>|<span>Gasto total<\/span>|<span>Gastos reconocidos<\/span>|<span>Montos pendientes<\/span>/,
	);

	// The same read-only hero is reused by the demo tree.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	assert.match(demoMarkup, /Solo lectura/);
	assert.match(demoMarkup, /Mercado/);
	// The demo shares the authenticated hero: both cards render, so its balance is the demo's own
	// observed-inflow net labelled as demo data and no demo-only layout modifier appears.
	assert.match(demoMarkup, /class="react-dashboard-lead"/);
	assert.match(demoMarkup, /react-lead-answer/);
	assert.match(demoMarkup, /Saldo disponible/);
	assert.doesNotMatch(demoMarkup, /react-dashboard-lead-single|Ingreso configurado/);

	// Scoped styles under the shipped `react-` prefix: one two-column lead and no demo-only modifier.
	assert.match(styles, /\.react-dashboard-lead \{/);
	assert.doesNotMatch(styles, /\.react-dashboard-lead-single/);
	assert.match(styles, /\.react-lead-primary,/);
	assert.match(styles, /\.react-lead-amount \{/);
	// The highlighted balance card is now a light, cool surface: the former dark primary gradient is
	// replaced by the soft blue token over the base surface, so the tone-coloured percentage and flag
	// stay legible and the red danger text reads naturally.
	const answerCardBlock =
		styles.match(/\.react-lead-answer \{\n\tdisplay: flex;[\s\S]*?\}/)?.[0] ?? "";
	assert.match(
		answerCardBlock,
		/background: linear-gradient\(150deg, var\(--surface\), var\(--color-blue-soft\)\);/,
	);
	assert.doesNotMatch(answerCardBlock, /var\(--primary\)|var\(--primary-container\)/);
	// The card is a column flex so the status row can be pushed to the bottom edge.
	assert.match(answerCardBlock, /flex-direction: column;/);
	// The percentage/status row stretches across the card content and anchors to the bottom edge:
	// the percentage sits at the bottom-left and the flag at the bottom-right of that same row.
	const balanceStatusRowBlock =
		styles.match(/\.react-lead-balance-status-row \{[\s\S]*?\}/)?.[0] ?? "";
	assert.match(balanceStatusRowBlock, /margin-top: auto;/);
	assert.match(balanceStatusRowBlock, /align-self: stretch;/);
	assert.match(balanceStatusRowBlock, /display: flex;/);
	assert.match(balanceStatusRowBlock, /justify-content: space-between;/);
	assert.doesNotMatch(balanceStatusRowBlock, /align-self: flex-end;/);
	// The percentage is plain tone-coloured text and glyph, never a chip: the element declares no background.
	const balancePercentBlock =
		styles.match(/\.react-lead-balance-percent \{[\s\S]*?\}/)?.[0] ?? "";
	assert.ok(balancePercentBlock.length > 0);
	assert.doesNotMatch(balancePercentBlock, /background/);
	// The flag owns the soft tone surface; the percentage only colours its number and icon.
	assert.match(styles, /\.react-lead-balance-status \{/);
	assert.match(
		styles,
		/\.react-lead-balance-status-positive \{\s*background: var\(--success-soft\);/,
	);
	assert.match(
		styles,
		/\.react-lead-balance-status-flat \{\s*background: var\(--warning-soft\);/,
	);
	assert.match(
		styles,
		/\.react-lead-balance-status-negative \{\s*background: var\(--danger-soft\);/,
	);
	assert.match(
		styles,
		/@media \(max-width: 640px\) \{[\s\S]*?\.react-dashboard-lead \{\s*grid-template-columns: 1fr;\s*\}/,
	);
});

test("the React authenticated summary mounts the dashboard lead hero without adding a request", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const page = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);

	// The hero is derived from the summary and the configured income the cycle already loaded, so the
	// page composes it and adds no request of its own.
	assert.match(page, /from "\.\.\/components\/analytics\/dashboardLead"/);
	assert.match(page, /\bgetDashboardLead\b/);
	assert.match(page, /const dashboardLead = getDashboardLead\(\{/);
	assert.match(page, /totalSpending: summary\.totalSpending,/);
	assert.match(page, /pendingAmountCount: summary\.pendingAmountCount,/);
	// The shared analytics body mounts the hero once for both the authenticated summary and the demo.
	assert.equal((page.match(/<DashboardLeadView/g) ?? []).length, 1);
	assert.match(page, /<DashboardLeadView lead=\{lead\} \/>/);
	assert.match(page, /export function DashboardLeadView\(/);
	// The authenticated call site declares the configured-cycle source, so its hero keeps the stored
	// income copy; the demo call site declares the demo source instead.
	assert.match(
		page,
		/getDashboardLead\(\{[\s\S]{0,400}?incomeSource: "configured-cycle",/,
	);
	assert.doesNotMatch(page, /loadDashboardLead|fetch\("\/api\/lead/);

	// The four primitive cards the hero consolidates are gone, so the total is not stated twice.
	assert.doesNotMatch(page, /<span>Ingreso configurado<\/span>/);
	assert.doesNotMatch(page, /<span>Gasto total<\/span>/);
	assert.doesNotMatch(page, /<span>Montos pendientes<\/span>/);

	// The demo tree reuses the same hero over its fixture.
	const demoSource = page.slice(
		page.indexOf("export function DemoDashboardPage"),
		page.indexOf("export interface DashboardLeadViewProps"),
	);
	assert.notEqual(demoSource, "", "the demo tree must be locatable");
	assert.match(demoSource, /DashboardLead/);
	assert.match(demoSource, /incomeSource: "demo-inflow"/);
	assert.doesNotMatch(demoSource, /incomeSource: "configured-cycle"/);
});

test("the React dashboard insights module derives a truthful story, top insights and a proportional breakdown", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [insights, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/analytics/dashboardInsights.ts"),
		readFile(
			new URL("../src/client/components/analytics/dashboardInsights.ts", import.meta.url),
			"utf8",
		),
	]);

	// It is a decision module over the data the summary already loaded: no request, no API layer, no
	// currency formatting and no React. The surface injects `formatClp`, so no formatter is imported.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);
	assert.doesNotMatch(moduleSource, /Intl\.NumberFormat|new Intl/);
	assert.doesNotMatch(moduleSource, /\bformatClp\s*\(/);

	// The story is concise and non-redundant: a short preamble, and only the facts the intelligence
	// card does not already show (now just the review count, since `Mayor impacto` states the largest
	// expense). The principal category, mayor destinatario and largest expense are accepted but never
	// restated.
	const story = insights.getDashboardStory({
		totalSpending: 25000,
		knownCount: 3,
		pendingAmountCount: 2,
		reviewCount: 2,
		topCategory: { label: "Comida", total: 20000 },
		topCounterparty: { label: "Mercado", total: 15000 },
	});
	assert.equal(story.title, "Lectura rápida");
	assert.equal(story.summary, "Puntos clave del periodo.");
	assert.deepEqual(story.facts, ["2 gastos necesitan una revisión rápida."]);
	// No fact or summary copy repeats what `Destacados` already states, including the largest expense
	// the intelligence card now shows as `Mayor impacto`.
	assert.doesNotMatch(JSON.stringify(story), /Comida|Mercado|CLP25000|CLP12000|Tienda/);

	// The facts fall back only to what the data supports: with no ranked fact but a known count the
	// story says the expenses are ready, and it renders no placeholder number.
	const ready = insights.getDashboardStory({
		totalSpending: 1000,
		knownCount: 1,
		pendingAmountCount: 0,
		reviewCount: 0,
		topCategory: null,
		topCounterparty: null,
	});
	assert.deepEqual(ready.facts, ["Tus gastos ya están listos para explorarse en el detalle."]);

	// An empty period states its lack of information and emits no fact; a pending-only period says why.
	const pendingOnly = insights.getDashboardStory({
		totalSpending: 0,
		knownCount: 0,
		pendingAmountCount: 3,
		reviewCount: 0,
		topCategory: null,
		topCounterparty: null,
	});
	assert.match(pendingOnly.summary, /todavía no tienen monto conocido/);
	assert.deepEqual(pendingOnly.facts, []);
	const empty = insights.getDashboardStory({
		totalSpending: 0,
		knownCount: 0,
		pendingAmountCount: 0,
		reviewCount: 0,
		topCategory: null,
		topCounterparty: null,
	});
	assert.match(empty.summary, /Todavía no hay gastos reconocidos/);
	assert.deepEqual(empty.facts, []);

	// The principal comercio/persona is grouped accent- and case-insensitively, sorted by raw total,
	// with a non-finite amount and a blank identity handled without a `NaN` or an empty name.
	const topCounterparty = insights.getTopCounterpartyGroup([
		{ id: "a", counterparty: "  Café  ", amount: 100, date: "2026-02-01", category: "Comida" },
		{ id: "b", counterparty: "cafe", amount: 50, date: "2026-02-02", category: "Comida" },
		{ id: "c", counterparty: "Mercado", amount: 500, date: "2026-02-03", category: "Comida" },
		{ id: "d", counterparty: "Rotiseria", amount: Number.POSITIVE_INFINITY, date: "2026-02-04", category: "Comida" },
		{ id: "e", counterparty: "   ", amount: 20, date: "2026-02-05", category: "Comida" },
	]);
	assert.deepEqual(topCounterparty, { label: "Mercado", total: 500 });
	assert.equal(insights.getTopCounterpartyGroup([]), null);

	// The four insights carry the raw total so the surface formats it; the latest movement ranks by
	// recency, so its value is the date and its note is the identity.
	const ranked = insights.getTopInsights({
		category: { label: "Comida", total: 20000 },
		counterparty: { label: "Mercado", total: 500 },
		largest: { label: "Tienda", total: 12000 },
		latest: { counterparty: "Tienda", date: "2026-02-28" },
	});
	assert.equal(ranked.category.label, "Principal categoría");
	assert.equal(ranked.category.value, "Comida");
	assert.equal(ranked.category.amount, 20000);
	assert.equal(ranked.counterparty.label, "Mayor destinatario");
	assert.equal(ranked.counterparty.value, "Mercado");
	assert.equal(ranked.counterparty.amount, 500);
	assert.equal(ranked.largest.label, "Mayor impacto");
	assert.equal(ranked.largest.value, "Tienda");
	assert.equal(ranked.largest.amount, 12000);
	assert.equal(ranked.latest.label, "Último movimiento");
	assert.equal(ranked.latest.value, "2026-02-28");
	assert.equal(ranked.latest.amount, null);
	assert.equal(ranked.latest.note, "Tienda");
	// Only the aggregate `Mayor destinatario` row carries the clarification that its total accumulates
	// every movement for the recipient; the other three rows state no hint.
	assert.equal(ranked.counterparty.hint, "Total acumulado del destinatario");
	assert.equal(ranked.category.hint, "");
	assert.equal(ranked.largest.hint, "");
	assert.equal(ranked.latest.hint, "");

	// No data: the shipped sentinel and a truthful reason instead of a name or an amount.
	const noData = insights.getTopInsights({ category: null, counterparty: null, largest: null, latest: null });
	assert.deepEqual(
		[noData.category.value, noData.counterparty.value, noData.largest.value, noData.latest.value],
		["—", "—", "—", "—"],
	);
	assert.deepEqual(
		[noData.category.amount, noData.counterparty.amount, noData.largest.amount, noData.latest.amount],
		[null, null, null, null],
	);
	assert.deepEqual(
		[noData.category.hint, noData.counterparty.hint, noData.largest.hint, noData.latest.hint],
		["", "", "", ""],
	);
	assert.match(noData.category.note, /Sin gastos con monto conocido/);
	assert.match(noData.largest.note, /Sin gastos con monto conocido/);
	assert.match(noData.latest.note, /Sin movimientos/);

	// The breakdown divides by the recognized quantified total and rounds each share once from the raw
	// amounts, so the three bars describe the same total the hero states.
	const breakdown = insights.getSpendingBreakdown({ purchase: 5000, transfer: 3000, payment: 2000 });
	assert.equal(breakdown.total, 10000);
	assert.deepEqual(
		breakdown.bars.map((bar) => [bar.key, bar.label, bar.amount, bar.percent]),
		[
			["purchase", "Compras", 5000, 50],
			["transfer", "Transferencias", 3000, 30],
			["payment", "Pagos", 2000, 20],
		],
	);
	assert.equal(breakdown.emptyMessage, null);

	// A zero total has no shares, never fabricated ones, and shows its own message.
	const zeroBreakdown = insights.getSpendingBreakdown({ purchase: 0, transfer: 0, payment: 0 });
	assert.equal(zeroBreakdown.total, 0);
	assert.deepEqual(zeroBreakdown.bars.map((bar) => bar.percent), [0, 0, 0]);
	assert.match(zeroBreakdown.emptyMessage, /Aún no hay gastos reconocidos con monto conocido/);
	// Non-finite totals cannot poison the percentages.
	const guardedBreakdown = insights.getSpendingBreakdown({
		purchase: Number.NaN,
		transfer: Number.POSITIVE_INFINITY,
		payment: 400,
	});
	assert.equal(guardedBreakdown.total, 400);
	assert.equal(guardedBreakdown.bars[2].percent, 100);

	// Neutral Spanish: no regional voseo in any of the copy this module produces.
	const allCopy = JSON.stringify([story, ready, pendingOnly, empty, ranked, noData, breakdown, zeroBreakdown]);
	assert.doesNotMatch(allCopy, /\bvos\b|ten[e\u00e9]s|quer[e\u00e9]s|pod[e\u00e9]s|hac[e\u00e9]|and[a\u00e1]/i);
});

test("the React authenticated summary renders the shared analytics body in the production order", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, insights, styles] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		vite.ssrLoadModule("/src/client/components/analytics/dashboardInsights.ts"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);

	const page = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);

	// The same CLP shape the surface's own `formatClp` produces, injected into the story so the view
	// echoes an already-formatted sentence.
	const formatClp = (amount) =>
		new Intl.NumberFormat("es-CL", {
			style: "currency",
			currency: "CLP",
			maximumFractionDigits: 0,
		}).format(Math.abs(amount));

	// The page composes the pure decisions and adds no request of its own.
	assert.match(page, /from "\.\.\/components\/analytics\/dashboardInsights"/);
	assert.match(page, /\bgetDashboardStory\b/);
	assert.match(page, /\bgetTopInsights\b/);
	assert.match(page, /\bgetSpendingBreakdown\b/);
	assert.match(page, /const dashboardStory = getDashboardStory\(\{/);
	assert.match(page, /const topInsights = getTopInsights\(\{/);
	assert.match(page, /const spendingBreakdown = getSpendingBreakdown\(spendingByKind\)/);
	assert.doesNotMatch(page, /loadDashboardInsights|fetch\("\/api\/insights/);

	// The shared analytics body owns the DOM order both surfaces read: primary lead, income/budget
	// truth, spending-type distribution, period metrics and spending chart (main column), then the
	// category ranking, the intelligence card and `Lectura rápida` (side column). Each position is a distinct
	// marker, so a reorder is observable.
	const bodySource = page.slice(
		page.indexOf("interface DashboardAnalyticsBodyProps"),
		page.indexOf("interface FinancialSummaryProps"),
	);
	assert.notEqual(bodySource, "", "the shared analytics body must be locatable");
	const positions = [
		bodySource.indexOf("<DashboardLeadView lead={lead} />"),
		bodySource.indexOf("<DashboardBudgetPanel panel={budgetPanel} />"),
		bodySource.indexOf("<SpendingBreakdownView breakdown={breakdown} />"),
		bodySource.indexOf("<PeriodAnalyticsPanel analytics={analytics} />"),
		bodySource.indexOf("<SpendingChartPanel"),
		bodySource.indexOf("<CategoryRankingPanel"),
		bodySource.indexOf("<TopInsightsView insights={insights} />"),
		bodySource.indexOf("<DashboardStoryView story={story} />"),
	];
	assert.ok(positions.every((position) => position >= 0), "every analytics panel must be mounted exactly once");
	for (let index = 1; index < positions.length; index += 1) {
		assert.ok(positions[index] > positions[index - 1], "the shared panels must appear in the production order");
	}
	// The distribution card leads the main column, so it renders left of the category card in the side
	// column instead of a narrow sidebar pair; `Lectura rápida` has left the main column entirely.
	const mainOpen = bodySource.indexOf('<div className="react-analytics-main">');
	const sideOpen = bodySource.indexOf('<div className="react-analytics-side">');
	assert.ok(mainOpen >= 0 && sideOpen > mainOpen, "the analytics body must mount the main column before the side column");
	const mainSource = bodySource.slice(mainOpen, sideOpen);
	const breakdownInMain = mainSource.indexOf("<SpendingBreakdownView breakdown={breakdown} />");
	assert.ok(breakdownInMain >= 0, "the distribution card must sit in the analytics main column");
	assert.equal(
		mainSource.indexOf("<DashboardStoryView story={story} />"),
		-1,
		"`Lectura rápida` must leave the analytics main column",
	);
	// The category distribution leads the side column, the intelligence card follows it, and `Lectura rápida`
	// renders last so the highlights stay primary.
	const sideSource = bodySource.slice(sideOpen);
	const categoryInSide = sideSource.indexOf("<CategoryRankingPanel");
	const insightsInSide = sideSource.indexOf("<TopInsightsView insights={insights} />");
	const storyInSide = sideSource.indexOf("<DashboardStoryView story={story} />");
	assert.ok(
		categoryInSide >= 0 && insightsInSide > categoryInSide,
		"the category card must lead the side column before the top insights",
	);
	assert.ok(
		storyInSide > insightsInSide,
		"`Lectura rápida` must render in the side column after the intelligence card",
	);
	// The temporary two-card sidebar pair wrapper and its placement rules are gone.
	assert.doesNotMatch(page, /react-analytics-pair/);
	// The shared body is the single mount site for both the authenticated summary and the demo.
	assert.equal((page.match(/<DashboardStoryView/g) ?? []).length, 1);
	assert.equal((page.match(/<TopInsightsView/g) ?? []).length, 1);
	assert.equal((page.match(/<SpendingBreakdownView/g) ?? []).length, 1);
	assert.match(page, /export function DashboardStoryView\(/);
	assert.match(page, /export function TopInsightsView\(/);
	assert.match(page, /export function SpendingBreakdownView\(/);

	// The duplicate latest-expense card and the plain definition-list breakdown are gone, so the three
	// facts and the three kind totals are not stated twice.
	assert.doesNotMatch(page, /react-latest-expense/);
	assert.doesNotMatch(page, /<dl className="react-spending-breakdown"/);

	// The story view renders the concise preamble and each non-duplicated fact as its own callout.
	const story = insights.getDashboardStory({
		totalSpending: 25000,
		knownCount: 3,
		pendingAmountCount: 2,
		reviewCount: 1,
		topCategory: { label: "Comida", total: 20000 },
		topCounterparty: { label: "Mercado", total: 15000 },
	});
	const storyMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DashboardStoryView, { story }),
	);
	assert.match(storyMarkup, /<section class="react-dashboard-story"/);
	assert.match(storyMarkup, /Lectura rápida/);
	assert.match(storyMarkup, /Puntos clave del periodo\./);
	assert.match(storyMarkup, /1 gasto necesita una revisión rápida\./);
	// One list item and one tinted callout per fact, and nothing repeats `Destacados` — including the
	// largest expense the intelligence card now shows as `Mayor impacto`.
	assert.equal((storyMarkup.match(/react-dashboard-story-callout/g) ?? []).length, 1);
	assert.match(storyMarkup, /<li class="react-dashboard-story-callout">/);
	assert.doesNotMatch(storyMarkup, /Comida|Mercado|Tienda|\$12\.000/);

	// An empty period announces its summary as a status and renders no callout block.
	const emptyStoryMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DashboardStoryView, {
			story: insights.getDashboardStory({
				totalSpending: 0,
				knownCount: 0,
				pendingAmountCount: 0,
				reviewCount: 0,
				topCategory: null,
				topCounterparty: null,
			}),
		}),
	);
	assert.match(emptyStoryMarkup, /role="status"/);
	assert.doesNotMatch(emptyStoryMarkup, /react-dashboard-story-callout/);

	// The intelligence card shows the new title, badge and the four truthful tiles with their totals.
	const topInsights = insights.getTopInsights({
		category: { label: "Comida", total: 20000 },
		counterparty: { label: "Mercado", total: 500 },
		largest: { label: "Tienda", total: 12000 },
		latest: { counterparty: "Tienda", date: "2026-02-28" },
	});
	const insightsMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.TopInsightsView, { insights: topInsights }),
	);
	assert.match(insightsMarkup, /<section class="react-top-insights"/);
	assert.match(insightsMarkup, /Lectura rápida · Inteligencia de gastos/);
	assert.match(insightsMarkup, /Resumen del periodo/);
	assert.match(insightsMarkup, /Tus datos más relevantes del periodo\./);
	assert.match(insightsMarkup, /Principal categoría/);
	assert.match(insightsMarkup, /Mayor destinatario/);
	assert.match(insightsMarkup, /Mayor impacto/);
	assert.match(insightsMarkup, /Último movimiento/);
	assert.match(insightsMarkup, /\$20\.000/);
	assert.match(insightsMarkup, /\$12\.000/);
	assert.match(insightsMarkup, /2026-02-28/);
	assert.match(insightsMarkup, /Tienda/);
	// The card is one uniform 2x2 grid of equal tiles: each keeps the same rhythm and a decorative
	// hidden glyph, the header leads with the lightbulb title, and only the aggregate `Mayor
	// destinatario` tile states its hint.
	assert.match(insightsMarkup, /react-top-insights-header/);
	assert.match(insightsMarkup, /<h3 id="react-top-insights-title">Lectura rápida · Inteligencia de gastos<\/h3>/);
	assert.match(insightsMarkup, /<span class="react-top-insights-badge">Resumen del periodo<\/span>/);
	assert.match(insightsMarkup, /<ul class="react-top-insights-grid">/);
	assert.doesNotMatch(insightsMarkup, /react-financial-grid|react-financial-card|react-top-insights-list/);
	assert.equal((insightsMarkup.match(/<li class="react-insight-callout">/g) ?? []).length, 4);
	assert.equal(
		(insightsMarkup.match(/class="react-card-icon" aria-hidden="true"/g) ?? []).length,
		5,
	);
	assert.match(insightsMarkup, /fa-lightbulb/);
	assert.match(insightsMarkup, /react-insight-callout-hint">Total acumulado del destinatario</);
	assert.equal((insightsMarkup.match(/react-insight-callout-hint/g) ?? []).length, 1);

	// The breakdown view draws one segmented bar plus an icon legend, keeping every kind's amount and
	// percentage as readable text.
	const breakdown = insights.getSpendingBreakdown({ purchase: 5000, transfer: 3000, payment: 2000 });
	const breakdownMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.SpendingBreakdownView, { breakdown }),
	);
	assert.match(breakdownMarkup, /<section class="react-spending-breakdown"/);
	assert.match(breakdownMarkup, /Distribución de gastos/);
	// The decorative chart glyph sits in its own hidden, non-interactive upper-right container.
	assert.match(breakdownMarkup, /class="react-spending-breakdown-header-icon" aria-hidden="true"/);
	assert.match(breakdownMarkup, /fa-chart-pie/);
	assert.match(breakdownMarkup, /\$10\.000/);
	assert.match(breakdownMarkup, /total registrado/);
	// The segmented bar carries the distribution and the total as its accessible name.
	assert.match(breakdownMarkup, /class="react-spending-breakdown-bar"/);
	assert.match(breakdownMarkup, /role="img"/);
	assert.match(breakdownMarkup, /aria-label="Distribución de gastos por tipo\. Total registrado \$10\.000\."/);
	assert.equal((breakdownMarkup.match(/react-spending-breakdown-segment-(purchase|transfer|payment)/g) ?? []).length, 3);
	assert.match(breakdownMarkup, /style="width:50%"/);
	assert.match(breakdownMarkup, /style="width:30%"/);
	assert.match(breakdownMarkup, /style="width:20%"/);
	// The base class plus its kind modifier both contain the base token, so count the standalone
	// class only: exactly one legend item per recognized kind.
	assert.equal((breakdownMarkup.match(/(?<![\w-])react-spending-breakdown-legend-item(?![\w-])/g) ?? []).length, 3);
	assert.match(breakdownMarkup, /fa-cart-shopping/);
	assert.match(breakdownMarkup, /fa-arrow-right-arrow-left/);
	assert.match(breakdownMarkup, /fa-receipt/);
	// Each legend marker reuses the exact class token of its matching bar segment.
	assert.match(breakdownMarkup, /react-spending-breakdown-legend-item react-spending-breakdown-legend-item-purchase/);
	assert.match(breakdownMarkup, /react-spending-breakdown-legend-item react-spending-breakdown-legend-item-transfer/);
	assert.match(breakdownMarkup, /react-spending-breakdown-legend-item react-spending-breakdown-legend-item-payment/);
	assert.match(breakdownMarkup, /react-spending-breakdown-icon react-spending-breakdown-icon-purchase/);
	assert.match(breakdownMarkup, /react-spending-breakdown-icon react-spending-breakdown-icon-transfer/);
	assert.match(breakdownMarkup, /react-spending-breakdown-icon react-spending-breakdown-icon-payment/);
	assert.match(breakdownMarkup, /Compras/);
	assert.match(breakdownMarkup, /Transferencias/);
	assert.match(breakdownMarkup, /Pagos/);
	assert.match(breakdownMarkup, /\$5\.000/);
	assert.match(breakdownMarkup, /\$3\.000/);
	assert.match(breakdownMarkup, /\$2\.000/);
	assert.match(breakdownMarkup, /50%/);
	assert.match(breakdownMarkup, /30%/);
	assert.match(breakdownMarkup, /20%/);

	// A zero total shows the truthful message instead of fabricated segments or a fabricated total.
	const zeroMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.SpendingBreakdownView, {
			breakdown: insights.getSpendingBreakdown({ purchase: 0, transfer: 0, payment: 0 }),
		}),
	);
	assert.match(zeroMarkup, /react-spending-breakdown-empty/);
	assert.doesNotMatch(zeroMarkup, /react-spending-breakdown-segment/);
	assert.doesNotMatch(zeroMarkup, /react-spending-breakdown-total/);

	// Scoped styles under the shipped `react-` prefix.
	assert.match(styles, /\.react-dashboard-story \{/);
	assert.match(styles, /\.react-dashboard-story-list \{/);
	// Each fact is a light callout: a blue tint with a matching, slightly stronger border.
	assert.match(styles, /\.react-dashboard-story-callout \{/);
	assert.match(styles, /\.react-dashboard-story-callout \{[^}]*background: var\(--color-blue-soft\)/s);
	assert.match(styles, /\.react-dashboard-story-callout \{[^}]*border: 1px solid var\(--color-blue-standard\)/s);
	assert.match(styles, /\.react-top-insights \{/);
	// The card carries a stronger left accent and the tiles use a light neutral tint, not white cards.
	assert.match(styles, /\.react-top-insights \{[^}]*border-left: 4px solid var\(--color-blue-standard\)/s);
	assert.match(styles, /\.react-top-insights-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
	assert.match(styles, /\.react-insight-callout \{[^}]*background: var\(--color-surface-subtle\)/s);
	assert.match(styles, /\.react-top-insights-badge \{/);
	assert.match(styles, /\.react-spending-breakdown-bar \{/);
	assert.match(styles, /\.react-spending-breakdown-header-icon \{/);
	assert.match(styles, /\.react-spending-breakdown-legend \{/);
	// The temporary pair wrapper and its placement rules are gone, so the main/side grid alone
	// decides the desktop and narrow-screen placement.
	assert.doesNotMatch(styles, /\.react-analytics-pair/);
	assert.match(styles, /\.react-analytics-columns \{\s*display: grid;\s*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 1fr\);/);
	assert.match(styles, /@media \(max-width: 1120px\) \{[\s\S]*?\.react-analytics-columns \{\s*grid-template-columns: 1fr;/);
	// Every legend marker resolves the same token as its matching bar segment.
	for (const [kind, token] of [
		["purchase", "--color-blue-deep"],
		["transfer", "--color-blue-bright"],
		["payment", "--color-violet"],
	]) {
		assert.match(styles, new RegExp(`\\.react-spending-breakdown-segment-${kind} \\{\\s*background: var\\(${token}\\)`));
		assert.match(styles, new RegExp(`\\.react-spending-breakdown-icon-${kind} \\{\\s*background: var\\(${token}\\)`));
	}
	assert.doesNotMatch(styles, /\.react-breakdown-(fill|track|row) \{/);
});

test("the React category distribution resolves stored colours with a deterministic fallback and states raw-total insights", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [distribution, ranking, moduleSource] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/analytics/categoryDistribution.ts"),
		vite.ssrLoadModule("/src/client/components/analytics/categoryRanking.ts"),
		readFile(
			new URL("../src/client/components/analytics/categoryDistribution.ts", import.meta.url),
			"utf8",
		),
	]);

	// The distribution is a decision module over the ranking rows, so it must never issue a request,
	// render React or reach for the charting library.
	assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
	assert.doesNotMatch(moduleSource, /api\/client/);
	assert.doesNotMatch(moduleSource, /from "react"|useState/);
	assert.doesNotMatch(moduleSource, /echarts/);

	// A stored catalog colour wins, matched accent- and case-insensitively and trimmed.
	const catalog = [
		{ name: "Comida", color: "#ff8800" },
		{ name: "Ropa", color: "no-es-color" },
	];
	assert.equal(distribution.getCategoryRowColor(" comida ", catalog), "#ff8800");
	// The merged tail and the unnamed bucket keep legacy's fixed colours.
	assert.equal(distribution.getCategoryRowColor("Otras categorías", catalog), "#94a3b8");
	assert.equal(distribution.getCategoryRowColor("Sin categoría", catalog), "#64748b");
	assert.equal(distribution.getCategoryRowColor("", catalog), "#64748b");
	// An unusable stored colour falls back to the palette, never to the invalid string.
	const ropaColor = distribution.getCategoryRowColor("Ropa", catalog);
	assert.notEqual(ropaColor, "no-es-color");
	assert.match(ropaColor, /^#[0-9a-f]{6}$/i);
	// The fallback is deterministic: the same category keeps its swatch with no catalog at all.
	assert.equal(distribution.getCategoryRowColor("Ropa", []), ropaColor);
	assert.equal(
		distribution.getCategoryRowColor("Ropa", undefined),
		distribution.getCategoryRowColor("Ropa", undefined),
	);

	const formatAmount = (amount) => `$${amount}`;

	// The combined share of the two largest rows is computed from raw totals and rounded once. This
	// fixture exposes legacy's rounded-sum bug: 245 + 245 both round to 25% (a 50% sum), while the raw
	// combined share is 490/1000 = 49%.
	const roundingRows = [
		{ category: "A", total: 245, count: 1, share: 25, mergesTail: false, counterparties: [], children: [] },
		{ category: "B", total: 245, count: 1, share: 25, mergesTail: false, counterparties: [], children: [] },
		{ category: "C", total: 200, count: 1, share: 20, mergesTail: false, counterparties: [], children: [] },
		{ category: "Otras categorías", total: 310, count: 2, share: 31, mergesTail: true, counterparties: [], children: [] },
	];
	const roundingInsight = distribution.getCategoryDistributionInsight(roundingRows, 1000, formatAmount);
	assert.doesNotMatch(roundingInsight, /50%/);
	assert.equal(
		roundingInsight,
		"Tus gastos están distribuidos entre varias categorías; mira el top 3 antes que todos los detalles.",
	);

	// A combined share that really reaches half is stated from the raw totals.
	const combined = distribution.getCategoryDistributionInsight(
		[
			{ category: "Comida", total: 300, count: 1, share: 30, mergesTail: false, counterparties: [], children: [] },
			{ category: "Arriendo", total: 250, count: 1, share: 25, mergesTail: false, counterparties: [], children: [] },
		],
		1000,
		formatAmount,
	);
	assert.equal(combined, "Comida y Arriendo explican el 55% de tus gastos.");

	// A single dominant category is named with its own raw share.
	const dominant = distribution.getCategoryDistributionInsight(
		[{ category: "Arriendo", total: 450, count: 1, share: 45, mergesTail: false, counterparties: [], children: [] }],
		1000,
		formatAmount,
	);
	assert.equal(dominant, "Arriendo concentra el 45% del gasto del periodo.");

	// The unnamed bucket is found even when the tail merge absorbed it, and the copy is neutral Spanish.
	const merged = ranking.getCategoryRanking(
		[
			{ id: "a", counterparty: "A", amount: 500, date: "", category: "Comida" },
			{ id: "b", counterparty: "B", amount: 200, date: "", category: "Sin categoría" },
			{ id: "c", counterparty: "C", amount: 150, date: "", category: "Transporte" },
			{ id: "d", counterparty: "D", amount: 100, date: "", category: "Ocio" },
			{ id: "e", counterparty: "E", amount: 50, date: "", category: "Hogar" },
		],
		0,
	);
	const mergedInsight = distribution.getCategoryDistributionInsight(merged.rows, merged.total, formatAmount);
	assert.equal(mergedInsight, "$200 (20%) aún está sin categoría. Clasificarlo mejora tu análisis.");
	assert.doesNotMatch(mergedInsight, /este mes|vos|ten[eé]s|quer[eé]s/i);

	// The accessible label names the total and every visible slice.
	const ariaLabel = distribution.getDistributionAriaLabel(
		[{ category: "Comida", total: 300, share: 30, count: 1, mergesTail: false, counterparties: [], children: [] }],
		1000,
		formatAmount,
	);
	assert.match(ariaLabel, /Total \$1000/);
	assert.match(ariaLabel, /Comida: \$300 \(30%\)/);
	assert.equal(distribution.formatMovementCount(1), "1 movimiento");
	assert.equal(distribution.formatMovementCount(2), "2 movimientos");
	assert.equal(distribution.getCategoryDistributionInsight([], 0, formatAmount), null);
});

test("the React category distribution renders the ECharts donut legend, reuses the category detail and stays out of the demo", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, analytics, distributionModule, distributionSource, page, styles] =
		await Promise.all([
			import("react"),
			import("react-dom/server"),
			vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
			vite.ssrLoadModule("/src/client/components/analytics/categoryRanking.ts"),
			vite.ssrLoadModule("/src/client/components/analytics/CategoryDistribution.tsx"),
			readFile(
				new URL("../src/client/components/analytics/CategoryDistribution.tsx", import.meta.url),
				"utf8",
			),
			readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
			readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
		]);

	const noop = () => {};
	const formatAmount = (amount) =>
		new Intl.NumberFormat("es-CL", {
			style: "currency",
			currency: "CLP",
			maximumFractionDigits: 0,
		}).format(Math.abs(amount));
	const movements = [
		{ id: "a", counterparty: "Mercado", amount: 25000, date: "2026-02-02", category: "Comida" },
		{ id: "b", counterparty: "Feria", amount: 5000, date: "2026-02-03", category: "Comida" },
		{ id: "c", counterparty: "Caf\u00e9", amount: 3500, date: "2026-02-04", category: "Comida" },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-05", category: "Arriendo" },
		{ id: "e", counterparty: "Supermercado", amount: 12000, date: "2026-02-06", category: "Supermercado" },
		{ id: "f", counterparty: "Sin identificar", amount: 1000, date: "2026-02-07", category: "Sin categoría" },
		{ id: "g", counterparty: "Cine", amount: 8000, date: "2026-02-08", category: "Entretenimiento" },
		{ id: "h", counterparty: "Bus", amount: 2000, date: "2026-02-09", category: "Transporte" },
	];
	const view = analytics.getCategoryRanking(movements, 3);
	const catalog = [{ name: "Comida", color: "#ff8800" }];

	const renderDistribution = (selectedCategory, ranking = view) =>
		renderer.renderToStaticMarkup(
			React.createElement(distributionModule.CategoryDistributionView, {
				ranking,
				catalog,
				selectedCategory,
				onSelect: noop,
				onClearSelection: noop,
				onJumpToCategory: noop,
				formatAmount,
			}),
		);

	const list = renderDistribution(null);
	assert.match(list, /<h3 id="react-category-distribution-title">Dónde se fue tu plata<\/h3>/);
	assert.match(list, /Distribución por categoría principal\./);
	assert.match(list, /class="react-category-distribution-insight" role="status"/);
	// The donut container carries the chart facts as an accessible name because the canvas is not.
	assert.match(list, /role="img" aria-label="Distribución de gastos por categoría\. Total \$456\.500\./);
	assert.match(list, /class="react-category-donut-chart"/);
	// One coloured legend row per visible row, using the stored colour where there is one.
	assert.equal((list.match(/class="react-category-legend-item"/g) ?? []).length, 4);
	assert.match(list, /style="--category-color:#ff8800"/);
	assert.match(list, /aria-pressed="false"/);
	assert.match(list, /<strong>Comida<\/strong><small>\$33\.500 · 7% · 3 mov\.<\/small>/);
	assert.match(list, /<strong>Otras categorías<\/strong>/);
	assert.doesNotMatch(list, /react-category-detail/);
	// The excluded outflows stay disclosed next to the total.
	assert.match(list, /3 salidas reconocidas del periodo no tienen monto conocido/);

	// Selecting a row reuses the extracted detail view in place of the legend.
	const detail = renderDistribution("Comida");
	assert.match(detail, /class="react-category-detail"/);
	assert.match(detail, /<strong>Comida<\/strong><small>\$33\.500 · 7% · 3 movimientos<\/small>/);
	assert.match(detail, /Ver gastos de esta categoría/);
	assert.doesNotMatch(detail, /react-category-legend-item/);

	// The merged tail reuses the same detail and withholds the jump it cannot perform.
	const tail = renderDistribution("Otras categorías");
	assert.match(tail, /<strong>Otras categorías<\/strong>/);
	assert.match(tail, /<strong>Entretenimiento<\/strong>/);
	assert.doesNotMatch(tail, /Ver gastos de esta categoría/);

	// A period with nothing to distribute states its own absence and draws no donut.
	const empty = renderDistribution(null, analytics.getCategoryRanking([], 0));
	assert.match(empty, /class="react-category-distribution-empty"/);
	assert.doesNotMatch(empty, /react-category-donut|react-category-legend-item/);

	// ECharts is imported dynamically, so a static render never loads the charting library.
	assert.match(distributionSource, /import type \{ EChartsOption, EChartsType \} from "echarts";/);
	assert.match(distributionSource, /void import\("echarts"\)/);
	// A failed dynamic import is stated instead of rejecting unhandled, and an empty ranking drops any
	// instance the card already owns.
	assert.match(distributionSource, /\.catch\(\(\) => \{[\s\S]*?setChartUnavailable\(true\)/);
	assert.match(distributionSource, /react-category-donut-fallback/);
	assert.match(distributionSource, /legend\.length === 0\) \{[\s\S]{0,240}?instanceRef\.current\?\.dispose\(\)/);

	// The page composes the distribution and loads the catalog only inside the authenticated summary.
	assert.match(page, /catalog=\{categoryCatalog\}/);
	// The shared analytics body mounts the ranking wrapper once for both the authenticated summary
	// and the read-only demo, so the wrapper keeps a single mount site.
	assert.equal((page.match(/<CategoryRankingPanel/g) ?? []).length, 1);
	const summarySource = page.slice(
		page.indexOf("function FinancialSummary"),
		page.indexOf("function FinancialCycleSetupForm"),
	);
	assert.match(summarySource, /getCategories\(controller\.signal\)/);
	assert.doesNotMatch(page, /loadCategoryDistribution|fetch\("\/api\/analytics/);

	// The same read-only distribution is reused by the demo tree.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
				],
			},
		}),
	);
	assert.match(demoMarkup, /Solo lectura/);
	// The demo now mounts the same read-only distribution as the authenticated summary.
	assert.match(demoMarkup, /react-category-distribution/);
	assert.match(demoMarkup, /Dónde se fue tu plata/);

	// Scoped styles under the shipped `react-` prefix.
	assert.match(styles, /\.react-category-distribution \{/);
	assert.match(styles, /\.react-category-distribution-body \{/);
	assert.match(styles, /\.react-category-donut \{/);
	assert.match(styles, /\.react-category-donut-fallback \{/);
	assert.match(styles, /\.react-category-legend-item \{/);
	assert.match(styles, /\.react-category-legend-marker \{/);
});

test("the React movement selection ticks only editable rows and offers the normalized similar-counterparty affordance", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const selection = await vite.ssrLoadModule(
		"/src/client/components/movements/movementSelection.ts",
	);
	const rows = [
		{ id: "a", counterparty: "Caf\u00e9 Central", amount: 1000, date: "2026-02-01", category: "Comida" },
		{ id: "b", counterparty: "cafe central", amount: 2000, date: "2026-02-02", category: "Comida" },
		{ id: null, counterparty: "CAF\u00c9  CENTRAL", amount: 3000, date: "\u2014", category: "Comida" },
		{ id: "d", counterparty: "Arriendo", amount: 400000, date: "2026-02-03", category: "Arriendo" },
	];
	const editableMovement = (id, counterparty, amount, date) => ({
		id,
		counterparty,
		amount,
		date,
		category: "Comida",
		description: "",
		kind: "purchase",
		direction: "outflow",
		occurredAt: `${date}T00:00:00`,
		isManual: true,
	});
	const editable = [
		editableMovement("a", "Caf\u00e9 Central", 1000, "2026-02-01"),
		editableMovement("b", "cafe central", 2000, "2026-02-02"),
		editableMovement("d", "Arriendo", 400000, "2026-02-03"),
	];

	// The row without a usable id is viewable but never tickable: the select-all set is exactly the
	// editable projection's ids.
	const selectableIds = selection.getSelectableMovementIds(rows, editable);
	assert.deepEqual(selectableIds, ["a", "b", "d"]);

	// Neutral state: nothing ticked, the header is neither checked nor mixed, and no count is claimed.
	let state = selection.createMovementSelection();
	let view = selection.getMovementSelectionView(state, selectableIds);
	assert.equal(view.selectedCount, 0);
	assert.equal(view.allSelected, false);
	assert.equal(view.indeterminate, false);
	assert.equal(view.message, null);

	// One tick: the header is mixed and the count statement names the filtered total.
	state = selection.toggleMovementSelection(state, "a", selectableIds);
	view = selection.getMovementSelectionView(state, selectableIds);
	assert.deepEqual(view.selectedIds, ["a"]);
	assert.equal(view.selectedCount, 1);
	assert.equal(view.allSelected, false);
	assert.equal(view.indeterminate, true);
	assert.equal(view.message, "1 de 3 movimientos seleccionados");

	// Select-all selects every tickable id; a second activation clears.
	state = selection.toggleAllMovementSelection(state, selectableIds);
	view = selection.getMovementSelectionView(state, selectableIds);
	assert.deepEqual(view.selectedIds, ["a", "b", "d"]);
	assert.equal(view.allSelected, true);
	assert.equal(view.indeterminate, false);
	state = selection.toggleAllMovementSelection(state, selectableIds);
	assert.equal(selection.getMovementSelectionView(state, selectableIds).selectedCount, 0);

	// A non-editable id can never enter the selection.
	assert.deepEqual(
		[...selection.toggleMovementSelection(selection.createMovementSelection(), "ghost", selectableIds)],
		[],
	);
	// Reconciliation drops a stale id and keeps the object identical while nothing changes.
	const reconciled = selection.reconcileMovementSelection(new Set(["a", "ghost"]), selectableIds);
	assert.deepEqual([...reconciled], ["a"]);
	assert.equal(selection.reconcileMovementSelection(reconciled, selectableIds), reconciled);

	// The similar-counterparty affordance groups accent- and case-insensitively, and offers only
	// tickable rows: the third fixture row shares the counterparty but has no editable target.
	const affordance = selection.getSimilarCounterpartyAffordance(rows[0], rows, selectableIds);
	assert.equal(affordance.key, selection.getMovementCounterpartyKey("CAF\u00c9  central"));
	assert.deepEqual(affordance.ids, ["a", "b"]);
	assert.equal(affordance.count, 2);
	assert.equal(affordance.label, "2 similares");
	assert.deepEqual(
		selection.getSimilarCounterpartyAffordance(rows[3], rows, selectableIds).ids,
		["d"],
	);
});

test("the React bulk category assignment sends each movement once and reports partial failure truthfully", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const selection = await vite.ssrLoadModule(
		"/src/client/components/movements/movementSelection.ts",
	);
	const targets = [
		{ movementId: "a", originalOccurredAt: "2026-02-01", isManual: true },
		{ movementId: "b", originalOccurredAt: "2026-02-02", isManual: false },
		{ movementId: "c", originalOccurredAt: "2026-02-03", isManual: true },
	];

	const calls = [];
	let reloads = 0;
	const partial = selection.createBulkCategorySubmitter({
		updateMovement: async (target, patch) => {
			calls.push({ id: target.movementId, patch });
			if (target.movementId === "b") throw new Error("Request to /api/transactions/b failed (500)");
			if (target.movementId === "c") throw new Error("Request to /api/transactions/c failed (404)");
		},
		reload: async () => {
			reloads += 1;
			return true;
		},
	});
	const outcome = await partial(targets, "Comida");
	// Each selected movement was attempted exactly once and every attempt sent the minimal PATCH body.
	assert.deepEqual(calls.map((call) => call.id).sort(), ["a", "b", "c"]);
	for (const call of calls) assert.deepEqual(call.patch, { category: "Comida" });
	assert.equal(outcome.total, 3);
	assert.equal(outcome.succeeded, 1);
	assert.equal(outcome.failed, 1);
	assert.equal(outcome.notFound, 1);
	assert.equal(outcome.reloadFailed, false);
	assert.equal(reloads, 1);
	assert.deepEqual(outcome.failures.map((failure) => failure.kind).sort(), ["failed", "notFound"]);

	const partialFeedback = selection.getBulkCategoryFeedback(outcome);
	assert.equal(partialFeedback.tone, "warning");
	assert.match(partialFeedback.message, /Se asign\u00f3 la categor\u00eda a 1 de 3 movimientos\./);
	assert.match(partialFeedback.message, /Los otros 2 no se pudieron actualizar\./);

	// A call with no targets has nothing to claim.
	assert.equal(
		selection.getBulkCategoryFeedback({ total: 0, succeeded: 0, failed: 0, notFound: 0, reloadFailed: false, failures: [] }),
		null,
	);

	// Clearing sends a null category and reports the stale list when the follow-up reload failed.
	const clearedCalls = [];
	const cleared = selection.createBulkCategorySubmitter({
		updateMovement: async (_target, patch) => {
			clearedCalls.push(patch);
		},
		reload: async () => false,
	});
	const clearedOutcome = await cleared([targets[0]], "");
	assert.deepEqual(clearedCalls[0], { category: null });
	assert.equal(clearedOutcome.succeeded, 1);
	assert.equal(clearedOutcome.reloadFailed, true);
	const clearedFeedback = selection.getBulkCategoryFeedback(clearedOutcome);
	assert.equal(clearedFeedback.tone, "success");
	assert.match(clearedFeedback.message, /puede estar desactualizada/);

	// No success at all: no reload runs and the feedback states that nothing changed.
	let failureReloads = 0;
	const alwaysFails = selection.createBulkCategorySubmitter({
		updateMovement: async () => {
			throw new Error("Request to /api/transactions/a failed (500)");
		},
		reload: async () => {
			failureReloads += 1;
			return true;
		},
	});
	const failureOutcome = await alwaysFails(targets, "Comida");
	assert.equal(failureOutcome.succeeded, 0);
	assert.equal(failureOutcome.failed, 3);
	assert.equal(failureReloads, 0);
	const failureFeedback = selection.getBulkCategoryFeedback(failureOutcome);
	assert.equal(failureFeedback.tone, "error");
	assert.match(failureFeedback.message, /No se pudo asignar la categor\u00eda a ninguno de los 3/);
	assert.match(failureFeedback.message, /No se aplicaron cambios\./);
});

test("the React view-movement dialog names every available field and offers edit/remove only with an editable target", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [dialog, React, renderer] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/movements/ViewMovementDialog.tsx"),
		import("react"),
		import("react-dom/server"),
	]);
	const noop = () => {};
	const movement = {
		id: "a",
		counterparty: "Caf\u00e9 Central",
		amount: 12345,
		date: "2026-02-01",
		category: "Comida",
		description: "Almuerzo",
		kind: "purchase",
		status: "needs_review",
		source: "gmail",
		occurredAt: "2026-02-01T14:30:00",
		hasTime: true,
	};

	// The field list is a pure projection: every available fact in order, with no invented placeholder.
	const fields = dialog.getMovementDetailFields(movement);
	assert.deepEqual(
		fields.map((field) => field.label),
		["Fecha y hora", "Comercio o persona", "Descripci\u00f3n", "Tipo", "Categor\u00eda", "Monto", "Estado", "Origen"],
	);
	assert.equal(fields[0].value, "2026-02-01 14:30");
	assert.equal(fields[2].value, "Almuerzo");
	assert.equal(fields[3].value, "Compras");
	assert.equal(fields[5].value, dialog.formatDetailAmount(12345));
	assert.equal(fields[6].value, "Requiere revisi\u00f3n");
	assert.equal(fields[7].value, "gmail");
	assert.equal(dialog.getMovementStatusLabel("manual"), "Manual");
	assert.equal(dialog.getMovementStatusLabel("otro"), "otro");
	assert.equal(dialog.getMovementStatusLabel(null), null);
	// A date-only row does not fabricate a time.
	assert.equal(
		dialog.getMovementDetailFields({ ...movement, occurredAt: "2026-02-01T00:00:00", hasTime: false })[0].value,
		"2026-02-01",
	);
	// An absent status/source is omitted instead of rendered as an empty line.
	assert.deepEqual(
		dialog
			.getMovementDetailFields({ ...movement, status: null, source: null, description: "" })
			.map((field) => field.label),
		["Fecha y hora", "Comercio o persona", "Tipo", "Categor\u00eda", "Monto"],
	);

	// With an editable target the existing edit/remove actions are exposed.
	const editable = {
		...movement,
		direction: "outflow",
		occurredAt: "2026-02-01T14:30:00",
		isManual: true,
	};
	const withActions = renderer.renderToStaticMarkup(
		React.createElement(dialog.ViewMovementDialog, {
			movement,
			editableMovement: editable,
			onClose: noop,
			onEdit: noop,
			onRemove: noop,
		}),
	);
	assert.match(withActions, /Detalle del movimiento/);
	assert.match(withActions, /<dt>Fecha y hora<\/dt><dd>2026-02-01 14:30<\/dd>/);
	assert.match(withActions, /<dt>Estado<\/dt><dd>Requiere revisi\u00f3n<\/dd>/);
	assert.match(withActions, />Editar</);
	assert.match(withActions, />Eliminar</);
	assert.doesNotMatch(withActions, /solo puede verse/);

	// Without one, the same detail renders with no mutation controls and a truthful note.
	const readOnly = renderer.renderToStaticMarkup(
		React.createElement(dialog.ViewMovementDialog, {
			movement,
			editableMovement: null,
			onClose: noop,
			onEdit: noop,
			onRemove: noop,
		}),
	);
	assert.match(readOnly, /Caf\u00e9 Central/);
	assert.match(readOnly, /solo puede verse/);
	assert.doesNotMatch(readOnly, />Editar</);
	assert.doesNotMatch(readOnly, />Eliminar</);
});

test("the React movements table renders the selection column, the bulk bar and the similar-counterparty affordance", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [filters, selection, pageModule, React, renderer, page, styles] = await Promise.all([
		vite.ssrLoadModule("/src/client/components/movements/movementFilters.ts"),
		vite.ssrLoadModule("/src/client/components/movements/movementSelection.ts"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		import("react"),
		import("react-dom/server"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/client/styles.css", import.meta.url), "utf8"),
	]);
	const noop = () => {};
	const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
	const rows = [
		{ id: "a", counterparty: "Caf\u00e9 Central", amount: 1000, date: "2026-02-01", category: "Comida" },
		{ id: "b", counterparty: "cafe central", amount: 2000, date: "2026-02-02", category: "Comida" },
		{ id: null, counterparty: "Sin identificaci\u00f3n", amount: 3000, date: "\u2014", category: "Comida" },
	];
	const editable = [
		{ id: "a", counterparty: "Caf\u00e9 Central", amount: 1000, date: "2026-02-01", category: "Comida", description: "", kind: "purchase", direction: "outflow", occurredAt: "2026-02-01T00:00:00", isManual: true },
		{ id: "b", counterparty: "cafe central", amount: 2000, date: "2026-02-02", category: "Comida", description: "", kind: "purchase", direction: "outflow", occurredAt: "2026-02-02T00:00:00", isManual: true },
	];
	const filteredView = filters.getMovementFilterView(
		filters.createMovementFilterSelection(period),
		period,
		rows,
	);
	const selectableIds = selection.getSelectableMovementIds(rows, editable);

	const renderView = (selectionView) =>
		renderer.renderToStaticMarkup(
			React.createElement(pageModule.MovementsTableView, {
				filteredView,
				sort: { key: null, direction: null },
				editableMovements: editable,
				onActivate: noop,
				onSelect: noop,
				onClear: noop,
				onEdit: noop,
				onRemove: noop,
				onView: noop,
				selection: selectionView,
				onToggleSelection: noop,
				onToggleAllSelection: noop,
				onSelectSimilar: noop,
				onClearSelection: noop,
				bulkCategoryOptions: [
					{ value: "", label: "Sin categor\u00eda", disabled: false },
					{ value: "Comida", label: "Comida", disabled: false },
				],
				bulkCategoryValue: "Comida",
				onBulkCategoryChange: noop,
				onAssignCategory: noop,
				isBulkAssigning: false,
				bulkNotice: {
					tone: "warning",
					message: "Se asign\u00f3 la categor\u00eda a 1 de 2 movimientos. Los otros 1 no se pudieron actualizar.",
				},
			}),
		);

	const neutral = renderView(selection.getMovementSelectionView(selection.createMovementSelection(), selectableIds));
	// The select-all control and one checkbox per row: the non-editable row's checkbox is disabled.
	assert.match(neutral, /aria-label="Seleccionar todos los movimientos editables"/);
	assert.equal((neutral.match(/class="react-movement-select"/g) ?? []).length, 2);
	assert.equal((neutral.match(/react-movement-select-disabled/g) ?? []).length, 1);
	assert.match(neutral, /aria-label="No seleccionable: Sin identificaci\u00f3n"[^>]*disabled=""/);
	// The bulk bar states the count and carries the category control and both actions.
	assert.match(neutral, /Acciones sobre la selecci\u00f3n/);
	assert.match(neutral, /Ning\u00fan movimiento seleccionado/);
	assert.match(neutral, /<option value="Comida" selected="">Comida<\/option>/);
	assert.match(neutral, /Limpiar selecci\u00f3n/);
	assert.match(neutral, /Asignar categor\u00eda/);
	// The partial-failure notice is the caller's own copy.
	assert.match(neutral, /Se asign\u00f3 la categor\u00eda a 1 de 2 movimientos\./);
	// "N similares" appears on the two rows that share a normalized counterparty.
	assert.equal((neutral.match(/>2 similares<\/button>/g) ?? []).length, 2);

	// One row selected: the header reports the mixed state and the count.
	const partial = renderView(selection.getMovementSelectionView(new Set(["a"]), selectableIds));
	assert.match(partial, /aria-checked="mixed"/);
	assert.match(partial, /1 de 2 movimientos seleccionados/);
	// Every tickable row selected: the header is checked and no longer mixed.
	const full = renderView(selection.getMovementSelectionView(new Set(["a", "b"]), selectableIds));
	assert.match(full, /aria-label="Seleccionar todos los movimientos editables"[^>]*checked=""/);
	assert.doesNotMatch(full, /aria-checked="mixed"/);

	// Sensitivity control: without a selection layer the table keeps its pre-selection markup.
	const legacy = renderer.renderToStaticMarkup(
		React.createElement(pageModule.MovementsTableView, {
			filteredView,
			sort: { key: null, direction: null },
			editableMovements: editable,
			onActivate: noop,
			onSelect: noop,
			onClear: noop,
			onEdit: noop,
			onRemove: noop,
		}),
	);
	assert.doesNotMatch(legacy, /react-movements-select-column|Acciones sobre la selecci\u00f3n/);
	// The Ver action is present for every row, including the one with no editable target.
	assert.equal((legacy.match(/>Ver<\/button>/g) ?? []).length, 3);

	// The table wires the container state to the pure module and passes the bulk submitter through.
	assert.match(page, /getMovementSelectionView/);
	assert.match(page, /getSimilarCounterpartyAffordance/);
	assert.match(page, /onSelectSimilar=/);
	assert.match(page, /submitBulkCategory=\{submitBulkCategory\}/);
	assert.match(page, /updateMovement: updateTransaction/);
	// Demo isolation: the read-only composition never mounts the table, the detail modal or the bar.
	const demoSource = page.slice(
		page.indexOf("export function DemoDashboardPage"),
		page.indexOf("export interface DashboardLeadViewProps"),
	);
	assert.doesNotMatch(demoSource, /MovementsTable|ViewMovementDialog|submitBulkCategory|react-movements-bulk/);

	// Scoped styles under the shipped `react-` prefix.
	assert.match(styles, /\.react-movements-bulk \{/);
	assert.match(styles, /\.react-movements-bulk-notice-warning \{/);
	assert.match(styles, /\.react-movement-similar \{/);
	assert.match(styles, /\.react-view-movement-dialog \{/);
});

test("the React movement selection and detail surfaces add no request of their own and keep the demo read-only", async () => {
	const [selectionSource, dialogSource] = await Promise.all([
		readFile(
			new URL("../src/client/components/movements/movementSelection.ts", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../src/client/components/movements/ViewMovementDialog.tsx", import.meta.url),
			"utf8",
		),
	]);

	// The decisions and the read-only dialog are pure: no fetch, no API layer, no new endpoint.
	assert.doesNotMatch(selectionSource, /\bfetch\s*\(/);
	assert.doesNotMatch(selectionSource, /api\/client/);
	assert.doesNotMatch(dialogSource, /\bfetch\s*\(/);
	assert.doesNotMatch(dialogSource, /api\/client/);
	assert.doesNotMatch(selectionSource, /useState|useEffect/);
});

test("the React cycle calendar keeps date-only math timezone-safe and bounds the grid to the current year so far", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const calendar = await vite.ssrLoadModule(
		"/src/client/components/financial-cycle/cycleCalendar.ts",
	);

	// Date-only parsing rejects impossible days, and the arithmetic is UTC based, so a DST boundary can
	// never shift a day. `today` is the viewer's local calendar date.
	assert.equal(calendar.isValidDateOnly("2028-02-29"), true);
	assert.equal(calendar.isValidDateOnly("2028-02-30"), false);
	assert.equal(calendar.isValidDateOnly("2028-2-9"), false);
	assert.equal(calendar.shiftDateOnly("2028-02-28", 1), "2028-02-29");
	assert.equal(calendar.shiftDateOnly("2026-03-08", 1), "2026-03-09");
	assert.equal(calendar.shiftDateOnly("2026-03-01", -1), "2026-02-28");
	assert.equal(calendar.getCurrentDateKey(new Date(2026, 1, 28, 23, 30)), "2026-02-28");

	// The selectable/navigation window is January of the current year through today; the year comes
	// from the local date, never a hard-coded constant.
	assert.deepEqual(calendar.getCurrentYearCalendarBounds(new Date(2026, 1, 15, 23, 30)), {
		startDate: "2026-01-01",
		endDate: "2026-02-15",
	});
	assert.deepEqual(
		calendar.getCalendarMonthKeys({ startDate: "2026-01-01", endDate: "2026-03-10" }),
		["2026-01", "2026-02", "2026-03"],
	);

	const bounds = { startDate: "2026-01-01", endDate: "2026-02-10" };
	const range = { startDate: "2026-02-01", endDate: "2026-02-28", awaitingEnd: false };
	const grid = calendar.buildCalendarMonthGrid("2026-02", { bounds, range, today: "2026-02-10" });
	assert.equal(grid.label, "febrero de 2026");
	assert.equal(grid.weekdayHeadings.length, 7);
	// 1 February 2026 is a Sunday, so a Monday-first grid has six leading blanks.
	assert.equal(grid.leadingBlanks, 6);
	assert.equal(grid.days.length, 28);

	const inRangeDay = grid.days.find((day) => day.dateKey === "2026-02-05");
	assert.deepEqual(
		{
			inBounds: inRangeDay.inBounds,
			isFuture: inRangeDay.isFuture,
			selected: inRangeDay.selected,
			disabled: inRangeDay.disabled,
			label: inRangeDay.label,
		},
		{
			inBounds: true,
			isFuture: false,
			selected: true,
			disabled: false,
			label: "5 de febrero de 2026",
		},
	);
	// A future day inside the period is disabled: the correction this port applies to the legacy grid.
	const futureDay = grid.days.find((day) => day.dateKey === "2026-02-20");
	assert.equal(futureDay.isFuture, true);
	assert.equal(futureDay.disabled, true);

	// The disabled rule is exactly "outside the selectable window or in the future": a day the
	// configured cycle does not include is still selectable while it is inside the year so far.
	const partialBounds = { startDate: "2026-02-10", endDate: "2026-02-20" };
	const partialGrid = calendar.buildCalendarMonthGrid("2026-02", {
		bounds: partialBounds,
		range: { startDate: "2026-02-10", endDate: "2026-02-20", awaitingEnd: false },
		today: "2026-02-20",
	});
	for (const day of partialGrid.days) {
		const inBounds =
			day.dateKey >= partialBounds.startDate && day.dateKey <= partialBounds.endDate;
		assert.equal(day.inBounds, inBounds);
		assert.equal(day.disabled, !inBounds);
	}
	assert.equal(partialGrid.days.find((day) => day.dateKey === "2026-02-01").disabled, true);
	assert.equal(partialGrid.days.find((day) => day.dateKey === "2026-02-15").disabled, false);

	// The legacy two-click rule: the first click sets the start, the second sets the end and swaps when
	// the user clicked an earlier day.
	const firstClick = calendar.selectCalendarDate(
		calendar.createCalendarRange("2026-02-01", "2026-02-28"),
		"2026-02-12",
	);
	assert.deepEqual(firstClick, { startDate: "2026-02-12", endDate: "", awaitingEnd: true });
	assert.deepEqual(calendar.selectCalendarDate(firstClick, "2026-02-20"), {
		startDate: "2026-02-12",
		endDate: "2026-02-20",
		awaitingEnd: false,
	});
	assert.deepEqual(calendar.selectCalendarDate(firstClick, "2026-02-03"), {
		startDate: "2026-02-03",
		endDate: "2026-02-12",
		awaitingEnd: false,
	});

	// Validation reuses the wizard's own copy, and the range summary states what is still pending.
	assert.equal(calendar.validateCalendarRange("", "2026-02-28").message, "Selecciona la fecha Desde.");
	assert.equal(calendar.validateCalendarRange("2026-02-01", "").message, "Selecciona la fecha Hasta.");
	assert.equal(
		calendar.validateCalendarRange("2026-02-28", "2026-02-01").message,
		"La fecha Hasta debe ser igual o posterior a la fecha Desde.",
	);
	assert.deepEqual(calendar.validateCalendarRange("2026-02-01", "2026-02-28"), { ok: true });
	assert.deepEqual(
		calendar.getCalendarRangeSummary({ startDate: "2026-02-01", endDate: "", awaitingEnd: true }),
		{
			startLabel: "1 de febrero de 2026",
			endLabel: "Pendiente",
			message: "Inicio 1 de febrero de 2026. Elige la fecha de término en el calendario.",
		},
	);
});

test("the React cycle calendar renders the year-to-date grid, the range summary and the validation error", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, calendar] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/financial-cycle/CycleCalendar.tsx"),
	]);
	const render = (props) =>
		renderer.renderToStaticMarkup(React.createElement(calendar.CycleCalendar, props));
	const dayButton = (markup, dateKey) =>
		(markup.match(new RegExp(`<button[^>]*data-date="${dateKey}"[^>]*>`)) ?? [""])[0];

	const bounds = { startDate: "2026-01-01", endDate: "2026-03-15" };
	const markup = render({
		bounds,
		range: { startDate: "2026-02-10", endDate: "2026-02-20", awaitingEnd: false },
		onSelectDate: () => {},
		today: "2026-02-15",
	});
	assert.match(markup, /aria-label="Calendario del periodo"/);
	assert.match(markup, /class="react-cycle-calendar-weekday" aria-hidden="true">L</);
	assert.match(markup, /class="react-cycle-calendar-day react-cycle-calendar-day-selected" data-date="2026-02-15"[^>]*aria-pressed="true"[^>]*aria-current="date"/);
	assert.doesNotMatch(dayButton(markup, "2026-02-15"), /disabled=""/);
	// A future day inside the period is disabled even while the range still selects it.
	assert.match(dayButton(markup, "2026-02-20"), /aria-pressed="true"/);
	assert.match(dayButton(markup, "2026-02-20"), /disabled=""/);
	assert.match(markup, /Desde el 10 de febrero de 2026 hasta el 20 de febrero de 2026\./);
	assert.match(markup, /Inicio<\/dt><dd>10 de febrero de 2026<\/dd>/);
	assert.match(markup, /Término<\/dt><dd>20 de febrero de 2026<\/dd>/);
	// February sits inside the January-to-today window, so both month arrows are reachable.
	assert.doesNotMatch(markup, /aria-label="Mes anterior" disabled=""/);
	assert.doesNotMatch(markup, /aria-label="Mes siguiente" disabled=""/);

	const errored = render({
		bounds,
		range: { startDate: "", endDate: "", awaitingEnd: false },
		onSelectDate: () => {},
		today: "2026-02-15",
		error: "Selecciona la fecha Desde.",
	});
	assert.match(errored, /aria-invalid="true"/);
	assert.match(errored, /class="react-cycle-calendar-error" role="alert">Selecciona la fecha Desde\./);

	// Navigation is bounded to the window's own months: the first month cannot go back, the last
	// (current) month cannot go forward.
	const firstMonth = render({
		bounds,
		range: { startDate: "2026-01-05", endDate: "", awaitingEnd: false },
		onSelectDate: () => {},
		today: "2026-03-15",
	});
	assert.match(firstMonth, /aria-label="Mes anterior" disabled=""/);
	assert.doesNotMatch(firstMonth, /aria-label="Mes siguiente" disabled=""/);
	const lastMonth = render({
		bounds,
		range: { startDate: "2026-03-05", endDate: "", awaitingEnd: false },
		onSelectDate: () => {},
		today: "2026-03-15",
	});
	assert.doesNotMatch(lastMonth, /aria-label="Mes anterior" disabled=""/);
	assert.match(lastMonth, /aria-label="Mes siguiente" disabled=""/);
});

test("the React financial-cycle setup and edit flows mount the modal setup and the bounded calendar over their existing fields", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, dialog, page, dialogSource] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule(
			"/src/client/components/financial-cycle/FinancialCycleEditDialog.tsx",
		),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
		readFile(
			new URL(
				"../src/client/components/financial-cycle/FinancialCycleEditDialog.tsx",
				import.meta.url,
			),
			"utf8",
		),
	]);

	// The setup form keeps its two date inputs and the income input, and adds the calendar over them.
	const setupSource = page.slice(
		page.indexOf("function FinancialCycleSetupForm"),
		page.indexOf("function MovementsTable"),
	);
	assert.notEqual(setupSource, "", "the setup form must be locatable");
	assert.match(setupSource, /<CycleCalendar/);
	assert.match(setupSource, /validateCalendarRange/);
	assert.match(setupSource, /selectCalendarDate/);
	assert.match(setupSource, /type="date"/);
	assert.match(setupSource, /id="financial-cycle-income"/);
	// The setup is a real modal, not an inline section: the shared dialog helper plus the shipped
	// `react-financial-state` card, with a current-year-to-today calendar window.
	assert.match(setupSource, /<dialog/);
	assert.match(setupSource, /syncNativeModalDialog/);
	assert.match(setupSource, /getCurrentYearCalendarBounds/);
	assert.match(setupSource, /bounds=\{calendarBounds\}/);

	// The edit dialog mounts the same calendar inside its form and keeps its fields.
	const configured = {
		selectedPeriod: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
		incomeAmount: 900000,
		completedAt: null,
	};
	const markup = renderer.renderToStaticMarkup(
		React.createElement(dialog.FinancialCycleEditDialog, {
			isOpen: true,
			cycle: configured,
			onClose: () => {},
			submitCycle: async () => ({ status: "saved", reloadFailed: false }),
			onSaved: () => {},
		}),
	);
	assert.match(markup, /class="react-cycle-calendar"/);
	assert.equal((markup.match(/type="date"/g) ?? []).length, 2);
	assert.match(markup, /id="financial-cycle-income"/);
	assert.match(markup, /Desde el 1 de febrero de 2026 hasta el 28 de febrero de 2026\./);
	assert.match(dialogSource, /<CycleCalendar/);
	// The edit calendar uses the same year-to-date window as the setup modal, not the stored cycle.
	assert.match(dialogSource, /getCurrentYearCalendarBounds/);
	assert.match(dialogSource, /bounds=\{calendarBounds\}/);
	// The calendar sits inside the form and before the field grid it augments.
	const formSource = dialogSource.slice(
		dialogSource.indexOf("react-financial-cycle-form"),
		dialogSource.indexOf("react-financial-cycle-status"),
	);
	assert.match(formSource, /<CycleCalendar[\s\S]*?<div className="react-financial-setup-fields">/);
});

test("the React dashboard income/budget panel states the configured income and the unconfigured budget truthfully", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, budget, pageModule] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/components/analytics/dashboardBudget.ts"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
	]);
	const formatAmount = (amount) =>
		new Intl.NumberFormat("es-CL", {
			style: "currency",
			currency: "CLP",
			maximumFractionDigits: 0,
		}).format(Math.abs(amount));

	const configured = budget.getDashboardIncomeBudgetPanel({
		source: "configured-cycle",
		incomeAmount: 900000,
		periodLabel: "2026-02-01 – 2026-02-28",
		formatAmount,
	});
	assert.equal(configured.income.label, "Ingreso configurado");
	assert.equal(configured.income.hasValue, true);
	assert.equal(configured.income.value, "$900.000");
	// The configured income copy is concise and never repeats the selected period.
	assert.equal(configured.income.detail, "Ingreso guardado.");
	assert.doesNotMatch(configured.income.detail, /2026-02-01|01\/02\/2026|2026-02-28|28\/02\/2026/);
	// The budget is always an explicit absence: the product stores no budget to read.
	assert.equal(configured.budget.hasValue, false);
	assert.equal(configured.budget.value, "No configurado");

	const absent = budget.getDashboardIncomeBudgetPanel({
		source: "configured-cycle",
		incomeAmount: null,
		periodLabel: "2026-02-01 – 2026-02-28",
		formatAmount,
	});
	assert.equal(absent.income.hasValue, false);
	assert.equal(absent.income.value, "Sin ingreso configurado");
	assert.equal(absent.income.detail, "No hay un ingreso configurado.");
	// A zero is not a configured income, so no fabricated `$0` is ever shown.
	assert.equal(
		budget.getDashboardIncomeBudgetPanel({
			source: "configured-cycle",
			incomeAmount: 0,
			periodLabel: "2026-02-01 – 2026-02-28",
			formatAmount,
		}).income.hasValue,
		false,
	);

	// The demo has no configured cycle: it states the fixture's observed inflow sum as demo data and
	// never borrows the configured-income label or its stored-in-period detail. Its copy is concise and
	// period-independent.
	const demo = budget.getDashboardIncomeBudgetPanel({
		source: "demo-inflow",
		incomeAmount: 900000,
		periodLabel: "2026-02-01 – 2026-02-28",
		formatAmount,
	});
	assert.equal(demo.income.label, "Ingresos del periodo");
	assert.equal(demo.income.hasValue, true);
	assert.equal(demo.income.value, "$900.000");
	assert.equal(demo.income.detail, "Ingresos presentes en la demo.");
	assert.doesNotMatch(demo.income.detail, /periodo financiero|2026-02-01|01\/02\/2026|28\/02\/2026/);
	assert.doesNotMatch(demo.income.label, /configurado/i);

	// A demo with no inflow is explicit too: copy instead of a fabricated `$0`, and still no configured
	// cycle claim.
	const demoAbsent = budget.getDashboardIncomeBudgetPanel({
		source: "demo-inflow",
		incomeAmount: 0,
		periodLabel: "2026-02-01 – 2026-02-28",
		formatAmount,
	});
	assert.equal(demoAbsent.income.hasValue, false);
	assert.equal(demoAbsent.income.value, "Sin ingresos en la demo");
	assert.equal(demoAbsent.income.detail, "La demo no registra ingresos.");
	assert.doesNotMatch(demoAbsent.income.value, /\$0/);

	const markup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DashboardBudgetPanel, { panel: configured }),
	);
	assert.match(markup, /class="react-budget-panel"/);
	assert.match(markup, /Ingreso configurado/);
	assert.match(markup, /\$900\.000/);
	assert.match(markup, /Presupuesto/);
	assert.match(markup, /No configurado/);
	assert.doesNotMatch(markup, /%|progress|saldo restante/i);

	const absentMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DashboardBudgetPanel, { panel: absent }),
	);
	assert.match(absentMarkup, /Sin ingreso configurado/);
	assert.doesNotMatch(absentMarkup, /\$0/);

	// The demo panel states the demo data sum and never the configured cycle copy. The same panel
	// component renders both sources, so a static render proves the demo branch in both truth states.
	const demoMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DashboardBudgetPanel, { panel: demo }),
	);
	assert.match(demoMarkup, /Ingresos del periodo/);
	assert.match(demoMarkup, /\$900\.000/);
	assert.doesNotMatch(demoMarkup, /Ingreso configurado|guardado en el periodo/);

	const demoAbsentMarkup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DashboardBudgetPanel, { panel: demoAbsent }),
	);
	assert.match(demoAbsentMarkup, /Sin ingresos en la demo/);
	assert.doesNotMatch(demoAbsentMarkup, /\$0|Ingreso configurado/);
});

test("the React demo dashboard composes the read-only analytics without API, Gmail or mutations", async (t) => {
	const configPath = new URL("../vite.config.ts", import.meta.url).pathname;
	const loadedConfig = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configPath,
	);
	const vite = await createViteServer({
		...loadedConfig?.config,
		configFile: false,
		appType: "custom",
		server: { middlewareMode: true },
	});
	t.after(() => vite.close());

	const [React, renderer, pageModule, page] = await Promise.all([
		import("react"),
		import("react-dom/server"),
		vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx"),
		readFile(new URL("../src/client/pages/DashboardPage.tsx", import.meta.url), "utf8"),
	]);
	const markup = renderer.renderToStaticMarkup(
		React.createElement(pageModule.DemoDashboardPage, {
			data: {
				period: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" },
				currentPeriodSpending: 25000,
				currentPeriodInflow: 900000,
				movements: [
					{
						id: "expense",
						occurredAt: "2026-02-28T12:30:00",
						amount: 25000,
						direction: "outflow",
						kind: "purchase",
						counterparty: "Mercado",
						category: "Comida",
					},
					{
						id: "income",
						occurredAt: "2026-02-15T09:00:00",
						amount: 900000,
						direction: "inflow",
						kind: "transfer",
						counterparty: "Empresa",
						category: null,
					},
				],
			},
		}),
	);

	// The complete read-only composition: badge, footer and every analytics surface.
	assert.match(markup, /demo-read-only-badge/);
	assert.match(markup, /Solo lectura/);
	assert.match(markup, /demo-dashboard-footer/);
	// The demo shares the authenticated composition: the same two-card lead, income/budget truth and
	// analytics panels render, over dummy data and with no demo-only layout modifier.
	assert.match(markup, /class="react-dashboard-lead"/);
	assert.match(markup, /react-lead-answer/);
	assert.match(markup, /react-budget-panel/);
	assert.match(markup, /Ingresos del periodo/);
	assert.doesNotMatch(markup, /react-dashboard-lead-single|demo-kpi-grid/);
	assert.match(markup, /react-category-distribution/);
	assert.match(markup, /react-spending-chart/);
	assert.match(markup, /react-dashboard-story/);
	assert.match(markup, /react-top-insights/);
	assert.match(markup, /react-spending-breakdown/);
	assert.match(markup, /react-period-analytics/);

	// No authenticated mutation tree, account/settings surface or Gmail panel is mounted.
	assert.doesNotMatch(
		markup,
		/react-financial-summary|AccountSettingsDialog|GmailConnectionPanel|Nuevo gasto|Cambiar período|Cerrar período/,
	);
	assert.doesNotMatch(markup, /<form|<input|<select|<dialog/);
	assert.doesNotMatch(markup, /type="submit"/);
	// Every interactive control is an explicit read-only selection button.
	assert.equal(
		(markup.match(/<button/g) ?? []).length,
		(markup.match(/<button type="button"/g) ?? []).length,
	);

	// The composition reads no API: the demo tree imports no client and calls no fetch.
	const demoSource = page.slice(
		page.indexOf("export function DemoDashboardPage"),
		page.indexOf("export interface DashboardLeadViewProps"),
	);
	assert.notEqual(demoSource, "", "the demo tree must be locatable");
	assert.doesNotMatch(
		demoSource,
		/api\/client|syncGmail|FinancialSummary|GmailConnectionPanel|AccountSettingsDialog/,
	);
	assert.doesNotMatch(demoSource, /\bfetch\s*\(/);

	// The demo mounts the one shared analytics body after its header and before its read-only movements
	// list and footer. The analytics section order lives in the shared body, not in the demo tree.
	const demoOrder = [
		"demo-read-only-badge",
		"<DashboardAnalyticsBody",
		'className="demo-movements"',
		"demo-dashboard-footer",
	];
	const demoPositions = demoOrder.map((marker) => demoSource.indexOf(marker));
	assert.ok(
		demoPositions.every((position) => position >= 0),
		"every demo surface must be mounted in the composition",
	);
	for (let index = 1; index < demoPositions.length; index += 1) {
		assert.ok(
			demoPositions[index] > demoPositions[index - 1],
			"the demo surfaces must appear in the target order",
		);
	}
});
