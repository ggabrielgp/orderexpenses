import {
	beginAsync,
	createAsyncState,
	invalidateAsync,
	isCurrentAsync,
	settleAsync,
} from "./async-state-coordinator.js";
import {
	CREATE_CATEGORY_VALUE,
	DEFAULT_CATEGORIES,
	categoryKey,
	defaultCategoryCatalog,
	mergeCategoryCatalog,
	normalizeCategoryColor,
	normalizeCategoryName,
	normalizeCounterpartyForUI,
} from "./category-catalog.js";
import {
	FINANCE_PREFERENCE_KEYS,
	parseFinancePreferences,
	readFinancePreferences,
	resetAllFinancePreferences,
	resetFinancePreferenceMonth,
	updateFinancePreferences,
} from "./finance-preferences.js";
import {
	buildReconciliation,
	calculateFinancialPosition,
	isCountedExpense,
	legacyConfirmationId,
	resolveConfirmedIncome,
	summarizeMovements,
} from "./financial-semantics.js";

const echarts = window.echarts;

const BUDGET_STORAGE_KEY = FINANCE_PREFERENCE_KEYS.budget;
const VIEW_PREFERENCES_STORAGE_KEY = FINANCE_PREFERENCE_KEYS.view;

// Modo demo: cargar datos ficticios sin backend solo si se pide explícitamente.
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
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

let financePreferenceNotice = "";
const initialBudgetRead = readLocalValue(BUDGET_STORAGE_KEY);
let financePreferenceSession = parseFinancePreferences(
	initialBudgetRead.ok ? initialBudgetRead.value : null,
	{ currentMonth: currentMonthKey() },
);
if (!initialBudgetRead.ok) {
	financePreferenceNotice =
		"El almacenamiento local no está disponible. Tus cambios durarán solo esta sesión.";
} else if (["invalid", "unsupported"].includes(financePreferenceSession.kind)) {
	financePreferenceNotice =
		"Las preferencias guardadas no son compatibles. Puedes ingresar valores nuevos o restablecerlas.";
}
const viewPreferences = loadViewPreferences();

const state = {
	transactions: [],
	activeId: null,
	sortKey: null,
	sortDir: null,
	view: "dashboard",
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
	selectedTransactionIds: new Set(),
	pendingCounterpartySelection: null,
	bulkCategory: "",
	bulkStatus: "",
	isBulkAssigning: false,
};

let asyncOwnership = createAsyncState();
let refreshButtonOwner = null;
let gmailSyncProgressOwner = null;
let gmailSyncTimer = null;
let gmailSyncFinishTimer = null;
let gmailSyncFinishResolve = null;

function beginOwnedAsync(channel, context) {
	const started = beginAsync(asyncOwnership, channel, context);
	asyncOwnership = started.state;
	return started.invocation;
}

function invalidateOwnedAsync(channel) {
	const invalidated = invalidateAsync(asyncOwnership, channel);
	asyncOwnership = invalidated.state;
	return invalidated.invalidatedInvocation;
}

function isCurrentOwner(invocation) {
	return isCurrentAsync(asyncOwnership, invocation);
}

function settleOwnedAsync(invocation) {
	asyncOwnership = settleAsync(asyncOwnership, invocation);
}

function beginTransactionReplacement(context) {
	const invocation = beginOwnedAsync("transactions", context);
	refreshButtonOwner = invocation;
	refreshButton.disabled = true;
	return invocation;
}

function invalidateTransactionReplacement() {
	const invocation = invalidateOwnedAsync("transactions");
	releaseRefreshButton(invocation);
	return invocation;
}

function releaseRefreshButton(invocation) {
	if (refreshButtonOwner !== invocation) return;
	refreshButtonOwner = null;
	refreshButton.disabled = false;
}

function isCurrentCandidate(invocation) {
	const context = invocation.context;
	return (
		isCurrentOwner(invocation) &&
		state.selectedMonth === context.month &&
		(state.budget.payTiming || "varies") === context.payTiming &&
		Boolean(state.budget.autoDetectIncome) === context.autoDetectIncome
	);
}

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
await Promise.all([loadGmailStatus(), loadProfile()]);
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
	window.location.assign("/auth/google");
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
		state.categories = mergeCategoryCatalog(
			state.categories.concat([payload.category]),
		);
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
		const deletedKey = categoryKey(name);
		state.categories = mergeCategoryCatalog(
			state.categories.filter((c) => categoryKey(c.name) !== deletedKey),
		);
		renderCategorySettings();
		render();
	} catch (error) {
		categoryFormStatus.textContent = `Error: ${error.message}`;
	}
}

async function loadGmailStatus(options = {}) {
	const isCurrent = options.isCurrent || (() => true);
	try {
		let status;
		if (DEMO_MODE) {
			status = mockApiResponse("/api/gmail/status");
		} else {
			const response = await fetch("/api/gmail/status");
			status = await response.json();
		}
		if (!isCurrent()) return false;
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
			return true;
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
		return true;
	} catch (error) {
		if (!isCurrent()) return false;
		updatePageTitle(false);
		if (!options.preserveMessage) {
			gmailStatus.textContent = `Error revisando Gmail: ${error.message}`;
		}
		return false;
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
		const oldSync = invalidateOwnedAsync("sync");
		resetGmailSyncProgress(oldSync);
		await loadProfile();
		await Promise.all([loadCategories(), loadGmailStatus()]);
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
	const context = {
		month: state.selectedMonth,
		payTiming: state.budget.payTiming || "varies",
	};
	const priorSync = invalidateOwnedAsync("sync");
	resetGmailSyncProgress(priorSync);
	const syncOwner = beginOwnedAsync("sync", context);
	const transactionOwner = beginTransactionReplacement({
		month: context.month,
	});
	startGmailSyncProgress(syncOwner);
	gmailStatus.textContent = `Buscando gastos de ${selectedMonthLabel()} en Gmail...`;
	try {
		const response = await fetch("/api/gmail/sync", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ limit: 200, ...context }),
		});
		const payload = await response.json();
		if (!response.ok)
			throw new Error(payload.error || "Error sincronizando Gmail");
		if (!isCurrentOwner(syncOwner)) return;
		gmailStatus.textContent = `Sincronizaci\u00f3n lista: ${payload.scanned} mensajes de ${selectedMonthLabel()} procesados.`;
		if (isCurrentOwner(transactionOwner)) {
			state.transactions = payload.transactions || [];
			await loadIncomeCandidates({ renderAfter: false });
		}
	} catch (error) {
		if (!isCurrentOwner(syncOwner)) return;
		gmailStatus.textContent = `Error sincronizando Gmail: ${error.message}`;
	} finally {
		if (!isCurrentOwner(syncOwner)) return;
		await stopGmailSyncProgress(syncOwner);
		if (!isCurrentOwner(syncOwner)) return;
		await loadGmailStatus({
			preserveMessage: true,
			isCurrent: () => isCurrentOwner(syncOwner),
		});
		if (!isCurrentOwner(syncOwner)) return;
		const ownsTransactions = isCurrentOwner(transactionOwner);
		if (ownsTransactions) {
			settleOwnedAsync(transactionOwner);
			releaseRefreshButton(transactionOwner);
			render();
		}
		settleOwnedAsync(syncOwner);
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

		invalidateTransactionReplacement();
		state.transactions.push(payload.transaction);
		closeNewExpenseModal();
		render();
	} catch (error) {
		newFormStatus.textContent = `Error: ${error.message}`;
	}
}

