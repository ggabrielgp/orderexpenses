import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./helpers/isolation.js";
const db = await import("../src/db.js");
const server = await import("../src/server.js");

const period = { startDate: "2026-11-01", endDateExclusive: "2026-12-01" };
const user = { email: "reconcile@example.com" };

test("db: upsertFinancialCycleReconciliation persists actualBalance (including 0) and preserves incomeAmount", async () => {
	await db.initDb();
	await db.upsertFinancialCycleSettings(user.email, {
		selectedPeriod: period,
		incomeAmount: 1_450_000,
	});

	const updated = await db.upsertFinancialCycleReconciliation(user.email, {
		selectedPeriod: period,
		actualBalance: 495_070,
		actualBalanceAt: "2026-11-25T22:20:00.000Z",
	});
	assert.equal(updated.incomeAmount, 1_450_000);
	assert.equal(updated.actualBalance, 495_070);
	assert.equal(updated.actualBalanceAt, "2026-11-25T22:20:00.000Z");

	// Updating income preserves existing reconciliation fields
	const afterIncomeUpdate = await db.upsertFinancialCycleSettings(user.email, {
		selectedPeriod: period,
		incomeAmount: 1_500_000,
	});
	assert.equal(afterIncomeUpdate.incomeAmount, 1_500_000);
	assert.equal(afterIncomeUpdate.actualBalance, 495_070);
	assert.equal(afterIncomeUpdate.actualBalanceAt, "2026-11-25T22:20:00.000Z");

	// Zero CLP is a valid actual balance
	const zeroed = await db.upsertFinancialCycleReconciliation(user.email, {
		selectedPeriod: period,
		actualBalance: 0,
		actualBalanceAt: "2026-11-25T22:30:00.000Z",
	});
	assert.equal(zeroed.actualBalance, 0);
	assert.equal(zeroed.actualBalanceAt, "2026-11-25T22:30:00.000Z");

	// Clearing sets both to null
	const cleared = await db.upsertFinancialCycleReconciliation(user.email, {
		selectedPeriod: period,
		actualBalance: null,
		actualBalanceAt: null,
	});
	assert.equal(cleared.actualBalance, null);
	assert.equal(cleared.actualBalanceAt, null);
});

