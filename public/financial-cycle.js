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
	if (!state.startDate)
		return {
			...state,
			error: "Selecciona la fecha Desde.",
			errorField: "startDate",
		};
	if (!state.endDate)
		return {
			...state,
			error: "Selecciona la fecha Hasta.",
			errorField: "endDate",
		};
	let period;
	try {
		period = ReviewPeriod.fromInclusive(state.startDate, state.endDate).toJSON();
	} catch {
		return {
			...state,
			error: "La fecha Hasta debe ser igual o posterior a la fecha Desde.",
			errorField: "endDate",
		};
	}
	const rawIncome =
		state.incomeAmount == null ? "" : String(state.incomeAmount).trim();
	const incomeAmount = rawIncome === "" ? null : Number(rawIncome);
	if (
		incomeAmount !== null &&
		(!Number.isSafeInteger(incomeAmount) || incomeAmount <= 0)
	) {
		return {
			...state,
			error: "Ingresa un monto entero positivo en CLP.",
			errorField: "incomeAmount",
		};
	}
	return { ...state, period, incomeAmount, error: "", errorField: "" };
}

export function wizardReducer(state = initialState(), action) {
	switch (action.type) {
		case "SET_FORM":
			return {
				...state,
				startDate: action.startDate,
				endDate: action.endDate,
				incomeAmount: action.incomeAmount,
				outcome: "",
				error: "",
				errorField: "",
			};
		case "VALIDATE":
			return validateForm(state);
		case "SAVING":
			return {
				...state,
				saving: true,
				outcome: "saving",
				error: "",
				errorField: "",
			};
		case "SAVED":
			return {
				...state,
				saving: false,
				configured: true,
				savedIncomeAmount: state.incomeAmount,
				outcome: "success",
				error: "",
				errorField: "",
			};
		case "SAVE_FAILED":
			return {
				...state,
				saving: false,
				outcome: "error",
				error: "No fue posible guardar la configuración. Intenta nuevamente.",
				errorField: "",
			};
		case "LOADING":
			return { ...state, outcome: "loading", error: "" };
		case "LOAD_FAILED":
			return {
				...state,
				outcome: "load-error",
				error: "No fue posible cargar tu período. Reintenta antes de continuar.",
			};
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
				outcome: "",
				error: "",
				errorField: "",
			};
		}
		case "OPEN": {
			if (!state.configured || !state.period)
				return { ...state, outcome: "", error: "", errorField: "" };
			const savedPeriod = ReviewPeriod.create(state.period);
			return {
				...state,
				startDate: savedPeriod.startDate,
				endDate: savedPeriod.visibleEndDate,
				incomeAmount: state.savedIncomeAmount,
				outcome: "",
				error: "",
				errorField: "",
			};
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
		if (!response.ok) throw new Error("settings request failed");
		return data;
	}
	return {
		load: () => request("/api/financial-cycle", "GET"),
		save: (selectedPeriod, incomeAmount) =>
			request("/api/financial-cycle", "PUT", { selectedPeriod, incomeAmount }),
	};
}

export function createDemoAdapter() {
	return {
		load: async () => null,
		save: async (selectedPeriod, incomeAmount) => ({
			selectedPeriod,
			incomeAmount,
		}),
	};
}

