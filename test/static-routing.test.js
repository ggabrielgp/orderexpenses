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

test("serves the marketing landing at the root", async () => {
	const response = await request("/");
	assert.equal(response.status, 200);
	assert.match(response.headers["content-type"], /^text\/html/);
	assert.match(response.body, /Acceder con Google/);
	assert.doesNotMatch(response.body, /id="dashboard"/);
});

test("landing demo CTA opens the deterministic demo dashboard without changing sign-in", async () => {
	const source = await readFile(
		new URL("../public/index.html", import.meta.url),
		"utf8",
	);
	assert.match(
		source,
		/<a class="btn-secondary" href="\/app\?demo">Ver dashboard<\/a>/,
	);
	assert.match(source, /id="landingSessionAction"[^>]*href="\/auth\/google"/);
});

test("landing and dashboard load Sora across every referenced weight", async () => {
	const documents = await Promise.all([
		readFile(new URL("../public/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/app.html", import.meta.url), "utf8"),
	]);

	for (const source of documents) {
		assert.equal(source.match(/family=Sora:wght@400\.\.800/g)?.length, 1);
	}
});

test("serves the product dashboard from the clean app route", async () => {
	for (const pathname of ["/app", "/app/"]) {
		const response = await request(pathname);
		assert.equal(response.status, 200);
		assert.match(response.body, /id="dashboard"/);
		assert.match(response.body, /src="\/app\.js"/);
	}
});

test("serves dashboard assets from absolute paths", async () => {
	const response = await request("/app.css");
	assert.equal(response.status, 200);
	assert.match(response.headers["content-type"], /^text\/css/);
	assert.match(response.body, /\.dashboard/);
});

