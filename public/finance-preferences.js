export const FINANCE_PREFERENCE_KEYS = Object.freeze({
	budget: "financeMonthlyBudget",
	view: "financeViewPreferences",
});

const PAY_TIMINGS = new Set([
	"first_week",
	"mid_month",
	"last_week",
	"varies",
]);
const ENTRY_FIELDS = [
	"salary",
	"actualRemaining",
	"autoDetectIncome",
	"payTiming",
	"confirmedIncomeId",
];

export function createDefaultFinancePreferences() {
	return {
		salary: "",
		actualRemaining: "",
		autoDetectIncome: false,
		payTiming: "varies",
		confirmedIncomeId: "",
	};
}

export function parseFinancePreferences(raw, { currentMonth } = {}) {
	if (raw === null || raw === undefined || raw === "") {
		return createSession("empty", emptyModel(), currentMonth);
	}
	let value;
	try {
		value = JSON.parse(raw);
	} catch {
		return createSession("invalid", emptyModel(), currentMonth, "json");
	}
	if (!isPlainObject(value)) {
		return createSession("invalid", emptyModel(), currentMonth, "shape");
	}
	if (Object.hasOwn(value, "version") || Object.hasOwn(value, "months")) {
		if (value.version !== 2) {
			return createSession("unsupported", emptyModel(), currentMonth, "version");
		}
		const model = canonicalV2(value);
		return model
			? createSession("v2", model, currentMonth)
			: createSession("invalid", emptyModel(), currentMonth, "months");
	}
	const legacyPreferences = canonicalEntry(value);
	if (!legacyPreferences || !ENTRY_FIELDS.some((field) => Object.hasOwn(value, field))) {
		return createSession("invalid", emptyModel(), currentMonth, "legacy");
	}
	return createSession(
		"legacy",
		emptyModel(),
		currentMonth,
		null,
		legacyPreferences,
	);
}

export function readFinancePreferences(session, { month } = {}) {
	let preferences = null;
	if (session.kind === "legacy" && month === session.currentMonth) {
		preferences = session.legacyPreferences;
	} else if (isValidMonth(month)) {
		preferences = session.model.months[month] || null;
	}
	return {
		preferences: preferences
			? { ...createDefaultFinancePreferences(), ...preferences }
			: createDefaultFinancePreferences(),
		model: session.model,
		notice: ["invalid", "unsupported"].includes(session.kind)
			? "recovery"
			: null,
	};
}

export function updateFinancePreferences(
	session,
	{ month, preferences } = {},
) {
	if (!isValidMonth(month)) throw new TypeError("Invalid finance month");
	const entry = canonicalEntry(preferences);
	if (!entry) throw new TypeError("Invalid finance preferences");
	const model = {
		version: 2,
		months: {
			...session.model.months,
			[month]: entry,
		},
	};
	const nextSession = createSession("v2", model, session.currentMonth);
	return {
		session: nextSession,
		preferences: { ...entry },
		serialized: JSON.stringify(model),
		operation: "write",
		recovery: session.kind !== "v2" && session.kind !== "empty",
	};
}

export function resetFinancePreferenceMonth(session, { month } = {}) {
	if (!isValidMonth(month)) throw new TypeError("Invalid finance month");
	if (session.kind !== "v2") return emptyReset(session.currentMonth);
	const months = { ...session.model.months };
	delete months[month];
	const model = { version: 2, months };
	const nextSession = createSession("v2", model, session.currentMonth);
	if (Object.keys(months).length === 0) return emptyReset(session.currentMonth);
	return {
		session: nextSession,
		preferences: createDefaultFinancePreferences(),
		serialized: JSON.stringify(model),
		operation: "write",
	};
}

export function resetAllFinancePreferences() {
	return {
		budgetOperation: "remove",
		viewOperation: "remove",
		budgetKey: FINANCE_PREFERENCE_KEYS.budget,
		viewKey: FINANCE_PREFERENCE_KEYS.view,
		budgetSession: createSession("empty", emptyModel(), null),
		viewPreferences: { budgetEnabled: false },
	};
}

function canonicalV2(value) {
	if (!isPlainObject(value.months)) return null;
	const months = {};
	for (const [month, entry] of Object.entries(value.months)) {
		if (!isValidMonth(month)) return null;
		const canonical = canonicalEntry(entry);
		if (!canonical) return null;
		months[month] = canonical;
	}
	return { version: 2, months };
}

function canonicalEntry(value) {
	if (!isPlainObject(value)) return null;
	const defaults = createDefaultFinancePreferences();
	if (!validOptionalString(value, "salary")) return null;
	if (!validOptionalString(value, "actualRemaining")) return null;
	if (!validOptionalString(value, "confirmedIncomeId")) return null;
	if (
		Object.hasOwn(value, "autoDetectIncome") &&
		typeof value.autoDetectIncome !== "boolean"
	) {
		return null;
	}
	if (Object.hasOwn(value, "payTiming") && typeof value.payTiming !== "string") {
		return null;
	}
	const result = {
		salary: value.salary ?? defaults.salary,
		actualRemaining: value.actualRemaining ?? defaults.actualRemaining,
		autoDetectIncome: value.autoDetectIncome ?? defaults.autoDetectIncome,
		payTiming: PAY_TIMINGS.has(value.payTiming)
			? value.payTiming
			: defaults.payTiming,
		confirmedIncomeId: value.confirmedIncomeId ?? defaults.confirmedIncomeId,
	};
	return result;
}

function validOptionalString(value, key) {
	return !Object.hasOwn(value, key) || typeof value[key] === "string";
}

function isValidMonth(value) {
	return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function isPlainObject(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function emptyModel() {
	return { version: 2, months: {} };
}

function emptyReset(currentMonth) {
	return {
		session: createSession("empty", emptyModel(), currentMonth),
		preferences: createDefaultFinancePreferences(),
		serialized: null,
		operation: "remove",
	};
}

function createSession(kind, model, currentMonth, reason = null, legacy = null) {
	return {
		kind,
		model,
		currentMonth: currentMonth ?? null,
		reason,
		legacyPreferences: legacy,
	};
}
