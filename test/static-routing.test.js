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

test("OAuth success returns users to the dashboard with auto-sync enabled", async () => {
	const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
	assert.match(source, /location: "\/app\?gmail=connected"/);
});

test("dashboard replaces the demo banner with a compact orange header badge", async () => {
	const source = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
	const styles = await readFile(new URL("../public/app.css", import.meta.url), "utf8");
	assert.doesNotMatch(source, /id="demoBanner"|class="demo-banner"/);
	assert.match(source, /id="demoModeBadge"[^>]*>Modo demo</);
	assert.ok(source.indexOf('id="demoModeBadge"') < source.indexOf('class="product-brand"'));
	assert.match(styles, /\.demo-mode-badge\s*\{[^}]*background: #ea580c/s);
});

test("dashboard header reuses view and account contracts", async () => {
	const source = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
	assert.match(source, /class="app-header"/);
	assert.equal(source.match(/id="dashboardViewButton"/g)?.length, 1);
	assert.equal(source.match(/id="tableViewButton"/g)?.length, 1);
	assert.equal(source.match(/id="profile"/g)?.length, 1);
	assert.match(source, /id="demoModeBadge"/);
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
	assert.match(script, /function guardDemoMutation\(\)[\s\S]*?demoAuthModal\.showModal\(\)/);
});

test("demo keeps authenticated affordances visible", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	assert.doesNotMatch(source, /newExpenseButton\.hidden = true/);
	assert.doesNotMatch(source, /querySelector\("\.setup-panel"\)\.hidden = true/);
	assert.doesNotMatch(source, /section\.hidden = DEMO_MODE/);
	assert.doesNotMatch(source, /selectCell\.hidden = DEMO_MODE/);
	assert.doesNotMatch(source, /modalSave\.hidden = DEMO_MODE/);
});

test("demo mode guards every mutation function and local preference write", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
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
		assert.match(bodyPrefix, /DEMO_MODE|guardDemoMutation/, `${name} must reject demo mutations`);
	}
});

test("feature-off dashboard keeps monthly behavior without mounting or fetching financial-cycle APIs", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	assert.match(source, /if \(!DEMO_MODE\) return false;/);
	assert.match(
		source,
		/if \(session\?\.features\?\.financialCycleOnboarding\) \{\s*mountFinancialCycleWizard\(/,
	);
	assert.match(source, /reopenFinancialCycle\.hidden = true;/);
	assert.match(source, /const session = await loadDashboardSession\(\);/);
	assert.match(source, /fetch\("\/api\/categories"\)/);
	assert.match(source, /fetch\(`\/api\/transactions\?\$\{params\}`\)/);
	assert.match(source, /profileEl\.addEventListener\("click", openSettingsModal\)/);
});

test("feature-on dashboard mounts the wizard only after the session advertises it", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	assert.match(
		source,
		/if \(session\?\.features\?\.financialCycleOnboarding\) \{\s*mountFinancialCycleWizard\(\{[\s\S]*?demo: DEMO_MODE,/,
	);
	assert.match(source, /else \{\s*reopenFinancialCycle\.hidden = true;/);
});

test("feature-on dashboard requests selected-period transactions while feature-off keeps month APIs", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	assert.match(source, /params\.set\("startDate", state\.reviewPeriod\.startDate\)/);
	assert.match(source, /params\.set\("endDateExclusive", state\.reviewPeriod\.endDateExclusive\)/);
	assert.match(source, /state\.financialCycleEnabled = Boolean\(session\?\.features\?\.financialCycleOnboarding\)/);
	assert.match(source, /period: state\.financialCycleEnabled \? state\.reviewPeriod : null/);
	assert.match(source, /onCompleted: applyFinancialCycleDashboardPeriod/);
});

test("dashboard identity uses the landing session-profile contract while Gmail remains separate", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	assert.match(source, /fetch\("\/api\/session\/profile"\)/);
	assert.match(source, /renderProfile\(session\.profile\)/);
	assert.match(source, /fetch\("\/api\/gmail\/status"\)/);
	assert.doesNotMatch(source, /fetch\("\/api\/gmail\/profile"\)/);
});

test("dashboard hides identity when the session contract is unavailable instead of substituting Gmail data", async () => {
	const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
	assert.match(source, /return response\.ok \? await response\.json\(\) : null;/);
	assert.match(source, /else renderProfile\(null\);/);
	assert.match(source, /async function loadGmailStatus\(options = \{\}\)/);
});

test("detail table keeps controls outside the row scroll viewport and headers sticky", async () => {
	const [script, styles] = await Promise.all([
		readFile(new URL("../public/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/app.css", import.meta.url), "utf8"),
	]);

	assert.match(script, /controls\.append\(tableSummary, categoryFilters, bulkBar, tableFeedback\)/);
	assert.match(script, /viewport\.append\(table\)/);
	assert.match(script, /transactionsEl\.append\(controls, viewport\)/);
	assert.match(script, /viewport\.setAttribute\("role", "region"\)/);
	assert.match(styles, /\.detail-table-viewport\s*\{[^}]*max-height:[^}]*overflow: auto/s);
	assert.match(styles, /\.transactions-table th\s*\{[^}]*position: sticky;[^}]*top: 0;/s);
	assert.match(styles, /--detail-visible-rows:\s*8/);
});
