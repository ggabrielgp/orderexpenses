const BUDGET_STORAGE_KEY = "financeMonthlyBudget";
const VIEW_PREFERENCES_STORAGE_KEY = "financeViewPreferences";

const DEFAULT_CATEGORIES = [
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
const CREATE_CATEGORY_VALUE = "__create_category__";

// Modo demo: cargar datos ficticios sin backend
const DEMO_MODE = false;
let demoData = [];

function adjustDemoDates(data) {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = now.getDate();
	return data.map((tx) => {
		const originalDate = new Date(tx.occurredAt);
		const dayOfMonth = Math.min(originalDate.getDate(), day);
		const adjustedDate = `${year}-${month}-${String(dayOfMonth).padStart(2, "0")}T${String(originalDate.getHours()).padStart(2, "0")}:${String(originalDate.getMinutes()).padStart(2, "0")}:00`;
		return { ...tx, occurredAt: adjustedDate };
	});
}

async function loadDemoData() {
	if (!DEMO_MODE) return;
	if (demoData.length > 0) return;
	try {
		const response = await fetch("/demo-data.json");
		const raw = await response.json();
		demoData = adjustDemoDates(raw);
	} catch (error) {
		console.error("Error cargando datos de demo:", error);
		demoData = [];
	}
}

// Simular respuestas de API en modo demo
function mockApiResponse(endpoint) {
	if (!DEMO_MODE) return null;

	if (endpoint === "/api/gmail/status") {
		return {
			hasCredentials: true,
			connected: true,
			activeEmail: "usuario@ejemplo.com",
		};
	}

	if (endpoint === "/api/gmail/profile") {
		return {
			connected: true,
			email: "usuario@ejemplo.com",
			name: "Usuario Demo",
			picture: null,
		};
	}

	if (endpoint === "/api/transactions") {
		if (demoData.length > 0) {
			return { transactions: demoData };
		}
		return { transactions: [] };
	}

	if (endpoint === "/api/income-candidates") {
		const candidates = demoData.filter(
			(tx) => tx.direction === "inflow" && tx.amount && Number(tx.amount) > 0,
		);
		return { candidates: candidates.slice(0, 2) };
	}

	if (endpoint === "/api/categories") {
		return { categories: DEFAULT_CATEGORIES };
	}

	if (endpoint === "/api/gmail/sync") {
		return { scanned: demoData.length, transactions: demoData };
	}

	return null;
}

const chartInstances = new Map();

function disposeChart(id) {
	const instance = chartInstances.get(id);
	if (instance) {
		instance.dispose();
		chartInstances.delete(id);
	}
}

function initChart(dom, option, id) {
	disposeChart(id);
	const chart = echarts.init(dom, null, { renderer: "svg" });
	chart.setOption(option);
	chartInstances.set(id, chart);
	return chart;
}

window.addEventListener("resize", () => {
	chartInstances.forEach((chart) => chart.resize());
});

const viewPreferences = loadViewPreferences();

const state = {
	transactions: [],
	activeId: null,
	sortKey: null,
	sortDir: null,
	view: "table",
	tableMode: viewPreferences.tableMode,
	chartTab: "month",
	chartDayKey: null,
	isGmailSyncing: false,
	selectedMonth: currentMonthKey(),
	budget: loadBudgetPreferences(currentMonthKey()),
	budgetEnabled: viewPreferences.budgetEnabled,
	incomeCandidates: [],
	categories: defaultCategoryCatalog(),
	profile: null,
	activeCounterpartyDetailKey: null,
	returnToCounterpartyKey: null,
	activeCategory: null,
};

const currency = new Intl.NumberFormat("es-CL", {
	style: "currency",
	currency: "CLP",
	maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("es-CL", {
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("es-CL", {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const shortWeekday = new Intl.DateTimeFormat("es-CL", { weekday: "short" });
const longWeekday = new Intl.DateTimeFormat("es-CL", { weekday: "long" });

function formatCLP(value) {
	if (value === null || value === undefined || value === "") return "";
	const num = Number(value);
	if (Number.isNaN(num)) return String(value);
	return currency.format(num);
}

function parseCLP(formatted) {
	if (formatted === null || formatted === undefined) return "";
	const str = String(formatted).trim();
	if (str === "") return "";
	const raw = str.replace(/[$\s.]/g, "");
	if (raw === "") return "";
	const num = Number(raw);
	return Number.isNaN(num) || num < 0 ? "" : num;
}

const gmailStatus = document.querySelector("#gmailStatus");
const connectGmailLink = document.querySelector("#connectGmail");
const disconnectGmailButton = document.querySelector("#disconnectGmailButton");
const syncGmailButton = document.querySelector("#syncGmailButton");
const gmailSyncProgress = document.querySelector("#gmailSyncProgress");
const gmailSyncProgressFill = document.querySelector("#gmailSyncProgressFill");
const gmailConsentModal = document.querySelector("#gmailConsentModal");
const gmailConsentCheck = document.querySelector("#gmailConsentCheck");
const gmailConsentAccept = document.querySelector("#gmailConsentAccept");
const gmailConsentCancel = document.querySelector("#gmailConsentCancel");
const gmailConsentClose = document.querySelector("#gmailConsentClose");
const heroTitle = document.querySelector("#heroTitle");
const heroSubtitle = document.querySelector("#heroSubtitle");
const profileEl = document.querySelector("#profile");
const refreshButton = document.querySelector("#refreshButton");
const dashboardViewButton = document.querySelector("#dashboardViewButton");
const tableViewButton = document.querySelector("#tableViewButton");
const monthSelect = document.querySelector("#monthSelect");
const dashboardEl = document.querySelector("#dashboard");
const transactionsEl = document.querySelector("#transactions");
const budgetPanelEl = document.querySelector("#budgetPanel");
const summaryEl = document.querySelector("#summary");
const rowTemplate = document.querySelector("#transactionRowTemplate");

const newExpenseButton = document.querySelector("#newExpenseButton");
const newExpenseModal = document.querySelector("#newExpenseModal");
const newOccurredAt = document.querySelector("#newOccurredAt");
const newAmount = document.querySelector("#newAmount");
const newKind = document.querySelector("#newKind");
const newDirection = document.querySelector("#newDirection");
const newCategory = document.querySelector("#newCategory");
const newCounterparty = document.querySelector("#newCounterparty");
const newDescription = document.querySelector("#newDescription");
const newFormStatus = document.querySelector("#newFormStatus");
const newSave = document.querySelector("#newSave");
const newCancel = document.querySelector("#newCancel");
const newClose = newExpenseModal.querySelector(".modal-close");

const modal = document.querySelector("#detailModal");
const modalOccurredAt = document.querySelector("#modalOccurredAt");
const modalAmount = document.querySelector("#modalAmount");
const modalKind = document.querySelector("#modalKind");
const modalDirection = document.querySelector("#modalDirection");
const modalCategory = document.querySelector("#modalCategory");
const modalCounterparty = document.querySelector("#modalCounterparty");
const modalDescription = document.querySelector("#modalDescription");
const modalStatus = document.querySelector("#modalStatus");
const modalSave = document.querySelector("#modalSave");
const modalDelete = document.querySelector("#modalDelete");
const modalClose = document.querySelector("#detailModalClose");
const modalBackToCounterparty = document.querySelector(
	"#modalBackToCounterparty",
);

const settingsModal = document.querySelector("#settingsModal");
const settingsClose = document.querySelector("#settingsClose");
const settingsProfile = document.querySelector("#settingsProfile");
const categorySettingsList = document.querySelector("#categorySettingsList");
const categoryForm = document.querySelector("#categoryForm");
const categoryName = document.querySelector("#categoryName");
const categoryColorInput = document.querySelector("#categoryColor");
const categoryFormStatus = document.querySelector("#categoryFormStatus");

const counterpartyDetailModal = document.querySelector(
	"#counterpartyDetailModal",
);
const counterpartyDetailTitle = document.querySelector(
	"#counterpartyDetailTitle",
);
const counterpartyDetailSummary = document.querySelector(
	"#counterpartyDetailSummary",
);
const counterpartyDetailList = document.querySelector(
	"#counterpartyDetailList",
);
const counterpartyDetailClose = document.querySelector(
	"#counterpartyDetailClose",
);
const counterpartyDetailDone = document.querySelector(
	"#counterpartyDetailDone",
);

// New expense modal
newExpenseButton.addEventListener("click", openNewExpenseModal);
newCancel.addEventListener("click", closeNewExpenseModal);
newClose.addEventListener("click", closeNewExpenseModal);
newExpenseModal.addEventListener("click", (e) => {
	if (e.target === newExpenseModal) closeNewExpenseModal();
});
newSave.addEventListener("click", createManualExpense);
newKind.addEventListener("change", () => {
	newDirection.value = newKind.value === "income" ? "inflow" : "outflow";
});
newAmount.addEventListener("focus", () => {
	const raw = parseCLP(newAmount.value);
	newAmount.value = raw === "" ? "" : String(raw);
});
newAmount.addEventListener("blur", () => {
	newAmount.value = formatCLP(parseCLP(newAmount.value));
});

// Detail modal
modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
	if (e.target === modal) closeModal();
});
modalSave.addEventListener("click", saveFromModal);
modalDelete.addEventListener("click", deleteFromModal);
modalBackToCounterparty.addEventListener("click", backToCounterpartyDetail);
modalAmount.addEventListener("focus", () => {
	const raw = parseCLP(modalAmount.value);
	modalAmount.value = raw === "" ? "" : String(raw);
});
modalAmount.addEventListener("blur", () => {
	modalAmount.value = formatCLP(parseCLP(modalAmount.value));
});
modalCategory.addEventListener("change", () => {
	if (modalCategory.value !== CREATE_CATEGORY_VALUE) return;
	const transaction = state.transactions.find((tx) => tx.id === state.activeId);
	populateCategorySelect(modalCategory, transaction?.category || "");
	openSettingsModal({ focusCategoryForm: true });
});

counterpartyDetailClose.addEventListener("click", closeCounterpartyDetailModal);
counterpartyDetailDone.addEventListener("click", closeCounterpartyDetailModal);
counterpartyDetailModal.addEventListener("click", (event) => {
	if (event.target === counterpartyDetailModal) closeCounterpartyDetailModal();
});

refreshButton.addEventListener("click", loadTransactions);
monthSelect.addEventListener("change", changeSelectedMonth);
dashboardViewButton.addEventListener("click", () => setView("dashboard"));
tableViewButton.addEventListener("click", () => setView("table"));
disconnectGmailButton.addEventListener("click", disconnectGmail);
syncGmailButton.addEventListener("click", syncGmail);
connectGmailLink.addEventListener("click", openGmailConsentModal);
gmailConsentCheck.addEventListener("change", () => {
	gmailConsentAccept.disabled = !gmailConsentCheck.checked;
});
gmailConsentAccept.addEventListener("click", acceptGmailConsent);
gmailConsentCancel.addEventListener("click", closeGmailConsentModal);
gmailConsentClose.addEventListener("click", closeGmailConsentModal);
gmailConsentModal.addEventListener("click", (event) => {
	if (event.target === gmailConsentModal) closeGmailConsentModal();
});

profileEl.addEventListener("click", openSettingsModal);
profileEl.addEventListener("keydown", (event) => {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		openSettingsModal();
	}
});
settingsClose.addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (event) => {
	if (event.target === settingsModal) closeSettingsModal();
});
categoryForm.addEventListener("submit", saveCategoryFromSettings);

renderMonthSelect();
await loadGmailStatus();
await loadProfile();
await loadCategories();
await loadTransactions();
await autoSyncAfterGmailConnect();

function openGmailConsentModal(event) {
	event.preventDefault();
	if (connectGmailLink.getAttribute("aria-disabled") === "true") {
		gmailStatus.textContent =
			"Ya hay una cuenta Gmail conectada. Desconéctala antes de cambiar de cuenta.";
		return;
	}
	gmailConsentCheck.checked = false;
	gmailConsentAccept.disabled = true;
	gmailConsentModal.showModal();
}

function closeGmailConsentModal() {
	gmailConsentModal.close();
}

function acceptGmailConsent() {
	if (!gmailConsentCheck.checked) return;
	window.location.href = connectGmailLink.href;
}

async function autoSyncAfterGmailConnect() {
	const params = new URLSearchParams(window.location.search);
	if (params.get("gmail") !== "connected") return;
	window.history.replaceState({}, "", window.location.pathname);
	gmailStatus.textContent =
		"Gmail conectado. Iniciando sincronización automática...";
	await syncGmail();
}

async function loadProfile() {
	try {
		let profile;
		if (DEMO_MODE) {
			profile = mockApiResponse("/api/gmail/profile");
		} else {
			const response = await fetch("/api/gmail/profile");
			profile = await response.json();
		}
		renderProfile(profile);
	} catch {
		profileEl.hidden = true;
		state.profile = null;
	}
}

async function loadCategories() {
	if (!state.profile?.email && !DEMO_MODE) {
		state.categories = defaultCategoryCatalog();
		return;
	}
	try {
		let payload;
		if (DEMO_MODE) {
			payload = mockApiResponse("/api/categories");
		} else {
			const response = await fetch("/api/categories");
			if (!response.ok) {
				state.categories = defaultCategoryCatalog();
				return;
			}
			payload = await response.json();
		}
		state.categories = mergeCategoryCatalog(payload.categories || []);
	} catch {
		state.categories = defaultCategoryCatalog();
	}
}

function renderProfile(profile) {
	profileEl.replaceChildren();
	if (!profile || profile.connected === false) {
		profileEl.hidden = true;
		state.profile = null;
		return;
	}

	profileEl.hidden = false;
	profileEl.setAttribute("role", "button");
	profileEl.tabIndex = 0;
	profileEl.setAttribute("aria-label", "Abrir configuración");
	state.profile = profile;
	if (profile.picture) {
		const img = document.createElement("img");
		img.src = profile.picture;
		img.alt = "";
		img.className = "profile-photo";
		img.referrerPolicy = "no-referrer";
		profileEl.append(img);
	}

	const info = document.createElement("div");
	info.className = "profile-info";
	const name = document.createElement("span");
	name.className = "profile-name";
	name.textContent = profile.name || "Usuario";
	const email = document.createElement("span");
	email.className = "profile-email";
	email.textContent = profile.email || "";
	info.append(name, email);
	profileEl.append(info);
}

function openSettingsModal(options = {}) {
	if (profileEl.hidden) return;
	categoryFormStatus.textContent = "";
	categoryName.value = "";
	categoryColorInput.value = "#22c55e";
	renderCategorySettings();
	settingsModal.showModal();
	if (options.focusCategoryForm) {
		setTimeout(() => categoryName.focus(), 0);
	}
}

function closeSettingsModal() {
	settingsModal.close();
}

function renderCategorySettings() {
	categorySettingsList.replaceChildren();
	settingsProfile.textContent = state.profile?.email
		? `${state.profile.name || "Usuario"} · ${state.profile.email}`
		: "Sin cuenta conectada";
	const categories = mergeCategoryCatalog(state.categories || []).sort((a, b) =>
		a.name.localeCompare(b.name, "es"),
	);
	for (const category of categories) {
		categorySettingsList.append(renderCategorySettingsRow(category));
	}
}

function renderCategorySettingsRow(category) {
	const row = document.createElement("div");
	row.className = "category-settings-row";
	const badge = document.createElement("span");
	badge.className = "category-badge";
	badge.style.setProperty("--category-color", category.color || "#64748b");
	badge.textContent = category.name;
	const meta = document.createElement("small");
	meta.textContent = category.builtin ? "Predeterminada" : "Personalizada";
	const actions = document.createElement("div");
	if (!category.builtin) {
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "secondary";
		remove.textContent = "Eliminar";
		remove.addEventListener("click", () =>
			deleteCategoryFromSettings(category.name),
		);
		actions.append(remove);
	}
	row.append(badge, meta, actions);
	return row;
}

async function saveCategoryFromSettings(event) {
	event.preventDefault();
	const name = normalizeCategoryName(categoryName.value);
	if (!name) {
		categoryFormStatus.textContent = "Ingresa un nombre de categoría.";
		return;
	}
	const color = normalizeCategoryColor(categoryColorInput.value);
	try {
		const response = await fetch("/api/categories", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name, color }),
		});
		const payload = await response.json();
		if (!response.ok)
			throw new Error(payload.error || "No se pudo guardar la categoría");
		categoryFormStatus.textContent = "Categoría guardada ✓";
		categoryName.value = "";
		await loadCategories();
		renderCategorySettings();
		render();
	} catch (error) {
		categoryFormStatus.textContent = `Error: ${error.message}`;
	}
}

