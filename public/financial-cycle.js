import { ReviewPeriod } from "./review-period.js";

function initialState(referenceDate = new Date()) {
	const period = ReviewPeriod.currentMonth(referenceDate);
	return {
		startDate: period.startDate,
		endDate: period.visibleEndDate,
		period: null,
		incomeAmount: null,
		savedIncomeAmount: null,
		configured: false,
		saving: false,
		outcome: "",
		error: "",
		errorField: "",
	};
}

function validateForm(state) {
	if (!state.startDate) return { ...state, error: "Selecciona la fecha Desde.", errorField: "startDate" };
	if (!state.endDate) return { ...state, error: "Selecciona la fecha Hasta.", errorField: "endDate" };
	let period;
	try {
		period = ReviewPeriod.fromInclusive(state.startDate, state.endDate).toJSON();
	} catch {
		return { ...state, error: "La fecha Hasta debe ser igual o posterior a la fecha Desde.", errorField: "endDate" };
	}
	const rawIncome = state.incomeAmount == null ? "" : String(state.incomeAmount).trim();
	const incomeAmount = rawIncome === "" ? null : Number(rawIncome);
	if (incomeAmount !== null && (!Number.isSafeInteger(incomeAmount) || incomeAmount <= 0)) {
		return { ...state, error: "Ingresa un monto entero positivo en CLP.", errorField: "incomeAmount" };
	}
	return { ...state, period, incomeAmount, error: "", errorField: "" };
}

export function wizardReducer(state = initialState(), action) {
	switch (action.type) {
		case "SET_FORM":
			return { ...state, startDate: action.startDate, endDate: action.endDate, incomeAmount: action.incomeAmount, outcome: "", error: "", errorField: "" };
		case "VALIDATE":
			return validateForm(state);
		case "SAVING":
			return { ...state, saving: true, outcome: "saving", error: "", errorField: "" };
		case "SAVED":
			return { ...state, saving: false, configured: true, savedIncomeAmount: state.incomeAmount, outcome: "success", error: "", errorField: "" };
		case "SAVE_FAILED":
			return { ...state, saving: false, outcome: "error", error: "No fue posible guardar la configuración. Intenta nuevamente.", errorField: "" };
		case "HYDRATE": {
			const savedPeriod = ReviewPeriod.create(action.period);
			return {
				...state,
				startDate: savedPeriod.startDate,
				endDate: savedPeriod.visibleEndDate,
				period: savedPeriod.toJSON(),
				incomeAmount: action.incomeAmount ?? null,
				savedIncomeAmount: action.incomeAmount ?? null,
				configured: true,
				error: "",
				errorField: "",
			};
		}
		case "OPEN": {
			if (!state.configured || !state.period) return { ...state, outcome: "", error: "", errorField: "" };
			const savedPeriod = ReviewPeriod.create(state.period);
			return { ...state, startDate: savedPeriod.startDate, endDate: savedPeriod.visibleEndDate, incomeAmount: state.savedIncomeAmount, outcome: "", error: "", errorField: "" };
		}
		default:
			return state;
	}
}

export function createAuthenticatedAdapter(fetcher = fetch) {
	async function request(url, method, body) {
		const options = { method, headers: { "content-type": "application/json" } };
		if (body !== undefined) options.body = JSON.stringify(body);
		const response = await fetcher(url, options);
		const data = await response.json();
		if (!response.ok) return { outcome: data.outcome ?? "error", ...data };
		return data;
	}
	return {
		load: () => request("/api/financial-cycle", "GET"),
		save: (selectedPeriod, incomeAmount) => request("/api/financial-cycle", "PUT", { selectedPeriod, incomeAmount }),
	};
}

export function createDemoAdapter() {
	return {
		load: async () => null,
		save: async (selectedPeriod, incomeAmount) => ({ selectedPeriod, incomeAmount }),
	};
}