test("landing and dashboard share the active visual design contract", async () => {
	const [tokens, landing, dashboard, appStyles] = await Promise.all([
		readFile(new URL("../public/design-tokens.css", import.meta.url), "utf8"),
		readFile(new URL("../public/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/app.html", import.meta.url), "utf8"),
		readFile(new URL("../public/app.css", import.meta.url), "utf8"),
	]);

	const tokenResponse = await request("/design-tokens.css");
	assert.equal(tokenResponse.status, 200);
	assert.match(tokenResponse.headers["content-type"], /^text\/css/);

	for (const source of [landing, dashboard]) {
		assert.equal(source.match(/href="\/design-tokens\.css"/g)?.length, 1);
	}
	assert.ok(
		dashboard.indexOf('href="/design-tokens.css"') <
			dashboard.indexOf('href="/app.css"'),
	);

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

	assert.match(landing, /class="[^"]*product-stage[^"]*"/);
	assert.match(dashboard, /href="\/design-tokens\.css"/);
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

test("landing consumes its cool marketing palette without changing product roles", async () => {
	const [tokens, source] = await Promise.all([
		readFile(new URL("../public/design-tokens.css", import.meta.url), "utf8"),
		readFile(new URL("../public/index.html", import.meta.url), "utf8"),
	]);

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

	assert.match(source, /name="theme-color" content="#faf8ff"/);
	assert.match(source, /canvas:\s*"var\(--marketing-canvas\)"/);
	assert.match(source, /cobalt:\s*"var\(--marketing-primary-hover\)"/);
	assert.match(source, /ink:\s*"var\(--marketing-ink\)"/);
	assert.match(source, /muted:\s*"var\(--marketing-muted\)"/);
	assert.match(source, /lavender:\s*"var\(--marketing-surface-subtle\)"/);
	assert.match(source, /line:\s*"var\(--marketing-line\)"/);
	assert.match(tokens, /--font-display:\s*"Sora"/);
	assert.match(tokens, /--radius-control:\s*12px/);
	assert.match(tokens, /--radius-card:\s*16px/);
	assert.match(tokens, /--radius-featured:\s*20px/);
	assert.match(
		source,
		/\.financial-value\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s,
	);
});

test("landing custom primary opacity modifiers use an alpha-aware marketing color contract", async () => {
	const [tokens, source] = await Promise.all([
		readFile(new URL("../public/design-tokens.css", import.meta.url), "utf8"),
		readFile(new URL("../public/index.html", import.meta.url), "utf8"),
	]);
	const activeModifiers = [
		...source.matchAll(/\bprimary\/(?:\d+|\[[^\]]+\])\b/g),
	];

	assert.ok(
		activeModifiers.length > 0,
		"expected the landing to exercise a primary opacity modifier",
	);
	const primaryColor = source.match(/\bprimary:\s*"([^"]+)"/)?.[1];
	assert.ok(
		primaryColor,
		"expected a custom primary color in the landing Tailwind config",
	);
	assert.match(
		primaryColor,
		/^rgb\(var\((--[\w-]+-rgb)\)\s*\/\s*<alpha-value>\)$/,
	);

	const channelToken = primaryColor.match(/var\((--[\w-]+-rgb)\)/)?.[1];
	assert.equal(channelToken, "--marketing-primary-rgb");
	assert.match(tokens, /--marketing-primary-rgb:\s*23\s+78\s+166/);
	assert.match(tokens, /--marketing-primary:\s*#174ea6/);
});

test("landing hero stage and featured KPI use light marketing roles, never the product dark anchor", async () => {
	const [tokens, source] = await Promise.all([
		readFile(new URL("../public/design-tokens.css", import.meta.url), "utf8"),
		readFile(new URL("../public/index.html", import.meta.url), "utf8"),
	]);

	assert.match(
		tokens,
		/--marketing-stage-background:\s*linear-gradient\([^;]+#ffffff[^;]+#f1f2fc[^;]+\)/s,
	);
	assert.match(tokens, /--marketing-stage-border:\s*#d7ddea/);
	assert.match(
		source,
		/\.product-stage\s*\{[^}]*border:\s*1px solid var\(--marketing-stage-border\)[^}]*background:\s*var\(--marketing-stage-background\)[^}]*box-shadow:\s*var\(--marketing-stage-shadow\)/s,
	);
	assert.match(
		source,
		/\.product-anchor\s*\{[^}]*background:\s*var\(--marketing-featured-kpi-background\)[^}]*color:\s*var\(--marketing-featured-kpi-text\)/s,
	);
	assert.doesNotMatch(
		source,
		/\.(?:product-stage|product-anchor)\s*\{[^}]*(?:--anchor-background|--anchor-background-raised)/s,
	);
	assert.match(
		source,
		/\.connected-status\s*\{[^}]*background:\s*var\(--success-soft\)[^}]*color:\s*var\(--success\)/s,
	);
	assert.match(
		source,
		/\.connected-status-dot\s*\{[^}]*background:\s*var\(--success\)/s,
	);
	assert.match(source, /\.success-value\s*\{[^}]*color:\s*var\(--success\)/s);
	assert.match(
		source,
		/\.budget-ring\s*\{[^}]*conic-gradient\(\s*var\(--marketing-primary\)\s+0\s+68%,\s*var\(--marketing-line\)\s+68%/s,
	);
});

test("every landing hero financial amount uses the shared financial-value contract", async () => {
	const source = await readFile(
		new URL("../public/index.html", import.meta.url),
		"utf8",
	);
	const heroStage = source.slice(
		source.indexOf('class="product-stage'),
		source.indexOf("Vista ilustrativa · datos de ejemplo"),
	);
	const amountElements = [
		...heroStage.matchAll(
			/<([a-z][\w-]*)\b([^>]*)>([^<>]*[+-]?\$\d[\d.]*[^<>]*)<\/\1>/gi,
		),
	];

	assert.ok(
		amountElements.length > 0,
		"expected illustrative financial amounts in the hero stage",
	);
	for (const [, , attributes, text] of amountElements) {
		assert.match(
			attributes,
			/class="[^"]*\bfinancial-value\b[^"]*"/,
			`${text.trim()} must use .financial-value`,
		);
	}
});

