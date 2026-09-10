import { formatReadableDateOnly } from "./date-format.js";
import { ReviewPeriod } from "./review-period.js";

function incomeDigits(value) {
	return String(value ?? "").replace(/\D/g, "");
}

function formatClpDigits(digits) {
	return digits ? `$ ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}` : "";
}

export function formatClpIncomeEdit(
	value,
	selectionStart = String(value ?? "").length,
) {
	const source = String(value ?? "");
	const digitsBeforeCaret = incomeDigits(source.slice(0, selectionStart)).length;
	const formatted = formatClpDigits(incomeDigits(source));
	if (!formatted) return { value: "", selectionStart: 0 };
	if (!digitsBeforeCaret) return { value: formatted, selectionStart: 2 };
	let seen = 0;
	let caret = formatted.length;
	for (let index = 0; index < formatted.length; index++) {
		if (/\d/.test(formatted[index])) seen += 1;
		if (seen === digitsBeforeCaret) {
			caret = index + 1;
			break;
		}
	}
	return { value: formatted, selectionStart: caret };
}

function initialState(referenceDate = new Date()) {
	const period = ReviewPeriod.currentMonth(referenceDate);
	return {
		startDate: period.startDate,
		endDate: period.visibleEndDate,
		period: null,
		savedPeriod: null,
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
				period: action.period,
				savedPeriod: action.period,
				incomeAmount: action.incomeAmount,
				savedIncomeAmount: action.incomeAmount,
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
				savedPeriod: savedPeriod.toJSON(),
				incomeAmount: action.incomeAmount ?? null,
				savedIncomeAmount: action.incomeAmount ?? null,
				configured: true,
				outcome: "",
				error: "",
				errorField: "",
			};
		}
		case "OPEN": {
			if (!state.configured || !state.savedPeriod)
				return { ...state, outcome: "", error: "", errorField: "" };
			const savedPeriod = ReviewPeriod.create(state.savedPeriod);
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
			const submission = {
				period: { ...this.state.period },
				incomeAmount: this.state.incomeAmount,
			};
			this.dispatch({ type: "SAVING" });
			savePromise = (async () => {
				try {
					const saved = await adapter.save(
						submission.period,
						submission.incomeAmount,
					);
					if (saved?.outcome && saved.outcome !== "success")
						throw new Error("settings save failed");
					this.dispatch({ type: "SAVED", ...submission });
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
	let awaitingRangeEnd = false;
	let focusedDate = null;
	const $ = (name) => dialog.querySelector(`[data-wizard-${name}]`);
	const controller = createWizardController({
		adapter: demo ? createDemoAdapter() : createAuthenticatedAdapter(fetcher),
		onChange: render,
		now,
	});

	function open(from = reopen) {
		invoker = from;
		if (["loading", "load-error"].includes(controller.state.outcome)) return;
		awaitingRangeEnd = false;
		controller.dispatch({ type: "OPEN" });
		focusedDate = controller.state.startDate;
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
		const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
		const tabbableDate =
			[focusedDate, controller.state.startDate].find((key) =>
				key?.startsWith(monthPrefix),
			) ?? dateKey(first);
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
		const previousMonth = element("button", "‹", {
			type: "button",
			"data-month": -1,
			"aria-label": "Mes anterior",
		});
		const nextMonth = element("button", "›", {
			type: "button",
			"data-month": 1,
			"aria-label": "Mes siguiente",
		});
		previousMonth.disabled = controller.state.saving;
		nextMonth.disabled = controller.state.saving;
		nav.append(
			previousMonth,
			element("strong", label, { "aria-live": "polite" }),
			nextMonth,
		);
		const days = element("div", "", { class: "cycle-calendar-days" });
		for (const name of ["L", "M", "M", "J", "V", "S", "D"])
			days.append(element("span", name, { "aria-hidden": true }));
		for (let offset = 0; offset < (first.getDay() + 6) % 7; offset++)
			days.append(element("span", "", { "aria-hidden": true }));
		for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
			const key = dateKey(new Date(year, month, day));
			const selected = controller.state.endDate
				? key >= controller.state.startDate && key <= controller.state.endDate
				: key === controller.state.startDate;
			const button = element("button", String(day), {
				type: "button",
				"data-date": key,
				"aria-label": formatReadableDateOnly(key),
				"aria-describedby": "financialCycleCalendarHelp",
				"aria-pressed": selected,
				tabindex: key === tabbableDate ? 0 : -1,
				class: `cycle-day${key > today ? " is-future" : ""}`,
			});
			button.disabled = controller.state.saving;
			if (key === today) button.setAttribute("aria-current", "date");
			days.append(button);
		}
		root.replaceChildren(nav, days);
	}

	function calendarTarget(event) {
		return event.target?.closest?.("button") ?? event.target;
	}

	function focusRenderedDate(key) {
		$("calendar").querySelector(`[data-date="${key}"]`)?.focus();
	}

	$("calendar")?.addEventListener("click", (event) => {
		const target = calendarTarget(event);
		if (
			!target?.dataset ||
			controller.state.saving ||
			["loading", "load-error"].includes(controller.state.outcome)
		)
			return;
		if (target.dataset.month) {
			calendarMonth = new Date(
				calendarMonth.getFullYear(),
				calendarMonth.getMonth() + Number(target.dataset.month),
				1,
			);
			focusedDate = dateKey(calendarMonth);
			renderCalendar();
			$("calendar")
				.querySelector(`[data-month="${target.dataset.month}"]`)
				?.focus();
			return;
		}
		if (!target.dataset.date) return;
		const key = target.dataset.date;
		focusedDate = key;
		if (!awaitingRangeEnd) {
			awaitingRangeEnd = true;
			controller.dispatch({
				type: "SET_FORM",
				startDate: key,
				endDate: "",
				incomeAmount: incomeDigits($("income-input").value),
			});
		} else {
			awaitingRangeEnd = false;
			controller.dispatch({
				type: "SET_FORM",
				startDate:
					key < controller.state.startDate ? key : controller.state.startDate,
				endDate:
					key > controller.state.startDate ? key : controller.state.startDate,
				incomeAmount: incomeDigits($("income-input").value),
			});
		}
		focusRenderedDate(key);
	});

	$("calendar")?.addEventListener("keydown", (event) => {
		const target = calendarTarget(event);
		if (controller.state.saving || !target?.dataset?.date) return;
		const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
		const current = new Date(`${target.dataset.date}T12:00:00`);
		if (event.key in offsets)
			current.setDate(current.getDate() + offsets[event.key]);
		else if (["PageUp", "PageDown"].includes(event.key)) {
			const day = current.getDate();
			const direction = event.key === "PageUp" ? -1 : 1;
			current.setDate(1);
			current.setMonth(current.getMonth() + direction);
			current.setDate(
				Math.min(
					day,
					new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate(),
				),
			);
		} else return;
		event.preventDefault();
		focusedDate = dateKey(current);
		calendarMonth = new Date(current.getFullYear(), current.getMonth(), 1);
		renderCalendar();
		focusRenderedDate(focusedDate);
	});

	$("income-input").addEventListener("input", (event) => {
		if (controller.state.saving) return;
		const input = event.target;
		const formatted = formatClpIncomeEdit(input.value, input.selectionStart);
		controller.dispatch({
			type: "SET_FORM",
			startDate: controller.state.startDate,
			endDate: controller.state.endDate,
			incomeAmount: incomeDigits(input.value),
		});
		input.value = formatted.value;
		input.setSelectionRange?.(formatted.selectionStart, formatted.selectionStart);
	});

	function render(state) {
		$("start-summary").textContent = state.startDate
			? formatReadableDateOnly(state.startDate)
			: "Pendiente";
		$("end-summary").textContent = state.endDate
			? formatReadableDateOnly(state.endDate)
			: "Pendiente";
		$("income-input").value = formatClpDigits(incomeDigits(state.incomeAmount));
		$("error").textContent = state.error;
		$("calendar").setAttribute(
			"aria-invalid",
			String(["startDate", "endDate"].includes(state.errorField)),
		);
		renderCalendar();
		$("status").textContent = state.saving ? "Guardando configuración..." : "";
		$("save").disabled =
			state.saving || ["loading", "load-error"].includes(state.outcome);
		$("income-input").disabled = state.saving;
		$("cancel").disabled = state.saving;
		if ($("retry")) $("retry").hidden = state.outcome !== "load-error";
		$("save").textContent = state.configured
			? "Guardar cambios"
			: "Guardar configuración";
		$("cancel").hidden = !state.configured;
		$("income-input").setAttribute(
			"aria-invalid",
			String(state.errorField === "incomeAmount"),
		);
	}

	reopen.addEventListener("click", () => open());
	dialog.addEventListener("keydown", (event) => trapFocus(event, dialog));
	dialog.addEventListener("close", () => restoreFocus(invoker));
	dialog.addEventListener("cancel", (event) => {
		if (controller.state.saving || !controller.state.configured)
			event.preventDefault();
	});
	$("cancel").addEventListener("click", () => {
		if (controller.state.configured && !controller.state.saving) dialog.close();
	});
	$("form").addEventListener("submit", async (event) => {
		event.preventDefault();
		if (controller.state.saving) return;
		const state = await controller.save({
			startDate: controller.state.startDate,
			endDate: controller.state.endDate,
			incomeAmount: incomeDigits($("income-input").value),
		});
		if (state.errorField) {
			if (state.errorField === "incomeAmount") $("income-input").focus();
			else {
				focusedDate = controller.state.startDate;
				calendarMonth = new Date(`${controller.state.startDate}T12:00:00`);
				renderCalendar();
				focusRenderedDate(controller.state.startDate);
			}
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