test("server: PUT /api/financial-cycle/reconciliation validates input and persists balance with server timestamp", async () => {
	const records = new Map();
	const api = server.createFinancialCycleApi({
		isConnected: async () => true,
		read: async (email) => records.get(`${email}:selected`) ?? null,
		readPeriod: async (email, p) => records.get(`${email}:${p.startDate}`) ?? null,
		write: async (email, record) => {
			records.set(`${email}:${record.selectedPeriod.startDate}`, record);
			records.set(`${email}:selected`, record);
			return record;
		},
		reconcile: async (email, record) => {
			const prev = records.get(`${email}:${record.selectedPeriod.startDate}`) ?? {
				selectedPeriod: record.selectedPeriod,
				incomeAmount: 1_450_000,
				completedAt: null,
			};
			const next = {
				...prev,
				actualBalance: record.actualBalance,
				actualBalanceAt: record.actualBalanceAt,
			};
			records.set(`${email}:${record.selectedPeriod.startDate}`, next);
			records.set(`${email}:selected`, next);
			return next;
		},
	});

	// Rejects non-PUT
	const badMethod = await server.dispatchFinancialCycleRequest({
		pathname: "/api/financial-cycle/reconciliation",
		method: "POST",
		user,
		readBody: async () => ({ period, actualBalance: 100 }),
		api,
	});
	assert.equal(badMethod.status, 405);

	// Rejects cross-origin
	const crossOrigin = await server.dispatchFinancialCycleRequest({
		pathname: "/api/financial-cycle/reconciliation",
		method: "PUT",
		user,
		sameOrigin: false,
		readBody: async () => ({ period, actualBalance: 100 }),
		api,
	});
	assert.equal(crossOrigin.status, 403);

	// Rejects invalid amounts (negatives are valid: credit lines can leave the account below zero)
	for (const badBalance of [12.5, -0.5, "495070", NaN, Number.MAX_SAFE_INTEGER + 1]) {
		const res = await server.dispatchFinancialCycleRequest({
			pathname: "/api/financial-cycle/reconciliation",
			method: "PUT",
			user,
			readBody: async () => ({ period, actualBalance: badBalance }),
			api,
		});
		assert.equal(res.status, 400);
		assert.equal(res.body.error.field, "actualBalance");
	}

	// Accepts valid CLP amount (including 0) and assigns ISO timestamp
	const saved = await server.dispatchFinancialCycleRequest({
		pathname: "/api/financial-cycle/reconciliation",
		method: "PUT",
		user,
		readBody: async () => ({ period, actualBalance: 495_070 }),
		api,
	});
	assert.equal(saved.status, 200);
	assert.equal(saved.body.actualBalance, 495_070);
	assert.match(saved.body.actualBalanceAt, /^\d{4}-\d{2}-\d{2}T/);

	const zeroRes = await server.dispatchFinancialCycleRequest({
		pathname: "/api/financial-cycle/reconciliation",
		method: "PUT",
		user,
		readBody: async () => ({ period, actualBalance: 0 }),
		api,
	});
	assert.equal(zeroRes.status, 200);
	assert.equal(zeroRes.body.actualBalance, 0);

	// Accepts a negative balance (account drawn into its credit line)
	const negativeRes = await server.dispatchFinancialCycleRequest({
		pathname: "/api/financial-cycle/reconciliation",
		method: "PUT",
		user,
		readBody: async () => ({ period, actualBalance: -120_000 }),
		api,
	});
	assert.equal(negativeRes.status, 200);
	assert.equal(negativeRes.body.actualBalance, -120_000);
	assert.match(negativeRes.body.actualBalanceAt, /^\d{4}-\d{2}-\d{2}T/);

	// Clears when null
	const cleared = await server.dispatchFinancialCycleRequest({
		pathname: "/api/financial-cycle/reconciliation",
		method: "PUT",
		user,
		readBody: async () => ({ period, actualBalance: null }),
		api,
	});
	assert.equal(cleared.status, 200);
	assert.equal(cleared.body.actualBalance, null);
	assert.equal(cleared.body.actualBalanceAt, null);
});

let vite, cache, recon, card;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "account-recon-"));
	vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	recon = await vite.ssrLoadModule("/src/client/components/analytics/accountReconciliation.ts");
	card = await vite.ssrLoadModule("/src/client/components/analytics/AccountReconciliationChip.tsx");
});

test.after(async () => {
	await vite?.close();
	if (cache) await rm(cache, { recursive: true, force: true });
});

test("analytics: parseClpBalanceInput handles formatted CLP, zero, empty, and rejects invalid", () => {
	assert.equal(recon.parseClpBalanceInput("495.070"), 495_070);
	assert.equal(recon.parseClpBalanceInput("$ 1.200.000"), 1_200_000);
	assert.equal(recon.parseClpBalanceInput("0"), 0);
	assert.equal(recon.parseClpBalanceInput("   "), null);
	assert.equal(recon.parseClpBalanceInput("abc"), undefined);
	assert.equal(recon.parseClpBalanceInput("12,5"), undefined);
});

test("analytics: parseClpBalanceInput accepts negative balances from a credit line", () => {
	assert.equal(recon.parseClpBalanceInput("-500"), -500);
	assert.equal(recon.parseClpBalanceInput("-120.000"), -120_000);
	assert.equal(recon.parseClpBalanceInput("-$120.000"), -120_000);
	assert.equal(recon.parseClpBalanceInput("$-120.000"), -120_000);
	assert.equal(recon.parseClpBalanceInput("−120.000"), -120_000); // typographic minus
	assert.equal(recon.parseClpBalanceInput("-0"), 0);
	assert.equal(recon.parseClpBalanceInput("--500"), undefined);
	assert.equal(recon.parseClpBalanceInput("5-00"), undefined);
	assert.equal(recon.parseClpBalanceInput("-"), undefined);
});