async function deleteCategoryFromSettings(name) {
	if (!confirm(`¿Eliminar la categoría ${name}?`)) return;
	try {
		const response = await fetch(
			`/api/categories/${encodeURIComponent(name)}`,
			{ method: "DELETE" },
		);
		const payload = await response.json();
		if (!response.ok)
			throw new Error(payload.error || "No se pudo eliminar la categoría");
		categoryFormStatus.textContent = "Categoría eliminada.";
		await loadCategories();
		renderCategorySettings();
		render();
	} catch (error) {
		categoryFormStatus.textContent = `Error: ${error.message}`;
	}
}

async function loadGmailStatus(options = {}) {
	try {
		let status;
		if (DEMO_MODE) {
			status = mockApiResponse("/api/gmail/status");
		} else {
			const response = await fetch("/api/gmail/status");
			status = await response.json();
		}
		if (!status.hasCredentials && !DEMO_MODE) {
			updatePageTitle(false);
			if (!options.preserveMessage) {
				gmailStatus.textContent =
					"Falta data/google-credentials.json. Crea credenciales OAuth de Gmail y vuelve a iniciar la app.";
			}
			disconnectGmailButton.hidden = true;
			syncGmailButton.hidden = true;
			syncGmailButton.disabled = true;
			connectGmailLink.removeAttribute("aria-disabled");
			return;
		}
		updatePageTitle(status.connected || DEMO_MODE);
		if (!options.preserveMessage) {
			if (DEMO_MODE) {
				gmailStatus.textContent = `Modo demostraci\u00f3n activado. Mostrando datos ficticios de ${selectedMonthLabel()}.`;
			} else {
				gmailStatus.textContent = status.connected
					? `Gmail conectado${status.activeEmail ? `: ${status.activeEmail}` : ""}. Puedes sincronizar gastos de ${selectedMonthLabel()} detectados desde Banco de Chile.`
					: "Gmail no conectado. Presiona Conectar Gmail para autorizar lectura.";
			}
		}
		disconnectGmailButton.hidden = !status.connected || DEMO_MODE;
		syncGmailButton.hidden = !status.connected || DEMO_MODE;
		syncGmailButton.disabled =
			!status.connected || state.isGmailSyncing || DEMO_MODE;
		connectGmailLink.setAttribute(
			"aria-disabled",
			status.connected || DEMO_MODE ? "true" : "false",
		);
	} catch (error) {
		updatePageTitle(false);
		if (!options.preserveMessage) {
			gmailStatus.textContent = `Error revisando Gmail: ${error.message}`;
		}
	}
}

async function disconnectGmail() {
	disconnectGmailButton.disabled = true;
	syncGmailButton.disabled = true;
	gmailStatus.textContent = "Desconectando Gmail...";
	try {
		const response = await fetch("/api/gmail/disconnect", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		const payload = await response.json();
		if (!response.ok)
			throw new Error(payload.error || "Error desconectando Gmail");
		gmailStatus.textContent = "Gmail desconectado.";
		await stopGmailSyncProgress();
		await loadProfile();
		await loadCategories();
		await loadGmailStatus();
		await loadTransactions();
	} catch (error) {
		gmailStatus.textContent = `Error desconectando Gmail: ${error.message}`;
	} finally {
		disconnectGmailButton.disabled = false;
		syncGmailButton.disabled = syncGmailButton.hidden;
	}
}

async function syncGmail() {
	if (DEMO_MODE) {
		gmailStatus.textContent =
			"Modo demostraci\u00f3n: los datos ya est\u00e1n cargados.";
		return;
	}
	startGmailSyncProgress();
	gmailStatus.textContent = `Buscando gastos de ${selectedMonthLabel()} en Gmail...`;
	try {
		const response = await fetch("/api/gmail/sync", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				limit: 200,
				month: state.selectedMonth,
				payTiming: state.budget.payTiming,
			}),
		});
		const payload = await response.json();
		if (!response.ok)
			throw new Error(payload.error || "Error sincronizando Gmail");
		gmailStatus.textContent = `Sincronizaci\u00f3n lista: ${payload.scanned} mensajes de ${selectedMonthLabel()} procesados.`;
		state.transactions = payload.transactions || [];
		await loadIncomeCandidates({ renderAfter: false });
	} catch (error) {
		gmailStatus.textContent = `Error sincronizando Gmail: ${error.message}`;
	} finally {
		await stopGmailSyncProgress();
		await loadGmailStatus({ preserveMessage: true });
		render();
	}
}