async function loadIncomeCandidates({ renderAfter = true } = {}) {
	const context = {
		month: state.selectedMonth,
		payTiming: state.budget.payTiming || "varies",
		autoDetectIncome: Boolean(state.budget.autoDetectIncome),
	};
	if (!context.autoDetectIncome) {
		invalidateOwnedAsync("candidates");
		state.incomeCandidates = [];
		if (renderAfter) render();
		return false;
	}
	const invocation = beginOwnedAsync("candidates", context);
	let payload;
	try {
		if (DEMO_MODE) {
			payload = mockApiResponse("/api/income-candidates", context);
		} else {
			const params = new URLSearchParams({
				month: context.month,
				payTiming: context.payTiming,
			});
			const response = await fetch(`/api/income-candidates?${params}`);
			payload = await response.json();
			if (!response.ok)
				throw new Error(payload.error || "Error cargando ingresos detectados");
		}
		if (!isCurrentCandidate(invocation)) return false;
		state.incomeCandidates = payload.candidates || [];
	} catch {
		if (!isCurrentCandidate(invocation)) return false;
		state.incomeCandidates = [];
	}
	if (!isCurrentCandidate(invocation)) return false;
	settleOwnedAsync(invocation);
	if (renderAfter) render();
	return true;
}

async function loadTransactions({ invocation = null } = {}) {
	const owner =
		invocation ||
		beginTransactionReplacement({ month: state.selectedMonth });
	if (!isCurrentOwner(owner)) return false;
	if (state.isGmailSyncing) {
		showGmailSyncMessage();
	} else {
		showTableMessage("Cargando gastos...");
	}
	try {
		let payload;
		if (DEMO_MODE) {
			await loadDemoData();
			payload = mockApiResponse("/api/transactions", owner.context);
		} else {
			const params = new URLSearchParams({ month: owner.context.month });
			const response = await fetch(`/api/transactions?${params}`);
			payload = await response.json();
			if (!response.ok)
				throw new Error(payload.error || "Error cargando gastos");
		}
		if (!isCurrentOwner(owner)) return false;
		state.transactions = payload.transactions || [];
		pruneSelectedTransactions();
		await loadIncomeCandidates({ renderAfter: false });
		if (isCurrentOwner(owner)) render();
		return true;
	} catch (error) {
		if (!isCurrentOwner(owner)) return false;
		showTableMessage(`No se pudieron cargar los gastos. ${error.message}`, {
			actionLabel: "Reintentar",
			onAction: loadTransactions,
		});
		return false;
	} finally {
		if (isCurrentOwner(owner)) {
			settleOwnedAsync(owner);
			releaseRefreshButton(owner);
		}
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
	const oldSync = invalidateOwnedAsync("sync");
	resetGmailSyncProgress(oldSync);
	invalidateOwnedAsync("candidates");
	invalidateTransactionReplacement();
	state.selectedMonth = monthSelect.value;
	state.budget = loadBudgetPreferences(state.selectedMonth);
	state.incomeCandidates = [];
	state.chartTab = "month";
	state.chartDayKey = null;
	const transactionOwner = beginTransactionReplacement({
		month: state.selectedMonth,
	});
	await loadGmailStatus({
		isCurrent: () => isCurrentOwner(transactionOwner),
	});
	if (isCurrentOwner(transactionOwner)) {
		await loadTransactions({ invocation: transactionOwner });
	}
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

	if (prefersReducedMotion()) {
		outgoing.hidden = true;
		state.view = view;
		render();
		incoming.hidden = false;
		return;
	}

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
	if (prefersReducedMotion()) return;

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

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
	renderHeroKpis(visibleExpenses.filter(isCountedExpense), allMonthTransactions);
	dashboardEl.hidden = state.view !== "dashboard";
	transactionsEl.hidden = state.view !== "table";
	budgetPanelEl?.replaceChildren();
	dashboardEl.replaceChildren();
	transactionsEl.replaceChildren();

	if (state.isGmailSyncing) {
		renderSyncingSummary();
		showGmailSyncMessage();
		return;
	}

	renderSummary(allMonthTransactions);

	if (allMonthTransactions.length === 0) {
		const empty = createEmptyState(
			`Todavía no hay gastos en ${selectedMonthLabel()}`,
			"Sincroniza Gmail o agrega un gasto manual para este periodo para empezar a ver el resumen.",
			{ actionLabel: "Agregar gasto", onAction: openNewExpenseModal },
		);
		if (state.view === "dashboard") {
			dashboardEl.append(empty);
		} else {
			transactionsEl.append(empty);
		}
		return;
	}

	if (state.view === "dashboard") {
		renderDashboard(visibleExpenses, allMonthTransactions);
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
	const sorted = sortTransactions(transactions);
	pruneSelectedTransactions(sorted);
	const tableSummary = renderTableSummary(sorted);
	const bulkBar = renderBulkCategoryBar(sorted);
	const counterpartyPrompt = renderCounterpartySelectionPrompt(sorted);
	const tableFeedback = renderTableFeedback();
	const tableScroll = document.createElement("div");
	tableScroll.className = "transactions-table-scroll";
	const table = document.createElement("table");
	table.className = "transactions-table";
	table.append(renderTableHead(sorted), renderTableBody(sorted));
	tableScroll.append(table);
	transactionsEl.append(
		tableSummary,
		bulkBar,
		counterpartyPrompt,
		tableFeedback,
		tableScroll,
	);
}

function updateChartOnly() {
	const existingChart = dashboardEl.querySelector(".chart-card");
	if (!existingChart) return;
	const transactions = selectedMonthExpenseTransactions(state.transactions);
	const knownExpenses = transactions.filter(isCountedExpense);
	const dailySpending = buildMonthlyDailySpending(knownExpenses);
	const newChart = renderMonthlyDailyChart(dailySpending, knownExpenses);
	existingChart.replaceWith(newChart);
}

function renderDashboard(transactions, allMonthTransactions) {
	const expenses = transactions.filter((tx) => tx.direction === "outflow");
	const knownExpenses = expenses.filter(isCountedExpense);
	const unknownExpenseCount = expenses.length - knownExpenses.length;
	const totalSpent = summarizeMovements(expenses).expenseTotal;
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
		(tx) => tx.counterparty || "Sin comercio o persona",
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

	const monthStory = renderMonthStoryCard(transactions, knownExpenses, {
		totalSpent,
		averageExpense,
		unknownExpenseCount,
		topCategory,
		topCounterparty,
		largestExpense,
	});
	const budgetToggle = renderBudgetToggle();
	const budgetCard = state.budgetEnabled
		? renderBudgetCard(allMonthTransactions)
		: null;
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
		monthStory,
		budgetToggle,
		...(budgetCard ? [budgetCard] : []),
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

function renderMonthStoryCard(transactions, knownExpenses, context) {
	const card = document.createElement("section");
	card.className = "month-story-card";

	const header = document.createElement("div");
	header.className = "month-story-header";
	const kicker = document.createElement("span");
	kicker.textContent = "Lectura simple";
	const title = document.createElement("h3");
	title.textContent = "Qué pasó este mes";
	const copy = document.createElement("p");
	copy.textContent = monthStorySummary(knownExpenses, context);
	header.append(kicker, title, copy);

	const list = document.createElement("ul");
	list.className = "month-story-list";
	for (const item of buildMonthStoryItems(
		transactions,
		knownExpenses,
		context,
	)) {
		const row = document.createElement("li");
		row.textContent = item;
		list.append(row);
	}

	card.append(
		header,
		list,
		renderNextBestAction(transactions, knownExpenses, context),
	);
	return card;
}

function monthStorySummary(knownExpenses, context) {
	if (knownExpenses.length === 0) {
		return "Todavía no hay suficiente información para contarte el mes.";
	}
	const topLabel =
		context.topCategory.label !== "—"
			? context.topCategory.label
			: "varias categorías";
	return `Llevas ${formatCLP(context.totalSpent)} en gastos detectados. La historia principal está en ${topLabel}.`;
}

function buildMonthStoryItems(transactions, knownExpenses, context) {
	const items = [];
	if (context.topCategory.label !== "—") {
		items.push(
			`${context.topCategory.label} concentra ${formatCLP(context.topCategory.total)} del periodo.`,
		);
	}
	if (context.topCounterparty.label !== "—") {
		items.push(
			`${context.topCounterparty.label} es donde más se repite el gasto.`,
		);
	}
	if (context.largestExpense) {
		items.push(
			`El gasto más alto fue ${formatCLP(context.largestExpense.amount)} en ${context.largestExpense.counterparty || context.largestExpense.description || "un movimiento sin nombre"}.`,
		);
	}
	const pending = reviewableTransactions(transactions).length;
	if (pending > 0) {
		items.push(
			`${pending} ${pending === 1 ? "gasto necesita" : "gastos necesitan"} una revisión rápida.`,
		);
	}
	if (items.length === 0 && knownExpenses.length > 0) {
		items.push("Tus gastos ya están listos para explorarse en el detalle.");
	}
	return items.slice(0, 4);
}

function renderNextBestAction(transactions, knownExpenses) {
	const action = document.createElement("aside");
	action.className = "next-action-card";
	const label = document.createElement("span");
	label.textContent = "Próxima acción";
	const title = document.createElement("strong");
	const detail = document.createElement("p");
	const button = document.createElement("button");
	button.type = "button";
	button.className = "review-now-button";

	const pending = reviewableTransactions(transactions);
	if (pending.length > 0) {
		title.textContent = "Revisar gastos dudosos";
		detail.textContent = `${pending.length} ${pending.length === 1 ? "movimiento necesita" : "movimientos necesitan"} tu confirmación.`;
		button.textContent = "Revisar ahora";
		button.addEventListener("click", openFirstReviewItem);
	} else if (state.budgetEnabled) {
		title.textContent = "Seguir el ritmo del mes";
		detail.textContent =
			"Ya podés mirar cuánto te queda y ajustar si algo no calza.";
		button.textContent = "Ver detalle";
		button.addEventListener("click", () => setView("table"));
	} else if (knownExpenses.length > 0) {
		title.textContent = "Responder la pregunta clave";
		detail.textContent =
			"Activa el cálculo para saber cuánto te queda este mes.";
		button.textContent = "Calcular cuánto queda";
		button.addEventListener("click", () => {
			state.budgetEnabled = true;
			saveViewPreferences();
			render();
		});
	} else {
		title.textContent = "Traer gastos al mes";
		detail.textContent =
			"Sincroniza Gmail o agrega un gasto para empezar el resumen.";
		button.textContent = "Agregar gasto";
		button.addEventListener("click", openNewExpenseModal);
	}

	action.append(label, title, detail, button);
	return action;
}

function reviewableTransactions(transactions) {
	return transactions
		.filter((tx) => tx.status === "needs_review")
		.sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0));
}

function openFirstReviewItem() {
	const [transaction] = reviewableTransactions(
		selectedMonthExpenseTransactions(state.transactions),
	);
	if (transaction) openModal(transaction.id);
}

function renderBudgetToggle() {
	const section = document.createElement("section");
	section.className = "budget-toggle-card";
	const copy = document.createElement("div");
	const title = document.createElement("strong");
	title.textContent = "¿Cuánto me queda este mes?";
	const description = document.createElement("p");
	description.textContent =
		"Transforma ingresos y gastos en una respuesta simple. Tu sueldo, saldo real y preferencias se guardan solo en este navegador, no se sincronizan y pueden desaparecer si borras sus datos.";
	const preferenceNotice = document.createElement("p");
	preferenceNotice.id = "financePreferencesNotice";
	preferenceNotice.className = "modal-status";
	preferenceNotice.setAttribute("aria-live", "polite");
	preferenceNotice.textContent = financePreferenceNotice;
	copy.append(title, description, preferenceNotice);

	const button = document.createElement("button");
	button.type = "button";
	button.className = "switch-control";
	button.setAttribute("role", "switch");
	button.setAttribute("aria-checked", String(state.budgetEnabled));
	button.setAttribute("aria-label", "Calcular cuánto queda este mes");
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

function renderBudgetCard(allMonthTransactions) {
	const totalSpent = summarizeMovements(allMonthTransactions).expenseTotal;
	const card = document.createElement("section");
	card.className = "budget-card";

	const header = document.createElement("div");
	header.className = "budget-header";
	const title = document.createElement("h3");
	title.textContent = "Cuánto te queda";
	const copy = document.createElement("p");
	copy.textContent =
		"Una respuesta simple: ingreso confirmado menos gastos capturados, con diferencias por aclarar si algo no calza.";
	header.append(title, copy);

	const preferenceActions = document.createElement("div");
	preferenceActions.className = "income-actions";
	const resetMonthButton = document.createElement("button");
	resetMonthButton.type = "button";
	resetMonthButton.className = "secondary";
	resetMonthButton.textContent = "Restablecer este mes";
	resetMonthButton.addEventListener("click", resetSelectedMonthPreferences);
	const resetAllButton = document.createElement("button");
	resetAllButton.type = "button";
	resetAllButton.className = "danger";
	resetAllButton.textContent = "Restablecer todas";
	resetAllButton.addEventListener("click", resetAllLocalFinancePreferences);
	preferenceActions.append(resetMonthButton, resetAllButton);

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
			"Salidas consideradas",
			formatCLP(totalSpent),
			selectedMonthLabel(),
		),
		budgetResult(
			"Restante esperado",
			"—",
			"Confirma un ingreso para calcularlo.",
		),
		budgetResult(
			"Diferencia esperado − real",
			"—",
			"Agrega tu saldo real local para compararlo.",
		),
	);

	card.append(header, preferenceActions, detection, form, results);
	wireBudgetInput(salaryInput.input, "salary", allMonthTransactions, card);
	wireBudgetInput(
		remainingInput.input,
		"actualRemaining",
		allMonthTransactions,
		card,
	);
	updateBudgetResults(card, allMonthTransactions);
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
	toggleText.textContent = "Sugerir ingresos desde Gmail";
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
		if (!toggle.checked) state.incomeCandidates = [];
		saveBudgetPreferences();
		await loadIncomeCandidates();
		updateHeroKpis();
	});
	timingSelect.addEventListener("change", async () => {
		state.budget.payTiming = timingSelect.value;
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
	const confirmedId = String(state.budget.confirmedIncomeId || "");
	const confirmedCandidateVisible = candidates.some(
		(candidate) => String(candidate.id) === confirmedId,
	);
	copy.textContent =
		confirmedId && confirmedId !== "manual" && !confirmedCandidateVisible
			? "Tu ingreso confirmado se conserva aunque esa entrada ya no aparezca. Puedes elegir otra o editarlo manualmente."
			: "Estas entradas son sugerencias. Elige una explícitamente o ingresa tu sueldo manualmente para usarlo en los cálculos.";
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
	const isConfirmed =
		state.budget.confirmedIncomeId === String(candidate.id);
	if (isConfirmed) option.classList.add("income-candidate-option-active");

	const content = document.createElement("div");
	const amount = document.createElement("strong");
	amount.textContent = formatCLP(candidate.amount);
	const detail = document.createElement("small");
	detail.textContent = `${formatDate(candidate.occurredAt)} · ${candidate.counterparty || "Origen no identificado"} · Confianza ${candidate.confidenceLabel}`;
	content.append(amount, detail);

	const button = document.createElement("button");
	button.type = "button";
	button.textContent = isConfirmed ? "Seleccionada" : "Usar como ingreso";
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
		const salaryInput = document.querySelector("#budgetSalary");
		if (salaryInput) salaryInput.focus();
	});
	const disableButton = document.createElement("button");
	disableButton.type = "button";
	disableButton.className = "secondary";
	disableButton.textContent = "Desactivar sugerencias";
	disableButton.addEventListener("click", () => {
		state.budget.autoDetectIncome = false;
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

function wireBudgetInput(input, key, allMonthTransactions, card) {
	input.addEventListener("focus", () => {
		const raw = parseCLP(input.value);
		input.value = raw === "" ? "" : String(raw);
	});
	input.addEventListener("input", () => {
		input.value = sanitizeBudgetInput(input.value);
		state.budget[key] = input.value;
		if (key === "salary") {
			state.budget.confirmedIncomeId =
				parseCLP(input.value) === "" ? "" : "manual";
		}
		saveBudgetPreferences();
		updateBudgetResults(card, allMonthTransactions);
		updateHeroKpis();
	});
	input.addEventListener("blur", () => {
		input.value = sanitizeBudgetInput(input.value);
		const raw = parseCLP(input.value);
		input.value = raw === "" ? "" : formatCLP(raw);
		state.budget[key] = input.value;
		if (key === "salary") {
			state.budget.confirmedIncomeId = raw === "" ? "" : "manual";
		}
		saveBudgetPreferences();
		updateBudgetResults(card, allMonthTransactions);
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

function updateBudgetResults(card, allMonthTransactions) {
	const results = card.querySelectorAll(".budget-result");
	const income = confirmedBudgetIncome();
	const actualRemaining = parseCLP(state.budget.actualRemaining);
	const reconciliation = buildReconciliation({
		confirmedIncome: income,
		transactions: allMonthTransactions,
		actualRemaining: actualRemaining === "" ? null : actualRemaining,
	});
	const transferDetail = reconciliation.transferOutflowCount
		? ` · ${reconciliation.transferOutflowCount} transferencias incluidas`
		: "";
	const inflowDetail = reconciliation.informationalInflowCount
		? ` · ${reconciliation.informationalInflowCount} entradas por ${formatCLP(reconciliation.informationalInflowTotal)} son solo informativas`
		: "";

	setBudgetResult(
		results[0],
		formatCLP(reconciliation.knownOutflowTotal),
		`${reconciliation.knownOutflowCount} salidas con monto${transferDetail}${inflowDetail}`,
	);

	if (reconciliation.expectedRemaining === null) {
		setBudgetResult(
			results[1],
			"—",
			income.reason || "Confirma un ingreso para calcularlo.",
		);
	} else {
		const uncertainty = [
			reconciliation.uncertainOutflowCount
				? `${reconciliation.uncertainOutflowCount} salidas incluidas siguen pendientes de revisión`
				: "",
			reconciliation.unknownOutflowCount
				? `${reconciliation.unknownOutflowCount} salidas sin monto no fueron incluidas`
				: "",
		]
			.filter(Boolean)
			.join(" · ");
		setBudgetResult(
			results[1],
			formatCLP(reconciliation.expectedRemaining),
			`${formatCLP(income.amount)} ingreso − ${formatCLP(reconciliation.knownOutflowTotal)} salidas${uncertainty ? ` · ${uncertainty}` : ""}`,
		);
	}

	if (reconciliation.difference === null) {
		setBudgetResult(
			results[2],
			"—",
			reconciliation.actualRemaining === null
				? "Agrega tu saldo real local para compararlo; no se enviará al servidor."
				: "Confirma un ingreso para habilitar la comparación.",
		);
		return;
	}

	let hypothesis = "El saldo real coincide con el restante esperado.";
	if (reconciliation.difference > 0) {
		hypothesis =
			"El saldo real es menor. Como hipótesis, revisa salidas no observadas, comisiones o desfases.";
	}
	if (reconciliation.difference < 0) {
		hypothesis =
			"El saldo real es mayor. Como hipótesis, revisa entradas informativas, gastos duplicados, ajustes o desfases.";
	}
	setBudgetResult(
		results[2],
		formatSignedCLP(reconciliation.difference),
		hypothesis,
	);
}

function setBudgetResult(item, valueText, detailText) {
	item.querySelector("strong").textContent = valueText;
	item.querySelector("small").textContent = detailText;
}

function confirmedBudgetIncome() {
	return resolveConfirmedIncome({
		salaryAmount: parseCLP(state.budget.salary),
		confirmedIncomeId: state.budget.confirmedIncomeId,
	});
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
	const result = readFinancePreferences(financePreferenceSession, { month });
	if (result.notice === "recovery" && !financePreferenceNotice) {
		setFinancePreferenceNotice(
			"Las preferencias guardadas no son compatibles. Puedes ingresar valores nuevos o restablecerlas.",
		);
	}
	return normalizeBudgetObject(result.preferences);
}

function normalizeBudgetObject(value = {}) {
	const defaults = defaultBudgetPreferences();
	const salary = normalizeBudgetPreference(value.salary);
	return {
		...defaults,
		salary,
		actualRemaining: normalizeBudgetPreference(value.actualRemaining),
		autoDetectIncome: Boolean(value.autoDetectIncome),
		payTiming: normalizePayTimingPreference(value.payTiming),
		confirmedIncomeId: legacyConfirmationId({
			salaryAmount: parseCLP(salary),
			confirmedIncomeId: value.confirmedIncomeId,
		}),
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
	const stored = readLocalValue(VIEW_PREFERENCES_STORAGE_KEY);
	if (!stored.ok) {
		setFinancePreferenceNotice(
			"El almacenamiento local no está disponible. Tus cambios durarán solo esta sesión.",
		);
		return { budgetEnabled: false };
	}
	if (!stored.value) return { budgetEnabled: false };
	try {
		const parsed = JSON.parse(stored.value);
		if (
			!parsed ||
			typeof parsed !== "object" ||
			Array.isArray(parsed) ||
			(Object.hasOwn(parsed, "budgetEnabled") &&
				typeof parsed.budgetEnabled !== "boolean")
		) {
			throw new Error("invalid view preferences");
		}
		return { budgetEnabled: Boolean(parsed.budgetEnabled) };
	} catch {
		setFinancePreferenceNotice(
			"La preferencia de vista guardada no es compatible y se usará el valor predeterminado.",
		);
		return { budgetEnabled: false };
	}
}

function saveViewPreferences() {
	const saved = writeLocalValue(
		VIEW_PREFERENCES_STORAGE_KEY,
		JSON.stringify({ budgetEnabled: Boolean(state.budgetEnabled) }),
	);
	if (!saved) {
		setFinancePreferenceNotice(
			"No pudimos guardar tus preferencias. Seguirán activas solo durante esta sesión.",
		);
	}
}

function saveBudgetPreferences() {
	state.budget = normalizeBudgetObject(state.budget);
	const update = updateFinancePreferences(financePreferenceSession, {
		month: state.selectedMonth,
		preferences: state.budget,
	});
	financePreferenceSession = update.session;
	const saved = writeLocalValue(BUDGET_STORAGE_KEY, update.serialized);
	setFinancePreferenceNotice(
		saved
			? update.recovery
				? "Preferencias locales recuperadas y guardadas en este navegador."
				: ""
			: "No pudimos guardar tus preferencias. Seguirán activas solo durante esta sesión.",
	);
}

function readLocalValue(key) {
	try {
		return { ok: true, value: localStorage.getItem(key) };
	} catch {
		return { ok: false, value: null };
	}
}

function writeLocalValue(key, value) {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

function removeLocalValue(key) {
	try {
		localStorage.removeItem(key);
		return true;
	} catch {
		return false;
	}
}

function setFinancePreferenceNotice(message) {
	financePreferenceNotice = message;
	const notice = document.querySelector("#financePreferencesNotice");
	if (notice) notice.textContent = message;
}

function resetSelectedMonthPreferences() {
	if (
		!confirm(
			`¿Restablecer las preferencias de ${selectedMonthLabel()}? Los demás meses se conservarán.`,
		)
	) {
		return;
	}
	const reset = resetFinancePreferenceMonth(financePreferenceSession, {
		month: state.selectedMonth,
	});
	financePreferenceSession = reset.session;
	const persisted =
		reset.operation === "write"
			? writeLocalValue(BUDGET_STORAGE_KEY, reset.serialized)
			: removeLocalValue(BUDGET_STORAGE_KEY);
	state.budget = normalizeBudgetObject(reset.preferences);
	state.incomeCandidates = [];
	setFinancePreferenceNotice(
		persisted
			? "Preferencias del mes restablecidas en este navegador."
			: "El mes se restableció para esta sesión, pero no pudimos guardarlo.",
	);
	render();
}

function resetAllLocalFinancePreferences() {
	if (
		!confirm(
			"¿Restablecer todas las preferencias financieras guardadas en este navegador? Esta acción incluye todos los meses y la vista de presupuesto.",
		)
	) {
		return;
	}
	const reset = resetAllFinancePreferences();
	financePreferenceSession = parseFinancePreferences(null, {
		currentMonth: state.selectedMonth,
	});
	state.budget = defaultBudgetPreferences();
	state.budgetEnabled = reset.viewPreferences.budgetEnabled;
	state.incomeCandidates = [];
	const budgetRemoved = removeLocalValue(reset.budgetKey);
	const viewRemoved = removeLocalValue(reset.viewKey);
	setFinancePreferenceNotice(
		budgetRemoved && viewRemoved
			? "Todas las preferencias financieras locales fueron restablecidas."
			: "Las preferencias se restablecieron para esta sesión, pero no pudimos borrar todos los valores guardados.",
	);
	render();
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

	const header = document.createElement("div");
	header.className = "chart-detail-header";
	const title = document.createElement("h4");
	const amount = document.createElement("strong");
	amount.className = "chart-detail-total";
	header.append(title, amount);

	if (!selectedDay) {
		title.textContent = "Selecciona una barra";
		amount.textContent = formatCLP(0);
		const empty = document.createElement("p");
		empty.textContent =
			"Elige un día del gráfico para ver qué gastos forman ese total.";
		panel.append(header, empty);
		return panel;
	}

	const matches = chartDayTransactions(selected, selectedDay, expenses);
	title.textContent = chartDetailTitle(selected, selectedDay);
	amount.textContent = formatCLP(sumAmounts(matches));
	panel.append(header);

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
		name.textContent = `${formatTime(tx.occurredAt)} · ${tx.counterparty || tx.description || "Sin comercio o persona"}`;
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
	title.textContent = "Dónde se fue tu plata";

	const copy = document.createElement("p");
	copy.textContent =
		"La app interpreta la distribución por vos: concentración, ahorro posible y detalles útiles.";

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

	section.append(
		renderCategoryDistributionInsight(rows),
		renderCategorySavingsHint(rows),
	);
	const displayRows = buildCategoryDisplayRows(rows);

	const body = document.createElement("div");
	body.className = "category-distribution-body";

	const donutWrap = document.createElement("div");
	donutWrap.className = "category-donut-wrap";

	const donutDom = document.createElement("div");
	donutDom.style.width = "260px";
	donutDom.style.height = "260px";

	const total = rows.reduce((sum, row) => sum + row.total, 0);

	const legend = document.createElement("div");
	legend.className = "category-distribution-legend";

	if (!echarts) {
		donutWrap.append(renderCategoryChartFallback(total));
		renderCategoryDetail(legend, displayRows, transactions);
		body.append(donutWrap, legend);
		section.append(body);
		return section;
	}

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
					data: displayRows.map((r) => ({
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
		renderCategoryDetail(legend, displayRows, transactions);
	});

	chart.getZr().on("click", (params) => {
		if (!params.target) {
			state.activeCategory = null;
			updateDonutHighlight(chart);
			renderCategoryDetail(legend, displayRows, transactions);
		}
	});

	donutWrap.append(donutDom);
	renderCategoryDetail(legend, displayRows, transactions);

	body.append(donutWrap, legend);
	section.append(body);

	return section;
}

function renderCategoryChartFallback(total) {
	const fallback = document.createElement("div");
	fallback.className = "category-chart-fallback";
	const label = document.createElement("span");
	label.textContent = "Total";
	const value = document.createElement("strong");
	value.textContent = formatCLP(total);
	const detail = document.createElement("small");
	detail.textContent = "Gráfico no disponible, detalle listo abajo";
	fallback.append(label, value, detail);
	return fallback;
}

function showCategoryInTable(category) {
	if (state.view === "table") {
		highlightTableByCategory(category);
		return;
	}
	setView("table");
	setTimeout(
		() => highlightTableByCategory(category),
		prefersReducedMotion() ? 0 : 240,
	);
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

function buildCategoryDisplayRows(rows) {
	if (rows.length <= 3) return rows;
	const visible = rows.slice(0, 3);
	const rest = rows.slice(3);
	const total = rows.reduce((sum, row) => sum + row.total, 0);
	const otherTotal = rest.reduce((sum, row) => sum + row.total, 0);
	const otherCount = rest.reduce((sum, row) => sum + row.count, 0);
	return [
		...visible,
		{
			category: "Otras categorías",
			total: otherTotal,
			count: otherCount,
			percent: total ? Math.round((otherTotal / total) * 100) : 0,
			color: "#94a3b8",
			children: rest,
		},
	];
}

function renderCategoryLegendItem(row) {
	const item = document.createElement("button");
	item.type = "button";
	item.className = "category-legend-item";
	item.style.setProperty("--category-color", row.color);
	item.title = `${row.category}: ${formatCLP(row.total)} · ${row.percent}% · ${row.count} movimientos`;
	item.addEventListener("click", () => {
		state.activeCategory =
			categoryKey(state.activeCategory) === categoryKey(row.category)
				? null
				: row.category;
		updateDonutHighlight(chartInstances.get("category-donut"));
		renderCategoryDetail(
			item.parentElement,
			item.parentElement.__categoryRows,
			item.parentElement.__categoryExpenses,
		);
	});

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
	legendEl.__categoryRows = rows;
	legendEl.__categoryExpenses = expenses;
	legendEl.replaceChildren();
	legendEl.classList.toggle(
		"category-distribution-legend-detail",
		Boolean(state.activeCategory),
	);

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
		legendEl.classList.remove("category-distribution-legend-detail");
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
	if (activeRow.children) {
		for (const child of activeRow.children) {
			groups.set(categoryKey(child.category), {
				displayName: child.category,
				total: child.total,
				count: child.count,
			});
		}
	} else {
		for (const tx of expenses) {
			const txCat = normalizeCategoryName(tx.category || "") || "Sin categoría";
			if (categoryKey(txCat) !== activeCategoryKey) continue;

			const displayName = tx.counterparty || "Sin comercio o persona";
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

	const actions = document.createElement("div");
	actions.className = "category-detail-actions";

	const view = document.createElement("button");
	view.type = "button";
	view.className = "category-detail-back";
	view.textContent = "Ver gastos de esta categoría";
	view.hidden = Boolean(activeRow.children);
	view.addEventListener("click", () => {
		showCategoryInTable(activeRow.category);
	});

	const back = document.createElement("button");
	back.type = "button";
	back.className = "category-detail-back";
	back.textContent = "← Todas las categorías";
	back.addEventListener("click", () => {
		state.activeCategory = null;
		updateDonutHighlight(chartInstances.get("category-donut"));
		renderCategoryDetail(legendEl, rows, expenses);
	});

	actions.append(view, back);
	panel.append(header, merchantList, actions);
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

	const [top, second] = rows;
	if (top && second && top.percent + second.percent >= 50) {
		insight.textContent = `${top.category} y ${second.category} explican el ${top.percent + second.percent}% de tus gastos.`;
		return insight;
	}
	if (top && top.percent >= 40) {
		insight.textContent = `${top.category} concentra el ${top.percent}% del gasto del periodo.`;
		return insight;
	}

	insight.textContent =
		"Tus gastos están distribuidos entre varias categorías; mirá el top 3 antes que todos los detalles.";
	return insight;
}

function renderCategorySavingsHint(rows) {
	const hint = document.createElement("p");
	hint.className = "category-savings-hint";
	const top = rows.find((row) => row.category !== "Sin categoría") || rows[0];
	if (!top) {
		hint.textContent =
			"Cuando haya categorías, te mostraremos dónde un pequeño ajuste mueve la aguja.";
		return hint;
	}
	const saving = Math.round(top.total * 0.1);
	hint.textContent = `Si bajaras ${top.category} un 10%, liberarías cerca de ${formatCLP(saving)} este mes.`;
	return hint;
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

function openCounterpartyDetailModal(counterpartyKey) {
	state.activeCounterpartyDetailKey = counterpartyKey;
	const movements = selectedMonthExpenseTransactions(state.transactions)
		.filter((tx) => {
			const key =
				tx.counterpartyKey ||
				normalizeCounterpartyForUI(tx.counterparty || "Sin comercio o persona");
			return key === counterpartyKey && hasKnownAmount(tx);
		})
		.sort((a, b) =>
			String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")),
		);

	if (!movements.length) return;
	const displayName = movements[0].counterparty || "Sin comercio o persona";
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
		income: "Ingresos",
		unknown: "Sin clasificar",
	};
	return labels[kind] || "Sin clasificar";
}

function renderTableHead(transactions = []) {
	const thead = document.createElement("thead");
	const row = document.createElement("tr");
	const selectedVisibleCount =
		selectedVisibleTransactionIds(transactions).length;
	const selectableCount = transactions.length;
	const columns = [
		{ key: "select", label: "Seleccionar", sortable: false },
		{ key: "date", label: "Fecha", sortable: true },
		{ key: "amount", label: "Monto", sortable: true },
		{ key: "counterparty", label: "Comercio o persona", sortable: true },
		{ key: "category", label: "Categoría", sortable: true },
		{ key: null, label: "", sortable: false },
	];
	for (const col of columns) {
		const th = document.createElement("th");
		th.scope = "col";
		if (col.key === "select") {
			th.className = "selection-column";
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked =
				selectableCount > 0 && selectedVisibleCount === selectableCount;
			checkbox.indeterminate =
				selectedVisibleCount > 0 && selectedVisibleCount < selectableCount;
			checkbox.disabled = selectableCount === 0;
			checkbox.setAttribute("aria-label", "Seleccionar movimientos visibles");
			checkbox.addEventListener("change", () => {
				toggleVisibleTransactionsSelection(transactions, checkbox.checked);
			});
			th.append(checkbox);
			row.append(th);
			continue;
		}
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
		tbody.append(renderTransactionRow(transaction, sorted));
	}
	return tbody;
}

function renderTableSummary(transactions) {
	const financial = summarizeMovements(transactions);
	const total = financial.expenseTotal;
	const incomeTotal = financial.informationalInflowTotal;
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
	detail.textContent = `${financial.expenseCount} salidas · ${financial.informationalInflowCount} ingresos${incomeTotal ? ` (${formatCLP(incomeTotal)})` : ""}${pending ? ` · ${pending} por revisar` : ""}`;
	box.append(label, value, detail);
	return box;
}

function renderBulkCategoryBar(transactions) {
	const selectedIds = selectedVisibleTransactionIds(transactions);
	const bar = document.createElement("div");
	bar.className = "bulk-action-bar";
	bar.hidden = selectedIds.length === 0;
	if (selectedIds.length === 0) return bar;

	const selectionSummary = selectedCounterpartySummary(
		transactions,
		selectedIds,
	);
	const copy = document.createElement("div");
	copy.className = "bulk-selection-copy";
	const count = document.createElement("strong");
	count.textContent = `${selectedIds.length} ${selectedIds.length === 1 ? "movimiento seleccionado" : "movimientos seleccionados"}`;
	copy.append(count);
	if (selectionSummary) {
		const detail = document.createElement("span");
		detail.textContent = bulkSelectionDetail(
			selectionSummary,
			selectedIds.length,
		);
		copy.append(detail);
	}

	const label = document.createElement("label");
	label.className = "bulk-category-field";
	label.textContent = "Categoría";
	const select = document.createElement("select");
	for (const option of categoryOptions(transactions)) {
		const node = document.createElement("option");
		node.value = option.value;
		node.textContent = option.value ? option.label : "Seleccionar categoría";
		node.selected = option.value === state.bulkCategory;
		select.append(node);
	}
	select.addEventListener("change", () => {
		if (select.value === CREATE_CATEGORY_VALUE) {
			state.bulkCategory = "";
			state.bulkStatus = "";
			openSettingsModal({ focusCategoryForm: true });
			render();
			return;
		}
		state.bulkCategory = select.value;
		state.bulkStatus = "";
		render();
	});
	label.append(select);

	const assign = document.createElement("button");
	assign.type = "button";
	assign.textContent = state.isBulkAssigning
		? "Asignando..."
		: "Asignar categoría";
	assign.disabled = state.isBulkAssigning || !state.bulkCategory;
	assign.addEventListener("click", () =>
		applyBulkCategoryAssignment(transactions),
	);

	const clear = document.createElement("button");
	clear.type = "button";
	clear.className = "secondary";
	clear.textContent = "Limpiar selección";
	clear.disabled = state.isBulkAssigning;
	clear.addEventListener("click", clearTransactionSelection);

	bar.append(copy, label, assign, clear);
	return bar;
}

function renderCounterpartySelectionPrompt(transactions) {
	const prompt = document.createElement("div");
	prompt.className = "counterparty-selection-prompt";
	prompt.setAttribute("aria-live", "polite");
	prompt.hidden = !state.pendingCounterpartySelection;
	if (!state.pendingCounterpartySelection) return prompt;

	const { key, label, ids } = state.pendingCounterpartySelection;
	const allowedIds = ids ? new Set(ids) : null;
	const matches = transactions.filter(
		(transaction) =>
			counterpartySelectionKey(transaction) === key &&
			(!allowedIds || allowedIds.has(String(transaction.id))),
	);
	if (matches.length === 0) {
		state.pendingCounterpartySelection = null;
		prompt.hidden = true;
		return prompt;
	}

	const selectedMatches = matches.filter((transaction) =>
		state.selectedTransactionIds.has(String(transaction.id)),
	).length;
	const copy = document.createElement("div");
	copy.className = "counterparty-selection-copy";
	const title = document.createElement("strong");
	title.textContent = `Encontré ${matches.length} ${matches.length === 1 ? "movimiento" : "movimientos"} de ${label}.`;
	const detail = document.createElement("span");
	detail.textContent =
		selectedMatches === matches.length
			? "Estos movimientos ya están seleccionados."
			: selectedMatches
				? `${selectedMatches} ya ${selectedMatches === 1 ? "está seleccionado" : "están seleccionados"}. Podés seleccionar el resto o cancelar.`
				: "¿Querés seleccionarlos todos para asignarles categoría juntos?";
	copy.append(title, detail);

	const actions = document.createElement("div");
	actions.className = "counterparty-selection-actions";
	const confirm = document.createElement("button");
	confirm.type = "button";
	confirm.textContent =
		selectedMatches === matches.length
			? "Ya seleccionados"
			: `Seleccionar ${matches.length}`;
	confirm.disabled = selectedMatches === matches.length;
	confirm.addEventListener("click", () => {
		confirmCounterpartySelection(matches, key, label);
	});
	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.className = "secondary";
	cancel.textContent = "Cancelar";
	cancel.addEventListener("click", () => {
		state.pendingCounterpartySelection = null;
		render();
	});
	actions.append(confirm, cancel);
	prompt.append(copy, actions);
	return prompt;
}

function requestCounterpartySelection(
	counterpartyKey,
	label,
	scopeTransactions = null,
) {
	state.pendingCounterpartySelection = {
		key: counterpartyKey,
		label: label || "sin comercio o persona",
		ids: scopeTransactions
			? scopeTransactions.map((transaction) => String(transaction.id))
			: null,
	};
	state.bulkStatus = "";
}

function confirmCounterpartySelection(transactions, counterpartyKey, label) {
	selectVisibleCounterpartyTransactions(transactions, counterpartyKey, {
		label,
	});
}

function selectedCounterpartySummary(transactions, selectedIds) {
	const selectedSet = new Set(selectedIds.map(String));
	const groups = new Map();
	for (const transaction of transactions) {
		if (!selectedSet.has(String(transaction.id))) continue;
		const key = counterpartySelectionKey(transaction);
		if (!groups.has(key)) {
			groups.set(key, {
				key,
				label: transaction.counterparty || "Sin comercio o persona",
				selectedCount: 0,
				visibleCount: 0,
			});
		}
		groups.get(key).selectedCount += 1;
	}
	for (const transaction of transactions) {
		const group = groups.get(counterpartySelectionKey(transaction));
		if (group) group.visibleCount += 1;
	}
	return (
		[...groups.values()].sort((a, b) => b.selectedCount - a.selectedCount)[0] ||
		null
	);
}

function bulkSelectionDetail(summary, selectedCount) {
	if (summary.selectedCount === selectedCount) {
		return `Selección concentrada en ${summary.label}: ${summary.selectedCount} de ${summary.visibleCount} movimientos visibles.`;
	}
	return `${summary.label} domina la selección: ${summary.selectedCount} de ${selectedCount} movimientos seleccionados.`;
}

function renderTableFeedback() {
	const feedback = document.createElement("div");
	feedback.className = "table-feedback";
	feedback.setAttribute("aria-live", "polite");
	feedback.hidden = !state.bulkStatus;
	feedback.textContent = state.bulkStatus;
	return feedback;
}

function selectedVisibleTransactionIds(transactions) {
	return transactions
		.map((tx) => String(tx.id))
		.filter((id) => state.selectedTransactionIds.has(id));
}

function pruneSelectedTransactions(transactions = state.transactions) {
	const availableIds = new Set(transactions.map((tx) => String(tx.id)));
	for (const id of state.selectedTransactionIds) {
		if (!availableIds.has(id)) state.selectedTransactionIds.delete(id);
	}
}

function toggleVisibleTransactionsSelection(transactions, checked) {
	for (const transaction of transactions) {
		const id = String(transaction.id);
		if (checked) {
			state.selectedTransactionIds.add(id);
		} else {
			state.selectedTransactionIds.delete(id);
		}
	}
	state.pendingCounterpartySelection = null;
	state.bulkStatus = "";
	render();
}

function toggleTransactionSelection(id, checked) {
	const key = String(id);
	if (checked) {
		state.selectedTransactionIds.add(key);
	} else {
		state.selectedTransactionIds.delete(key);
	}
	state.pendingCounterpartySelection = null;
	state.bulkStatus = "";
	render();
}

function selectVisibleCounterpartyTransactions(
	transactions,
	counterpartyKey,
	options = {},
) {
	let selectedCount = 0;
	for (const transaction of transactions) {
		if (counterpartySelectionKey(transaction) === counterpartyKey) {
			state.selectedTransactionIds.add(String(transaction.id));
			selectedCount += 1;
		}
	}
	state.pendingCounterpartySelection = null;
	state.bulkStatus = options.status
		? `${selectedCount} ${selectedCount === 1 ? "movimiento" : "movimientos"} de ${options.label || "este comercio"} seleccionados.`
		: "";
	render();
}

function clearTransactionSelection() {
	state.selectedTransactionIds.clear();
	state.pendingCounterpartySelection = null;
	state.bulkCategory = "";
	state.bulkStatus = "";
	render();
}

async function applyBulkCategoryAssignment(transactions) {
	const selectedIds = selectedVisibleTransactionIds(transactions);
	if (selectedIds.length === 0 || !state.bulkCategory || state.isBulkAssigning)
		return;
	state.isBulkAssigning = true;
	state.bulkStatus = `Asignando categoría a ${selectedIds.length} movimientos...`;
	render();
	try {
		const results = await Promise.allSettled(
			selectedIds.map((id) => patchTransactionCategory(id, state.bulkCategory)),
		);
		const updates = results
			.filter((result) => result.status === "fulfilled")
			.map((result) => result.value);
		applyTransactionUpdatesLocally(updates);
		const assignedCount = updates.length;
		const failedCount = results.length - assignedCount;
		for (const update of updates) {
			state.selectedTransactionIds.delete(String(update.id));
		}
		if (failedCount === 0) {
			state.selectedTransactionIds.clear();
			state.pendingCounterpartySelection = null;
			state.bulkCategory = "";
			state.bulkStatus = `Categoría asignada a ${assignedCount} ${assignedCount === 1 ? "movimiento" : "movimientos"}.`;
		} else {
			state.bulkStatus = `${assignedCount} ${assignedCount === 1 ? "movimiento actualizado" : "movimientos actualizados"}; ${failedCount} ${failedCount === 1 ? "falló" : "fallaron"}. Intenta nuevamente con los pendientes.`;
		}
		render();
	} catch (error) {
		state.bulkStatus = `Error: ${error.message}`;
		render();
	} finally {
		state.isBulkAssigning = false;
		render();
	}
}

async function patchTransactionCategory(id, category) {
	const transaction = state.transactions.find(
		(tx) => String(tx.id) === String(id),
	);
	if (!transaction) throw new Error("Movimiento no encontrado");
	const patch = {
		id,
		category,
		status: transaction.status === "manual" ? "manual" : "edited",
	};
	if (DEMO_MODE) return patch;

	const params = new URLSearchParams({ month: state.selectedMonth });
	const response = await fetch(
		`/api/transactions/${encodeURIComponent(id)}?${params}`,
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
	const payload = await response.json();
	if (!response.ok)
		throw new Error(payload.error || "No se pudo asignar la categoría");
	return payload.transaction || patch;
}

function applyTransactionUpdatesLocally(updates) {
	const updateMap = new Map(
		updates.filter(Boolean).map((update) => [String(update.id), update]),
	);
	if (updateMap.size === 0) return;
	const apply = (tx) => {
		const update = updateMap.get(String(tx.id));
		return update ? { ...tx, ...update } : tx;
	};
	invalidateTransactionReplacement();
	state.transactions = state.transactions.map(apply);
	if (DEMO_MODE) demoData = demoData.map(apply);
}

function computeHeroKpiData(knownExpenses, allMonthTransactions) {
	const totalSpent = summarizeMovements(knownExpenses).expenseTotal;
	const inflows = (allMonthTransactions || knownExpenses).filter(
		(tx) => tx.direction === "inflow",
	);
	const visibleIncomeCount = inflows.filter(hasKnownAmount).length;
	const budgetIncome = state.budgetEnabled
		? confirmedBudgetIncome()
		: { amount: null, reason: "" };
	const income = budgetIncome.amount ?? 0;
	const hasConfirmedIncome = budgetIncome.amount !== null;
	const position = calculateFinancialPosition({
		confirmedIncome: budgetIncome,
		expenseTotal: totalSpent,
		actualRemaining: null,
	});

	const incomeDetail =
		budgetIncome.amount !== null
			? budgetIncome.reason || "Del presupuesto"
			: visibleIncomeCount > 0
				? `${visibleIncomeCount} ingreso${visibleIncomeCount === 1 ? "" : "s"} en tabla; no usado para presupuesto`
				: "Activa presupuesto para calcular";

	const remaining = position.expectedRemaining;
	const remainingPercent =
		income > 0 && remaining !== null
			? Math.round((remaining / income) * 100)
			: 0;

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
			label: "Ingreso",
			value: hasConfirmedIncome ? formatCLP(income) : "\u2014",
			detail: incomeDetail,
		},
		{
			key: "remaining",
			label: "Saldo restante",
			value:
				remaining === null
					? "—"
					: remaining >= 0
						? formatCLP(remaining)
						: `-${formatCLP(Math.abs(remaining))}`,
			detail: hasConfirmedIncome
				? `${remainingPercent}% disponible`
				: "Agrega tu ingreso para estimarlo",
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
	const knownExpenses = allMonthTransactions.filter(isCountedExpense);
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
	const financial = summarizeMovements(transactions);
	const outflow = financial.expenseTotal;
	const pending = transactions.filter(
		(tx) => tx.status === "needs_review",
	).length;
	summaryEl.replaceChildren();
	const label = document.createElement("span");
	label.textContent = `En salidas de ${selectedMonthLabel()}`;
	const amount = document.createElement("strong");
	amount.textContent = currency.format(outflow);
	const detail = document.createElement("small");
	detail.textContent = `${transactions.length} movimientos · ${financial.informationalInflowCount} ingresos visibles${pending ? ` · ${pending} por revisar` : ""}`;
	summaryEl.append(label, amount, detail);
}

function renderTransactionRow(transaction, visibleTransactions = []) {
	const row = rowTemplate.content.firstElementChild.cloneNode(true);
	const selected = state.selectedTransactionIds.has(String(transaction.id));
	row.classList.toggle("is-selected", selected);
	const selectCell = row.querySelector('[data-field="select"]');
	const checkbox = document.createElement("input");
	checkbox.type = "checkbox";
	checkbox.checked = selected;
	checkbox.setAttribute(
		"aria-label",
		`Seleccionar ${transaction.counterparty || transaction.description || "movimiento"}`,
	);
	checkbox.addEventListener("change", () => {
		toggleTransactionSelection(transaction.id, checkbox.checked);
	});
	selectCell.append(checkbox);

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
	const counterpartyCell = row.querySelector('[data-field="counterparty"]');
	counterpartyCell.replaceChildren(
		renderCounterpartyCell(transaction, visibleTransactions),
	);
	counterpartyCell.title = transaction.counterparty || "";
	row
		.querySelector('[data-field="category"]')
		.replaceChildren(renderCategoryBadge(transaction));
	row
		.querySelector('[data-action="view"]')
		.addEventListener("click", () => openModal(transaction.id));

	return row;
}

function renderCounterpartyCell(transaction, visibleTransactions) {
	const wrapper = document.createElement("div");
	wrapper.className = "counterparty-cell";
	const name = document.createElement("span");
	name.className = "counterparty-name";
	name.textContent = transaction.counterparty || "—";
	wrapper.append(name);

	const key = counterpartySelectionKey(transaction);
	const sameCounterparty = visibleTransactions.filter(
		(tx) => counterpartySelectionKey(tx) === key,
	);
	if (sameCounterparty.length > 1) {
		const allSameSelected = sameCounterparty.every((tx) =>
			state.selectedTransactionIds.has(String(tx.id)),
		);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "counterparty-select-chip";
		button.textContent = allSameSelected
			? `${sameCounterparty.length} seleccionados`
			: `${sameCounterparty.length} similares`;
		button.disabled = allSameSelected;
		button.setAttribute(
			"aria-label",
			allSameSelected
				? `${sameCounterparty.length} movimientos visibles de ${transaction.counterparty || "sin comercio o persona"} ya seleccionados`
				: `Preparar selección de ${sameCounterparty.length} movimientos visibles de ${transaction.counterparty || "sin comercio o persona"}`,
		);
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			requestCounterpartySelection(
				key,
				transaction.counterparty || "sin comercio o persona",
			);
			render();
		});
		wrapper.append(button);
	}

	return wrapper;
}

function counterpartySelectionKey(transaction) {
	return (
		transaction.counterpartyKey ||
		normalizeCounterpartyForUI(
			transaction.counterparty || "Sin comercio o persona",
		)
	);
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
		let update;
		if (DEMO_MODE) {
			update = { id: state.activeId, ...patch };
		} else {
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
			const payload = await response.json();
			if (!response.ok) {
				modalStatus.textContent = payload.error || "No se pudo guardar.";
				return;
			}
			update = payload.transaction || { id: state.activeId, ...patch };
		}
		modalStatus.textContent = "Guardado ✓";
		applyTransactionUpdatesLocally([update]);
		const returnKey = state.returnToCounterpartyKey;
		closeModal({ preserveCounterpartyReturn: Boolean(returnKey) });
		render();
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
	const transactionId = state.activeId;
	const name =
		(transaction && transaction.counterparty) ||
		(transaction && transaction.description) ||
		"este gasto";
	if (!confirm(`¿Eliminar ${name}?`)) return;

	try {
		const params = new URLSearchParams({ month: state.selectedMonth });
		const response = await fetch(
			`/api/transactions/${encodeURIComponent(transactionId)}?${params}`,
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
		invalidateTransactionReplacement();
		state.transactions = state.transactions.filter(
			(tx) => tx.id !== transactionId,
		);
		pruneSelectedTransactions();
		if (state.activeId === transactionId) closeModal();
		render();
	} catch (error) {
		modalStatus.textContent = `Error: ${error.message}`;
	}
}

function startGmailSyncProgress(owner) {
	gmailSyncProgressOwner = owner;
	state.isGmailSyncing = true;
	syncGmailButton.disabled = true;
	gmailSyncProgress.hidden = false;
	gmailSyncProgressFill.style.width = "8%";
	showGmailSyncMessage();

	let progress = 8;
	gmailSyncTimer = setInterval(() => {
		if (gmailSyncProgressOwner !== owner || !isCurrentOwner(owner)) return;
		progress = Math.min(progress + (progress < 70 ? 12 : 4), 92);
		gmailSyncProgressFill.style.width = `${progress}%`;
	}, 220);
}

function resetGmailSyncProgress(owner) {
	if (!owner || gmailSyncProgressOwner !== owner) return false;
	if (gmailSyncTimer) clearInterval(gmailSyncTimer);
	if (gmailSyncFinishTimer) clearTimeout(gmailSyncFinishTimer);
	gmailSyncTimer = null;
	gmailSyncFinishTimer = null;
	gmailSyncProgressOwner = null;
	gmailSyncProgressFill.style.width = "8%";
	gmailSyncProgress.hidden = true;
	state.isGmailSyncing = false;
	syncGmailButton.disabled = syncGmailButton.hidden;
	if (gmailSyncFinishResolve) {
		const resolve = gmailSyncFinishResolve;
		gmailSyncFinishResolve = null;
		resolve(false);
	}
	return true;
}

function stopGmailSyncProgress(owner) {
	if (gmailSyncProgressOwner !== owner || !isCurrentOwner(owner)) {
		return Promise.resolve(false);
	}
	if (gmailSyncTimer) clearInterval(gmailSyncTimer);
	gmailSyncTimer = null;
	gmailSyncProgressFill.style.width = "100%";
	return new Promise((resolve) => {
		gmailSyncFinishResolve = resolve;
		gmailSyncFinishTimer = setTimeout(() => {
			if (gmailSyncProgressOwner !== owner || !isCurrentOwner(owner)) return;
			gmailSyncFinishResolve = null;
			gmailSyncFinishTimer = null;
			resetGmailSyncProgress(owner);
			resolve(true);
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
