import { ReviewPeriod } from "./review-period.js";

const initialState = () => ({ step: 1, startDate: "", endDate: "", period: null, incomeAmount: null, error: "", errorField: "", progress: 0, outcome: "", transactions: null, completed: false });

export function wizardReducer(state = initialState(), action) {
	switch (action.type) {
		case "SET_DATES": return { ...state, startDate: action.startDate, endDate: action.endDate, error: "", errorField: "" };
		case "NEXT": {
			try { return { ...state, step: 2, period: ReviewPeriod.fromInclusive(state.startDate, state.endDate).toJSON(), error: "", errorField: "" }; }
			catch (error) { return { ...state, error: error.message, errorField: "endDate" }; }
		}
		case "SET_INCOME": return { ...state, incomeAmount: action.incomeAmount === "" ? null : Number(action.incomeAmount), error: "", errorField: "" };
		case "SKIP_INCOME": return { ...state, step: 3, incomeAmount: null };
		case "CONTINUE_INCOME": return state.incomeAmount === null || (Number.isSafeInteger(state.incomeAmount) && state.incomeAmount > 0)
			? { ...state, step: 3 }
			: { ...state, error: "Ingresa un monto entero positivo en CLP.", errorField: "incomeAmount" };
		case "SYNCING": return { ...state, progress: 18, outcome: "syncing", error: "" };
		case "RESULT": return { ...state, progress: action.result.outcome === "success" ? 100 : 65, outcome: action.result.outcome, transactions: action.result.transactions ?? 0, completed: action.result.outcome === "success", error: action.result.error ?? "" };
		case "RETRY": return { ...state, outcome: "", error: "", progress: 0 };
		case "OPEN": return { ...state, step: 1, error: "", errorField: "", outcome: "" };
		default: return state;
	}
}

export function createAuthenticatedAdapter(fetcher = fetch) {
	async function request(url, method, body) {
		const response = await fetcher(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		const data = await response.json();
		if (!response.ok) return { outcome: data.outcome ?? (response.status === 409 ? "disconnected" : "error"), ...data };
		return data;
	}
	return { load: () => request("/api/financial-cycle", "GET"), save: (selectedPeriod, incomeAmount) => request("/api/financial-cycle", "PUT", { selectedPeriod, incomeAmount }), complete: (period) => request("/api/financial-cycle/complete", "POST", { period }) };
}

export function createDemoAdapter() {
	return { load: async () => null, save: async (selectedPeriod, incomeAmount) => ({ selectedPeriod, incomeAmount }), complete: async () => ({ outcome: "success", scanned: 0, transactions: 0, completedAt: "demo" }) };
}

export function createWizardController({ adapter, onChange = () => {} }) {
	const controller = { state: initialState(), dispatch(action) { this.state = wizardReducer(this.state, action); onChange(this.state); return this.state; }, async bootstrap() { const settings = await adapter.load(); this.state = { ...this.state, period: settings?.selectedPeriod ?? null, incomeAmount: settings?.incomeAmount ?? null, completed: Boolean(settings?.completedAt) }; onChange(this.state); return this.state.completed; }, async sync() { this.dispatch({ type: "SYNCING" }); try { const saved = await adapter.save(this.state.period, this.state.incomeAmount); if (saved?.outcome && saved.outcome !== "success") throw new Error("settings save failed"); this.dispatch({ type: "RESULT", result: await adapter.complete(this.state.period) }); } catch { this.dispatch({ type: "RESULT", result: { outcome: "error" } }); } return this.state; } };
	return controller;
}

export function focusHeading(dialog) { dialog.querySelector("[data-wizard-heading]")?.focus(); }
export function restoreFocus(invoker) { invoker?.focus?.(); }
export function trapFocus(event, root) {
	if (event.key !== "Tab") return;
	const items = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')];
	if (!items.length) return;
	const [first, last] = [items[0], items.at(-1)];
	if ((!event.shiftKey && event.target === last) || (event.shiftKey && event.target === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
}

export function mountFinancialCycleWizard({ dialog, reopen, demo = false, fetcher = fetch, onCompleted = () => {} }) {
	if (!dialog || !reopen) return null;
	let invoker = reopen;
	const controller = createWizardController({ adapter: demo ? createDemoAdapter() : createAuthenticatedAdapter(fetcher), onChange: render });
	const $ = (name) => dialog.querySelector(`[data-wizard-${name}]`);
	const today = new Date();
	const dateText = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	$("start").value = dateText(new Date(today.getFullYear(), today.getMonth(), 1));
	$("end").value = dateText(new Date(today.getFullYear(), today.getMonth() + 1, 0));
	function open(from = reopen) { invoker = from; controller.dispatch({ type: "OPEN" }); dialog.showModal(); focusHeading(dialog); }
	function render(state) {
		dialog.dataset.step = state.step; $("step").textContent = `Paso ${state.step} de 3`;
		$("progress").style.width = `${state.step * 33}%`; $("error").textContent = state.error;
		$("status").textContent = state.outcome === "success" ? `Listo: ${state.transactions} movimientos sincronizados.` : state.outcome === "disconnected" ? "Conecta Gmail para continuar." : state.outcome === "partial" ? "La sincronización fue parcial. Puedes reintentar." : state.outcome === "error" ? "No fue posible sincronizar. Puedes reintentar." : state.outcome === "syncing" ? "Sincronizando movimientos..." : "";
		$("period").hidden = state.step !== 1; $("income").hidden = state.step !== 2; $("sync").hidden = state.step !== 3;
		$("retry").hidden = !["partial", "error"].includes(state.outcome); $("connect").hidden = state.outcome !== "disconnected"; $("close").hidden = !state.completed;
	}
	reopen.addEventListener("click", () => open()); dialog.addEventListener("keydown", (event) => trapFocus(event, dialog));
	$("next").addEventListener("click", () => { controller.dispatch({ type: "SET_DATES", startDate: $("start").value, endDate: $("end").value }); controller.dispatch({ type: "NEXT" }); });
	$("income-next").addEventListener("click", () => { controller.dispatch({ type: "SET_INCOME", incomeAmount: $("income-input").value }); controller.dispatch({ type: "CONTINUE_INCOME" }); });
	$("skip").addEventListener("click", () => controller.dispatch({ type: "SKIP_INCOME" }));
	async function syncAndApply() {
		await controller.sync();
		if (controller.state.completed) {
			onCompleted({ period: controller.state.period, incomeAmount: controller.state.incomeAmount });
		}
	}
	$("sync-button").addEventListener("click", syncAndApply); $("retry").addEventListener("click", () => { controller.dispatch({ type: "RETRY" }); syncAndApply(); });
	$("close").addEventListener("click", () => { dialog.close(); restoreFocus(invoker); }); dialog.addEventListener("cancel", (event) => { if (!controller.state.completed) event.preventDefault(); });
	controller.bootstrap().then((completed) => { if (!completed) open(); }).catch(() => open());
	return { open, controller };
}
