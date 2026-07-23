export const DEFAULT_CATEGORIES = [
	{ name: "Supermercado", color: "#16a34a", builtin: true },
	{ name: "Comida", color: "#f97316", builtin: true },
	{ name: "Transporte", color: "#2563eb", builtin: true },
	{ name: "Salud", color: "#dc2626", builtin: true },
	{ name: "Educación", color: "#7c3aed", builtin: true },
	{ name: "Servicios", color: "#0891b2", builtin: true },
	{ name: "Entretenimiento", color: "#db2777", builtin: true },
	{ name: "Ocio", color: "#a855f7", builtin: true },
	{ name: "Hogar", color: "#65a30d", builtin: true },
	{ name: "Transferencias", color: "#64748b", builtin: true },
	{ name: "Suscripciones", color: "#9333ea", builtin: true },
	{ name: "Otros", color: "#475569", builtin: true },
];

export const CREATE_CATEGORY_VALUE = "__create_category__";

export function normalizeCounterpartyForUI(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

export function normalizeCategoryName(value) {
	return String(value || "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 40);
}

export function normalizeCategoryColor(value) {
	const color = String(value || "").trim();
	return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#64748b";
}

export function categoryKey(value) {
	return normalizeCounterpartyForUI(normalizeCategoryName(value));
}

export function defaultCategoryCatalog() {
	return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
}

export function mergeCategoryCatalog(categories = []) {
	const merged = new Map(
		defaultCategoryCatalog().map((category) => [
			categoryKey(category.name),
			category,
		]),
	);
	for (const category of categories) {
		const name = normalizeCategoryName(category?.name);
		if (!name) continue;
		merged.set(categoryKey(name), {
			name,
			color: normalizeCategoryColor(category?.color),
			builtin: Boolean(category?.builtin),
		});
	}
	return [...merged.values()];
}
