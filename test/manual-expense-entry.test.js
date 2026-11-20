import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const withModules = async (run) => {
	const vite = await createServer({
		configFile: false,
		envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false },
	});
	try {
		await run(vite);
	} finally {
		await vite.close();
	}
};

const loadHelpers = (vite) => vite.ssrLoadModule("/src/client/components/movements/manualExpense.ts");
const period = { startDate: "2026-03-01", endDateExclusive: "2026-04-01" };

test("formatClpAmountInput groups digits with es-CL thousands dots", async () => {
	await withModules(async (vite) => {
		const { formatClpAmountInput } = await loadHelpers(vite);
		for (const [raw, expected] of [
			["12500", "12.500"],
			["0012500", "12.500"],
			["$1.450.000", "1.450.000"],
			["1 234", "1.234"],
			["999", "999"],
			["0", "0"],
			["000", "0"],
			["", ""],
			["abc", ""],
			["-5", "5"],
		]) {
			assert.equal(formatClpAmountInput(raw), expected, JSON.stringify(raw));
		}
	});
});

test("formatClpAmountInput output is parsed back by parseClpAmount", async () => {
	await withModules(async (vite) => {
		const { formatClpAmountInput, parseClpAmount } = await loadHelpers(vite);
		for (const raw of ["12500", "7", "1450000", "0012500", "$ 99.999"]) {
			const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
			assert.equal(parseClpAmount(formatClpAmountInput(raw)), Number(digits), raw);
		}
		assert.equal(parseClpAmount(formatClpAmountInput("")), null);
	});
});

test("manual expense validation still reads formatted amounts", async () => {
	await withModules(async (vite) => {
		const { createManualExpensePayload } = await loadHelpers(vite);
		const payload = createManualExpensePayload(
			{ occurredAt: "2026-03-10T09:30", amount: "12.500", kind: "purchase", counterparty: "", category: "", description: "" },
			period,
			[],
		);
		assert.equal(payload.amount, 12500);
		assert.equal(payload.direction, "outflow");
		assert.throws(
			() => createManualExpensePayload({ occurredAt: "2026-03-10T09:30", amount: "0", kind: "purchase", counterparty: "", category: "", description: "" }, period, []),
			TypeError,
		);
	});
});

test("createManualExpenseDraft defaults the date to now inside the period, minute precision", async () => {
	await withModules(async (vite) => {
		const { createManualExpenseDraft } = await loadHelpers(vite);
		const inside = createManualExpenseDraft(period, new Date(2026, 2, 15, 18, 7, 42));
		assert.equal(inside.occurredAt, "2026-03-15T18:07");
		assert.equal(inside.amount, "");
		assert.equal(inside.kind, "purchase");
		// Outside the period the previous behavior stays: the first day of the period at noon.
		const before = createManualExpenseDraft(period, new Date(2026, 1, 20, 18, 7));
		assert.equal(before.occurredAt, "2026-03-01T12:00");
		const after = createManualExpenseDraft(period, new Date(2026, 3, 1, 0, 5));
		assert.equal(after.occurredAt, "2026-03-01T12:00");
	});
});

test("create dialog puts the large numeric amount first and drops internal jargon", async () => {
	await withModules(async (vite) => {
		const { CreateManualExpenseDialog } = await vite.ssrLoadModule(
			"/src/client/components/movements/CreateManualExpenseDialog.tsx",
		);
		const html = renderToStaticMarkup(
			createElement(CreateManualExpenseDialog, {
				isOpen: true,
				period,
				onClose: () => {},
				submitExpense: async () => ({ reloadFailed: false }),
				onSaved: () => {},
			}),
		);
		const amountAt = html.indexOf('id="manual-expense-amount"');
		const dateAt = html.indexOf('id="manual-expense-occurred-at"');
		assert.ok(amountAt > -1 && dateAt > -1);
		assert.ok(amountAt < dateAt, "amount input precedes the date input");
		const amountTag = html.slice(html.lastIndexOf("<input", amountAt), html.indexOf(">", amountAt) + 1);
		assert.match(amountTag, /inputMode="numeric"|inputmode="numeric"/i);
		assert.match(amountTag, /autoComplete="off"|autocomplete="off"/i);
		assert.match(html, /react-create-expense-amount/);
		assert.doesNotMatch(html, /Catálogo de solo lectura/);
		// Every field, label and action remains.
		for (const copy of ["Monto CLP", "Fecha y hora", "Tipo", "Categoría", "Comercio o persona", "Descripción", "Cancelar", "Guardar gasto", "Nuevo gasto"]) {
			assert.ok(html.includes(copy) || html.includes(copy.replace("á", "&#xE1;")), copy);
		}
		for (const id of ["manual-expense-kind", "manual-expense-category", "manual-expense-counterparty", "manual-expense-description"]) {
			assert.ok(html.includes(`id="${id}"`), id);
		}
	});
});