test("analytics: getAccountReconciliation computes gap, surplus, matched, staleness, and pending-amount caveats", () => {
	const now = new Date("2026-11-25T22:40:00.000Z"); // 19:40 America/Santiago
	const base = {
		incomeAmount: 1_450_000,
		totalSpending: 912_430, // theoretical remaining = 537,570
		pendingAmountCount: 0,
		actualBalance: 495_070,
		actualBalanceAt: "2026-11-25T22:20:00.000Z",
		transactions: [],
		now,
	};

	const gap = recon.getAccountReconciliation(base);
	assert.equal(gap.kind, "gap");
	assert.equal(gap.theoreticalRemaining, 537_570);
	assert.equal(gap.difference, 42_500);
	assert.equal(gap.badgeTone, "tight");

	const surplus = recon.getAccountReconciliation({ ...base, actualBalance: 565_000 });
	assert.equal(surplus.kind, "surplus");
	assert.equal(surplus.difference, -27_430);
	assert.equal(surplus.badgeTone, "calm");

	const matched = recon.getAccountReconciliation({ ...base, actualBalance: 537_570 });
	assert.equal(matched.kind, "matched");
	assert.equal(matched.difference, 0);
	assert.equal(matched.badgeTone, "calm");

	const noIncome = recon.getAccountReconciliation({ ...base, incomeAmount: null });
	assert.equal(noIncome.kind, "no-income");
	assert.equal(noIncome.theoreticalRemaining, null);

	const empty = recon.getAccountReconciliation({ ...base, actualBalance: null, actualBalanceAt: null });
	assert.equal(empty.kind, "empty");

	// Stale: 2 recognized expense movements occurred after actualBalanceAt
	const stale = recon.getAccountReconciliation({
		...base,
		actualBalanceAt: "2026-11-23T21:10:00.000Z",
		transactions: [
			{ direction: "outflow", kind: "purchase", amount: 12_000, occurredAt: "2026-11-24T15:00:00.000Z" },
			{ direction: "outflow", kind: "transfer", amount: 8_000, occurredAt: "2026-11-25T12:00:00.000Z" },
			{ direction: "outflow", kind: "purchase", amount: 5_000, occurredAt: "2026-11-22T12:00:00.000Z" }, // before cutoff
			{ direction: "inflow", kind: "income", amount: 50_000, occurredAt: "2026-11-25T14:00:00.000Z" }, // not expense
		],
	});
	assert.equal(stale.movementsAfterCount, 2);
	assert.equal(stale.callout.tone, "warn");
	assert.match(stale.callout.body, /2/);

	// Pending unknown amounts must always surface a warning caveat
	const pending = recon.getAccountReconciliation({ ...base, pendingAmountCount: 2 });
	assert.equal(pending.callout.tone, "warn");
	assert.match(pending.callout.title, /2 movimientos sin monto/i);

	// Short timestamp used by the chip
	assert.equal(gap.shortUpdatedLabel, "hoy 19:20");
	assert.equal(stale.shortUpdatedLabel, "hace 2 días");
	assert.equal(empty.shortUpdatedLabel, null);
	assert.equal(gap.creditLineUsed, null);
});

test("analytics: getAccountReconciliation handles a negative real balance (credit line)", () => {
	const negative = recon.getAccountReconciliation({
		incomeAmount: 1_450_000,
		totalSpending: 912_430, // theoretical remaining = 537,570
		pendingAmountCount: 0,
		actualBalance: -120_000,
		actualBalanceAt: "2026-11-25T22:20:00.000Z",
		transactions: [],
		now: new Date("2026-11-25T22:40:00.000Z"),
	});
	assert.equal(negative.kind, "gap");
	assert.equal(negative.actualBalance, -120_000);
	assert.equal(negative.difference, 657_570);
	assert.equal(negative.creditLineUsed, 120_000);
	assert.equal(recon.formatSignedReconciliationClp(-120_000), "-$120.000");
	assert.equal(recon.formatSignedReconciliationClp(495_070), "$495.070");
});