async function createManualExpense() {
	const body = {
		occurredAt: `${newOccurredAt.value}:00`,
		amount: parseCLP(newAmount.value),
		kind: newKind.value,
		direction: newDirection.value,
		category: newCategory.value,
		counterparty: newCounterparty.value,
		description: newDescription.value,
	};
	if (body.kind === "income") body.direction = "inflow";
	if (!body.occurredAt || !body.amount) {
		newFormStatus.textContent = "Completa fecha y monto.";
		return;
	}
	newFormStatus.textContent = "Guardando gasto...";

	try {
		const response = await fetch("/api/transactions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error || "Error guardando gasto");

		await loadTransactions();
		closeNewExpenseModal();
	} catch (error) {
		newFormStatus.textContent = `Error: ${error.message}`;
	}
}

async function loadIncomeCandidates({ renderAfter = true } = {}) {
	if (!state.budget.autoDetectIncome) {
		state.incomeCandidates = [];
		if (renderAfter) render();
		return;
	}
	try {
		let payload;
		if (DEMO_MODE) {
			payload = mockApiResponse("/api/income-candidates", {
				month: state.selectedMonth,
				payTiming: state.budget.payTiming || "varies",
			});
		} else {
			const params = new URLSearchParams({
				month: state.selectedMonth,
				payTiming: state.budget.payTiming || "varies",
			});
			const response = await fetch(`/api/income-candidates?${params}`);
			payload = await response.json();
			if (!response.ok)
				throw new Error(payload.error || "Error cargando ingresos detectados");
		}
		state.incomeCandidates = payload.candidates || [];
	} catch {
		state.incomeCandidates = [];
	}
	if (renderAfter) render();
}

async function loadTransactions() {
	refreshButton.disabled = true;
	if (state.isGmailSyncing) {
		showGmailSyncMessage();
	} else {
		showTableMessage("Cargando gastos...");
	}
	try {
		let payload;
		if (DEMO_MODE) {
			await loadDemoData();
			payload = mockApiResponse("/api/transactions", {
				month: state.selectedMonth,
			});
		} else {
			const params = new URLSearchParams({ month: state.selectedMonth });
			const response = await fetch(`/api/transactions?${params}`);
			payload = await response.json();
			if (!response.ok)
				throw new Error(payload.error || "Error cargando gastos");
		}
		state.transactions = payload.transactions || [];
		await loadIncomeCandidates({ renderAfter: false });
		render();
	} catch (error) {
		showTableMessage(`No se pudieron cargar los gastos. ${error.message}`, {
			actionLabel: "Reintentar",
			onAction: loadTransactions,
		});
	} finally {
		refreshButton.disabled = false;
	}
}

function sortTransactions(transactions) {
	if (!state.sortKey) return transactions;
	const sorted = [...transactions];
	sorted.sort((a, b) => {
		let cmp = 0;
		if (state.sortKey === "date") {
			cmp = (a.occurredAt || "").localeCompare(b.occurredAt || "");
		} else if (state.sortKey === "amount") {
			cmp = (Number(a.amount) || 0) - (Number(b.amount) || 0);
		} else if (state.sortKey === "counterparty") {
			cmp = (a.counterparty || "").localeCompare(b.counterparty || "", "es");
		} else if (state.sortKey === "category") {
			cmp = (a.category || "Sin categoría").localeCompare(
				b.category || "Sin categoría",
				"es",
			);
		}
		return state.sortDir === "desc" ? -cmp : cmp;
	});
	return sorted;
}

function showTableMessage(message, options = {}) {
	renderViewToggle();
	dashboardEl.hidden = state.view !== "dashboard";
	transactionsEl.hidden = state.view !== "table";
	transactionsEl.replaceChildren();
	dashboardEl.replaceChildren();
	const box = createEmptyState(message, null, options);
	(state.view === "dashboard" ? dashboardEl : transactionsEl).append(box);
}

function showGmailSyncMessage() {
	showTableMessage(`Sincronizando gastos de ${selectedMonthLabel()}...`, {
		copyText: `Estamos revisando Gmail solo para ${selectedMonthLabel()} con los filtros autorizados. Los datos aparecerán cuando termine la sincronización.`,
	});
}

function createEmptyState(titleText, copyText, options = {}) {
	const box = document.createElement("div");
	box.className = "empty";
	const title = document.createElement("strong");
	title.textContent = titleText;
	box.append(title);
	const bodyCopy = copyText || options.copyText;
	if (bodyCopy) {
		const copy = document.createElement("span");
		copy.textContent = bodyCopy;
		box.append(copy);
	}
	if (options.actionLabel && options.onAction) {
		const action = document.createElement("button");
		action.type = "button";
		action.textContent = options.actionLabel;
		action.addEventListener("click", options.onAction);
		box.append(action);
	}
	return box;
}

async function changeSelectedMonth() {
	state.selectedMonth = monthSelect.value;
	state.budget = loadBudgetPreferences(state.selectedMonth);
	state.incomeCandidates = [];
	state.chartTab = "month";
	state.chartDayKey = null;
	await loadGmailStatus();
	await loadTransactions();
}

function renderMonthSelect() {
	monthSelect.replaceChildren();
	for (const option of selectableMonthOptions()) {
		const item = document.createElement("option");
		item.value = option.value;
		item.textContent = option.label;
		item.selected = option.value === state.selectedMonth;
		monthSelect.append(item);
	}
}

function selectableMonthOptions() {
	const current = startOfMonth(new Date());
	const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
	return [
		{ value: monthKey(current), label: `Este mes · ${monthName(current)}` },
		{
			value: monthKey(previous),
			label: `Mes anterior · ${monthName(previous)}`,
		},
	];
}

function setView(view) {
	if (state.view === view) return;
	const outgoing = state.view === "dashboard" ? dashboardEl : transactionsEl;
	const incoming = view === "dashboard" ? dashboardEl : transactionsEl;

	outgoing.style.transition =
		"opacity 200ms var(--ease-out-expo), transform 200ms var(--ease-out-expo)";
	outgoing.style.opacity = "0";
	outgoing.style.transform = "translateY(-4px)";

	setTimeout(() => {
		outgoing.hidden = true;
		outgoing.style.transform = "";
		outgoing.style.opacity = "";
		outgoing.style.transition = "";

		state.view = view;
		render();

		incoming.hidden = false;
		incoming.style.opacity = "0";
		incoming.style.transform = "translateY(4px)";

		requestAnimationFrame(() => {
			incoming.style.transition =
				"opacity 250ms var(--ease-out-expo), transform 250ms var(--ease-spring)";
			incoming.style.opacity = "1";
			incoming.style.transform = "translateY(0)";

			setTimeout(() => {
				incoming.style.transition = "";
				incoming.style.opacity = "";
				incoming.style.transform = "";
			}, 300);
		});
	}, 200);
}

function animateEntry(element, index = 0) {
	element.style.opacity = "0";
	element.style.transform = "translateY(16px)";
	element.style.filter = "blur(6px)";

	requestAnimationFrame(() => {
		element.style.transition = `opacity 600ms var(--ease-out-expo) ${index * 80}ms, transform 600ms var(--ease-spring) ${index * 80}ms, filter 400ms var(--ease-out-expo) ${index * 80}ms`;
		element.style.opacity = "1";
		element.style.transform = "translateY(0)";
		element.style.filter = "blur(0)";
	});
}

function updatePageTitle(isConnected) {
	if (isConnected) {
		heroTitle.textContent = selectedMonthLabel();
		document.title = `${selectedMonthLabel()} · Resumen`;
		heroSubtitle.textContent =
			"Revisa, corrige y entiende tus gastos importados automáticamente.";
	} else {
		heroTitle.textContent = "Tu mes en un vistazo";
		document.title = "Resumen · Finanzas Personales";
		heroSubtitle.textContent =
			"Conecta tu cuenta para ver el análisis automático de tus gastos.";
	}
}

function render() {
	renderMonthSelect();
	const allMonthTransactions = selectedMonthTransactions(state.transactions);
	const visibleExpenses = allMonthTransactions.filter(
		(tx) => tx.direction === "outflow",
	);
	renderViewToggle();
	renderHeroKpis(visibleExpenses.filter(hasKnownAmount), allMonthTransactions);
	dashboardEl.hidden = state.view !== "dashboard";
	transactionsEl.hidden = state.view !== "table";
	budgetPanelEl.replaceChildren();
	dashboardEl.replaceChildren();
	transactionsEl.replaceChildren();

	renderBudgetPanel(visibleExpenses.filter(hasKnownAmount));

	if (state.isGmailSyncing) {
		renderSyncingSummary();
		showGmailSyncMessage();
		return;
	}

	renderSummary(allMonthTransactions);

	if (allMonthTransactions.length === 0) {
		const empty = createEmptyState(
			`Todavía no hay movimientos en ${selectedMonthLabel()}`,
			"Sincroniza Gmail o ingresa un movimiento manual para este periodo para empezar a ver el resumen.",
			{ actionLabel: "Ingresar gasto", onAction: openNewExpenseModal },
		);
		if (state.view === "dashboard") {
			dashboardEl.append(empty);
		} else {
			transactionsEl.append(renderTableModeSwitch());
			if (state.tableMode === "counterparties") {
				transactionsEl.append(
					renderCounterpartySpendSection([], { limit: null }),
				);
			} else {
				transactionsEl.append(empty);
			}
		}
		return;
	}

	if (state.view === "dashboard") {
		renderDashboard(visibleExpenses);
		return;
	}

	renderTableView(allMonthTransactions);
}

function renderViewToggle() {
	const isDashboard = state.view === "dashboard";
	dashboardViewButton.classList.remove("secondary");
	tableViewButton.classList.remove("secondary");
	dashboardViewButton.classList.toggle(
		"view-switch-option-active",
		isDashboard,
	);
	tableViewButton.classList.toggle("view-switch-option-active", !isDashboard);
	dashboardViewButton.setAttribute("aria-pressed", String(isDashboard));
	tableViewButton.setAttribute("aria-pressed", String(!isDashboard));
}

function renderTableView(transactions) {
	transactionsEl.append(renderTableModeSwitch());
	if (state.tableMode === "counterparties") {
		const expenses = transactions.filter((tx) => tx.direction === "outflow");
		const knownExpenses = expenses.filter(hasKnownAmount);
		transactionsEl.append(
			renderCounterpartySpendSection(knownExpenses, { limit: null }),
		);
		return;
	}

	const sorted = sortTransactions(transactions);
	const tableSummary = renderTableSummary(sorted);
	const table = document.createElement("table");
	table.className = "transactions-table";
	table.append(renderTableHead(), renderTableBody(sorted));
	transactionsEl.append(tableSummary, table);
}

function renderTableModeSwitch() {
	const wrapper = document.createElement("section");
	wrapper.className = "table-mode-switch";
	const label = document.createElement("span");
	label.className = "table-mode-switch-label";
	label.textContent = "Ver como";
	const options = document.createElement("div");
	options.className = "table-mode-options";
	options.setAttribute("role", "group");
	options.setAttribute("aria-label", "Modo de tabla");

	for (const option of [
		{ value: "movements", label: "Movimientos" },
		{ value: "counterparties", label: "Comercios" },
	]) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "table-mode-option";
		button.textContent = option.label;
		const isActive = state.tableMode === option.value;
		button.classList.toggle("table-mode-option-active", isActive);
		button.setAttribute("aria-pressed", String(isActive));
		button.addEventListener("click", () => {
			if (state.tableMode === option.value) return;
			state.tableMode = option.value;
			saveViewPreferences();
			render();
		});
		options.append(button);
	}

	wrapper.append(label, options);
	return wrapper;
}

function updateChartOnly() {
	const existingChart = dashboardEl.querySelector(".chart-card");
	if (!existingChart) return;
	const transactions = selectedMonthExpenseTransactions(state.transactions);
	const expenses = transactions.filter((tx) => tx.direction === "outflow");
	const knownExpenses = expenses.filter(hasKnownAmount);
	const dailySpending = buildMonthlyDailySpending(knownExpenses);
	const newChart = renderMonthlyDailyChart(dailySpending, knownExpenses);
	existingChart.replaceWith(newChart);
}

function renderDashboard(transactions) {
	const expenses = transactions.filter((tx) => tx.direction === "outflow");
	const knownExpenses = expenses.filter(hasKnownAmount);
	const unknownExpenseCount = expenses.length - knownExpenses.length;
	const totalSpent = sumAmounts(knownExpenses);
	const averageExpense = knownExpenses.length
		? Math.round(totalSpent / knownExpenses.length)
		: 0;
	const largestExpense = knownExpenses.reduce(
		(max, tx) =>
			Number(tx.amount) > Number((max && max.amount) || 0) ? tx : max,
		null,
	);
	const latest = [...transactions].sort((a, b) =>
		String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")),
	)[0];
	const topCategory = topGroup(
		knownExpenses,
		(tx) => tx.category || labelForKind(tx.kind),
	);
	const topCounterparty = topGroup(
		knownExpenses,
		(tx) => tx.counterparty || "Sin contraparte",
	);
	const kindBreakdown = groupTotals(knownExpenses, (tx) =>
		labelForKind(tx.kind),
	);
	const dailySpending = buildMonthlyDailySpending(knownExpenses);

	const metrics = document.createElement("div");
	metrics.className = "metric-grid";
	metrics.append(
		metricCard(
			`Total gastado en ${selectedMonthLabel()}`,
			formatCLP(totalSpent),
			`${knownExpenses.length} salidas con monto${unknownExpenseCount ? ` · ${unknownExpenseCount} por revisar` : ""}`,
		),
		metricCard(
			"Gasto promedio",
			formatCLP(averageExpense),
			"Promedio con montos conocidos",
		),
		metricCard(
			"Mayor gasto",
			largestExpense ? formatCLP(largestExpense.amount) : "—",
			(largestExpense && largestExpense.counterparty) ||
				(largestExpense && largestExpense.description) ||
				"Sin gastos",
		),
		metricCard(
			"Por revisar",
			String(unknownExpenseCount),
			unknownExpenseCount
				? "Salidas sin monto conocido o pendientes de revisión"
				: "Todas las salidas visibles tienen monto conocido",
		),
	);

	const insights = document.createElement("div");
	insights.className = "dashboard-grid";
	insights.append(
		insightCard(
			"Principal categoría",
			topCategory.label,
			formatCLP(topCategory.total),
		),
		insightCard(
			"Principal comercio/persona",
			topCounterparty.label,
			formatCLP(topCounterparty.total),
		),
		insightCard(
			"Último movimiento",
			latest ? formatDate(latest.occurredAt) : "—",
			(latest && latest.counterparty) ||
				(latest && latest.description) ||
				"Sin movimientos",
		),
	);

	const weeklyChart = renderMonthlyDailyChart(dailySpending, knownExpenses);
	const categoryDistribution = renderCategoryDistribution(knownExpenses);

	const breakdown = document.createElement("section");
	breakdown.className = "breakdown-card";
	const title = document.createElement("h3");
	title.textContent = "Distribución de gastos";
	breakdown.append(title);
	if (kindBreakdown.length === 0) {
		const empty = document.createElement("p");
		empty.textContent = "Aún no hay salidas para graficar.";
		breakdown.append(empty);
	} else {
		for (const item of kindBreakdown.slice(0, 5)) {
			breakdown.append(breakdownRow(item.label, item.total, totalSpent));
		}
	}

	const cards = [
		metrics,
		weeklyChart,
		categoryDistribution,
		insights,
		breakdown,
	];
	cards.forEach((card, index) => {
		dashboardEl.append(card);
		animateEntry(card, index);
	});
}

function renderBudgetPanel(knownExpenses) {
	if (!budgetPanelEl) return;
	const totalSpent = sumAmounts(knownExpenses);
	budgetPanelEl.append(renderBudgetToggle());
	if (state.budgetEnabled) budgetPanelEl.append(renderBudgetCard(totalSpent));
}

function renderBudgetToggle() {
	const section = document.createElement("section");
	section.className = "budget-toggle-card";
	const copy = document.createElement("div");
	const title = document.createElement("strong");
	title.textContent = "Calcular presupuesto del mes";
	const description = document.createElement("p");
	description.textContent =
		"Siempre disponible: ingresa tu sueldo manualmente o activa detección para usar la entrada mayor como ingreso principal.";
	copy.append(title, description);

	const button = document.createElement("button");
	button.type = "button";
	button.className = "switch-control";
	button.setAttribute("role", "switch");
	button.setAttribute("aria-checked", String(state.budgetEnabled));
	button.setAttribute("aria-label", "Calcular presupuesto del mes");
	button.addEventListener("click", () => {
		state.budgetEnabled = !state.budgetEnabled;
		saveViewPreferences();
		render();
	});
	const knob = document.createElement("span");
	knob.setAttribute("aria-hidden", "true");
	button.append(knob);

	section.append(copy, button);
	return section;
}

function renderBudgetCard(totalSpent) {
	const card = document.createElement("section");
	card.className = "budget-card";

	const header = document.createElement("div");
	header.className = "budget-header";
	const title = document.createElement("h3");
	title.textContent = "Presupuesto del mes";
	const copy = document.createElement("p");
	copy.textContent =
		"Los ingresos importados se muestran en la tabla, pero solo afectan el restante cuando ingresas un sueldo o activas la detección automática.";
	header.append(title, copy);

	const detection = renderIncomeDetection(totalSpent);
	const form = document.createElement("div");
	form.className = "budget-form";
	const salaryInput = budgetInput(
		"Ingreso principal del mes",
		"budgetSalary",
		state.budget.salary,
	);
	const remainingInput = budgetInput(
		"Restante real o esperado (opcional)",
		"budgetActualRemaining",
		state.budget.actualRemaining,
	);
	form.append(salaryInput.label, remainingInput.label);

	const results = document.createElement("div");
	results.className = "budget-results";
	results.setAttribute("aria-live", "polite");
	results.append(
		budgetResult(
			"Gastos capturados",
			formatCLP(totalSpent),
			selectedMonthLabel(),
		),
		budgetResult(
			"Restante estimado",
			"—",
			"Ingresa un sueldo o activa detección automática para calcularlo.",
		),
		budgetResult(
			"Diferencia no rastreada",
			"—",
			"Opcional: compáralo con tu restante real.",
		),
	);

	card.append(header, detection, form, results);
	wireBudgetInput(salaryInput.input, "salary", totalSpent, card);
	wireBudgetInput(remainingInput.input, "actualRemaining", totalSpent, card);
	updateBudgetResults(card, totalSpent);
	return card;
}

