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
const { ReviewPeriod: publicReviewPeriod } = await import(
	"../public/review-period.js"
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

	const appStylesheet = await fetch(`http://127.0.0.1:${viteAddress.port}/app.css`);
	assert.equal(appStylesheet.status, 200);
	assert.match(appStylesheet.headers.get("content-type") ?? "", /^text\/css/);

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

test("production mounts the React shell at /app/demo and preserves the legacy dashboard route", () => {
	assert.deepEqual(resolveStaticAsset("/"), {
		directory: "public",
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
	assert.deepEqual(resolveStaticAsset("/app", new URLSearchParams("demo")), {
		directory: "public",
		pathname: "/app.html",
	});
	assert.deepEqual(resolveStaticAsset("/legacy-app"), {
		directory: "public",
		pathname: "/app.html",
	});
	assert.deepEqual(resolveStaticAsset("/demo-data.json"), {
		directory: "public",
		pathname: "/demo-data.json",
	});
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
			"2028-02-29 – 2028-02-29",
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
	assert.match(source, /<dl className="react-spending-breakdown"/);
	assert.match(source, /<dt>Purchases<\/dt>/);
	assert.match(source, /<dt>Transfers<\/dt>/);
	assert.match(source, /<dt>Payments<\/dt>/);
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
				counterparty: "Coffee shop",
				amount: -1200,
				date: "2028-02-29",
				category: "Food",
			},
			{
				counterparty: "Rent transfer",
				amount: 300,
				date: "2028-02-29",
				category: "Uncategorized",
			},
			{
				counterparty: "Unidentified expense",
				amount: 200,
				date: "—",
				category: "Uncategorized",
			},
		],
	);

	const source = await readFile(
		new URL("../src/client/pages/DashboardPage.tsx", import.meta.url),
		"utf8",
	);
	assert.match(source, /role="group" aria-label="Financial view"/);
	assert.match(source, /aria-pressed=\{view === "summary"\}/);
	assert.match(source, /aria-pressed=\{view === "movements"\}/);
	assert.match(source, /<th scope="col">Counterparty<\/th>/);
	assert.match(source, /<th scope="col">Amount<\/th>/);
	assert.match(source, /<th scope="col">Date<\/th>/);
	assert.match(source, /<th scope="col">Category<\/th>/);
	assert.match(source, /No recognized expenses are available for this period\./);
	assert.match(source, /Open legacy dashboard/);
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
	assert.match(markup, /href="\/auth\/google"/);
	assert.match(hero, /href="\/app\/demo"/);
	const demoBranch = route.DemoDashboardRoute.toString();
	assert.doesNotMatch(demoBranch, /getSessionProfile|getGmailStatus|syncGmail|\/api\//);
});

test("the legacy browser module re-exports the shared review-period contract", () => {
	assert.equal(publicReviewPeriod, sharedReviewPeriod);
	assert.deepEqual(
		publicReviewPeriod.fromInclusive("2028-02-29", "2028-02-29").toJSON(),
		{ startDate: "2028-02-29", endDateExclusive: "2028-03-01" },
	);
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
	assert.doesNotMatch(
		source.slice(
			source.indexOf("function FinancialCycleSetupForm"),
			source.indexOf("function MovementsTable"),
		),
		/legacy-app/,
	);
	assert.match(styles, /\.react-financial-setup-form/);
});
