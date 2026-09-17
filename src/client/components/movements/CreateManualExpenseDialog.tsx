import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import { getCategories } from "../../api/client";
import type {
	Category,
	CreateManualExpenseRequest,
	FinancialPeriod,
	ManualExpenseKind,
} from "../../api/types";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../../shared/review-period.js";
import {
	createManualExpenseDraft,
	createManualExpensePayload,
	formatPeriodLabel,
	getManualExpensePeriodKey,
	type ManualExpenseCreationPhase,
	type ManualExpenseDraft,
} from "./manualExpense";

/**
 * Create-manual-expense flow for the period-scoped React dashboard.
 *
 * The decisions live in pure functions on purpose: this repository's test harness has no DOM,
 * so the invariants that keep the flow truthful (one in-flight POST, entered values preserved
 * on failure, a created expense whose refresh failed never reported as a failure) must be
 * provable without rendering the dialog.
 */

/** Boolean ref shaped exactly like `useRef(false)`, used as the synchronous submit lock. */
export type InFlightLockRef = { current: boolean };

/**
 * Acquires the lock and reports whether the caller may proceed. React state cannot close the
 * async window: two clicks in the same tick both read the rendered phase, so this synchronous
 * ref is what guarantees a single POST per attempt.
 */
export function acquireInFlightLock(lock: InFlightLockRef): boolean {
	if (lock.current) return false;
	lock.current = true;
	return true;
}

/** Releases the lock so a failed attempt stays retryable. Intentional dismissals reset it too. */
export function releaseInFlightLock(lock: InFlightLockRef): void {
	lock.current = false;
}

export type CategoryCatalogPhase = "idle" | "loading" | "ready" | "failed";

export type CategoryCatalogState = {
	phase: CategoryCatalogPhase;
	/** Only ever the categories a successful load returned. */
	categories: Category[];
	/** Truthful failure detail; null unless the phase is `failed`. */
	errorMessage: string | null;
};

export type CategoryCatalogEvent =
	| { type: "loadStarted" }
	| { type: "loaded"; categories: Category[] }
	| { type: "loadFailed" };

export type CategorySelectOption = {
	value: string;
	label: string;
	disabled: boolean;
};

const CATEGORY_LOADING_OPTION: CategorySelectOption = {
	value: "",
	label: "Cargando categorías...",
	disabled: true,
};
const CATEGORY_UNAVAILABLE_OPTION: CategorySelectOption = {
	value: "",
	label: "No se pudieron cargar las categorías (el gasto se guardará sin categoría)",
	disabled: true,
};
const CATEGORY_NONE_OPTION: CategorySelectOption = {
	value: "",
	label: "Sin categoría",
	disabled: false,
};
const CATEGORY_CATALOG_FAILURE_MESSAGE =
	"No se pudieron cargar las categorías. El gasto se guarda sin categoría; puedes reintentar la carga.";

export function createCategoryCatalogState(): CategoryCatalogState {
	return { phase: "idle", categories: [], errorMessage: null };
}

export function reduceCategoryCatalog(
	state: CategoryCatalogState,
	event: CategoryCatalogEvent,
): CategoryCatalogState {
	switch (event.type) {
		case "loadStarted":
			return { phase: "loading", categories: [], errorMessage: null };
		case "loaded":
			return { phase: "ready", categories: [...event.categories], errorMessage: null };
		case "loadFailed":
			return {
				phase: "failed",
				categories: [],
				errorMessage: CATEGORY_CATALOG_FAILURE_MESSAGE,
			};
	}
}

/**
 * Options for the read-only category select.
 *
 * While the catalog has not loaded successfully the select offers exactly one disabled
 * placeholder that names the real state. A catalog that never loaded must never render as an
 * empty one: an empty list would tell the user no category exists, which is not what happened.
 * A catalog that did load and is empty renders the real "Sin categoría" option instead.
 */
export function getCategoryCatalogOptions(state: CategoryCatalogState): CategorySelectOption[] {
	if (state.phase !== "ready") {
		return [
			state.phase === "failed"
				? { ...CATEGORY_UNAVAILABLE_OPTION }
				: { ...CATEGORY_LOADING_OPTION },
		];
	}
	return [
		{ ...CATEGORY_NONE_OPTION },
		...state.categories.map((category) => ({
			value: category.name,
			label: category.name,
			disabled: false,
		})),
	];
}