function renderIncomeDetection() {
	const box = document.createElement("div");
	box.className = "income-detection";

	const toggleLabel = document.createElement("label");
	toggleLabel.className = "budget-check";
	const toggle = document.createElement("input");
	toggle.type = "checkbox";
	toggle.checked = Boolean(state.budget.autoDetectIncome);
	const toggleText = document.createElement("span");
	toggleText.textContent = "Detectar ingreso automáticamente";
	toggleLabel.append(toggle, toggleText);

	const timingLabel = document.createElement("label");
	timingLabel.className = "budget-field";
	timingLabel.textContent = "¿Cuándo recibes normalmente tu sueldo?";
	const timingSelect = document.createElement("select");
	timingSelect.id = "budgetPayTiming";
	for (const option of payTimingOptions()) {
		const item = document.createElement("option");
		item.value = option.value;
		item.textContent = option.label;
		item.selected = option.value === state.budget.payTiming;
		timingSelect.append(item);
	}
	timingSelect.disabled = !state.budget.autoDetectIncome;
	timingLabel.append(timingSelect);

	toggle.addEventListener("change", async () => {
		state.budget.autoDetectIncome = toggle.checked;
		if (!toggle.checked) {
			state.budget.confirmedIncomeId = state.budget.salary ? "manual" : "";
			state.incomeCandidates = [];
		} else if (
			state.budget.confirmedIncomeId === "manual" &&
			!state.budget.salary
		) {
			state.budget.confirmedIncomeId = "";
		}
		saveBudgetPreferences();
		await loadIncomeCandidates();
		updateHeroKpis();
	});
	timingSelect.addEventListener("change", async () => {
		state.budget.payTiming = timingSelect.value;
		state.budget.confirmedIncomeId = state.budget.salary ? "manual" : "";
		saveBudgetPreferences();
		await loadIncomeCandidates();
		updateHeroKpis();
	});

	box.append(toggleLabel, timingLabel);
	if (state.budget.autoDetectIncome) {
		box.append(renderIncomeSuggestion());
	}
	return box;
}

function renderIncomeSuggestion() {
	const panel = document.createElement("div");
	panel.className = "income-suggestion";
	const candidates = incomeCandidatesWithConfidence(
		state.incomeCandidates,
	).slice(0, 2);
	const title = document.createElement("strong");
	title.textContent = "Transferencias entrantes mayores";

	if (candidates.length === 0) {
		const empty = document.createElement("p");
		empty.textContent =
			"No encontramos transferencias entrantes importadas para el periodo elegido. Puede que Gmail no tenga correos de entrada del banco en ese rango, que aún no hayas sincronizado, o que ese ingreso no venga por correo. Puedes ingresar tu ingreso manualmente.";
		panel.append(title, empty, renderIncomeFallbackActions());
		return panel;
	}

	const copy = document.createElement("p");
	copy.textContent =
		"Con la detección activa usamos la entrada mayor como ingreso principal. Si no es tu sueldo, elige otra entrada o ingrésalo manualmente.";
	const list = document.createElement("div");
	list.className = "income-candidate-list";
	for (const candidate of candidates) {
		list.append(renderIncomeCandidateOption(candidate));
	}

	panel.append(title, copy, list, renderIncomeFallbackActions());
	return panel;
}

function renderIncomeCandidateOption(candidate) {
	const option = document.createElement("article");
	option.className = "income-candidate-option";
	const isAutoPick =
		state.budget.autoDetectIncome &&
		!state.budget.confirmedIncomeId &&
		String(autoDetectedIncomeCandidate()?.id) === String(candidate.id);
	const isConfirmed =
		state.budget.confirmedIncomeId === String(candidate.id) || isAutoPick;
	if (isConfirmed) option.classList.add("income-candidate-option-active");

	const content = document.createElement("div");
	const amount = document.createElement("strong");
	amount.textContent = formatCLP(candidate.amount);
	const detail = document.createElement("small");
	detail.textContent = `${formatDate(candidate.occurredAt)} · ${candidate.counterparty || "Origen no identificado"} · Confianza ${candidate.confidenceLabel}`;
	content.append(amount, detail);

	const button = document.createElement("button");
	button.type = "button";
	button.textContent = isAutoPick
		? "Usando mayor"
		: isConfirmed
			? "Seleccionada"
			: "Usar como ingreso";
	button.className = isConfirmed ? "" : "secondary";
	button.addEventListener("click", () => useIncomeCandidate(candidate));

	option.append(content, button);
	return option;
}

function renderIncomeFallbackActions() {
	const actions = document.createElement("div");
	actions.className = "income-actions";
	const manualButton = document.createElement("button");
	manualButton.type = "button";
	manualButton.className = "secondary";
	manualButton.textContent = "Ingresar manualmente";
	manualButton.addEventListener("click", () => {
		state.budget.confirmedIncomeId = "manual";
		saveBudgetPreferences();
		render();
		const salaryInput = document.querySelector("#budgetSalary");
		if (salaryInput) salaryInput.focus();
	});
	const disableButton = document.createElement("button");
	disableButton.type = "button";
	disableButton.className = "secondary";
	disableButton.textContent = "Desactivar detección";
	disableButton.addEventListener("click", () => {
		state.budget.autoDetectIncome = false;
		state.budget.confirmedIncomeId = state.budget.salary ? "manual" : "";
		state.incomeCandidates = [];
		saveBudgetPreferences();
		render();
	});
	actions.append(manualButton, disableButton);
	return actions;
}

function useIncomeCandidate(candidate) {
	state.budget.salary = formatCLP(candidate.amount);
	state.budget.confirmedIncomeId = String(candidate.id);
	saveBudgetPreferences();
	render();
}

function payTimingOptions() {
	return [
		{ value: "first_week", label: "Primera semana del mes" },
		{ value: "mid_month", label: "Mitad del mes" },
		{ value: "last_week", label: "Última semana del mes" },
		{ value: "varies", label: "Varía / no estoy seguro" },
	];
}

function incomeCandidatesWithConfidence(candidates) {
	const sorted = [...candidates]
		.filter((tx) => tx.direction === "inflow" && hasKnownAmount(tx))
		.sort((a, b) => Number(b.amount) - Number(a.amount));
	return sorted.map((candidate, index) => ({
		...candidate,
		confidenceLabel: incomeConfidence(candidate, sorted[index + 1]),
	}));
}

function autoDetectedIncomeCandidate() {
	return incomeCandidatesWithConfidence(state.incomeCandidates)[0] || null;
}

function incomeConfidence(candidate, nextCandidate) {
	let score = 1;
	if (candidate.counterparty) score += 1;
	if (state.budget.payTiming !== "varies") score += 1;
	if (
		!nextCandidate ||
		Number(candidate.amount) >= Number(nextCandidate.amount) * 2
	) {
		score += 1;
	}
	if (state.budget.payTiming === "varies") score -= 1;
	if (score >= 3) return "alta";
	if (score >= 2) return "media";
	return "baja";
}

function budgetInput(labelText, id, value) {
	const label = document.createElement("label");
	label.className = "budget-field";
	label.textContent = labelText;
	const input = document.createElement("input");
	input.id = id;
	input.type = "text";
	input.inputMode = "numeric";
	input.autocomplete = "off";
	input.min = "0";
	input.pattern = "[0-9.$\\s]*";
	input.placeholder = "$0";
	input.title = "Ingresa un monto positivo, por ejemplo $850.000";
	input.value = value ? formatCLP(parseCLP(value)) : "";
	label.append(input);
	return { label, input };
}

function budgetResult(labelText, valueText, detailText) {
	const item = document.createElement("article");
	item.className = "budget-result";
	const label = document.createElement("span");
	label.textContent = labelText;
	const value = document.createElement("strong");
	value.textContent = valueText;
	const detail = document.createElement("small");
	detail.textContent = detailText;
	item.append(label, value, detail);
	return item;
}

function wireBudgetInput(input, key, totalSpent, card) {
	input.addEventListener("focus", () => {
		const raw = parseCLP(input.value);
		input.value = raw === "" ? "" : String(raw);
	});
	input.addEventListener("input", () => {
		input.value = sanitizeBudgetInput(input.value);
		state.budget[key] = input.value;
		if (key === "salary") state.budget.confirmedIncomeId = "manual";
		saveBudgetPreferences();
		updateBudgetResults(card, totalSpent);
		updateHeroKpis();
	});
	input.addEventListener("blur", () => {
		input.value = sanitizeBudgetInput(input.value);
		const raw = parseCLP(input.value);
		input.value = raw === "" ? "" : formatCLP(raw);
		state.budget[key] = input.value;
		if (key === "salary") state.budget.confirmedIncomeId = "manual";
		saveBudgetPreferences();
		updateBudgetResults(card, totalSpent);
		updateHeroKpis();
	});
}

function sanitizeBudgetInput(value) {
	return Array.from(String(value || ""))
		.filter(
			(char) => /\d/.test(char) || char === "$" || char === "." || char === " ",
		)
		.join("");
}

function updateBudgetResults(card, totalSpent) {
	const results = card.querySelectorAll(".budget-result");
	const income = confirmedBudgetIncome();
	const salary = income.amount;
	const actualRemaining = parseCLP(state.budget.actualRemaining);
	const estimated = salary === null ? null : salary - totalSpent;

	setBudgetResult(
		results[0],
		formatCLP(totalSpent),
		`${selectedMonthLabel()} · gastos detectados y manuales`,
	);

	if (estimated === null) {
		setBudgetResult(
			results[1],
			"—",
			income.reason ||
				"Ingresa un sueldo o activa detección automática para calcularlo.",
		);
		setBudgetResult(
			results[2],
			"—",
			"Si luego agregas tu restante real, mostraremos dinero no explicado por los correos y movimientos analizados.",
		);
		return;
	}

	setBudgetResult(
		results[1],
		formatCLP(estimated),
		`${formatCLP(salary)} ingreso - ${formatCLP(totalSpent)} gastos`,
	);

	if (actualRemaining === "") {
		setBudgetResult(
			results[2],
			"—",
			"Agrega tu restante real o esperado para detectar dinero no explicado.",
		);
		return;
	}

	const difference = estimated - actualRemaining;
	const direction =
		difference === 0
			? "Calza con lo esperado."
			: difference > 0
				? "Dinero no explicado por los correos analizados: podría ser pagos automáticos, tarjeta, giros, comisiones, suscripciones u otros movimientos no rastreados."
				: "Tu restante real es mayor al estimado: revisa ingresos, ajustes o gastos duplicados.";
	setBudgetResult(
		results[2],
		formatCLP(Math.abs(difference)),
		`${direction} Diferencia: ${formatSignedCLP(difference)}.`,
	);
}

function setBudgetResult(item, valueText, detailText) {
	item.querySelector("strong").textContent = valueText;
	item.querySelector("small").textContent = detailText;
}

function confirmedBudgetIncome() {
	const salary = parseCLP(state.budget.salary);
	if (state.budget.confirmedIncomeId === "manual" && salary !== "") {
		return { amount: salary, reason: "Ingreso manual confirmado." };
	}

	if (state.budget.autoDetectIncome) {
		const confirmedCandidate = state.incomeCandidates.find(
			(candidate) => String(candidate.id) === state.budget.confirmedIncomeId,
		);
		if (confirmedCandidate) {
			return {
				amount: Number(confirmedCandidate.amount),
				reason: "Entrada detectada seleccionada como ingreso principal.",
			};
		}

		const automaticCandidate = autoDetectedIncomeCandidate();
		if (automaticCandidate) {
			return {
				amount: Number(automaticCandidate.amount),
				reason: "Usando la entrada mayor detectada como ingreso principal.",
			};
		}
	}

	if (salary !== "") {
		return { amount: salary, reason: "Ingreso manual." };
	}

	return {
		amount: null,
		reason:
			"Activa la detección automática o ingresa tu sueldo manualmente para calcular el restante.",
	};
}

function defaultBudgetPreferences() {
	return {
		salary: "",
		actualRemaining: "",
		autoDetectIncome: false,
		payTiming: "varies",
		confirmedIncomeId: "",
	};
}

function loadBudgetPreferences(month = currentMonthKey()) {
	const defaults = defaultBudgetPreferences();
	try {
		const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
		if (!raw) return defaults;
		const parsed = JSON.parse(raw);
		if (parsed?.months) {
			return normalizeBudgetObject(parsed.months[month] || defaults);
		}
		if (month === currentMonthKey()) {
			return normalizeBudgetObject(parsed);
		}
		return defaults;
	} catch {
		return defaults;
	}
}

function normalizeBudgetObject(value = {}) {
	const defaults = defaultBudgetPreferences();
	return {
		...defaults,
		salary: normalizeBudgetPreference(value.salary),
		actualRemaining: normalizeBudgetPreference(value.actualRemaining),
		autoDetectIncome: Boolean(value.autoDetectIncome),
		payTiming: normalizePayTimingPreference(value.payTiming),
		confirmedIncomeId: value.confirmedIncomeId
			? String(value.confirmedIncomeId)
			: "",
	};
}