export function createWizardController({ adapter, onChange = () => {}, now = new Date() }) {
	let savePromise = null;
	const controller = {
		state: initialState(now),
		dispatch(action) {
			this.state = wizardReducer(this.state, action);
			onChange(this.state);
			return this.state;
		},
		async bootstrap() {
			const settings = await adapter.load();
			if (settings?.selectedPeriod) this.dispatch({ type: "HYDRATE", period: settings.selectedPeriod, incomeAmount: settings.incomeAmount });
			else onChange(this.state);
			return this.state.configured;
		},
		save(values) {
			if (savePromise) return savePromise;
			this.dispatch({ type: "SET_FORM", ...values });
			this.dispatch({ type: "VALIDATE" });
			if (this.state.error) return Promise.resolve(this.state);
			this.dispatch({ type: "SAVING" });
			savePromise = (async () => {
				try {
					const saved = await adapter.save(this.state.period, this.state.incomeAmount);
					if (saved?.outcome && saved.outcome !== "success") throw new Error("settings save failed");
					this.dispatch({ type: "SAVED" });
				} catch {
					this.dispatch({ type: "SAVE_FAILED" });
				} finally {
					savePromise = null;
				}
				return this.state;
			})();
			return savePromise;
		},
	};
	return controller;
}

export function focusHeading(dialog) { dialog.querySelector("[data-wizard-heading]")?.focus(); }
export function restoreFocus(invoker) { invoker?.focus?.(); }
export function trapFocus(event, root) {
	if (event.key !== "Tab") return;
	const items = [...root.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), a[href]:not([hidden])')];
	if (!items.length) return;
	const [first, last] = [items[0], items.at(-1)];
	if ((!event.shiftKey && event.target === last) || (event.shiftKey && event.target === first)) {
		event.preventDefault();
		(event.shiftKey ? last : first).focus();
	}
}

export function mountFinancialCycleWizard({ dialog, reopen, demo = false, fetcher = fetch, onSaved = () => {}, now = new Date() }) {
	if (!dialog || !reopen) return null;
	let invoker = reopen;
	const $ = (name) => dialog.querySelector(`[data-wizard-${name}]`);
	const controller = createWizardController({ adapter: demo ? createDemoAdapter() : createAuthenticatedAdapter(fetcher), onChange: render, now });

	function open(from = reopen) {
		invoker = from;
		controller.dispatch({ type: "OPEN" });
		dialog.showModal();
		focusHeading(dialog);
	}

	function render(state) {
		$("start").value = state.startDate;
		$("end").value = state.endDate;
		$("income-input").value = state.incomeAmount ?? "";
		$("error").textContent = state.error;
		$("status").textContent = state.saving ? "Guardando configuración..." : "";
		$("save").disabled = state.saving;
		$("save").textContent = state.configured ? "Guardar cambios" : "Guardar configuración";
		$("cancel").hidden = !state.configured;
		for (const [field, name] of [["startDate", "start"], ["endDate", "end"], ["incomeAmount", "income-input"]]) {
			$(name).setAttribute("aria-invalid", String(state.errorField === field));
		}
	}

	reopen.addEventListener("click", () => open());
	dialog.addEventListener("keydown", (event) => trapFocus(event, dialog));
	dialog.addEventListener("close", () => restoreFocus(invoker));
	dialog.addEventListener("cancel", (event) => {
		if (!controller.state.configured) event.preventDefault();
	});
	$("cancel").addEventListener("click", () => {
		if (controller.state.configured) dialog.close();
	});
	$("form").addEventListener("submit", async (event) => {
		event.preventDefault();
		if (controller.state.saving) return;
		const state = await controller.save({ startDate: $("start").value, endDate: $("end").value, incomeAmount: $("income-input").value });
		if (state.errorField) {
			({ startDate: $("start"), endDate: $("end"), incomeAmount: $("income-input") })[state.errorField]?.focus();
			return;
		}
		if (state.outcome !== "success") return;
		dialog.close();
		Promise.resolve(onSaved({ period: state.period, incomeAmount: state.incomeAmount })).catch(() => {});
	});

	const ready = controller.bootstrap().then((configured) => {
		if (!configured) open();
		return !configured;
	}).catch(() => {
		open();
		return true;
	});
	return { open, controller, ready, get incomplete() { return !controller.state.configured; } };
}