test("view switch options keep the shared control radius in the final cascade", async () => {
	const styles = await readFile(
		new URL("../public/app.css", import.meta.url),
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

test("landing hero KPI cards stack before narrow-screen amounts can clip", async () => {
	const source = await readFile(
		new URL("../public/index.html", import.meta.url),
		"utf8",
	);

	assert.match(
		source,
		/\.hero-kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
	);
	assert.match(
		source,
		/@media\s*\(max-width:\s*420px\)\s*\{\s*\.hero-kpi-grid\s*\{[^}]*grid-template-columns:\s*1fr/s,
	);
	assert.match(source, /class="[^"]*\bhero-kpi-grid\b[^"]*"/);
	assert.doesNotMatch(
		source,
		/class="[^"]*\bhero-kpi-grid\b[^"]*\bgrid-cols-3\b[^"]*"/,
	);
});

test("OAuth success returns users to the dashboard with auto-sync enabled", async () => {
	const source = await readFile(
		new URL("../src/server.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /location: "\/app\?gmail=connected"/);
});

test("dashboard replaces the demo banner with a compact orange header badge", async () => {
	const source = await readFile(
		new URL("../public/app.html", import.meta.url),
		"utf8",
	);
	const styles = await readFile(
		new URL("../public/app.css", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /id="demoBanner"|class="demo-banner"/);
	assert.match(source, /id="demoModeBadge"[^>]*>Modo demo</);
	assert.ok(
		source.indexOf('id="demoModeBadge"') <
			source.indexOf('class="product-brand"'),
	);
	assert.match(styles, /\.demo-mode-badge\s*\{[^}]*background: #ea580c/s);
});

test("dashboard header reuses view and account contracts", async () => {
	const source = await readFile(
		new URL("../public/app.html", import.meta.url),
		"utf8",
	);
	assert.match(source, /class="app-header"/);
	assert.equal(source.match(/id="dashboardViewButton"/g)?.length, 1);
	assert.equal(source.match(/id="tableViewButton"/g)?.length, 1);
	assert.equal(source.match(/id="profile"/g)?.length, 1);
	assert.match(source, /id="demoModeBadge"/);
});

test("dashboard P0 information architecture starts inside one compact period header", async () => {
	const source = await readFile(
		new URL("../public/app.html", import.meta.url),
		"utf8",
	);
	const account = source.slice(
		source.indexOf('class="app-account"'),
		source.indexOf("</header>"),
	);
	const panel = source.slice(
		source.indexOf('class="panel product-panel"'),
		source.indexOf('id="dashboard"'),
	);

	assert.doesNotMatch(source, /<section class="hero"/);
	assert.match(panel, /class="panel-header period-action-header"/);
	assert.match(panel, /id="heroTitle"[\s\S]*id="heroSubtitle"/);
	assert.match(panel, /id="monthSelect"[\s\S]*id="reopenFinancialCycle"/);
	assert.doesNotMatch(account, /id="reopenFinancialCycle"/);
	assert.doesNotMatch(panel, /<h2>\s*Gastos\s*<\/h2>/);
	assert.match(source, /id="tableViewButton"[^>]*>\s*Movimientos\s*<\/button>/);
	for (const id of [
		"heroTitle",
		"heroSubtitle",
		"monthSelect",
		"syncGmailButton",
		"newExpenseButton",
		"refreshButton",
		"reopenFinancialCycle",
	]) {
		assert.equal(source.match(new RegExp(`id="${id}"`, "g"))?.length, 1);
	}
});

test("dashboard P0 lead prioritizes money and action before descriptive analysis via existing Gmail contracts", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	const lead = source.slice(
		source.indexOf("function renderDashboardLead("),
		source.indexOf("function dashboardRemainingSummary("),
	);
	const dashboard = source.slice(
		source.indexOf("function renderDashboard("),
		source.indexOf("function renderDashboardLead("),
	);
	const emptyPeriod = source.slice(
		source.indexOf("function renderEmptyPeriod("),
		source.indexOf("function renderViewToggle("),
	);

	assert.match(
		lead,
		/primary\.append\([\s\S]*side\.append\([\s\S]*renderNextBestAction\(/,
	);
	assert.doesNotMatch(lead, /top-category|context\.topCategory/);
	assert.ok(dashboard.indexOf("lead,") < dashboard.indexOf("monthStory,"));
	assert.match(emptyPeriod, /syncGmailButton\.hidden/);
	assert.match(emptyPeriod, /openGmailConsentModal/);
	assert.match(emptyPeriod, /syncGmail/);
	assert.match(emptyPeriod, /openNewExpenseModal/);
	assert.match(emptyPeriod, /primaryActionLabel/);
	assert.match(emptyPeriod, /secondaryActionLabel/);
	assert.ok(source.includes("event?.preventDefault()"));
	assert.ok(source.includes('window.location.assign("/auth/google")'));
});

test("dashboard P0 IA layout keeps the compact lead readable in source order", async () => {
	const styles = await readFile(
		new URL("../public/app.css", import.meta.url),
		"utf8",
	);

	assert.match(
		styles,
		/\.period-action-header\s*\{[^}]*grid-template-columns:[^}]*margin-bottom:/s,
	);
	assert.match(
		styles,
		/\.period-action-header h1\s*\{[^}]*font-size:[^}]*margin:\s*0/s,
	);
	assert.match(
		styles,
		/\.dashboard-lead\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.4fr\)\s+minmax\(280px,\s*0\.6fr\)/s,
	);
	assert.match(
		styles,
		/@media\s*\(max-width:\s*1120px\)[\s\S]*?\.dashboard-lead\s*\{[^}]*grid-template-columns:\s*1fr/s,
	);
	assert.match(styles, /\.empty-actions\s*\{[^}]*display:\s*flex/s);
});

test("demo identity uses a generic accessible multicolor D avatar", async () => {
	const [script, styles] = await Promise.all([
		readFile(new URL("../public/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/app.css", import.meta.url), "utf8"),
	]);
	assert.match(script, /email: "demo@demo\.cl"/);
	assert.match(script, /avatar\.textContent = "D"/);
	assert.match(styles, /\.profile-photo-demo\s*\{[^}]*conic-gradient/s);
});

test("demo mutations use one reusable sign-in modal", async () => {
	const [html, script] = await Promise.all([
		readFile(new URL("../public/app.html", import.meta.url), "utf8"),
		readFile(new URL("../public/app.js", import.meta.url), "utf8"),
	]);
	assert.equal(html.match(/id="demoAuthModal"/g)?.length, 1);
	assert.match(html, /aria-labelledby="demoAuthTitle"/);
	assert.match(html, /href="\/auth\/google">Continuar con Google/);
	assert.match(
		script,
		/function guardDemoMutation\(\)[\s\S]*?demoAuthModal\.showModal\(\)/,
	);
});

test("demo keeps authenticated affordances visible", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /newExpenseButton\.hidden = true/);
	assert.doesNotMatch(source, /querySelector\("\.setup-panel"\)\.hidden = true/);
	assert.doesNotMatch(source, /section\.hidden = DEMO_MODE/);
	assert.doesNotMatch(source, /selectCell\.hidden = DEMO_MODE/);
	assert.doesNotMatch(source, /modalSave\.hidden = DEMO_MODE/);
});

test("demo mode guards every mutation function and local preference write", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	const guardedFunctions = [
		"saveCategoryFromSettings",
		"deleteCategoryFromSettings",
		"disconnectGmail",
		"syncGmail",
		"createManualExpense",
		"saveViewPreferences",
		"saveBudgetPreferences",
		"useIncomeCandidate",
		"saveCounterpartyCategoryRule",
		"applyBulkCategoryAssignment",
		"patchTransactionCategory",
		"saveFromModal",
		"deleteFromModal",
		"openNewExpenseModal",
		"openSettingsModal",
		"openGmailConsentModal",
	];

	for (const name of guardedFunctions) {
		const bodyStart = source.indexOf(`function ${name}(`);
		assert.notEqual(bodyStart, -1, `${name} must exist`);
		const bodyPrefix = source.slice(bodyStart, bodyStart + 220);
		assert.match(
			bodyPrefix,
			/DEMO_MODE|guardDemoMutation/,
			`${name} must reject demo mutations`,
		);
	}
});

test("anonymous dashboard retains monthly routing and authenticated users mount onboarding", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /if \(!DEMO_MODE\) return false;/);
	assert.match(
		source,
		/if \(state\.financialCycleEnabled && !DEMO_MODE\) \{\s*const wizard = mountFinancialCycleWizard\(/,
	);
	assert.match(
		source,
		/reopenFinancialCycle\.hidden = !state\.financialCycleEnabled && !DEMO_MODE;/,
	);
	assert.match(source, /const session = await loadDashboardSession\(\);/);
	assert.match(source, /fetch\("\/api\/categories"\)/);
	assert.match(source, /fetch\(`\/api\/transactions\?\$\{params\}`\)/);
	assert.match(source, /bindNativeAccountMenu\(/);
});

test("authenticated dashboard mounts onboarding while demo retains its separate path", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	assert.match(
		source,
		/if \(state\.financialCycleEnabled && !DEMO_MODE\) \{\s*const wizard = mountFinancialCycleWizard\(\{[\s\S]*?demo: DEMO_MODE,/,
	);
	assert.match(
		source,
		/if \(!onboardingIncomplete && !state\.financialCycleEnabled && DEMO_MODE\)/,
	);
	assert.match(
		source,
		/reopenFinancialCycle\.hidden = !state\.financialCycleEnabled && !DEMO_MODE;/,
	);
});

test("feature-on dashboard requests selected-period transactions while feature-off keeps month APIs", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	assert.match(
		source,
		/params\.set\("startDate", state\.reviewPeriod\.startDate\)/,
	);
	assert.match(
		source,
		/params\.set\("endDateExclusive", state\.reviewPeriod\.endDateExclusive\)/,
	);
	assert.match(
		source,
		/state\.financialCycleEnabled\s*=\s*Boolean\(session\?\.authenticated\) && !DEMO_MODE/,
	);
	assert.match(
		source,
		/period: state\.financialCycleEnabled \? state\.reviewPeriod : null/,
	);
	assert.match(source, /onSaved: applyFinancialCycleDashboardPeriod/);
});

test("dashboard identity uses the landing session-profile contract while Gmail remains separate", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /fetch\("\/api\/session\/profile"\)/);
	assert.match(source, /renderProfile\(session\.profile\)/);
	assert.match(source, /fetch\("\/api\/gmail\/status"\)/);
	assert.doesNotMatch(source, /fetch\("\/api\/gmail\/profile"\)/);
});

test("dashboard hides identity when the session contract is unavailable instead of substituting Gmail data", async () => {
	const source = await readFile(
		new URL("../public/app.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /actionLabel: "Reintentar sesión"/);
	assert.match(source, /else renderProfile\(null\);/);
	assert.match(source, /async function loadGmailStatus\(options = \{\}\)/);
});

test("detail table keeps controls outside the row scroll viewport and headers sticky", async () => {
	const [script, styles] = await Promise.all([
		readFile(new URL("../public/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/app.css", import.meta.url), "utf8"),
	]);

	assert.match(
		script,
		/controls\.append\(tableSummary, categoryFilters, bulkBar, tableFeedback\)/,
	);
	assert.match(script, /viewport\.append\(table\)/);
	assert.match(script, /transactionsEl\.append\(controls, viewport\)/);
	assert.match(script, /viewport\.setAttribute\("role", "region"\)/);
	assert.match(
		styles,
		/\.detail-table-viewport\s*\{[^}]*max-height:[^}]*overflow: auto/s,
	);
	assert.match(
		styles,
		/\.transactions-table th\s*\{[^}]*position: sticky;[^}]*top: 0;/s,
	);
	assert.match(styles, /--detail-visible-rows:\s*8/);
});

test("incomplete financial-cycle onboarding opens before dashboard data or post-OAuth synchronization", async () => {
	const [script, wizard] = await Promise.all([
		readFile(new URL("../public/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/financial-cycle.js", import.meta.url), "utf8"),
	]);
	assert.match(
		script,
		/const wizard = mountFinancialCycleWizard\([\s\S]*?await wizard\.ready;[\s\S]*?onboardingIncomplete = wizard\.incomplete;/,
	);
	const startup = script.slice(
		script.indexOf("const session = await loadDashboardSession()"),
	);
	assert.match(
		startup,
		/if \(!onboardingIncomplete\) \{\s*state\.dashboardReady = true;\s*await refreshDashboardAfterFinancialCycle\(\);/,
	);
	assert.match(wizard, /const ready = bootstrap\(\);/);
});

test("account menu exposes Gmail identity, configuration, connect, and real disconnect safely", async () => {
	const [html, script] = await Promise.all([
		readFile(new URL("../public/app.html", import.meta.url), "utf8"),
		readFile(new URL("../public/app.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="profile"[\s\S]*?aria-haspopup="menu"/);
	assert.match(html, /id="accountMenu"[^>]*role="menu"/);
	assert.match(html, /id="accountSettingsButton"[^>]*>\s*Configuración\s*</);
	assert.match(html, /id="connectGmail"[^>]*href="\/auth\/google"/);
	assert.match(html, /id="disconnectGmailButton"[^>]*>\s*Desconectar Gmail\s*</);
	assert.match(
		script,
		/accountSettingsButton\.addEventListener\("click", openSettingsModal\)/,
	);
	assert.match(
		script,
		/disconnectGmailButton\.addEventListener\("click", disconnectGmail\)/,
	);
	assert.match(script, /if \(DEMO_MODE\) return;/);
	assert.match(script, /profile\.picture/);
	assert.match(script, /avatar\.textContent = "mail"/);
});

test("account menu keeps its hidden initial state despite its grid layout", async () => {
	const [html, styles] = await Promise.all([
		readFile(new URL("../public/app.html", import.meta.url), "utf8"),
		readFile(new URL("../public/app.css", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="accountMenu"[^>]*class="account-menu"[^>]*hidden/);
	assert.match(styles, /\.account-menu\[hidden\]\s*\{\s*display:\s*none;/s);
});

test("profile trigger isolates its restrained hover and focus treatment from generic buttons", async () => {
	const styles = await readFile(
		new URL("../public/app.css", import.meta.url),
		"utf8",
	);
	assert.match(
		styles,
		/#profile\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--ink\);/s,
	);
	assert.match(
		styles,
		/#profile:hover\s*\{[^}]*background:\s*var\(--accent-soft\);[^}]*color:\s*var\(--ink\);[^}]*transform:\s*none;/s,
	);
	assert.match(
		styles,
		/#profile:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\);[^}]*background:\s*var\(--accent-soft\);/s,
	);
});

test("profile trigger keeps its press state neutral instead of inheriting button scale", async () => {
	const styles = await readFile(
		new URL("../public/app.css", import.meta.url),
		"utf8",
	);
	assert.match(
		styles,
		/#profile:active\s*\{[^}]*background:\s*var\(--surface-pressed\);[^}]*transform:\s*none;/s,
	);
});

test("dashboard removes the visible setup panel while retaining Gmail feedback infrastructure", async () => {
	const [html, script] = await Promise.all([
		readFile(new URL("../public/app.html", import.meta.url), "utf8"),
		readFile(new URL("../public/app.js", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(html, /class="panel setup-panel"/);
	assert.match(html, /id="gmailStatus"[^>]*aria-live="polite"/);
	assert.match(html, /id="gmailSyncProgress"/);
	assert.doesNotMatch(script, /querySelector\("\.setup-panel"\)/);
});