function normalizePayTimingPreference(value) {
	return payTimingOptions().some((option) => option.value === value)
		? value
		: "varies";
}

function normalizeBudgetPreference(value) {
	const amount = parseCLP(sanitizeBudgetInput(value || ""));
	return amount === "" ? "" : formatCLP(amount);
}

function loadViewPreferences() {
	try {
		const parsed = JSON.parse(
			localStorage.getItem(VIEW_PREFERENCES_STORAGE_KEY) || "{}",
		);
		return {
			budgetEnabled: Boolean(parsed.budgetEnabled),
			tableMode:
				parsed.tableMode === "counterparties" ? "counterparties" : "movements",
		};
	} catch {
		return { budgetEnabled: false, tableMode: "movements" };
	}
}

function saveViewPreferences() {
	try {
		localStorage.setItem(
			VIEW_PREFERENCES_STORAGE_KEY,
			JSON.stringify({
				budgetEnabled: Boolean(state.budgetEnabled),
				tableMode:
					state.tableMode === "counterparties" ? "counterparties" : "movements",
			}),
		);
	} catch {
		// Local storage is a convenience only; ignore unavailable storage.
	}
}

function saveBudgetPreferences() {
	try {
		const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
		let months = {};
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed?.months) {
				months = parsed.months;
			} else if (parsed && typeof parsed === "object") {
				months[currentMonthKey()] = normalizeBudgetObject(parsed);
			}
		}
		months[state.selectedMonth] = normalizeBudgetObject(state.budget);
		localStorage.setItem(
			BUDGET_STORAGE_KEY,
			JSON.stringify({ version: 2, months }),
		);
	} catch {
		// Local storage is a convenience only; ignore unavailable storage.
	}
}

function formatSignedCLP(value) {
	if (value === 0) return formatCLP(0);
	return `${value > 0 ? "+" : "-"}${formatCLP(Math.abs(value))}`;
}

function buildMonthlyDailySpending(expenses) {
	const selectedMonth = selectedMonthDate();
	const monthStart = new Date(
		selectedMonth.getFullYear(),
		selectedMonth.getMonth(),
		1,
	);
	const monthEnd = new Date(
		selectedMonth.getFullYear(),
		selectedMonth.getMonth() + 1,
		0,
	);
	const firstWeekStart = startOfWeek(monthStart);
	const lastWeekStart = startOfWeek(monthEnd);
	const weeks = [];

	for (
		let weekStart = firstWeekStart;
		weekStart <= lastWeekStart;
		weekStart = addDays(weekStart, 7)
	) {
		weeks.push({
			id: `week-${weeks.length}`,
			label: `Semana ${weeks.length + 1}`,
			range: `${formatShortDate(maxDate(weekStart, monthStart))} al ${formatShortDate(
				minDate(addDays(weekStart, 6), monthEnd),
			)}`,
			days: createWeekDays(weekStart, monthStart, monthEnd),
		});
	}

	const monthDays = createWeekdayTotals(selectedMonth);
	const weekByDate = new Map(
		weeks.flatMap((week) => week.days.map((day) => [day.key, day])),
	);

	for (const expense of expenses) {
		const date = parseTransactionDate(expense.occurredAt);
		if (!date || !isSameMonth(date, selectedMonth)) continue;
		const amount = Number(expense.amount);
		const weekDay = weekByDate.get(dateKey(date));
		if (weekDay) weekDay.total += amount;
		const monthDay = monthDays[weekdayIndex(date)];
		monthDay.total += amount;
	}

	return { weeks, monthDays, monthLabel: monthName(selectedMonth) };
}

function createWeekDays(weekStart, monthStart, monthEnd) {
	return Array.from({ length: 7 }, (_, index) => {
		const date = addDays(weekStart, index);
		const isInMonthRange = date >= monthStart && date <= monthEnd;
		return {
			date,
			key: dateKey(date),
			label: shortWeekday.format(date),
			detail: isInMonthRange ? formatShortDate(date) : "",
			isInMonthRange,
			total: 0,
		};
	});
}

function createWeekdayTotals(referenceDate) {
	const weekStart = startOfWeek(referenceDate);
	return Array.from({ length: 7 }, (_, index) => {
		const date = addDays(weekStart, index);
		return {
			date,
			key: `weekday-${index}`,
			label: shortWeekday.format(date),
			detail: "",
			titleDetail: `Total del mes por ${longWeekday.format(date)}`,
			total: 0,
		};
	});
}

function preserveScrollDuringRender(callback) {
	const scrollX = window.scrollX;
	const scrollY = window.scrollY;
	callback();
	requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
}

function renderMonthlyDailyChart(series, expenses) {
	const selected = selectedChartSeries(series);
	const selectedDay = selectedChartDay(selected);
	const total = selected.days.reduce((sum, day) => sum + day.total, 0);
	const max = Math.max(...selected.days.map((day) => day.total), 1);
	const section = document.createElement("section");
	section.className = "chart-card";

	const header = document.createElement("div");
	header.className = "chart-header";
	const title = document.createElement("h3");
	title.id = "weeklySpendingChartTitle";
	title.textContent = "Gasto por día de la semana";
	const totalEl = document.createElement("span");
	totalEl.textContent = `${formatCLP(total)} · ${selected.detail}`;
	header.append(title, totalEl);

	const tabs = document.createElement("div");
	tabs.className = "chart-tabs";
	tabs.setAttribute("aria-label", "Periodo del gráfico de gastos");
	for (const option of chartTabOptions(series)) {
		const tab = document.createElement("button");
		tab.type = "button";
		tab.id = `chart-period-${option.id}`;
		tab.className = "chart-tab";
		tab.textContent = option.label;
		tab.setAttribute("aria-pressed", String(option.id === selected.id));
		tab.setAttribute("aria-controls", "weeklySpendingChart");
		tab.addEventListener("click", () => {
			state.chartTab = option.id;
			state.chartDayKey = null;
			updateChartOnly();
		});
		tabs.append(tab);
	}

	const chart = document.createElement("div");
	chart.id = "weeklySpendingChart";
	chart.className = "weekly-chart";
	chart.setAttribute("role", "region");
	chart.setAttribute("aria-labelledby", "weeklySpendingChartTitle");
	chart.setAttribute("aria-label", selected.ariaLabel);
	for (const day of selected.days) {
		const bar = document.createElement("button");
		bar.type = "button";
		bar.className = "weekly-bar";
		const isOutOfMonth = day.isInMonthRange === false;
		const isSelected = selectedDay && day.key === selectedDay.key;
		bar.disabled = isOutOfMonth;
		bar.setAttribute("aria-pressed", String(isSelected));
		bar.setAttribute("aria-controls", "chartDayDetail");
		bar.setAttribute("aria-label", chartBarLabel(selected, day, isOutOfMonth));
		if (isSelected) bar.classList.add("weekly-bar-selected");
		bar.addEventListener("click", () => {
			state.chartDayKey = day.key;
			updateChartOnly();
		});
		const value = document.createElement("span");
		value.className = "weekly-value";
		value.textContent = formatCLP(day.total);
		const track = document.createElement("span");
		track.className = "weekly-track";
		if (isOutOfMonth) {
			track.classList.add("weekly-track-empty");
		}
		const titleDetail = day.titleDetail ? day.titleDetail : day.detail;
		track.title = titleDetail
			? `${day.label} · ${titleDetail}: ${formatCLP(day.total)}`
			: `${day.label}: fuera del mes`;
		const fill = document.createElement("span");
		fill.className = "weekly-fill";
		fill.style.height = `${Math.max(day.total ? 12 : 0, Math.round((day.total / max) * 100))}%`;
		track.append(fill);
		const label = document.createElement("strong");
		label.textContent = day.label;
		const detail = document.createElement("small");
		detail.textContent = day.detail;
		bar.append(value, track, label, detail);
		chart.append(bar);
	}

	const chartBody = document.createElement("div");
	chartBody.className = "chart-body";
	chartBody.append(
		renderChartDayDetail(selected, selectedDay, expenses),
		chart,
		renderChartTotalsGrid(series, selected.id),
	);

	section.append(header, tabs, chartBody);
	return section;
}

function selectedChartDay(selected) {
	const selectableDays = selected.days.filter(
		(day) => day.isInMonthRange !== false,
	);
	if (state.chartDayKey) {
		const active = selectableDays.find((day) => day.key === state.chartDayKey);
		if (active) return active;
	}
	if (selected.mode === "month") {
		const monday = selectableDays.find((day) => day.key === "weekday-0");
		if (monday) return monday;
	}
	return selectableDays.reduce(
		(best, day) => (!best || day.total > best.total ? day : best),
		null,
	);
}

function chartBarLabel(selected, day, isOutOfMonth) {
	if (isOutOfMonth) return `${day.label}, fuera del mes`;
	const prefix =
		selected.mode === "month"
			? `Ver detalle de ${day.titleDetail}`
			: `Ver detalle de ${day.label} ${day.detail}`;
	return `${prefix}: ${formatCLP(day.total)}`;
}

function renderChartDayDetail(selected, selectedDay, expenses) {
	const panel = document.createElement("aside");
	panel.id = "chartDayDetail";
	panel.className = "chart-detail";
	panel.setAttribute("aria-live", "polite");

	const title = document.createElement("h4");
	const amount = document.createElement("strong");
	amount.className = "chart-detail-total";

	if (!selectedDay) {
		title.textContent = "Selecciona una barra";
		amount.textContent = formatCLP(0);
		const empty = document.createElement("p");
		empty.textContent =
			"Elige un día del gráfico para ver qué gastos forman ese total.";
		panel.append(title, amount, empty);
		return panel;
	}

	const matches = chartDayTransactions(selected, selectedDay, expenses);
	title.textContent = chartDetailTitle(selected, selectedDay);
	amount.textContent = formatCLP(sumAmounts(matches));
	panel.append(title, amount);

	if (matches.length === 0) {
		const empty = document.createElement("p");
		empty.textContent = "No hay gastos con monto conocido para este día.";
		panel.append(empty);
		return panel;
	}

	if (selected.mode === "month") {
		for (const group of groupTransactionsByDate(matches)) {
			const groupTitle = document.createElement("span");
			groupTitle.className = "chart-detail-date";
			groupTitle.textContent = group.label;
			panel.append(groupTitle, chartDetailList(group.items));
		}
		return panel;
	}

	panel.append(chartDetailList(matches));
	return panel;
}

function chartDayTransactions(selected, selectedDay, expenses) {
	const selectedMonth = selectedMonthDate();
	return expenses
		.filter((tx) => {
			const date = parseTransactionDate(tx.occurredAt);
			if (!date || !isSameMonth(date, selectedMonth)) return false;
			if (selected.mode === "month") {
				return `weekday-${weekdayIndex(date)}` === selectedDay.key;
			}
			return dateKey(date) === selectedDay.key;
		})
		.sort((a, b) =>
			String(a.occurredAt || "").localeCompare(String(b.occurredAt || "")),
		);
}

function chartDetailTitle(selected, selectedDay) {
	if (selected.mode === "month") {
		return `Detalle de ${longWeekday.format(selectedDay.date)} de ${selected.detail}`;
	}
	return `Detalle del ${longWeekday.format(selectedDay.date)} ${formatShortDate(selectedDay.date)}`;
}

function groupTransactionsByDate(transactions) {
	const groups = new Map();
	for (const tx of transactions) {
		const date = parseTransactionDate(tx.occurredAt);
		const key = dateKey(date);
		if (!groups.has(key)) {
			groups.set(key, { date, items: [] });
		}
		groups.get(key).items.push(tx);
	}
	return [...groups.values()].map((group) => ({
		label: `${longWeekday.format(group.date)} ${formatShortDate(group.date)}`,
		items: group.items,
	}));
}

function chartDetailList(transactions) {
	const list = document.createElement("ul");
	list.className = "chart-detail-list";
	for (const tx of transactions) {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.className = "chart-detail-item";
		button.setAttribute(
			"aria-label",
			`Ver detalle de ${tx.counterparty || tx.description || "movimiento"}, ${formatCLP(tx.amount)}`,
		);
		button.addEventListener("click", () => openModal(tx.id));

		const info = document.createElement("span");
		const name = document.createElement("strong");
		name.textContent = `${formatTime(tx.occurredAt)} · ${tx.counterparty || tx.description || "Sin contraparte"}`;
		const meta = document.createElement("small");
		meta.textContent = labelForKind(tx.kind);
		info.append(name, meta);
		const value = document.createElement("strong");
		value.textContent = formatCLP(tx.amount);
		button.append(info, value);
		item.append(button);
		list.append(item);
	}
	return list;
}