/**
 * Names the payload is allowed to accept. Nothing can be proven to exist before a successful
 * load, so this stays empty and the category builder rejects nothing that the user could not
 * see.
 */
export function getCategoryCatalogNames(state: CategoryCatalogState): string[] {
	return state.phase === "ready" ? state.categories.map((category) => category.name) : [];
}

/**
 * The select can only offer names the catalog returned, so a draft category that cannot be
 * checked against a loaded catalog is dropped and the expense is saved without one. That is
 * what keeps a failed catalog load from blocking the create flow.
 *
 * With a loaded catalog the value is passed through unchanged, because the existence rule
 * already belongs to `createManualExpensePayload`.
 */
export function resolveCategoryForSubmission(
	state: CategoryCatalogState,
	category: string,
): string {
	const trimmed = category.trim();
	if (!trimmed) return "";
	return state.phase === "ready" ? trimmed : "";
}

export type ManualExpenseCreationState = {
	phase: ManualExpenseCreationPhase;
	draft: ManualExpenseDraft;
	/** Truthful message for the current phase; null while no problem is known. */
	errorMessage: string | null;
	/** True when the POST succeeded but the follow-up cycle-first reload failed. */
	reloadFailed: boolean;
};

export type ManualExpenseCreationEvent =
	| { type: "open"; draft: ManualExpenseDraft }
	| { type: "change"; patch: Partial<ManualExpenseDraft> }
	| { type: "invalid"; message: string }
	| { type: "submitted" }
	| { type: "failed"; message: string }
	| { type: "succeeded"; reloadFailed: boolean };

const MANUAL_EXPENSE_FAILURE_MESSAGE =
	"No se pudo guardar el gasto. Los datos ingresados se mantienen para que puedas reintentar.";

export function createManualExpenseCreationState(
	draft: ManualExpenseDraft,
): ManualExpenseCreationState {
	return { phase: "idle", draft, errorMessage: null, reloadFailed: false };
}

/** The only phases that may start a request: not in flight, and not already created. */
function isSubmittablePhase(phase: ManualExpenseCreationPhase) {
	return phase === "idle" || phase === "invalid" || phase === "failed";
}

export function canSubmitManualExpense(state: ManualExpenseCreationState): boolean {
	return isSubmittablePhase(state.phase);
}

/**
 * True while dismissing the dialog is truthful. Closing while the POST is in flight would hide
 * the outcome of a write that is already on its way.
 */
export function canDismissManualExpenseCreation(state: ManualExpenseCreationState): boolean {
	return state.phase !== "saving";
}

function normalizeCreationMessage(message: unknown) {
	return typeof message === "string" && message.trim()
		? message.trim()
		: MANUAL_EXPENSE_FAILURE_MESSAGE;
}

/**
 * Pure reducer for the create lifecycle. Events that cannot legally apply return the identical
 * state, so `reduceManualExpenseCreation(state, event) === state` proves nothing happened.
 */
export function reduceManualExpenseCreation(
	state: ManualExpenseCreationState,
	event: ManualExpenseCreationEvent,
): ManualExpenseCreationState {
	switch (event.type) {
		case "open":
			return createManualExpenseCreationState(event.draft);
		case "change":
			// The values on screen must be the values that were sent, so the draft is frozen
			// while the request is in flight and after it succeeded.
			if (!isSubmittablePhase(state.phase)) return state;
			return { ...state, draft: { ...state.draft, ...event.patch } };
		case "invalid":
			return {
				...state,
				phase: "invalid",
				errorMessage: normalizeCreationMessage(event.message),
				reloadFailed: false,
			};
		case "submitted":
			// The single in-flight lock: a duplicate submit lands on a phase that may not start
			// a request, so exactly one POST is sent.
			if (!isSubmittablePhase(state.phase)) return state;
			return { ...state, phase: "saving", errorMessage: null, reloadFailed: false };
		case "failed":
			// Only the request that was in flight can fail, and it never touches the draft.
			if (state.phase !== "saving") return state;
			return {
				...state,
				phase: "failed",
				errorMessage: normalizeCreationMessage(event.message),
				reloadFailed: false,
			};
		case "succeeded":
			// A failed follow-up reload is still a success, and `saved` is terminal: it can never
			// send the POST again.
			if (state.phase !== "saving") return state;
			return {
				...state,
				phase: "saved",
				errorMessage: null,
				reloadFailed: event.reloadFailed === true,
			};
	}
}

