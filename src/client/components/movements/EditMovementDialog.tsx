import { useEffect, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import { getCategories } from "../../api/client";
import type {
	FinancialPeriod,
	MovementUpdateTarget,
	RecognizedExpenseKind,
	UpdateTransactionRequest,
} from "../../api/types";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../../shared/review-period.js";
import {
	acquireInFlightLock,
	createCategoryCatalogState,
	getCategoryCatalogNames,
	getCategoryCatalogOptions,
	reduceCategoryCatalog,
	releaseInFlightLock,
	resolveCategoryForSubmission,
	syncNativeModalDialog,
	type CategoryCatalogState,
} from "./CreateManualExpenseDialog";
import {
	createMovementEditDraft,
	createMovementUpdatePayload,
	formatPeriodLabel,
	getMovementUpdateTarget,
	isMovementNotFoundError,
	type EditableRecognizedExpenseMovement,
	type MovementEditDraft,
} from "./manualExpense";

/**
 * Edit flow for a recognized expense.
 *
 * The decisions live in pure functions on purpose: this repository's test harness has no DOM, so
 * the invariants that keep the flow truthful (one in-flight PATCH, entered values preserved on
 * failure, a Gmail date that is never offered, a movement the server cannot locate that is never
 * retried, and a successful PATCH whose refresh failed never reported as a failed save) must be
 * provable without rendering the component.
 *
 * It reuses the C1 conventions instead of defining a second set: the synchronous in-flight lock,
 * the native-modal sync, and the category catalog state/options/name resolution all come from
 * `CreateManualExpenseDialog`. The payload, target and draft rules come from unit A.
 */

export type MovementEditPhase = "idle" | "invalid" | "saving" | "failed" | "notFound" | "saved";

export type MovementEditState = {
	phase: MovementEditPhase;
	draft: MovementEditDraft;
	/** Truthful message for the current phase; null while no problem is known. */
	errorMessage: string | null;
	/** True when the PATCH succeeded but the follow-up cycle-first reload failed. */
	reloadFailed: boolean;
};

export type MovementEditEvent =
	| { type: "open"; draft: MovementEditDraft }
	| { type: "change"; patch: Partial<MovementEditDraft> }
	| { type: "invalid"; message: string }
	| { type: "submitted" }
	| { type: "failed"; message: string }
	| { type: "notFound"; message: string }
	| { type: "succeeded"; reloadFailed: boolean };

const MOVEMENT_EDIT_INVALID_MESSAGE =
	"Revisa los datos: el monto debe ser un número positivo en pesos, el tipo debe ser válido y la categoría debe existir.";
/**
 * The out-of-period `RangeError` is the authorized product rule shared with creation, so its copy
 * names the accepted range through the single shared period label instead of blaming the save.
 */
function getMovementEditPeriodMessage(period: FinancialPeriod) {
	return `La fecha debe estar dentro del periodo seleccionado (${formatPeriodLabel(period)}). Un movimiento fuera del periodo no aparecería en el resumen, así que no se guarda.`;
}
const MOVEMENT_EDIT_FAILURE_MESSAGE =
	"No se pudo guardar el cambio. Los datos ingresados se mantienen para que puedas reintentar.";
const MOVEMENT_EDIT_NOT_FOUND_MESSAGE =
	"No se encontró el movimiento, así que no se pudo guardar el cambio. Puede que ya se haya eliminado u ocultado en otro lugar, o que una edición anterior haya cambiado su fecha. Actualiza la página para ver el estado real.";
const MOVEMENT_EDIT_DATE_LOCK_MESSAGE =
	"La fecha de un movimiento importado desde Gmail no se puede modificar; el servidor rechaza el cambio. Los demás campos sí se pueden editar.";

export function createMovementEditState(draft: MovementEditDraft): MovementEditState {
	return { phase: "idle", draft, errorMessage: null, reloadFailed: false };
}

/** The only phases that may start a request: not in flight, not already saved, not unreachable. */
function isMovementEditSubmittable(phase: MovementEditPhase) {
	return phase === "idle" || phase === "invalid" || phase === "failed";
}

export function canSubmitMovementEdit(state: MovementEditState): boolean {
	return isMovementEditSubmittable(state.phase);
}

/**
 * True while dismissing the dialog is truthful. Closing while the PATCH is in flight would hide
 * the outcome of a write that is already on its way.
 */
export function canDismissMovementEdit(state: MovementEditState): boolean {
	return state.phase !== "saving";
}

function normalizeMovementEditMessage(message: unknown, fallback: string) {
	return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

/**
 * Pure reducer for the edit lifecycle. Events that cannot legally apply return the identical
 * state, so `reduceMovementEdit(state, event) === state` proves nothing happened.
 */
export function reduceMovementEdit(
	state: MovementEditState,
	event: MovementEditEvent,
): MovementEditState {
	switch (event.type) {
		case "open":
			return createMovementEditState(event.draft);
		case "change":
			// The values on screen must be the values that were sent, so the draft is frozen
			// while the request is in flight and after it succeeded.
			if (!isMovementEditSubmittable(state.phase)) return state;
			return { ...state, draft: { ...state.draft, ...event.patch } };
		case "invalid":
			return {
				...state,
				phase: "invalid",
				errorMessage: normalizeMovementEditMessage(event.message, MOVEMENT_EDIT_INVALID_MESSAGE),
				reloadFailed: false,
			};
		case "submitted":
			// The single in-flight lock at state level: a duplicate submit lands on a phase that
			// may not start a request, so exactly one PATCH is sent.
			if (!isMovementEditSubmittable(state.phase)) return state;
			return { ...state, phase: "saving", errorMessage: null, reloadFailed: false };
		case "failed":
			// Only the request that was in flight can fail, and it never touches the draft.
			if (state.phase !== "saving") return state;
			return {
				...state,
				phase: "failed",
				errorMessage: normalizeMovementEditMessage(event.message, MOVEMENT_EDIT_FAILURE_MESSAGE),
				reloadFailed: false,
			};
		case "notFound":
			// `notFound` is terminal. A 404 means the server could not locate the movement at all, so
			// the identical PATCH can only 404 again; re-arming it would be an automatic retry of a
			// request that cannot succeed.
			if (state.phase !== "saving") return state;
			return {
				...state,
				phase: "notFound",
				errorMessage: normalizeMovementEditMessage(event.message, MOVEMENT_EDIT_NOT_FOUND_MESSAGE),
				reloadFailed: false,
			};
		case "succeeded":
			// A failed follow-up reload is still a success, and `saved` is terminal: it can never
			// send the PATCH again because of a refresh that did not work.
			if (state.phase !== "saving") return state;
			return {
				...state,
				phase: "saved",
				errorMessage: null,
				reloadFailed: event.reloadFailed === true,
			};
	}
}

/** The date is only editable for a manual movement; `updateTransaction` refuses a Gmail change. */
export function isMovementDateEditable(target: MovementUpdateTarget | null): boolean {
	return target !== null && target.isManual === true;
}

/** Explains the locked date instead of letting the user edit a value the server will reject. */
export function getMovementDateLockMessage(): string {
	return MOVEMENT_EDIT_DATE_LOCK_MESSAGE;
}

export function getMovementNotFoundMessage(): string {
	return MOVEMENT_EDIT_NOT_FOUND_MESSAGE;
}

/**
 * Maps a rejection to Spanish copy.
 *
 * The out-of-period `RangeError` is the authorized product rule shared with creation: it explains
 * that an out-of-period movement would not appear in the summary instead of blaming the save, and
 * it names the accepted range.
 */
export function getMovementEditErrorMessage(
	error: unknown,
	period: FinancialPeriod,
): string {
	if (error instanceof RangeError) return getMovementEditPeriodMessage(period);
	if (error instanceof TypeError) return MOVEMENT_EDIT_INVALID_MESSAGE;
	return MOVEMENT_EDIT_FAILURE_MESSAGE;
}

export type MovementEditSubmitOutcome =
	| { status: "saved"; reloadFailed: boolean }
	| { status: "notFound" }
	| { status: "failed"; message: string };

export type MovementEditSubmitter = (
	target: MovementUpdateTarget,
	payload: UpdateTransactionRequest,
) => Promise<MovementEditSubmitOutcome>;

export interface MovementEditSubmitterDeps {
	/** Selected financial period; the out-of-period copy names its accepted range. */
	period: FinancialPeriod;
	/** PATCHes the movement; rejects when the server refuses it. */
	updateMovement: (
		target: MovementUpdateTarget,
		payload: UpdateTransactionRequest,
	) => Promise<void>;
	/** Re-runs the cycle-first dashboard load. Resolves `false` when the reload failed. */
	reload: () => Promise<boolean>;
}

/**
 * Creates the submit callback the dialog awaits.
 *
 * A rejected PATCH is classified: a 404 becomes a terminal `notFound` so the dialog can state the
 * real situation without retrying, and anything else is a retryable failure. A successful PATCH
 * always resolves with the reload outcome, so a refresh that failed (or threw) says the visible
 * list may be stale and never re-sends the successful PATCH.
 */
export function createMovementEditSubmitter({
	period,
	updateMovement,
	reload,
}: MovementEditSubmitterDeps): MovementEditSubmitter {
	return async (target, payload) => {
		try {
			await updateMovement(target, payload);
		} catch (error) {
			if (isMovementNotFoundError(error)) return { status: "notFound" };
			return { status: "failed", message: getMovementEditErrorMessage(error, period) };
		}
		try {
			return { status: "saved", reloadFailed: (await reload()) === false };
		} catch {
			return { status: "saved", reloadFailed: true };
		}
	};
}

export type MovementEditNotice = {
	message: string;
	tone: "success" | "warning";
};

/**
 * Copy for the outcome shown after the dialog closes. A saved movement whose refresh failed is
 * reported as a stale list, never as a failed save.
 */
export function getMovementEditNotice(reloadFailed: boolean): MovementEditNotice {
	if (reloadFailed) {
		return {
			message:
				"El movimiento se guardó correctamente, pero la lista no se pudo actualizar y puede estar desactualizada. Actualiza la página para ver el estado real.",
			tone: "warning",
		};
	}
	return { message: "El movimiento se guardó correctamente.", tone: "success" };
}

const MOVEMENT_EDIT_KIND_OPTIONS: { value: RecognizedExpenseKind; label: string }[] = [
	{ value: "purchase", label: "Compra" },
	{ value: "transfer", label: "Transferencia" },
	{ value: "payment", label: "Pago" },
];

/**
 * Kind labels for the edit form. Only the recognized kinds are offered: `income`/`unknown` are not
 * recognized expenses, so they would silently leave the summary. Direction is not a control, the
 * same as creation.
 */
export function getMovementEditKindOptions() {
	return MOVEMENT_EDIT_KIND_OPTIONS.map((option) => ({ ...option }));
}

/** Valid draft for a not-yet-mounted dialog; never rendered because the component returns null. */
const EMPTY_MOVEMENT_EDIT_DRAFT: MovementEditDraft = {
	occurredAt: "",
	amount: "",
	kind: "purchase",
	direction: "outflow",
	category: "",
	counterparty: "",
	description: "",
};

export interface EditMovementDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** Movement being edited; `null` renders nothing. */
	movement: EditableRecognizedExpenseMovement | null;
	/** Selected financial period; a manual date must stay inside it. */
	period: FinancialPeriod;
	/** Dismissal intent. It never re-sends the PATCH. */
	onClose: () => void;
	/** Performs the PATCH and the follow-up reload; it never rejects for a reload failure. */
	submitEdit: MovementEditSubmitter;
	/** Called after a successful save so the parent can report the outcome and close. */
	onSaved: (reloadFailed: boolean) => void;
}

export function EditMovementDialog({
	isOpen,
	movement,
	period,
	onClose,
	submitEdit,
	onSaved,
}: EditMovementDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const saveLock = useRef(false);
	const [edit, setEdit] = useState<MovementEditState>(() =>
		createMovementEditState(
			movement ? createMovementEditDraft(movement) : EMPTY_MOVEMENT_EDIT_DRAFT,
		),
	);
	const [catalog, setCatalog] = useState<CategoryCatalogState>(createCategoryCatalogState);
	const [catalogRetryToken, setCatalogRetryToken] = useState(0);
	const reviewPeriod = ReviewPeriod.create(period);
	const minDateTime = `${reviewPeriod.startDate}T00:00`;
	const maxDateTime = `${reviewPeriod.visibleEndDate}T23:59`;
	const movementId = movement?.id ?? null;
	const movementOccurredAt = movement?.occurredAt ?? null;
	// The unit A target helper owns the identity rule, so the dialog cannot build a PATCH the
	// API layer would refuse: a missing id or an unparseable date yields no editable target.
	const target = movement
		? getMovementUpdateTarget({
				id: movement.id ?? undefined,
				occurredAt: movement.occurredAt,
				isManual: movement.isManual,
			})
		: null;
	const isDateEditable = isMovementDateEditable(target);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	// Reopening starts a brand new edit: no stale error, outcome or lock may leak into it.
	useEffect(() => {
		if (!isOpen || !movement) return;
		releaseInFlightLock(saveLock);
		setEdit(createMovementEditState(createMovementEditDraft(movement)));
		// `movementId`/`movementOccurredAt` identify the record; the object identity may change
		// on every parent render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen, movementId, movementOccurredAt]);

	// The catalog is only requested while the dialog is open, so a dashboard that cannot edit a
	// movement never asks for it.
	useEffect(() => {
		if (!isOpen || !movementId) return;
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
	}, [isOpen, movementId, catalogRetryToken]);

	if (!movement || !target) return null;

	const { phase, draft, errorMessage } = edit;
	const isSaving = phase === "saving";
	const isNotFound = phase === "notFound";
	const isSubmitOpen = canSubmitMovementEdit(edit);
	const categoryNames = getCategoryCatalogNames(catalog);
	const categoryOptions = getCategoryCatalogOptions(catalog);
	// The C1 resolver keeps a failed catalog from blocking the save: nothing can be proven to
	// exist before a successful load, so an unloaded catalog saves without a category instead of
	// rejecting a save the user cannot repair.
	const categoryValue = resolveCategoryForSubmission(catalog, draft.category);
	const isCatalogReady = catalog.phase === "ready";

	const updateDraft = (patch: Partial<MovementEditDraft>) =>
		setEdit((current) => reduceMovementEdit(current, { type: "change", patch }));

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!isSubmitOpen) return;

		let payload: UpdateTransactionRequest;
		try {
			payload = createMovementUpdatePayload(
				{ ...draft, category: categoryValue },
				target,
				period,
				categoryNames,
			);
		} catch (error) {
			// Nothing was sent, so this is an invalid draft rather than a failed save, and every
			// entered value stays for correction.
			setEdit((current) =>
				reduceMovementEdit(current, {
					type: "invalid",
					message: getMovementEditErrorMessage(error, period),
				}),
			);
			return;
		}

		if (!acquireInFlightLock(saveLock)) return;
		setEdit((current) => reduceMovementEdit(current, { type: "submitted" }));
		try {
			const outcome = await submitEdit(target, payload);
			if (outcome.status === "saved") {
				setEdit((current) =>
					reduceMovementEdit(current, {
						type: "succeeded",
						reloadFailed: outcome.reloadFailed,
					}),
				);
				// The parent reports the outcome on the dashboard and closes the dialog.
				onSaved(outcome.reloadFailed);
				return;
			}
			if (outcome.status === "notFound") {
				setEdit((current) =>
					reduceMovementEdit(current, {
						type: "notFound",
						message: getMovementNotFoundMessage(),
					}),
				);
				return;
			}
			releaseInFlightLock(saveLock);
			setEdit((current) =>
				reduceMovementEdit(current, { type: "failed", message: outcome.message }),
			);
		} catch (error) {
			releaseInFlightLock(saveLock);
			setEdit((current) =>
				reduceMovementEdit(current, {
					type: "failed",
					message: getMovementEditErrorMessage(error, period),
				}),
			);
		}
	};

	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		// `Esc` must not abandon a write that is already on its way, or the saved movement would
		// stay invisible with no explanation.
		if (!canDismissMovementEdit(edit)) event.preventDefault();
	};

	const retryCategoryCatalog = () => setCatalogRetryToken((token) => token + 1);

	return (
		<dialog
			ref={dialogRef}
			className="react-edit-movement-dialog"
			aria-labelledby="react-edit-movement-title"
			onCancel={handleDialogCancel}
			onClose={onClose}
		>
			<form className="react-edit-movement-form" onSubmit={handleSubmit} aria-busy={isSaving}>
				<h2 id="react-edit-movement-title">Editar movimiento</h2>
				<div className="react-edit-movement-fields">
					<label className="react-edit-movement-full" htmlFor="edit-movement-occurred-at">
						<span>Fecha y hora</span>
						<input
							id="edit-movement-occurred-at"
							name="occurredAt"
							type="datetime-local"
							value={draft.occurredAt}
							min={minDateTime}
							max={maxDateTime}
							onChange={(event) => updateDraft({ occurredAt: event.target.value })}
							disabled={!isDateEditable || isSaving}
							readOnly={!isDateEditable}
							aria-describedby="edit-movement-date-help"
							required
						/>
						<small
							id="edit-movement-date-help"
							className={isDateEditable ? undefined : "react-edit-movement-date-locked"}
						>
							{isDateEditable
								? "La fecha y hora del movimiento."
								: getMovementDateLockMessage()}
						</small>
					</label>
					<label htmlFor="edit-movement-amount">
						<span>Monto CLP</span>
						<input
							id="edit-movement-amount"
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
					<label htmlFor="edit-movement-kind">
						<span>Tipo</span>
						<select
							id="edit-movement-kind"
							name="kind"
							value={draft.kind}
							onChange={(event) =>
								updateDraft({ kind: event.target.value as RecognizedExpenseKind })
							}
							disabled={isSaving}
							required
						>
							{getMovementEditKindOptions().map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label htmlFor="edit-movement-counterparty">
						<span>Comercio o persona</span>
						<input
							id="edit-movement-counterparty"
							name="counterparty"
							type="text"
							value={draft.counterparty}
							placeholder="Supermercado, persona o comercio"
							onChange={(event) => updateDraft({ counterparty: event.target.value })}
							disabled={isSaving}
						/>
					</label>
					<label htmlFor="edit-movement-description">
						<span>Descripción</span>
						<input
							id="edit-movement-description"
							name="description"
							type="text"
							value={draft.description}
							placeholder="Detalle breve"
							onChange={(event) => updateDraft({ description: event.target.value })}
							disabled={isSaving}
						/>
					</label>
					<label className="react-edit-movement-full" htmlFor="edit-movement-category">
						<span>Categoría</span>
						<select
							id="edit-movement-category"
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
							<p className="react-edit-movement-catalog-error" role="status">
								{catalog.errorMessage}
							</p>
							<button
								type="button"
								className="secondary react-edit-movement-catalog-retry"
								onClick={retryCategoryCatalog}
								disabled={isSaving}
							>
								Reintentar categorías
							</button>
						</>
					) : (
						<p className="react-edit-movement-catalog" role="status" aria-live="polite">
							{isCatalogReady ? "Categorías disponibles." : "Cargando categorías..."}
						</p>
					)}
				</div>
				{errorMessage !== null && (
					<p className="react-edit-movement-error" role="alert">
						{errorMessage}
					</p>
				)}
				{isSaving && (
					<p className="react-edit-movement-pending" role="status">
						Guardando cambios...
					</p>
				)}
				<div className="react-shell-actions">
					{/* A missing movement is terminal: the PATCH cannot succeed with the same request,
					    so the dialog offers only a truthful close and never a retry control. */}
					{isNotFound ? (
						<button type="button" className="secondary" onClick={onClose}>
							Cerrar
						</button>
					) : (
						<>
							<button type="button" className="secondary" onClick={onClose} disabled={isSaving}>
								Cancelar
							</button>
							<button type="submit" disabled={!isSubmitOpen}>
								{isSaving ? "Guardando..." : "Guardar cambios"}
							</button>
						</>
					)}
				</div>
			</form>
		</dialog>
	);
}