function renderChartTotalsGrid(series, selectedId) {
	const summary = document.createElement("aside");
	summary.className = "chart-summary";
	summary.setAttribute("aria-label", "Resumen de gastos del mes");

	const title = document.createElement("h4");
	title.textContent = "Resumen del mes";
	summary.append(title);

	for (const row of chartTotalsRows(series)) {
		const item = document.createElement("div");
		item.className = "chart-summary-row";
		if (row.id === selectedId) {
			item.classList.add("chart-summary-row-active");
			item.setAttribute("aria-current", "true");
			item.setAttribute(
				"aria-label",
				`${row.label} seleccionado: ${formatCLP(row.total)}`,
			);
		}

		const label = document.createElement("span");
		label.textContent = `${row.label}:`;
		const value = document.createElement("strong");
		value.textContent = formatCLP(row.total);
		item.append(label, value);
		summary.append(item);
	}

	return summary;
}

function chartTotalsRows(series) {
	const weekRows = series.weeks.map((week) => ({
		id: week.id,
		label: week.label,
		total: week.days.reduce(
			(sum, day) => sum + (day.isInMonthRange ? day.total : 0),
			0,
		),
	}));
	const monthTotal = weekRows.reduce((sum, row) => sum + row.total, 0);
	return [...weekRows, { id: "month", label: "Mes", total: monthTotal }];
}

function chartTabOptions(series) {
	return [
		...series.weeks.map((week) => ({ id: week.id, label: week.label })),
		{ id: "month", label: "Mes completo" },
	];
}

function selectedChartSeries(series) {
	const week = series.weeks.find((item) => item.id === state.chartTab);
	if (week) {
		return {
			id: week.id,
			mode: "week",
			days: week.days,
			detail: week.range,
			ariaLabel: `${week.label}, gasto diario de lunes a domingo`,
		};
	}
	return {
		id: "month",
		mode: "month",
		days: series.monthDays,
		detail: series.monthLabel,
		ariaLabel:
			"Mes completo, total gastado por cada día de la semana durante el mes",
	};
}