const MANUAL_EXPENSE_KIND_OPTIONS: { value: ManualExpenseKind; label: string }[] = [
	{ value: "purchase", label: "Compra" },
	{ value: "transfer", label: "Transferencia" },
	{ value: "payment", label: "Pago" },
	{ value: "income", label: "Ingreso" },
];

/**
 * Kind labels for the create form. There is deliberately no direction control and no `unknown`
 * kind: direction is derived from the kind by `createManualExpensePayload`.
 */
export function getManualExpenseKindOptions() {
	return MANUAL_EXPENSE_KIND_OPTIONS.map((option) => ({ ...option }));
}

/**
 * Maps a rejection to Spanish copy.
 *
 * The out-of-period `RangeError` is an authorized product rule, not a system failure: it names
 * the accepted range so the user knows which dates are valid, and explains that a
 * out-of-period expense would not appear in the summary instead of blaming the save.
 */
export function getManualExpenseErrorMessage(error: unknown, period: FinancialPeriod): string {
	if (error instanceof RangeError) {
		return `La fecha debe estar dentro del periodo seleccionado (${formatPeriodLabel(period)}). Un gasto fuera del periodo no aparecería en el resumen, así que no se guarda.`;
	}
	if (error instanceof TypeError) {
		return "Revisa los datos: la fecha debe ser válida, el monto debe ser un número positivo en pesos y la categoría debe existir.";
	}
	return MANUAL_EXPENSE_FAILURE_MESSAGE;
}

export type ManualExpenseCreationNotice = {
	message: string;
	tone: "success" | "warning";
};

/**
 * Copy for the outcome shown after the dialog closes. A created expense whose refresh failed is
 * reported as a stale list, never as a failed creation.
 */
export function getManualExpenseCreationNotice(reloadFailed: boolean): ManualExpenseCreationNotice {
	if (reloadFailed) {
		return {
			message:
				"El gasto se creó correctamente, pero la lista no se pudo actualizar y puede estar desactualizada. Actualiza la página para ver el estado real.",
			tone: "warning",
		};
	}
	return { message: "El gasto se creó correctamente.", tone: "success" };
}

export type ManualExpenseSubmitOutcome = {
	/** True when the POST succeeded but the follow-up cycle-first reload failed. */
	reloadFailed: boolean;
};

export type ManualExpenseSubmitter = (
	payload: CreateManualExpenseRequest,
) => Promise<ManualExpenseSubmitOutcome>;

export interface ManualExpenseSubmitterDeps {
	/** POSTs the expense and resolves with the HTTP status, like the API layer's `createManualExpense`. */
	createExpense: (payload: CreateManualExpenseRequest) => Promise<number>;
	/** Re-runs the cycle-first dashboard load. Resolves `false` when the reload failed. */
	reload: () => Promise<boolean>;
}

/**
 * Creates the submit callback the dialog awaits.
 *
 * A rejected POST throws, so it is reported as a failure. A successful POST always resolves with
 * the reload outcome: a refresh that failed (or threw) says the visible list may be stale, and
 * the successful POST is never re-sent because of it.
 */
export function createManualExpenseSubmitter({
	createExpense,
	reload,
}: ManualExpenseSubmitterDeps): ManualExpenseSubmitter {
	return async (payload) => {
		const status = await createExpense(payload);
		if (!(status >= 200 && status < 300)) {
			throw new Error(`The expense request was rejected with status ${status}.`);
		}
		try {
			return { reloadFailed: (await reload()) === false };
		} catch {
			return { reloadFailed: true };
		}
	};
}

/** Native dialog surface this component needs; `HTMLDialogElement` satisfies it structurally. */
export interface NativeModalDialog {
	open: boolean;
	showModal: () => void;
	close: () => void;
}

/**
 * Opens the dialog modally and closes it cleanly.
 *
 * A bare `<dialog open>` is non-modal markup with no focus trap and no `Esc` handling, so
 * `showModal()` is what makes the dialog a real modal. Both calls are guarded by the element's
 * own `open` state, so re-rendering never re-opens or double-closes it.
 */
export function syncNativeModalDialog(dialog: NativeModalDialog | null, isOpen: boolean): void {
	if (!dialog) return;
	if (isOpen) {
		if (!dialog.open) dialog.showModal();
		return;
	}
	if (dialog.open) dialog.close();
}

