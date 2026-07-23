import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	CREATE_CATEGORY_VALUE,
	DEFAULT_CATEGORIES,
	categoryKey,
	defaultCategoryCatalog,
	mergeCategoryCatalog,
	normalizeCategoryColor,
	normalizeCategoryName,
	normalizeCounterpartyForUI,
} from "../public/category-catalog.js";

const EXPECTED_DEFAULTS = [
	["Supermercado", "#16a34a"],
	["Comida", "#f97316"],
	["Transporte", "#2563eb"],
	["Salud", "#dc2626"],
	["Educación", "#7c3aed"],
	["Servicios", "#0891b2"],
	["Entretenimiento", "#db2777"],
	["Ocio", "#a855f7"],
	["Hogar", "#65a30d"],
	["Transferencias", "#64748b"],
	["Suscripciones", "#9333ea"],
	["Otros", "#475569"],
].map(([name, color]) => ({ name, color, builtin: true }));

test("preserves the category creation sentinel and built-in catalog", () => {
	assert.equal(CREATE_CATEGORY_VALUE, "__create_category__");
	assert.deepEqual(DEFAULT_CATEGORIES, EXPECTED_DEFAULTS);
});

test("normalizes category and counterparty identity without locale drift", () => {
	assert.equal(normalizeCounterpartyForUI("  José  Pérez "), "jose perez");
	assert.equal(normalizeCounterpartyForUI(null), "");
	assert.equal(normalizeCategoryName("  Comida   rápida "), "Comida rápida");
	assert.equal(normalizeCategoryName("x".repeat(45)), "x".repeat(40));
	assert.equal(categoryKey("  EDUCACIÓN "), "educacion");
});

test("accepts only six-digit hex colors and otherwise uses the fallback", () => {
	for (const color of ["#abcdef", "#ABCDEF", "#123456"]) {
		assert.equal(normalizeCategoryColor(color), color);
	}
	for (const color of [null, "", "#fff", "123456", "#12345g"]) {
		assert.equal(normalizeCategoryColor(color), "#64748b");
	}
});

test("returns fresh default category objects", () => {
	const first = defaultCategoryCatalog();
	const second = defaultCategoryCatalog();
	first[0].name = "Changed";

	assert.deepEqual(second, EXPECTED_DEFAULTS);
	assert.deepEqual(DEFAULT_CATEGORIES, EXPECTED_DEFAULTS);
	assert.notEqual(first[1], second[1]);
});

test("merges normalized categories without mutating inputs", () => {
	const categories = [
		{ name: "  supermercado ", color: "#111111", builtin: false },
		{ name: " Nueva   categoría ", color: "invalid", builtin: 1 },
		{ name: "   ", color: "#ffffff" },
	];
	const before = structuredClone(categories);
	const merged = mergeCategoryCatalog(categories);
	const supermarket = merged.find(
		(category) => categoryKey(category.name) === "supermercado",
	);
	const custom = merged.find(
		(category) => categoryKey(category.name) === "nueva categoria",
	);

	assert.deepEqual(supermarket, {
		name: "supermercado",
		color: "#111111",
		builtin: false,
	});
	assert.deepEqual(custom, {
		name: "Nueva categoría",
		color: "#64748b",
		builtin: true,
	});
	assert.equal(merged.length, EXPECTED_DEFAULTS.length + 1);
	assert.deepEqual(categories, before);
});

test("later normalized duplicates replace earlier values in place", () => {
	const merged = mergeCategoryCatalog([
		{ name: "Viajes", color: "#111111" },
		{ name: " VIAJES ", color: "#222222", builtin: true },
	]);
	const matches = merged.filter(
		(category) => categoryKey(category.name) === "viajes",
	);

	assert.deepEqual(matches, [
		{ name: "VIAJES", color: "#222222", builtin: true },
	]);
});

test("app imports the defaults used by demo category responses", () => {
	const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
	const catalogImport = source.match(
		/import \{([\s\S]*?)\} from "\.\/category-catalog\.js";/,
	)?.[1];
	assert.match(catalogImport || "", /\bDEFAULT_CATEGORIES\b/);
	assert.match(source, /categories: DEFAULT_CATEGORIES/);
});