export function createWizardController({
	adapter,
	onChange = () => {},
	now = new Date(),
}) {
	let savePromise = null;
	const controller = {
		state: initialState(now),
		dispatch(action) {
			this.state = wizardReducer(this.state, action);
			onChange(this.state);
			return this.state;
		},
		async bootstrap() {
			this.dispatch({ type: "LOADING" });
			try {
				const settings = await adapter.load();
				if (settings?.outcome && settings.outcome !== "success")
					throw new Error("settings load failed");
				if (settings?.selectedPeriod)
					this.dispatch({
						type: "HYDRATE",
						period: settings.selectedPeriod,
						incomeAmount: settings.incomeAmount,
					});
				else this.dispatch({ type: "OPEN" });
			} catch {
				this.dispatch({ type: "LOAD_FAILED" });
			}
			return this.state.configured;
		},
		save(values) {
			if (["loading", "load-error"].includes(this.state.outcome))
				return Promise.resolve(this.state);
			if (savePromise) return savePromise;
			this.dispatch({ type: "SET_FORM", ...values });
			this.dispatch({ type: "VALIDATE" });
			if (this.state.error) return Promise.resolve(this.state);
			this.dispatch({ type: "SAVING" });
			savePromise = (async () => {
				try {
					const saved = await adapter.save(
						this.state.period,
						this.state.incomeAmount,
					);
					if (saved?.outcome && saved.outcome !== "success")
						throw new Error("settings save failed");
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

export function focusHeading(dialog) {
	dialog.querySelector("[data-wizard-heading]")?.focus();
}
export function restoreFocus(invoker) {
	invoker?.focus?.();
}
export function trapFocus(event, root) {
	if (event.key !== "Tab") return;
	const items = [
		...root.querySelectorAll(
			"button:not([disabled]):not([hidden]), input:not([disabled]), a[href]:not([hidden])",
		),
	];
	if (!items.length) return;
	const [first, last] = [items[0], items.at(-1)];
	if (
		(!event.shiftKey && event.target === last) ||
		(event.shiftKey && event.target === first)
	) {
		event.preventDefault();
		(event.shiftKey ? last : first).focus();
	}
}

export function mountFinancialCycleWizard({
	dialog,
	reopen,
	demo = false,
	fetcher = fetch,
	onSaved = () => {},
	now = new Date(),
}) {
	if (!dialog || !reopen) return null;
	let invoker = reopen;
	let calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	let rangeStart = null;
	const $ = (name) => dialog.querySelector(`[data-wizard-${name}]`);
	const controller = createWizardController({
		adapter: demo ? createDemoAdapter() : createAuthenticatedAdapter(fetcher),
		onChange: render,
		now,
	});

	function open(from = reopen) {
		invoker = from;
		if (["loading", "load-error"].includes(controller.state.outcome)) return;
		rangeStart = null;
		controller.dispatch({ type: "OPEN" });
		calendarMonth = new Date(`${controller.state.startDate}T12:00:00`);
		renderCalendar();
		dialog.showModal();
		focusHeading(dialog);
	}

	function dateKey(date) {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	}

	function renderCalendar() {
		const root = $("calendar");
		if (!root) return;
		const year = calendarMonth.getFullYear();
		const month = calendarMonth.getMonth();
		const first = new Date(year, month, 1);
		const today = dateKey(now);
		const label = first.toLocaleDateString("es-CL", {
			month: "long",
			year: "numeric",
		});
		function element(tag, text, attributes = {}) {
			const node = root.ownerDocument.createElement(tag);
			node.textContent = text;
			for (const [name, value] of Object.entries(attributes))
				node.setAttribute(name, String(value));
			return node;
		}
		const nav = element("div", "", { class: "cycle-calendar-nav" });
		nav.append(
			element("button", "‹", {
				type: "button",
				"data-month": -1,
				"aria-label": "Mes anterior",
			}),
			element("strong", label, { "aria-live": "polite" }),
			element("button", "›", {
				type: "button",
				"data-month": 1,
				"aria-label": "Mes siguiente",
			}),
		);
		const days = element("div", "", { class: "cycle-calendar-days" });
		for (const name of ["L", "M", "M", "J", "V", "S", "D"])
			days.append(element("span", name, { "aria-hidden": true }));
		for (let offset = 0; offset < (first.getDay() + 6) % 7; offset++)
			days.append(element("span", "", { "aria-hidden": true }));
		for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
			const key = dateKey(new Date(year, month, day));
			const selected = key >= $("start").value && key <= $("end").value;
			const button = element("button", String(day), {
				type: "button",
				"data-date": key,
				"aria-label": key,
				"aria-pressed": selected,
				class: `cycle-day${key > today ? " is-future" : ""}`,
			});
			if (key === today) button.setAttribute("aria-current", "date");
			days.append(button);
		}
		root.replaceChildren(nav, days);
	}

	$("calendar")?.addEventListener("click", (event) => {
		const target = event.target.closest("button");
		if (!target || ["loading", "load-error"].includes(controller.state.outcome))
			return;
		if (target.dataset.month) {
			calendarMonth = new Date(
				calendarMonth.getFullYear(),
				calendarMonth.getMonth() + Number(target.dataset.month),
				1,
			);
		} else if (target.dataset.date) {
			const key = target.dataset.date;
			if (!rangeStart) {
				rangeStart = key;
				$("start").value = key;
				$("end").value = key;
			} else {
				$("start").value = key < rangeStart ? key : rangeStart;
				$("end").value = key > rangeStart ? key : rangeStart;
				rangeStart = null;
			}
		}
		renderCalendar();
		const selector = target.dataset.date
			? `[data-date="${target.dataset.date}"]`
			: `[data-month="${target.dataset.month}"]`;
		$("calendar").querySelector(selector)?.focus();
	});
	for (const name of ["start", "end"]) {
		$(name).addEventListener("change", () => {
			rangeStart = null;
			if ($(name).value) calendarMonth = new Date(`${$(name).value}T12:00:00`);
			renderCalendar();
		});
	}

	function render(state) {
		$("start").value = state.startDate;
		$("end").value = state.endDate;
		$("income-input").value = state.incomeAmount ?? "";
		$("error").textContent = state.error;
		renderCalendar();
		$("status").textContent = state.saving ? "Guardando configuración..." : "";
		$("save").disabled =
			state.saving || ["loading", "load-error"].includes(state.outcome);
		if ($("retry")) $("retry").hidden = state.outcome !== "load-error";
		$("save").textContent = state.configured
			? "Guardar cambios"
			: "Guardar configuración";
		$("cancel").hidden = !state.configured;
		for (const [field, name] of [
			["startDate", "start"],
			["endDate", "end"],
			["incomeAmount", "income-input"],
		]) {
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
		const state = await controller.save({
			startDate: $("start").value,
			endDate: $("end").value,
			incomeAmount: $("income-input").value,
		});
		if (state.errorField) {
			({
				startDate: $("start"),
				endDate: $("end"),
				incomeAmount: $("income-input"),
			})[state.errorField]?.focus();
			return;
		}
		if (state.outcome !== "success") return;
		dialog.close();
		Promise.resolve(
			onSaved({ period: state.period, incomeAmount: state.incomeAmount }),
		).catch(() => {});
	});

	async function bootstrap(retry = false) {
		if (retry && controller.state.outcome === "loading") return;
		const configured = await controller.bootstrap();
		if (!configured) {
			if (!dialog.open) dialog.showModal();
			focusHeading(dialog);
		} else if (retry) {
			dialog.close();
			await onSaved({
				period: controller.state.period,
				incomeAmount: controller.state.incomeAmount,
			});
		}
		return !configured;
	}
	$("retry")?.addEventListener("click", () => bootstrap(true));
	const ready = bootstrap();
	return {
		open,
		controller,
		ready,
		get incomplete() {
			return !controller.state.configured;
		},
	};
}