export interface CreateManualExpenseDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** Selected financial period; the form only accepts dates inside it. */
	period: FinancialPeriod;
	/** Dismissal intent. It never re-sends the POST. */
	onClose: () => void;
	/** Performs the POST and the follow-up reload; rejects only when the expense was not created. */
	submitExpense: ManualExpenseSubmitter;
	/** Called after a successful creation so the parent can report the outcome on the dashboard. */
	onSaved: (reloadFailed: boolean) => void;
}

export function CreateManualExpenseDialog({
	isOpen,
	period,
	onClose,
	submitExpense,
	onSaved,
}: CreateManualExpenseDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const saveLock = useRef(false);
	const [creation, setCreation] = useState<ManualExpenseCreationState>(() =>
		createManualExpenseCreationState(createManualExpenseDraft(period)),
	);
	const [catalog, setCatalog] = useState<CategoryCatalogState>(createCategoryCatalogState);
	const [catalogRetryToken, setCatalogRetryToken] = useState(0);
	const reviewPeriod = ReviewPeriod.create(period);
	const minDateTime = `${reviewPeriod.startDate}T00:00`;
	const maxDateTime = `${reviewPeriod.visibleEndDate}T23:59`;
	const periodKey = getManualExpensePeriodKey(period);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	// Reopening starts a brand new expense: no stale error, outcome or lock may leak into it.
	// The reset is keyed on the period's primitive bounds (`periodKey`), not on the `period`
	// object: the dashboard hands out a fresh object on every reload, so keying it on the object
	// would silently discard typed input while the dialog is open.
	useEffect(() => {
		if (!isOpen) return;
		releaseInFlightLock(saveLock);
		setCreation(createManualExpenseCreationState(createManualExpenseDraft(period)));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen, periodKey]);

	// The catalog is only requested while the dialog is open, so a dashboard that cannot create
	// an expense never asks for it.
	useEffect(() => {
		if (!isOpen) return;
		const controller = new AbortController();
		setCatalog((current) => reduceCategoryCatalog(current, { type: "loadStarted" }));
		getCategories(controller.signal)
			.then((categories) => {
				if (controller.signal.aborted) return;
				setCatalog((current) =>
					reduceCategoryCatalog(current, { type: "loaded", categories }),
				);
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setCatalog((current) => reduceCategoryCatalog(current, { type: "loadFailed" }));
			});
		return () => controller.abort();
	}, [isOpen, catalogRetryToken]);

	const { phase, draft, errorMessage } = creation;
	const isSaving = phase === "saving";
	const isSubmitOpen = canSubmitManualExpense(creation);
	const categoryNames = getCategoryCatalogNames(catalog);
	const categoryOptions = getCategoryCatalogOptions(catalog);
	const categoryValue = resolveCategoryForSubmission(catalog, draft.category);
	const isCatalogReady = catalog.phase === "ready";

	const updateDraft = (patch: Partial<ManualExpenseDraft>) =>
		setCreation((current) => reduceManualExpenseCreation(current, { type: "change", patch }));

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!isSubmitOpen) return;

		let payload: CreateManualExpenseRequest;
		try {
			payload = createManualExpensePayload(
				{ ...draft, category: categoryValue },
				period,
				categoryNames,
			);
		} catch (error) {
			// Nothing was sent, so this is an invalid draft rather than a failed save, and every
			// entered value stays for correction.
			setCreation((current) =>
				reduceManualExpenseCreation(current, {
					type: "invalid",
					message: getManualExpenseErrorMessage(error, period),
				}),
			);
			return;
		}

		if (!acquireInFlightLock(saveLock)) return;
		setCreation((current) => reduceManualExpenseCreation(current, { type: "submitted" }));
		try {
			const outcome = await submitExpense(payload);
			setCreation((current) =>
				reduceManualExpenseCreation(current, {
					type: "succeeded",
					reloadFailed: outcome.reloadFailed,
				}),
			);
			// The parent reports the outcome on the dashboard and closes the dialog.
			onSaved(outcome.reloadFailed);
		} catch (error) {
			releaseInFlightLock(saveLock);
			setCreation((current) =>
				reduceManualExpenseCreation(current, {
					type: "failed",
					message: getManualExpenseErrorMessage(error, period),
				}),
			);
		}
	};

	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		// `Esc` must not abandon a write that is already on its way, or the created expense would
		// stay invisible with no explanation.
		if (!canDismissManualExpenseCreation(creation)) event.preventDefault();
	};

	const retryCategoryCatalog = () => setCatalogRetryToken((token) => token + 1);

	return (
		<dialog
			ref={dialogRef}
			className="react-create-expense-dialog"
			aria-labelledby="react-create-expense-title"
			aria-describedby="manual-expense-period-help"
			onCancel={handleDialogCancel}
			onClose={onClose}
		>
			<form className="react-create-expense-form" onSubmit={handleSubmit} aria-busy={isSaving}>
				<h2 id="react-create-expense-title">Nuevo gasto</h2>
				<div className="react-create-expense-fields">
					<label className="react-create-expense-full" htmlFor="manual-expense-occurred-at">
						<span>Fecha y hora</span>
						<input
							id="manual-expense-occurred-at"
							name="occurredAt"
							type="datetime-local"
							value={draft.occurredAt}
							min={minDateTime}
							max={maxDateTime}
							onChange={(event) => updateDraft({ occurredAt: event.target.value })}
							disabled={isSaving}
							aria-describedby="manual-expense-period-help"
							required
						/>
						<small id="manual-expense-period-help">
							Periodo seleccionado: {formatPeriodLabel(period)}. Las fechas fuera de
							este periodo no se guardan.
						</small>
					</label>
					<label htmlFor="manual-expense-amount">
						<span>Monto CLP</span>
						<input
							id="manual-expense-amount"
							name="amount"
							type="text"
							inputMode="numeric"
							value={draft.amount}
							placeholder="12500"
							onChange={(event) => updateDraft({ amount: event.target.value })}
							disabled={isSaving}
							required
						/>
					</label>
					<label htmlFor="manual-expense-kind">
						<span>Tipo</span>
						<select
							id="manual-expense-kind"
							name="kind"
							value={draft.kind}
							onChange={(event) =>
								updateDraft({ kind: event.target.value as ManualExpenseKind })
							}
							disabled={isSaving}
							required
						>
							{getManualExpenseKindOptions().map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<small>Los ingresos se registran como entrada y el resto como salida.</small>
					</label>
					<label className="react-create-expense-full" htmlFor="manual-expense-category">
						<span>Categoría</span>
						<select
							id="manual-expense-category"
							name="category"
							value={categoryValue}
							onChange={(event) => updateDraft({ category: event.target.value })}
							disabled={!isCatalogReady || isSaving}
						>
							{categoryOptions.map((option) => (
								<option key={option.value} value={option.value} disabled={option.disabled}>
									{option.label}
								</option>
							))}
						</select>
						<small>Catálogo de solo lectura.</small>
					</label>
					{catalog.phase === "failed" ? (
						<>
							<p className="react-create-expense-catalog-error" role="status">
								{catalog.errorMessage}
							</p>
							<button
								type="button"
								className="secondary react-create-expense-catalog-retry"
								onClick={retryCategoryCatalog}
								disabled={isSaving}
							>
								Reintentar categorías
							</button>
						</>
					) : (
						<p className="react-create-expense-catalog" role="status" aria-live="polite">
							{isCatalogReady ? "Categorías disponibles." : "Cargando categorías..."}
						</p>
					)}
					<label htmlFor="manual-expense-counterparty">
						<span>Comercio o persona</span>
						<input
							id="manual-expense-counterparty"
							name="counterparty"
							type="text"
							value={draft.counterparty}
							placeholder="Supermercado, persona o comercio"
							onChange={(event) => updateDraft({ counterparty: event.target.value })}
							disabled={isSaving}
						/>
					</label>
					<label htmlFor="manual-expense-description">
						<span>Descripción</span>
						<input
							id="manual-expense-description"
							name="description"
							type="text"
							value={draft.description}
							placeholder="Detalle breve"
							onChange={(event) => updateDraft({ description: event.target.value })}
							disabled={isSaving}
						/>
					</label>
				</div>
				{errorMessage !== null && (
					<p className="react-create-expense-error" role="alert">
						{errorMessage}
					</p>
				)}
				{isSaving && (
					<p className="react-create-expense-pending" role="status">
						Guardando gasto...
					</p>
				)}
				<div className="react-shell-actions">
					<button type="button" className="secondary" onClick={onClose} disabled={isSaving}>
						Cancelar
					</button>
					<button type="submit" disabled={!isSubmitOpen}>
						{isSaving ? "Guardando..." : "Guardar gasto"}
					</button>
				</div>
			</form>
		</dialog>
	);
}
