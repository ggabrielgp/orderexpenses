import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// S20 (odd/tasks/identidad-b.md, T22): the cycle setup asks one question with three options, each
// revealing only what it needs, plus a separate income field and a summary footer. Validation, saved
// data and API calls are unchanged (S10).
const vite = await createServer({
	configFile: false,
	envFile: false,
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());

const options = await vite.ssrLoadModule("/src/client/components/financial-cycle/cycleOptions.ts");
const presets = await vite.ssrLoadModule("/src/client/components/financial-cycle/cyclePresets.ts");
const view = await vite.ssrLoadModule("/src/client/components/financial-cycle/CyclePresetsControl.tsx");
const summaryView = await vite.ssrLoadModule("/src/client/components/financial-cycle/CyclePeriodSummary.tsx");
const editDialog = await vite.ssrLoadModule("/src/client/components/financial-cycle/FinancialCycleEditDialog.tsx");
const page = await vite.ssrLoadModule("/src/client/pages/DashboardPage.tsx");
const settings = await vite.ssrLoadModule("/src/client/components/financial-cycle/cycleSettings.ts");
const pace = await vite.ssrLoadModule("/src/client/components/analytics/dashboardPace.ts");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const day = (year, month, dayOfMonth) => ({ year, month, day: dayOfMonth });
const NOV_20 = day(2026, 11, 20);

test("the pay day quick choices are 1, 5, 15, 25 and the last day (31 clamps to the month end)", () => {
	assert.deepEqual([...options.PAY_DAY_QUICK_CHOICES], [1, 5, 15, 25, 31]);
	assert.equal(options.DEFAULT_PAY_DAY, 25);
	assert.equal(options.payDayLabel(31), "Último día");
	assert.equal(options.payDayLabel(5), "5");
	assert.equal(options.payDayLabel(options.LAST_BUSINESS_DAY), "Último día hábil");
});

test("Último día hábil resolves to the last-business-day cycle and an existing such range preselects it", () => {
	const typed = { startDate: "", endDate: "" };
	assert.deepEqual(options.resolveCycleOption("payDay", NOV_20, options.LAST_BUSINESS_DAY, typed), presets.lastBusinessDayCycle(NOV_20));
	// Dec 2026: started Mon Nov 30, ends Wed Dec 30; no fixed pay day produces it, the last business day does.
	const dec = day(2026, 12, 10);
	assert.deepEqual(options.inferCycleOption({ startDate: "2026-11-30", endDate: "2026-12-30" }, dec), { option: "payDay", payDay: options.LAST_BUSINESS_DAY });
	// A fixed pay day that produces the range keeps winning, as before.
	assert.deepEqual(options.inferCycleOption({ startDate: "2026-11-25", endDate: "2026-12-24" }, dec), { option: "payDay", payDay: 25 });
});

test("choosing an option resolves the range: calendar month, pay day cycle, or the range already typed", () => {
	const typed = { startDate: "2026-11-03", endDate: "2026-11-18" };
	assert.deepEqual(options.resolveCycleOption("calendar", NOV_20, 25, typed), { startDate: "2026-11-01", endDate: "2026-11-30" });
	assert.deepEqual(options.resolveCycleOption("payDay", NOV_20, 25, typed), { startDate: "2026-10-25", endDate: "2026-11-24" });
	assert.deepEqual(options.resolveCycleOption("payDay", NOV_20, 5, typed), { startDate: "2026-11-05", endDate: "2026-12-04" });
	// Last day of month: the pay day clamps to each month's end (February 2026 has 28 days).
	assert.deepEqual(options.resolveCycleOption("payDay", day(2026, 2, 28), 31, typed), { startDate: "2026-02-28", endDate: "2026-03-30" });
	assert.deepEqual(options.resolveCycleOption("custom", NOV_20, 25, typed), typed);
});

test("the options match the preset rules exactly (same range as payDayCycle / calendarMonthCycle)", () => {
	for (const payDay of options.PAY_DAY_QUICK_CHOICES) {
		assert.deepEqual(options.resolveCycleOption("payDay", NOV_20, payDay, { startDate: "", endDate: "" }), presets.payDayCycle(NOV_20, payDay));
	}
	assert.deepEqual(options.resolveCycleOption("calendar", NOV_20, 25, { startDate: "", endDate: "" }), presets.calendarMonthCycle(NOV_20));
});

test("an existing range preselects the option that produces it, otherwise Otro rango", () => {
	assert.deepEqual(options.inferCycleOption({ startDate: "2026-11-01", endDate: "2026-11-30" }, NOV_20), { option: "calendar", payDay: 25 });
	assert.deepEqual(options.inferCycleOption({ startDate: "2026-10-25", endDate: "2026-11-24" }, NOV_20), { option: "payDay", payDay: 25 });
	assert.deepEqual(options.inferCycleOption({ startDate: "2026-11-05", endDate: "2026-12-04" }, NOV_20), { option: "payDay", payDay: 5 });
	assert.deepEqual(options.inferCycleOption({ startDate: "2026-02-01", endDate: "2026-02-28" }, NOV_20), { option: "custom", payDay: 25 });
	assert.deepEqual(options.inferCycleOption({ startDate: "", endDate: "" }, NOV_20), { option: "custom", payDay: 25 });
});

test("the result line reads like a sentence: 1 al 30 de noviembre, 25 oct al 24 nov, with the year when it crosses one", () => {
	assert.equal(options.formatCycleResult({ startDate: "2026-11-01", endDate: "2026-11-30" }), "1 al 30 de noviembre");
	assert.equal(options.formatCycleResult({ startDate: "2026-10-25", endDate: "2026-11-24" }), "25 oct al 24 nov");
	assert.equal(options.formatCycleResult({ startDate: "2026-12-25", endDate: "2027-01-24" }), "25 dic 2026 al 24 ene 2027");
});

test("the summary describes the chosen period with its day count, or what is still missing", () => {
	const describe = (startDate, endDate, awaitingEnd = false) => options.describeCyclePeriod({ startDate, endDate, awaitingEnd });
	assert.deepEqual(describe("2026-11-01", "2026-11-30"), { tone: "ok", text: "1–30 nov · 30 días" });
	assert.deepEqual(describe("2026-10-25", "2026-11-24"), { tone: "ok", text: "25 oct–24 nov · 31 días" });
	assert.deepEqual(describe("2026-12-25", "2027-01-24"), { tone: "ok", text: "25 dic 2026–24 ene 2027 · 31 días" });
	assert.deepEqual(describe("2026-11-05", "2026-11-05"), { tone: "ok", text: "5 nov · 1 día" });
	assert.deepEqual(describe("2026-11-20", "2026-11-10"), { tone: "invalid", text: "Revisa las fechas" });
	assert.deepEqual(describe("2026-11-03", "", true), { tone: "pending", text: "Elige el término" });
	assert.deepEqual(describe("", ""), { tone: "pending", text: "Elige las fechas" });
});

const renderOptions = (props) =>
	renderToStaticMarkup(
		createElement(view.CyclePresets, {
			option: "calendar",
			payDay: 25,
			range: { startDate: "2026-11-01", endDate: "2026-11-30" },
			onOptionChange() {},
			onPayDayChange() {},
			...props,
		}),
	);

test("the options are one labelled radiogroup with three native radios and exactly one checked", () => {
	const html = renderOptions({});
	assert.match(html, /role="radiogroup"/);
	assert.ok(html.includes('aria-label="¿Cuándo empieza tu período?"'));
	assert.equal((html.match(/<input type="radio" name="[^"]*"(?: checked="")? value="(?:calendar|payDay|custom)"/g) ?? []).length, 3);
	for (const text of ["Mes calendario", "Del 1 al último día", "Desde mi día de pago", "Otro rango"]) assert.ok(html.includes(text), text);
	assert.equal((html.match(/ checked="" value="(?:calendar|payDay|custom)"/g) ?? []).length, 1);
});

test("Mes calendario reveals only the computed result line", () => {
	const html = renderOptions({ option: "calendar", customPane: createElement("div", { id: "custom-pane" }) });
	assert.ok(html.includes("Tu período:"));
	assert.match(html, /Tu período: <b>1 al 30 de noviembre<\/b>/);
	assert.doesNotMatch(html, /<select/);
	assert.doesNotMatch(html, /¿Qué día te pagan\?/);
	assert.doesNotMatch(html, /custom-pane/);
});

test("Desde mi día de pago reveals the pay day question, the quick choices, Otro día (1–31) and the resulting range", () => {
	const html = renderOptions({ option: "payDay", payDay: 25, range: { startDate: "2026-10-25", endDate: "2026-11-24" }, customPane: createElement("div", { id: "custom-pane" }) });
	assert.ok(html.includes("¿Qué día te pagan?"));
	for (const label of ["1", "5", "15", "25", "Último día"]) assert.match(html, new RegExp(`<span>${label}</span>`), label);
	assert.match(html, /<span>Último día hábil<\/span>/);
	assert.equal((html.match(/<input type="radio" name="[^"]*-pay-day"(?: checked="")? value="\d+"/g) ?? []).length, 6);
	assert.match(html, /-pay-day" checked="" value="25"/);
	assert.match(html, /<select[^>]*id="financial-cycle-pay-day"/);
	assert.ok(html.includes(">Otro día</option>"));
	assert.equal((html.match(/<option value="\d+">Día \d+<\/option>/g) ?? []).length, 31);
	assert.match(html, /Tu período: <b>25 oct al 24 nov<\/b>/);
	assert.doesNotMatch(html, /custom-pane/);
	// 25 is a quick choice, so "Otro día" stays the unselected placeholder; a custom day selects it.
	assert.match(html, /<option value="" selected="">Otro día<\/option>/);
	const other = renderOptions({ option: "payDay", payDay: 10, range: { startDate: "2026-11-10", endDate: "2026-12-09" } });
	assert.match(other, /<option value="10" selected="">Día 10<\/option>/);
	assert.doesNotMatch(other, /-pay-day" checked=""/);
	// Short-month rule is explained only for the days that can clamp.
	assert.doesNotMatch(html, /meses más cortos/);
	assert.ok(renderOptions({ option: "payDay", payDay: 31, range: { startDate: "2026-10-31", endDate: "2026-11-29" } }).includes("Último día de cada mes; en meses más cortos, su último día."));
	// Último día hábil: its chip is checked, "Otro día" stays a placeholder and the weekend rule is explained.
	const business = renderOptions({ option: "payDay", payDay: options.LAST_BUSINESS_DAY, range: { startDate: "2026-10-30", endDate: "2026-11-29" } });
	assert.match(business, /-pay-day" checked="" value="0"/);
	assert.match(business, /<option value="" selected="">Otro día<\/option>/);
	assert.ok(business.includes("Último día de lunes a viernes de cada mes; si el mes termina en fin de semana, usamos el viernes anterior."));
	assert.match(business, /Tu período: <b>30 oct al 29 nov<\/b>/);
});

test("Otro rango reveals the calendar and date inputs it is given, and nothing else", () => {
	const html = renderOptions({ option: "custom", customPane: createElement("div", { id: "custom-pane" }, "calendario") });
	assert.ok(html.includes('id="custom-pane"'));
	assert.doesNotMatch(html, /Tu período:/);
	assert.doesNotMatch(html, /<select/);
	assert.doesNotMatch(html, /¿Qué día te pagan\?/);
});

test("a saving form disables every option control", () => {
	const html = renderOptions({ option: "payDay", disabled: true, range: { startDate: "2026-10-25", endDate: "2026-11-24" } });
	const inputs = html.match(/<(input|select)\b[^>]*>/g) ?? [];
	assert.ok(inputs.length >= 9);
	for (const control of inputs) assert.match(control, /disabled=""/, control);
});

test("the footer summary announces the chosen period and flags an invalid or pending one", () => {
	const render = (props) => renderToStaticMarkup(createElement(summaryView.CyclePeriodSummary, props));
	const ok = render({ startDate: "2026-11-01", endDate: "2026-11-30" });
	assert.ok(ok.includes("Período elegido"));
	assert.match(ok, /role="status"/);
	assert.ok(ok.includes("1–30 nov · 30 días"));
	assert.match(ok, /data-tone="ok"/);
	const bad = render({ startDate: "2026-11-20", endDate: "2026-11-10" });
	assert.ok(bad.includes("Revisa las fechas"));
	assert.match(bad, /data-tone="invalid"/);
	assert.match(render({ startDate: "2026-11-03", endDate: "", awaitingEnd: true }), /Elige el término/);
});

test("each option saves the same PUT body as before for the same dates and income", () => {
	const today = day(2026, 11, 20);
	const cases = [
		["calendar", 25, { startDate: "2026-11-01", endDateExclusive: "2026-12-01" }],
		["payDay", 25, { startDate: "2026-10-25", endDateExclusive: "2026-11-25" }],
		["payDay", 31, { startDate: "2026-10-31", endDateExclusive: "2026-11-30" }],
	];
	for (const [option, payDay, selectedPeriod] of cases) {
		const range = options.resolveCycleOption(option, today, payDay, { startDate: "", endDate: "" });
		assert.deepEqual(page.createFinancialCycleSetupPayload(range.startDate, range.endDate, "900.000"), { selectedPeriod, incomeAmount: 900000 }, option);
		assert.deepEqual(page.createFinancialCycleSetupPayload(range.startDate, range.endDate, ""), { selectedPeriod, incomeAmount: null }, option);
		const draft = { startDate: range.startDate, endDate: range.endDate, incomeValue: "900.000" };
		assert.deepEqual(settings.validateCycleEditDraft(draft), { ok: true, payload: { selectedPeriod, incomeAmount: 900000 } }, option);
	}
	// Other range: the typed dates are sent untouched.
	assert.deepEqual(page.createFinancialCycleSetupPayload("2026-11-03", "2026-11-18", "1.200.000"), {
		selectedPeriod: { startDate: "2026-11-03", endDateExclusive: "2026-11-19" },
		incomeAmount: 1200000,
	});
});

const todaySantiago = pace.todayInSantiago(new Date());
const iso = (year, month, dayOfMonth) => `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
const toCycle = (range) => {
	const end = new Date(Date.UTC(Number(range.endDate.slice(0, 4)), Number(range.endDate.slice(5, 7)) - 1, Number(range.endDate.slice(8, 10)) + 1));
	return {
		selectedPeriod: { startDate: range.startDate, endDateExclusive: iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()) },
		incomeAmount: 900000,
		completedAt: null,
	};
};
const renderEdit = (cycle) =>
	renderToStaticMarkup(createElement(editDialog.FinancialCycleEditDialog, { isOpen: true, cycle, onClose() {}, submitCycle: async () => ({ status: "saved", reloadFailed: false }), onSaved() {} }));

test("the edit-period dialog has the same structure: options, income and a summary footer, keeping its own title and actions", () => {
	const month = renderEdit(toCycle(presets.calendarMonthCycle(todaySantiago)));
	assert.ok(month.includes("Cambiar período"));
	assert.ok(month.includes("¿Cuándo empieza tu período?"));
	assert.match(month, /role="radiogroup"/);
	assert.match(month, /Tu período: <b>/);
	// A calendar month needs nothing to fill: no date inputs and no calendar are rendered.
	assert.equal((month.match(/type="date"/g) ?? []).length, 0);
	assert.doesNotMatch(month, /react-cycle-calendar"/);
	assert.match(month, /id="financial-cycle-income"[^>]*value="900\.000"|value="900\.000"[^>]*id="financial-cycle-income"/);
	assert.ok(month.includes("¿Cuánto ganas al mes?"));
	assert.ok(month.includes("(opcional)"));
	assert.ok(month.includes("Lo usamos para tu medidor. Puedes agregarlo después."));
	assert.ok(month.includes("Período elegido"));
	assert.match(month, /Guardar cambios<\/button>/);
	assert.match(month, /Cancelar<\/button>/);

	const payDay = renderEdit(toCycle(presets.payDayCycle(todaySantiago, 5)));
	assert.ok(payDay.includes("¿Qué día te pagan?"));
	assert.equal((payDay.match(/type="date"/g) ?? []).length, 0);

	// A historical range cannot be produced by the shortcuts: Otro rango opens with the calendar and both inputs.
	const custom = renderEdit({ selectedPeriod: { startDate: "2026-02-01", endDateExclusive: "2026-03-01" }, incomeAmount: null, completedAt: null });
	assert.equal((custom.match(/type="date"/g) ?? []).length, 2);
	assert.match(custom, /id="financial-cycle-start-date"/);
	assert.match(custom, /id="financial-cycle-end-date"/);
	assert.match(custom, /class="react-cycle-calendar"/);
	assert.match(custom, /Desde el 1 de febrero de 2026 hasta el 28 de febrero de 2026\./);
});

test("the setup form keeps its handlers: the same ids, the same validation, dismissal and the single income field", async () => {
	const source = await read("src/client/components/financial-cycle/FinancialCycleSetupForm.tsx");
	const form = source.slice(source.indexOf("function FinancialCycleSetupForm"));
	for (const id of ["financial-cycle-start-date", "financial-cycle-end-date", "financial-cycle-income", "financial-cycle-income-help"]) {
		assert.equal((form.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, id);
	}
	assert.ok(form.includes("¿Cuándo empieza tu período?"));
	assert.ok(form.includes("Paso 2 de 3 · Tu período"));
	assert.ok(form.includes("¿Cuánto ganas al mes?"));
	assert.ok(form.includes("Lo usamos para tu medidor. Puedes agregarlo después."));
	assert.ok(form.includes("Guardar y ver mi medidor"));
	assert.match(form, /<CyclePeriodSummary/);
	assert.match(form, /validateCalendarRange\(startDate, endDate\)/);
	assert.match(form, /createFinancialCycleSetupPayload\(startDate, endDate, incomeValue\)/);
	assert.match(form, /await updateFinancialCycle\(cycle\)/);
	assert.match(form, /requestFinancialSetupDismiss\(saveLock, isSaving/);
	// The default selection is the calendar month, so the form is valid without extra input.
	assert.match(form, /useState<CycleOptionChoice>\("calendar"\)/);
	// The two date inputs only live inside the Otro rango reveal.
	assert.ok(form.indexOf("customPane=") < form.indexOf('id="financial-cycle-start-date"'));
	assert.ok(form.indexOf('id="financial-cycle-income"') > form.indexOf("customPane="));
});