test("UI: AccountReconciliationChip renders the state chip and a closed panel with equation, caveat and Sí/No confirmation", () => {
	const model = recon.getAccountReconciliation({
		incomeAmount: 1_450_000,
		totalSpending: 912_430,
		pendingAmountCount: 1,
		actualBalance: 495_070,
		actualBalanceAt: "2026-11-25T22:20:00.000Z",
		transactions: [],
		now: new Date("2026-11-25T22:40:00.000Z"),
	});
	const html = renderToStaticMarkup(
		createElement(card.AccountReconciliationChip, {
			model,
			onSave: async () => {},
		}),
	);
	// Chip: one line answers "does it match?"
	assert.match(html, /class="react-recon-chip is-tight"/);
	assert.match(html, /aria-expanded="false"/);
	assert.match(html, /\$42\.500 sin seguimiento/);
	assert.match(html, /hoy 19:20/);
	assert.match(html, /react-recon-chip-dot/); // pending amount caveat dot
	// Panel is rendered but hidden until the chip is opened
	assert.match(html, /role="dialog"[^>]*hidden=""/);
	assert.match(html, /Cuadre con tu cuenta/);
	assert.match(html, /537\.570/);
	assert.match(html, /495\.070/);
	assert.match(html, /1 movimiento sin monto/i);
	assert.match(html, /¿Sigues teniendo/);
	assert.match(html, /Sí, confirmar/);
	assert.match(html, /No, cambió/);
	assert.doesNotMatch(html, /Actualizar saldo/);
});

test("UI: AccountReconciliationChip shows a negative balance and credit-line hint, and a read-only panel without actions", () => {
	const model = recon.getAccountReconciliation({
		incomeAmount: 1_450_000,
		totalSpending: 912_430,
		pendingAmountCount: 0,
		actualBalance: -120_000,
		actualBalanceAt: "2026-11-25T22:20:00.000Z",
		transactions: [],
		now: new Date("2026-11-25T22:40:00.000Z"),
	});
	const html = renderToStaticMarkup(createElement(card.AccountReconciliationChip, { model, readOnly: true }));
	assert.match(html, /-\$120\.000/);
	assert.match(html, /línea de crédito/i);
	assert.match(html, /\$657\.570 sin seguimiento/);
	assert.doesNotMatch(html, /Sí, confirmar/);
	assert.doesNotMatch(html, /Quitar saldo real/);
});

test("UI: AccountReconciliationChip invites to reconcile when there is no real balance yet", () => {
	const model = recon.getAccountReconciliation({
		incomeAmount: 1_450_000,
		totalSpending: 912_430,
		pendingAmountCount: 0,
		actualBalance: null,
		actualBalanceAt: null,
		transactions: [],
	});
	const html = renderToStaticMarkup(createElement(card.AccountReconciliationChip, { model, onSave: async () => {} }));
	assert.match(html, /class="react-recon-chip is-empty"/);
	assert.match(html, /Cuadrar con tu banco/);
	assert.match(html, /¿Cuánto tienes hoy en tu cuenta\?/);
	assert.match(html, /Saldo en negativo/);
	assert.match(html, /Guardar saldo/);
});

test("UI: AccountReconciliationChip summarizes the balance as a compact ledger with a labeled result", () => {
	const model = recon.getAccountReconciliation({
		incomeAmount: 1_450_000,
		totalSpending: 912_430,
		pendingAmountCount: 0,
		actualBalance: -20_000,
		actualBalanceAt: "2026-11-25T22:20:00.000Z",
		transactions: [],
		now: new Date("2026-11-25T22:40:00.000Z"),
	});
	const html = renderToStaticMarkup(createElement(card.AccountReconciliationChip, { model, onSave: async () => {} }));
	const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
	assert.doesNotMatch(html, /react-recon-equation/);
	assert.match(html, /<dl class="react-recon-ledger"/);
	assert.match(text, /Según tus registros \$537\.570/);
	assert.match(text, /En tu cuenta -\$20\.000/);
	assert.match(text, /Dinero sin seguimiento \$557\.570/);
	assert.match(html, /react-recon-ledger-total is-tight/);
});

test("UI: AccountReconciliationChip balance field shows the amount with CLP thousands while typing", async () => {
	const { readFile } = await import("node:fs/promises");
	const source = await readFile(new URL("../src/client/components/analytics/AccountReconciliationChip.tsx", import.meta.url), "utf8");
	assert.match(source, /formatClpAmountInput/);
	const manual = await vite.ssrLoadModule("/src/client/components/movements/manualExpense.ts");
	assert.equal(manual.formatClpAmountInput("20000"), "20.000");
	assert.equal(manual.formatClpAmountInput("1.2345"), "12.345");
	assert.equal(manual.formatClpAmountInput("0"), "0");
	assert.equal(recon.parseClpBalanceInput(manual.formatClpAmountInput("1495070")), 1_495_070);
});