function startOfDay(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function minDate(a, b) {
	return a <= b ? a : b;
}

function maxDate(a, b) {
	return a >= b ? a : b;
}

function startOfWeek(date) {
	const normalized = startOfDay(date);
	const dayOfWeek = normalized.getDay();
	const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	return addDays(normalized, mondayOffset);
}

function addDays(date, days) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dateKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseTransactionDate(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function isSameMonth(date, reference) {
	return (
		date.getFullYear() === reference.getFullYear() &&
		date.getMonth() === reference.getMonth()
	);
}

function selectedMonthTransactions(transactions) {
	const selectedMonth = selectedMonthDate();
	return transactions.filter((tx) => {
		const date = parseTransactionDate(tx.occurredAt);
		return date && isSameMonth(date, selectedMonth);
	});
}

function selectedMonthExpenseTransactions(transactions) {
	return selectedMonthTransactions(transactions).filter(
		(tx) => tx.direction === "outflow",
	);
}

function weekdayIndex(date) {
	return (date.getDay() + 6) % 7;
}

function formatShortDate(date) {
	return new Intl.DateTimeFormat("es-CL", {
		day: "numeric",
		month: "short",
	}).format(date);
}

function monthName(date) {
	return new Intl.DateTimeFormat("es-CL", {
		month: "long",
		year: "numeric",
	}).format(date);
}

function selectedMonthLabel() {
	return monthName(selectedMonthDate());
}

function currentMonthKey() {
	return monthKey(new Date());
}

function selectedMonthDate() {
	const [year, month] = state.selectedMonth.split("-").map(Number);
	if (!year || !month) return startOfMonth(new Date());
	return new Date(year, month - 1, 1);
}

function startOfMonth(date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function hasKnownAmount(transaction) {
	return (
		transaction.amount !== null &&
		transaction.amount !== "" &&
		Number.isFinite(Number(transaction.amount))
	);
}

function sumAmounts(transactions) {
	return transactions.reduce((total, tx) => total + Number(tx.amount), 0);
}

function groupTotals(transactions, labelForTransaction) {
	const groups = new Map();
	for (const tx of transactions) {
		const label = labelForTransaction(tx) || "Sin clasificar";
		groups.set(label, (groups.get(label) || 0) + Number(tx.amount || 0));
	}
	return [...groups.entries()]
		.map(([label, total]) => ({ label, total }))
		.sort((a, b) => b.total - a.total);
}

function updateDonutHighlight(chart) {
	if (!chart) return;
	chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
	if (state.activeCategory) {
		chart.dispatchAction({
			type: "highlight",
			seriesIndex: 0,
			name: state.activeCategory,
		});
	}
}

function darkenColor(hex, amount = 25) {
	const num = parseInt(hex.replace("#", ""), 16);
	const r = Math.max(0, ((num >> 16) & 0xff) - amount);
	const g = Math.max(0, ((num >> 8) & 0xff) - amount);
	const b = Math.max(0, (num & 0xff) - amount);
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function renderCategoryDistribution(transactions) {
	const section = document.createElement("section");
	section.className = "category-distribution-card";

	const title = document.createElement("h3");
	title.textContent = "\u00bfD\u00f3nde se va tu dinero?";

	const copy = document.createElement("p");
	copy.textContent =
		"Agrupa tus gastos del periodo seg\u00fan la categor\u00eda asignada.";

	section.append(title, copy);

	const rows = buildCategoryBreakdown(transactions);

	if (!rows.length) {
		const empty = document.createElement("p");
		empty.className = "category-distribution-empty";
		empty.textContent =
			"A\u00fan no hay gastos con monto suficiente para distribuir por categor\u00eda.";
		section.append(empty);
		return section;
	}

	section.append(renderCategoryDistributionInsight(rows));

	const body = document.createElement("div");
	body.className = "category-distribution-body";

	const donutWrap = document.createElement("div");
	donutWrap.className = "category-donut-wrap";

	const donutDom = document.createElement("div");
	donutDom.style.width = "260px";
	donutDom.style.height = "260px";

	const total = rows.reduce((sum, row) => sum + row.total, 0);

	const chart = initChart(
		donutDom,
		{
			animation: true,
			animationDuration: 800,
			animationEasing: "cubicOut",
			tooltip: {
				trigger: "item",
				backgroundColor: "#0F172A",
				borderColor: "#334155",
				borderWidth: 1,
				padding: [10, 14],
				textStyle: {
					color: "#F8FAFC",
					fontFamily: "Plus Jakarta Sans, sans-serif",
					fontSize: 13,
				},
				formatter: (params) => {
					return `<strong style="font-size:14px">${params.name}</strong><br/>
						<span style="font-size:16px;font-weight:600">${formatCLP(params.value)}</span>
						<span style="opacity:0.6"> \u00b7 ${params.percent}%</span><br/>
						<span style="opacity:0.5;font-size:12px">${params.data.count} movimiento${params.data.count === 1 ? "" : "s"}</span>`;
				},
			},
			series: [
				{
					type: "pie",
					radius: ["48%", "74%"],
					center: ["50%", "50%"],
					avoidLabelOverlap: false,
					padAngle: 3,
					emphasis: {
						scale: true,
						scaleSize: 8,
						itemStyle: {
							shadowBlur: 20,
							shadowColor: "rgba(0,0,0,0.12)",
						},
					},
					label: { show: false },
					data: rows.map((r) => ({
						value: r.total,
						name: r.category,
						count: r.count,
						itemStyle: {
							color: r.color,
							borderColor: darkenColor(r.color, 30),
							borderWidth: 2,
							borderRadius: 6,
						},
					})),
				},
			],
			graphic: [
				{
					type: "text",
					left: "center",
					top: "40%",
					style: {
						text: "Total",
						fontSize: 12,
						fill: "#94A3B8",
						fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
						textAlign: "center",
					},
				},
				{
					type: "text",
					left: "center",
					top: "54%",
					style: {
						text: formatCLP(total),
						fontSize: 20,
						fill: "#0F172A",
						fontWeight: 700,
						fontFamily: "Plus Jakarta Sans, sans-serif",
						textAlign: "center",
					},
				},
			],
		},
		"category-donut",
	);

	chart.on("click", (params) => {
		if (state.activeCategory === params.name) {
			state.activeCategory = null;
		} else {
			state.activeCategory = params.name;
		}
		updateDonutHighlight(chart);
		renderCategoryDetail(legend, rows, transactions);
	});

	chart.getZr().on("click", (params) => {
		if (!params.target) {
			state.activeCategory = null;
			updateDonutHighlight(chart);
			renderCategoryDetail(legend, rows, transactions);
		}
	});

	donutWrap.append(donutDom);

	const legend = document.createElement("div");
	legend.className = "category-distribution-legend";
	renderCategoryDetail(legend, rows, transactions);

	body.append(donutWrap, legend);
	section.append(body);

	return section;
}

function highlightTableByCategory(category) {
	const rows = document.querySelectorAll(".transactions-table tbody tr");
	for (const row of rows) {
		const cell = row.querySelector('[data-field="category"]');
		if (cell && cell.textContent.trim() === category) {
			row.style.background = "var(--accent-soft)";
			row.style.borderLeftColor = "var(--accent)";
		} else {
			row.style.background = "";
			row.style.borderLeftColor = "";
		}
	}
}

function clearTableHighlight() {
	const rows = document.querySelectorAll(".transactions-table tbody tr");
	for (const row of rows) {
		row.style.background = "";
		row.style.borderLeftColor = "";
	}
}

function buildCategoryBreakdown(transactions) {
	const groups = new Map();
	const total = sumAmounts(transactions);
	for (const tx of transactions) {
		const category =
			normalizeCategoryName(tx.category || "") || "Sin categoría";
		const key = categoryKey(category);
		if (!groups.has(key)) {
			groups.set(key, {
				category,
				total: 0,
				count: 0,
			});
		}
		const group = groups.get(key);
		group.total += Number(tx.amount || 0);
		group.count += 1;
	}
	return [...groups.values()]
		.map((group) => ({
			...group,
			percent: total ? Math.round((group.total / total) * 100) : 0,
			color: categoryVisualColor(group.category),
		}))
		.sort((a, b) => b.total - a.total);
}

function renderCategoryLegendItem(row) {
	const item = document.createElement("article");
	item.className = "category-legend-item";
	item.style.setProperty("--category-color", row.color);
	item.title = `${row.category}: ${formatCLP(row.total)} · ${row.percent}% · ${row.count} movimientos`;

	const marker = document.createElement("span");
	marker.className = "category-legend-marker";
	marker.setAttribute("aria-hidden", "true");

	const name = document.createElement("strong");
	name.textContent = row.category;

	const detail = document.createElement("small");
	detail.textContent = `${formatCLP(row.total)} · ${row.percent}% · ${row.count} mov.`;

	item.append(marker, name, detail);
	return item;
}

function renderCategoryDetail(legendEl, rows, expenses) {
	legendEl.replaceChildren();

	if (!state.activeCategory) {
		for (const row of rows) {
			legendEl.append(renderCategoryLegendItem(row));
		}
		return;
	}

	const activeRow = rows.find(
		(row) => categoryKey(row.category) === categoryKey(state.activeCategory),
	);
	if (!activeRow) {
		state.activeCategory = null;
		for (const row of rows) {
			legendEl.append(renderCategoryLegendItem(row));
		}
		return;
	}

	const panel = document.createElement("div");
	panel.className = "category-detail-panel";

	const header = document.createElement("div");
	header.className = "category-detail-header";

	const marker = document.createElement("span");
	marker.className = "category-legend-marker";
	marker.style.setProperty("--category-color", activeRow.color);
	marker.setAttribute("aria-hidden", "true");

	const name = document.createElement("strong");
	name.textContent = activeRow.category;

	const detail = document.createElement("small");
	detail.textContent = `${formatCLP(activeRow.total)} · ${activeRow.percent}% · ${activeRow.count} movimiento${activeRow.count === 1 ? "" : "s"}`;

	header.append(marker, name, detail);

	const merchantList = document.createElement("div");
	merchantList.className = "category-detail-merchants";

	const activeCategoryKey = categoryKey(state.activeCategory);
	const groups = new Map();
	for (const tx of expenses) {
		const txCat = normalizeCategoryName(tx.category || "") || "Sin categoría";
		if (categoryKey(txCat) !== activeCategoryKey) continue;

		const displayName = tx.counterparty || "Sin contraparte";
		const key =
			tx.counterpartyKey ||
			normalizeCounterpartyForUI(tx.counterparty || displayName);
		if (!groups.has(key)) {
			groups.set(key, { displayName, total: 0, count: 0 });
		}
		const group = groups.get(key);
		group.total += Number(tx.amount || 0);
		group.count += 1;
	}

	const merchantRows = [...groups.values()].sort((a, b) => b.total - a.total);
	for (const mr of merchantRows) {
		const item = document.createElement("article");
		item.className = "category-detail-merchant";

		const mName = document.createElement("strong");
		mName.textContent = mr.displayName;

		const mDetail = document.createElement("small");
		mDetail.textContent = `${formatCLP(mr.total)} · ${mr.count} movimiento${mr.count === 1 ? "" : "s"}`;

		item.append(mName, mDetail);
		merchantList.append(item);
	}

	const back = document.createElement("button");
	back.type = "button";
	back.className = "category-detail-back";
	back.textContent = "← Todas las categorías";
	back.addEventListener("click", () => {
		state.activeCategory = null;
		updateDonutHighlight(chartInstances.get("category-donut"));
		renderCategoryDetail(legendEl, rows, expenses);
	});

	panel.append(header, merchantList, back);
	legendEl.append(panel);
}

function renderCategoryDistributionInsight(rows) {
	const insight = document.createElement("p");
	insight.className = "category-distribution-insight";

	const uncategorized = rows.find((row) => row.category === "Sin categoría");
	if (uncategorized && uncategorized.percent >= 10) {
		insight.textContent = `${formatCLP(uncategorized.total)} (${uncategorized.percent}%) aún está sin categoría. Clasificarlo mejora tu análisis.`;
		return insight;
	}

	const top = rows[0];
	if (top && top.percent >= 40) {
		insight.textContent = `${top.category} concentra el ${top.percent}% del gasto del periodo.`;
		return insight;
	}

	insight.textContent =
		"Tus gastos están distribuidos entre varias categorías.";
	return insight;
}

function renderCounterpartySpendSection(expenses, options = {}) {
	const { limit = null } = options;
	const section = document.createElement("section");
	section.className = "counterparty-spend-card";
	const title = document.createElement("h3");
	title.textContent = "Gasto por comercio";
	const copy = document.createElement("p");
	copy.textContent =
		"Agrupa gastos por comercio o contraparte para detectar dónde se concentra tu gasto y asignar categorías en bloque.";
	const allRows = buildCounterpartyRows(expenses);
	const rows = limit ? allRows.slice(0, limit) : allRows;
	const count = document.createElement("small");
	count.className = "counterparty-spend-count";
	count.textContent = `${rows.length} comercios · ${expenses.length} movimientos`;
	section.append(title, copy, count);
	if (!rows.length) {
		const empty = document.createElement("p");
		empty.className = "counterparty-spend-empty";
		empty.textContent =
			"Aún no hay gastos suficientes para agrupar por comercio.";
		section.append(empty);
		return section;
	}

	const list = document.createElement("div");
	list.className = "counterparty-spend-list";
	for (const row of rows) {
		const item = document.createElement("article");
		item.className = "counterparty-spend-row";
		const meta = document.createElement("div");
		const name = document.createElement("strong");
		name.textContent = row.displayName;
		const detail = document.createElement("small");
		detail.textContent = `${formatCLP(row.total)} · ${row.count} movimientos`;
		meta.append(name, detail);

		const categoryLabel = document.createElement("label");
		categoryLabel.className = "counterparty-category-label";
		categoryLabel.textContent = "Categoría";
		const select = document.createElement("select");
		select.className = "counterparty-category-select";
		for (const option of counterpartyCategoryOptions(expenses)) {
			const node = document.createElement("option");
			node.value = option.value;
			node.textContent = option.label;
			node.selected = option.value === (row.category || "");
			select.append(node);
		}
		select.addEventListener("change", async () => {
			if (select.value === CREATE_CATEGORY_VALUE) {
				select.value = row.category || "";
				openSettingsModal({ focusCategoryForm: true });
				return;
			}
			try {
				await saveCounterpartyCategoryRule(row, select.value);
			} catch (error) {
				console.error(error);
				await loadTransactions();
			}
		});
		categoryLabel.append(select);

		const detailButton = document.createElement("button");
		detailButton.type = "button";
		detailButton.className = "secondary counterparty-detail-button";
		detailButton.textContent = "Ver detalle";
		detailButton.addEventListener("click", () => {
			openCounterpartyDetailModal(row.counterpartyKey);
		});

		const actions = document.createElement("div");
		actions.className = "counterparty-actions";
		actions.append(categoryLabel, detailButton);

		item.append(meta, actions);
		list.append(item);
	}

	section.append(list);
	return section;
}

function buildCounterpartyRows(expenses) {
	const groups = new Map();
	for (const tx of expenses) {
		const displayName = tx.counterparty || "Sin contraparte";
		const key =
			tx.counterpartyKey ||
			normalizeCounterpartyForUI(tx.counterparty || displayName);
		if (!groups.has(key)) {
			groups.set(key, {
				counterpartyKey: key,
				displayName,
				total: 0,
				count: 0,
				category: tx.category || "",
			});
		}
		const row = groups.get(key);
		row.total += Number(tx.amount || 0);
		row.count += 1;
		if (!row.category && tx.category) row.category = tx.category;
	}
	return [...groups.values()].sort((a, b) => b.total - a.total);
}

function counterpartyCategoryOptions(expenses) {
	return categoryOptions(expenses);
}

function categoryOptions(transactions = state.transactions) {
	const catalog = mergeCategoryCatalog(state.categories || []);
	const fromData = transactions
		.map((tx) => String(tx.category || "").trim())
		.filter(Boolean);
	for (const value of fromData) {
		if (
			!catalog.some(
				(category) => categoryKey(category.name) === categoryKey(value),
			)
		) {
			catalog.push({ name: value, color: "#64748b", builtin: false });
		}
	}
	const sorted = [...catalog].sort((a, b) =>
		a.name.localeCompare(b.name, "es"),
	);
	return [
		{ value: "", label: "Sin categoría" },
		...sorted.map((category) => ({
			value: category.name,
			label: category.name,
		})),
		{ value: CREATE_CATEGORY_VALUE, label: "+ Crear categoría" },
	];
}

function mergeCategoryCatalog(categories = []) {
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

function defaultCategoryCatalog() {
	return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
}

function normalizeCategoryName(value) {
	return String(value || "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 40);
}

function normalizeCategoryColor(value) {
	const color = String(value || "").trim();
	return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#64748b";
}

function categoryKey(value) {
	return normalizeCounterpartyForUI(normalizeCategoryName(value));
}

function categoryColor(name) {
	if (!name) return "#64748b";
	const key = categoryKey(name);
	const found = mergeCategoryCatalog(state.categories || []).find(
		(category) => categoryKey(category.name) === key,
	);
	return found?.color || "#64748b";
}

function categoryVisualColor(category) {
	const normalized = normalizeCategoryName(category || "");
	if (!normalized || normalized === "Sin categoría") {
		return "#64748b";
	}
	return categoryColor(normalized);
}

function populateCategorySelect(select, selectedValue = "") {
	select.replaceChildren();
	for (const option of categoryOptions()) {
		const node = document.createElement("option");
		node.value = option.value;
		node.textContent = option.label;
		node.selected = option.value === selectedValue;
		select.append(node);
	}
}

async function saveCounterpartyCategoryRule(row, category) {
	const response = await fetch("/api/counterparty-rules", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			counterpartyKey: row.counterpartyKey,
			displayName: row.displayName,
			category,
		}),
	});
	const payload = await response.json();
	if (!response.ok) {
		throw new Error(payload.error || "No se pudo guardar la categoría");
	}
	state.transactions = state.transactions.map((tx) => {
		const key =
			tx.counterpartyKey ||
			normalizeCounterpartyForUI(tx.counterparty || "Sin contraparte");
		if (key !== row.counterpartyKey) return tx;
		return { ...tx, category: category || null };
	});
	render();
}

function openCounterpartyDetailModal(counterpartyKey) {
	state.activeCounterpartyDetailKey = counterpartyKey;
	const movements = selectedMonthExpenseTransactions(state.transactions)
		.filter((tx) => {
			const key =
				tx.counterpartyKey ||
				normalizeCounterpartyForUI(tx.counterparty || "Sin contraparte");
			return key === counterpartyKey && hasKnownAmount(tx);
		})
		.sort((a, b) =>
			String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")),
		);

	if (!movements.length) return;
	const displayName = movements[0].counterparty || "Sin contraparte";
	const total = sumAmounts(movements);
	counterpartyDetailTitle.textContent = `Gastos en ${displayName}`;
	counterpartyDetailSummary.textContent = `${formatCLP(total)} · ${movements.length} movimientos · ${selectedMonthLabel()}`;
	counterpartyDetailList.replaceChildren();
	for (const movement of movements) {
		counterpartyDetailList.append(renderCounterpartyDetailItem(movement));
	}
	counterpartyDetailModal.showModal();
}

function renderCounterpartyDetailItem(transaction) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "counterparty-detail-item";
	button.setAttribute(
		"aria-label",
		`Ver o editar ${transaction.counterparty || transaction.description || "movimiento"} por ${formatCLP(transaction.amount)}`,
	);

	const info = document.createElement("span");
	info.className = "counterparty-detail-main";
	const detailName = transaction.description || transaction.counterparty;
	info.textContent = `${formatDate(transaction.occurredAt)} · ${formatTime(transaction.occurredAt)} · ${labelForKind(transaction.kind)}${detailName ? ` · ${detailName}` : ""}`;

	const amount = document.createElement("strong");
	amount.className = "counterparty-detail-amount";
	amount.textContent = formatCLP(transaction.amount);

	button.append(info, amount);
	button.addEventListener("click", () => {
		state.returnToCounterpartyKey = state.activeCounterpartyDetailKey;
		closeCounterpartyDetailModal();
		openModal(transaction.id);
	});
	return button;
}

function closeCounterpartyDetailModal() {
	counterpartyDetailModal.close();
	state.activeCounterpartyDetailKey = null;
}

function normalizeCounterpartyForUI(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

function topGroup(transactions, labelForTransaction) {
	return (
		groupTotals(transactions, labelForTransaction)[0] || {
			label: "—",
			total: 0,
		}
	);
}

function metricCard(label, value, detail) {
	const card = document.createElement("article");
	card.className = "metric-card";
	const labelEl = document.createElement("span");
	labelEl.textContent = label;
	const valueEl = document.createElement("strong");
	valueEl.textContent = value;
	const detailEl = document.createElement("small");
	detailEl.textContent = detail;
	card.append(labelEl, valueEl, detailEl);
	return card;
}

function insightCard(label, value, detail) {
	const card = document.createElement("article");
	card.className = "insight-card";
	const labelEl = document.createElement("span");
	labelEl.textContent = label;
	const valueEl = document.createElement("strong");
	valueEl.textContent = value;
	const detailEl = document.createElement("small");
	detailEl.textContent = detail;
	card.append(labelEl, valueEl, detailEl);
	return card;
}

function breakdownRow(label, amount, total) {
	const row = document.createElement("div");
	row.className = "breakdown-row";
	const header = document.createElement("div");
	const name = document.createElement("span");
	name.textContent = label;
	const value = document.createElement("strong");
	value.textContent = formatCLP(amount);
	header.append(name, value);
	const track = document.createElement("div");
	track.className = "breakdown-track";
	const fill = document.createElement("div");
	fill.className = "breakdown-fill";
	fill.style.width = `${Math.round((amount / Math.max(total, 1)) * 100)}%`;
	track.append(fill);
	row.append(header, track);
	return row;
}

function labelForKind(kind) {
	const labels = {
		purchase: "Compras",
		transfer: "Transferencias",
		payment: "Pagos",
		income: "Abonos",
		unknown: "Sin clasificar",
	};
	return labels[kind] || "Sin clasificar";
}

function renderTableHead() {
	const thead = document.createElement("thead");
	const row = document.createElement("tr");
	const columns = [
		{ key: "date", label: "Fecha", sortable: true },
		{ key: "amount", label: "Monto", sortable: true },
		{ key: "counterparty", label: "Contraparte", sortable: true },
		{ key: "category", label: "Categoría", sortable: true },
		{ key: null, label: "", sortable: false },
	];
	for (const col of columns) {
		const th = document.createElement("th");
		th.scope = "col";
		if (!col.sortable) {
			th.textContent = col.label;
			row.append(th);
			continue;
		}

		const button = document.createElement("button");
		button.type = "button";
		button.className = "sort-button";
		const indicator = sortIndicator(col.key);
		button.textContent = `${col.label} ${indicator}`;
		button.setAttribute("aria-label", `Ordenar por ${col.label}`);
		if (state.sortKey === col.key) {
			th.classList.add("sort-active");
			th.setAttribute(
				"aria-sort",
				state.sortDir === "asc" ? "ascending" : "descending",
			);
		} else {
			th.setAttribute("aria-sort", "none");
		}
		button.addEventListener("click", () => cycleSort(col.key));
		th.append(button);
		row.append(th);
	}
	thead.append(row);
	return thead;
}

function sortIndicator(key) {
	if (state.sortKey !== key) return "▬";
	return state.sortDir === "asc" ? "▲" : "▼";
}

function cycleSort(key) {
	if (state.sortKey === key) {
		if (state.sortDir === "asc") {
			state.sortDir = "desc";
		} else if (state.sortDir === "desc") {
			state.sortKey = null;
			state.sortDir = null;
		}
	} else {
		state.sortKey = key;
		state.sortDir = "asc";
	}
	render();
}

function renderTableBody(sorted) {
	const tbody = document.createElement("tbody");
	for (const transaction of sorted) {
		tbody.append(renderTransactionRow(transaction));
	}
	return tbody;
}

function renderTableSummary(transactions) {
	const expenses = transactions.filter(
		(tx) => tx.direction === "outflow" && hasKnownAmount(tx),
	);
	const incomes = transactions.filter(
		(tx) => tx.direction === "inflow" && hasKnownAmount(tx),
	);
	const total = sumAmounts(expenses);
	const incomeTotal = sumAmounts(incomes);
	const pending = transactions.filter(
		(tx) => tx.status === "needs_review",
	).length;
	const box = document.createElement("div");
	box.className = "table-summary";
	const label = document.createElement("span");
	label.textContent = `Movimientos de ${selectedMonthLabel()}`;
	const value = document.createElement("strong");
	value.textContent = formatCLP(total);
	const detail = document.createElement("small");
	detail.textContent = `${expenses.length} salidas · ${incomes.length} ingresos${incomeTotal ? ` (${formatCLP(incomeTotal)})` : ""}${pending ? ` · ${pending} por revisar` : ""}`;
	box.append(label, value, detail);
	return box;
}

function computeHeroKpiData(knownExpenses, allMonthTransactions) {
	const totalSpent = sumAmounts(knownExpenses);
	const visibleIncomeCount = (allMonthTransactions || []).filter(
		(tx) => tx.direction === "inflow" && hasKnownAmount(tx),
	).length;
	const budgetIncome = state.budgetEnabled
		? confirmedBudgetIncome()
		: { amount: null, reason: "" };
	const income = budgetIncome.amount ?? 0;
	const incomeDetail =
		budgetIncome.amount !== null
			? budgetIncome.reason || "Del presupuesto"
			: visibleIncomeCount > 0
				? `${visibleIncomeCount} ingreso${visibleIncomeCount === 1 ? "" : "s"} en tabla; no usado para presupuesto`
				: "Activa presupuesto para calcular";

	const remaining = income - totalSpent;
	const remainingPercent =
		income > 0 ? Math.round((remaining / income) * 100) : 0;

	const today = new Date();
	const daysInMonth = new Date(
		today.getFullYear(),
		today.getMonth() + 1,
		0,
	).getDate();
	const daysRemaining = Math.max(0, daysInMonth - today.getDate());

	return [
		{
			key: "expense",
			label: "Total gastado",
			value: formatCLP(totalSpent),
			detail: `${knownExpenses.length} transacciones`,
		},
		{
			key: "income",
			label: "Ingreso presupuesto",
			value: income > 0 ? formatCLP(income) : "\u2014",
			detail: incomeDetail,
		},
		{
			key: "remaining",
			label: "Saldo restante",
			value:
				income > 0
					? remaining >= 0
						? formatCLP(remaining)
						: `-${formatCLP(Math.abs(remaining))}`
					: "\u2014",
			detail:
				income > 0
					? `${remainingPercent}% disponible`
					: "No se calcula sin presupuesto",
		},
		{
			key: "days",
			label: "D\u00edas restantes",
			value: String(daysRemaining),
			detail: `de ${daysInMonth} d\u00edas`,
		},
	];
}

function renderHeroKpis(knownExpenses, allMonthTransactions) {
	const container = document.getElementById("heroKpis");
	if (!container) return;
	container.replaceChildren();

	const kpis = computeHeroKpiData(knownExpenses, allMonthTransactions);

	for (const kpi of kpis) {
		const card = document.createElement("div");
		card.className = "kp-card";
		card.dataset.kpi = kpi.key;
		const inner = document.createElement("div");
		inner.className = "kp-card-inner";
		const label = document.createElement("span");
		label.className = "metric-label";
		label.textContent = kpi.label;
		const value = document.createElement("strong");
		value.className = "metric-value";
		value.textContent = kpi.value;
		const detail = document.createElement("small");
		detail.className = "metric-detail";
		detail.textContent = kpi.detail;
		inner.append(label, value, detail);
		card.append(inner);
		container.append(card);
	}
}

function updateHeroKpis() {
	const container = document.getElementById("heroKpis");
	if (!container || !container.children.length) return;

	const allMonthTransactions = selectedMonthTransactions(state.transactions);
	const knownExpenses = allMonthTransactions
		.filter((tx) => tx.direction === "outflow")
		.filter(hasKnownAmount);
	const kpis = computeHeroKpiData(knownExpenses, allMonthTransactions);

	for (const kpi of kpis) {
		const card = container.querySelector(`[data-kpi="${kpi.key}"]`);
		if (!card) continue;
		card.querySelector(".metric-value").textContent = kpi.value;
		card.querySelector(".metric-detail").textContent = kpi.detail;
	}
}

function renderSyncingSummary() {
	if (!summaryEl) return;
	summaryEl.replaceChildren();
	const label = document.createElement("span");
	label.textContent = "Sincronizando Gmail";
	const amount = document.createElement("strong");
	amount.textContent = "Procesando...";
	const detail = document.createElement("small");
	detail.textContent = `Los totales de ${selectedMonthLabel()} aparecerán cuando termine la sincronización.`;
	summaryEl.append(label, amount, detail);
}

function renderSummary(transactions) {
	if (!summaryEl) return;
	const outflows = transactions.filter(
		(tx) => tx.direction === "outflow" && hasKnownAmount(tx),
	);
	const inflows = transactions.filter(
		(tx) => tx.direction === "inflow" && hasKnownAmount(tx),
	);
	const outflow = sumAmounts(outflows);
	const pending = transactions.filter(
		(tx) => tx.status === "needs_review",
	).length;
	summaryEl.replaceChildren();
	const label = document.createElement("span");
	label.textContent = `En salidas de ${selectedMonthLabel()}`;
	const amount = document.createElement("strong");
	amount.textContent = currency.format(outflow);
	const detail = document.createElement("small");
	detail.textContent = `${transactions.length} movimientos · ${inflows.length} ingresos visibles${pending ? ` · ${pending} por revisar` : ""}`;
	summaryEl.append(label, amount, detail);
}

function renderTransactionRow(transaction) {
	const row = rowTemplate.content.firstElementChild.cloneNode(true);

	row.querySelector('[data-field="date"]').textContent = formatDate(
		transaction.occurredAt,
	);
	const amountCell = row.querySelector('[data-field="amount"]');
	amountCell.textContent = formatCLP(transaction.amount);
	if (transaction.direction === "outflow") {
		amountCell.classList.add("is-outflow");
	} else if (transaction.direction === "inflow") {
		amountCell.classList.add("is-inflow");
	}
	row.querySelector('[data-field="counterparty"]').textContent =
		transaction.counterparty || "—";
	row.querySelector('[data-field="counterparty"]').title =
		transaction.counterparty || "";
	row
		.querySelector('[data-field="category"]')
		.replaceChildren(renderCategoryBadge(transaction));
	row
		.querySelector('[data-action="view"]')
		.addEventListener("click", () => openModal(transaction.id));

	return row;
}

function renderCategoryBadge(transaction) {
	const category = normalizeCategoryName(transaction.category || "");
	const badge = document.createElement("button");
	badge.type = "button";
	badge.className = "category-badge";
	badge.textContent = category || "+ Categoría";
	if (!category) {
		badge.classList.add("category-badge-empty");
	} else {
		badge.style.setProperty("--category-color", categoryVisualColor(category));
	}
	badge.addEventListener("click", () => openModal(transaction.id));
	return badge;
}

function formatDate(iso) {
	if (!iso) return "—";
	try {
		return dateFormatter.format(new Date(iso));
	} catch {
		return iso.slice(0, 10);
	}
}

function formatTime(iso) {
	if (!iso) return "--:--";
	try {
		return timeFormatter.format(new Date(iso));
	} catch {
		return String(iso).slice(11, 16) || "--:--";
	}
}

function openModal(id) {
	const transaction = state.transactions.find((tx) => tx.id === id);
	if (!transaction) return;
	state.activeId = id;

	modalOccurredAt.value = toDatetimeLocal(transaction.occurredAt);
	modalAmount.value = formatCLP(transaction.amount);
	modalKind.value = transaction.kind || "unknown";
	modalDirection.value = transaction.direction || "outflow";
	populateCategorySelect(modalCategory, transaction.category || "");
	modalCounterparty.value = transaction.counterparty || "";
	modalDescription.value = transaction.description || "";
	modalStatus.textContent = statusLabel(transaction);
	modalStatus.title = `${transaction.source} · confianza ${Math.round((transaction.confidence || 0) * 100)}%`;
	modalBackToCounterparty.hidden = !state.returnToCounterpartyKey;

	modal.showModal();
}

function closeModal(options = {}) {
	state.activeId = null;
	modal.close();
	if (!options.preserveCounterpartyReturn) {
		state.returnToCounterpartyKey = null;
	}
	modalBackToCounterparty.hidden = true;
}

async function saveFromModal() {
	if (!state.activeId) return;
	modalStatus.textContent = "Guardando...";

	const patch = {
		occurredAt: fromDatetimeLocal(modalOccurredAt.value),
		amount: parseCLP(modalAmount.value),
		kind: modalKind.value,
		direction: modalDirection.value,
		category: modalCategory.value,
		counterparty: modalCounterparty.value,
		description: modalDescription.value,
		status:
			(state.transactions.find((tx) => tx.id === state.activeId) || {})
				.status === "manual"
				? "manual"
				: "edited",
	};

	try {
		const params = new URLSearchParams({ month: state.selectedMonth });
		const response = await fetch(
			`/api/transactions/${encodeURIComponent(state.activeId)}?${params}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...patch,
					month: state.selectedMonth,
					payTiming: state.budget.payTiming,
				}),
			},
		);
		if (!response.ok) {
			modalStatus.textContent = "No se pudo guardar.";
			return;
		}
		modalStatus.textContent = "Guardado ✓";
		const returnKey = state.returnToCounterpartyKey;
		await loadTransactions();
		closeModal({ preserveCounterpartyReturn: Boolean(returnKey) });
		if (returnKey) {
			state.returnToCounterpartyKey = null;
			openCounterpartyDetailModal(returnKey);
		}
	} catch (error) {
		modalStatus.textContent = `Error: ${error.message}`;
	}
}

function backToCounterpartyDetail() {
	const returnKey = state.returnToCounterpartyKey;
	closeModal({ preserveCounterpartyReturn: true });
	state.returnToCounterpartyKey = null;
	if (returnKey) {
		openCounterpartyDetailModal(returnKey);
	}
}

async function deleteFromModal() {
	if (!state.activeId) return;
	const transaction = state.transactions.find((tx) => tx.id === state.activeId);
	const name =
		(transaction && transaction.counterparty) ||
		(transaction && transaction.description) ||
		"este gasto";
	if (!confirm(`¿Eliminar ${name}?`)) return;

	try {
		const params = new URLSearchParams({ month: state.selectedMonth });
		const response = await fetch(
			`/api/transactions/${encodeURIComponent(state.activeId)}?${params}`,
			{
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					month: state.selectedMonth,
					payTiming: state.budget.payTiming,
				}),
			},
		);
		if (!response.ok) {
			modalStatus.textContent = "No se pudo eliminar.";
			return;
		}
		await loadTransactions();
		closeModal();
	} catch (error) {
		modalStatus.textContent = `Error: ${error.message}`;
	}
}

function startGmailSyncProgress() {
	state.isGmailSyncing = true;
	syncGmailButton.disabled = true;
	gmailSyncProgress.hidden = false;
	gmailSyncProgressFill.style.width = "8%";
	showGmailSyncMessage();

	let progress = 8;
	const timer = setInterval(() => {
		progress = Math.min(progress + (progress < 70 ? 12 : 4), 92);
		gmailSyncProgressFill.style.width = `${progress}%`;
	}, 220);
	window.__gmailSyncTimer = timer;
}

function stopGmailSyncProgress() {
	if (window.__gmailSyncTimer) {
		clearInterval(window.__gmailSyncTimer);
		window.__gmailSyncTimer = null;
	}
	gmailSyncProgressFill.style.width = "100%";
	return new Promise((resolve) => {
		setTimeout(() => {
			gmailSyncProgressFill.style.width = "8%";
			gmailSyncProgress.hidden = true;
			state.isGmailSyncing = false;
			syncGmailButton.disabled = syncGmailButton.hidden;
			resolve();
		}, 250);
	});
}

function openNewExpenseModal() {
	newOccurredAt.value = toDatetimeLocal(defaultDateTimeForSelectedMonth());
	newAmount.value = "";
	newKind.value = "purchase";
	newDirection.value = "outflow";
	newCategory.value = "";
	newCounterparty.value = "";
	newDescription.value = "";
	newFormStatus.textContent = "";
	newExpenseModal.showModal();
}

function closeNewExpenseModal() {
	newExpenseModal.close();
}

function statusLabel(transaction) {
	if (transaction.status === "manual") return "Manual";
	if (transaction.status === "needs_review") return "Revisar";
	if (transaction.status === "edited") return "Editado";
	if (transaction.source === "gmail_banco_chile") return "Gmail";
	return "Detectado";
}

function defaultDateTimeForSelectedMonth() {
	const now = new Date();
	const selected = selectedMonthDate();
	const lastDay = new Date(
		selected.getFullYear(),
		selected.getMonth() + 1,
		0,
	).getDate();
	return new Date(
		selected.getFullYear(),
		selected.getMonth(),
		Math.min(now.getDate(), lastDay),
		now.getHours(),
		now.getMinutes(),
	);
}

function toDatetimeLocal(value) {
	if (!value) return "";
	if (value instanceof Date) {
		return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
	}
	return String(value).slice(0, 16);
}

function fromDatetimeLocal(value) {
	return value ? `${value}:00` : null;
}
