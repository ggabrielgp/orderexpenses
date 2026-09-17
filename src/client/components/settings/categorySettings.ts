import { ApiError } from "../../api/client";
import type {
	Category,
	DeleteCategoryResponse,
	UpsertCategoryRequest,
	UpsertCategoryResponse,
} from "../../api/types";
import {
	acquireInFlightLock,
	releaseInFlightLock,
	type InFlightLockRef,
} from "../movements/CreateManualExpenseDialog";

/**
 * Category administration decisions.
 *
 * Every rule that keeps the settings surface honest is a pure function, because this repository's
 * test harness has no DOM: the draft validation that must reject before a request leaves, the
 * catalog derivation that decides which rows can be deleted, the truthful delete confirmation, and
 * the single in-flight mutation lock are all provable without rendering the dialog.
 *
 * The lock is the one the movement dialogs already use. A second implementation would be a second
 * rule, so `acquireInFlightLock` is imported from its owner instead of duplicated here.
 */

/** The server slices every category name to this length (`src/server.js:773-777`). */
export const MAX_CATEGORY_NAME_LENGTH = 40;
/** Colour the legacy settings list and the server substitute when a stored one is unusable. */
export const DEFAULT_CATEGORY_COLOR = "#64748b";
/** Initial value of the create form's colour input, matching the legacy form. */
export const DEFAULT_CATEGORY_DRAFT_COLOR = "#22c55e";
export const CATEGORY_NAME_REQUIRED_MESSAGE = "Ingresa un nombre de categoría.";
export const CATEGORY_COLOR_INVALID_MESSAGE =
	"El color debe ser un valor hexadecimal de seis dígitos, por ejemplo #22c55e.";

const categoryColorPattern = /^#[0-9a-fA-F]{6}$/;
const CATEGORY_MUTATION_FAILURE_MESSAGE =
	"No se pudo completar la operación con la categoría. Inténtalo de nuevo.";

export type CategoryDraft = {
	name: string;
	color: string;
};

export type CategoryDisplayRow = {
	name: string;
	color: string;
	/**
	 * `Predeterminada` for a server builtin, `Personalizada` for a category the server reported as
	 * non-builtin, and `Protegida` for a row whose provenance was not reported. The label always
	 * agrees with `canDelete`: a row is never labelled as one thing while offering the other one's
	 * control.
	 */
	label: "Predeterminada" | "Personalizada" | "Protegida";
	/** True only when the server flagged this row as one of its merged builtins. */
	builtin: boolean;
	/**
	 * Builtins offer no delete control, exactly like the legacy settings list. An unknown provenance
	 * is protected too, so this is true only for an explicit non-builtin.
	 */
	canDelete: boolean;
};

export type CategoryDeleteConfirmation = {
	name: string;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
};

export type CategoryDraftValidation =
	| { ok: true; payload: UpsertCategoryRequest }
	| { ok: false; message: string };

export function createCategoryDraft(): CategoryDraft {
	return { name: "", color: DEFAULT_CATEGORY_DRAFT_COLOR };
}

/**
 * Mirrors the server's `normalizeCategoryName` (`src/server.js`): trim, collapse repeated
 * whitespace, and slice to 40 characters. The same rule is applied before sending, so the payload
 * is the value the server would store and the 40-character limit is not a surprise rejection.
 */
export function normalizeCategoryName(value: unknown): string {
	return String(value ?? "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, MAX_CATEGORY_NAME_LENGTH);
}

export function isValidCategoryColor(value: unknown): value is string {
	return typeof value === "string" && categoryColorPattern.test(value.trim());
}

/**
 * Validates a draft and produces the exact `PUT /api/categories` body.
 *
 * A draft that fails here is an invalid draft, never a rejected request, so the caller reports it
 * without sending anything. The colour is validated rather than replaced with the grey fallback:
 * silently storing a different colour than the one on screen would be a lie, and the grey is only
 * a *display* fallback for rows the server already stored.
 */
export function validateCategoryDraft(draft: CategoryDraft): CategoryDraftValidation {
	const name = normalizeCategoryName(draft.name);
	if (!name) return { ok: false, message: CATEGORY_NAME_REQUIRED_MESSAGE };
	const color = typeof draft.color === "string" ? draft.color.trim() : "";
	if (!isValidCategoryColor(color)) return { ok: false, message: CATEGORY_COLOR_INVALID_MESSAGE };
	return { ok: true, payload: { name, color } };
}

function getCategoryColor(category: Category) {
	return isValidCategoryColor(category.color) ? category.color.trim() : DEFAULT_CATEGORY_COLOR;
}

/**
 * Derives the display rows from the merged catalog `GET /api/categories` returns.
 *
 * The server already merges the builtins and reports provenance, so this does not re-merge
 * defaults: it normalizes what arrived, labels it, and sorts it the way the server and the legacy
 * list sort (`localeCompare` in Spanish). `canDelete` is the row-level expression of the product
 * rule that builtins are listed and protected.
 *
 * A nameless row is dropped instead of rendered: it could not be deleted by name nor used in the
 * form, so showing it would only offer a control that cannot work.
 *
 * Deletability fails safe. The server stamps `builtin` on every row it merges today, but the
 * derivation does not depend on that: a missing or non-boolean flag is unknown provenance, and the
 * only row that may be deleted is one the server explicitly reported as a non-builtin. An unknown
 * row is therefore protected and labelled `Protegida` rather than silently claiming to be a
 * custom category: labelling it `Personalizada` while offering nothing to delete, or deleting a row
 * that may well be a builtin, would both be dishonest about what is actually known.
 */
export function getCategoryDisplayRows(categories: Category[]): CategoryDisplayRow[] {
	const rows: CategoryDisplayRow[] = [];
	for (const category of categories) {
		const name = normalizeCategoryName(category?.name);
		if (!name) continue;
		const builtin = category?.builtin === true;
		const canDelete = category?.builtin === false;
		rows.push({
			name,
			color: getCategoryColor(category),
			label: builtin ? "Predeterminada" : canDelete ? "Personalizada" : "Protegida",
			builtin,
			canDelete,
		});
	}
	return rows.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * Delete confirmation copy.
 *
 * It states what the server actually does: only the `categories` row is removed
 * (`src/db.js:507-515`), so movements keep the category string they already store and nothing is
 * reassigned. Promising or implying a cascade would be false, and hiding the consequence behind a
 * bare "¿Eliminar?" would leave the user guessing.
 */
export function getCategoryDeleteConfirmation(name: string): CategoryDeleteConfirmation {
	const normalizedName = normalizeCategoryName(name);
	return {
		name: normalizedName,
		title: `¿Eliminar la categoría ${normalizedName}?`,
		message: `Se quita "${normalizedName}" del catálogo. Los movimientos existentes conservan su categoría y no se reasigna ningún movimiento.`,
		confirmLabel: "Eliminar categoría",
		cancelLabel: "Cancelar",
	};
}

export type CategoryCatalogPhase = "idle" | "loading" | "ready" | "failed";

export type CategoryCatalogState = {
	phase: CategoryCatalogPhase;
	/** Only ever categories a successful load returned. */
	categories: Category[];
	/** Truthful failure detail; null unless the phase is `failed`. */
	errorMessage: string | null;
};

export type CategoryCatalogEvent =
	| { type: "loadStarted" }
	| { type: "loaded"; categories: Category[] }
	| { type: "loadFailed" };

const CATEGORY_CATALOG_FAILURE_MESSAGE =
	"No se pudieron cargar las categorías. Puedes reintentar la carga.";
/**
 * Copy for a refresh that failed after a list was already loaded. Only a load that never succeeded
 * may claim no categories could be loaded; when a known list is on screen, the honest statement is
 * that it may be stale.
 */
const CATEGORY_CATALOG_STALE_MESSAGE =
	"No se pudo actualizar la lista de categorías y puede estar desactualizada. Se muestra la última versión conocida.";

export function createCategoryCatalogState(): CategoryCatalogState {
	return { phase: "idle", categories: [], errorMessage: null };
}

/**
 * Pure catalog reducer.
 *
 * A failed load keeps the categories of the last successful one: after a mutation whose refresh
 * failed, clearing the list would erase the user's catalog from the screen and present a transient
 * network failure as if the categories no longer existed. The error message says which of the two
 * situations applies.
 */
export function reduceCategoryCatalog(
	state: CategoryCatalogState,
	event: CategoryCatalogEvent,
): CategoryCatalogState {
	switch (event.type) {
		case "loadStarted":
			return { phase: "loading", categories: state.categories, errorMessage: null };
		case "loaded":
			return { phase: "ready", categories: [...event.categories], errorMessage: null };
		case "loadFailed":
			return {
				phase: "failed",
				categories: state.categories,
				errorMessage:
					state.categories.length > 0
						? CATEGORY_CATALOG_STALE_MESSAGE
						: CATEGORY_CATALOG_FAILURE_MESSAGE,
			};
	}
}

export type CategoryMutation =
	| { type: "upsert"; draft: CategoryDraft }
	| { type: "delete"; name: string };

export type CategoryMutationOutcome =
	| { status: "saved" }
	| { status: "deleted" }
	| { status: "failed"; message: string }
	/** No request left: another mutation already holds the single in-flight lock. */
	| { status: "busy" };

/**
 * Whether a settled mutation outcome owns the in-flight phase and must release it.
 *
 * `busy` is the one outcome that did not settle anything: no request left, because an earlier
 * attempt still holds the lock. Releasing the phase there would re-enable the submit and delete
 * controls while that attempt is unresolved, so the pending state has to stay and only the attempt
 * that owns the lock may clear it. Every other outcome — success and failure alike — belongs to
 * this attempt, so the phase is released for it and the surface can never stay locked forever.
 *
 * The decision lives here, next to the outcomes it reasons about, because this repository's test
 * harness has no DOM: as a pure function the invariant is executable instead of being a claim about
 * the component's source.
 */
export function shouldClearCategoryMutationPhase(outcome: CategoryMutationOutcome): boolean {
	return outcome.status !== "busy";
}

export type CategoryMutationSubmitter = (
	mutation: CategoryMutation,
) => Promise<CategoryMutationOutcome>;

export interface CategoryMutationSubmitterDeps {
	/** PUTs the category; rejects when the server refuses it. */
	upsertCategory: (payload: UpsertCategoryRequest) => Promise<UpsertCategoryResponse>;
	/** DELETEs the category by name; rejects when the server refuses it. */
	deleteCategory: (name: string) => Promise<DeleteCategoryResponse>;
	/** The same single in-flight lock the movement dialogs and the Gmail sync use. */
	lock: InFlightLockRef;
}

/**
 * A rejection the API layer produced carries the server's own Spanish message
 * (`"name es obligatorio"`, `"color inválido"`, `"Category not found"`), which is user-facing and
 * must be shown as-is. Any other rejection is local, and its technical text is not written for the
 * user, so it is replaced with copy that names the operation instead of leaking an internal string.
 */
export function getCategoryMutationFailureMessage(error: unknown): string {
	if (error instanceof ApiError && error.message.trim()) return error.message.trim();
	return CATEGORY_MUTATION_FAILURE_MESSAGE;
}

/**
 * Creates the submit callback the settings dialog awaits.
 *
 * Both decisions the lock protects are synchronous and happen before the first `await`: an invalid
 * draft or an empty delete name is refused without a request, and the lock is acquired before
 * anything leaves, so two clicks in the same tick can never issue two mutations — the second
 * reports `busy`. The lock is released on every settled attempt, so a failed mutation stays
 * retryable and never holds the surface hostage.
 */
export function createCategoryMutationSubmitter({
	upsertCategory,
	deleteCategory,
	lock,
}: CategoryMutationSubmitterDeps): CategoryMutationSubmitter {
	return async (mutation) => {
		if (mutation.type === "delete") {
			const name = normalizeCategoryName(mutation.name);
			if (!name) return { status: "failed", message: CATEGORY_NAME_REQUIRED_MESSAGE };
			if (!acquireInFlightLock(lock)) return { status: "busy" };
			try {
				await deleteCategory(name);
				return { status: "deleted" };
			} catch (error) {
				return { status: "failed", message: getCategoryMutationFailureMessage(error) };
			} finally {
				releaseInFlightLock(lock);
			}
		}

		// The dialog validates for its inline message; this is the invariant that makes "no request
		// leaves for an invalid draft" true no matter which caller submits.
		const validation = validateCategoryDraft(mutation.draft);
		if (!validation.ok) return { status: "failed", message: validation.message };
		if (!acquireInFlightLock(lock)) return { status: "busy" };
		try {
			await upsertCategory(validation.payload);
			return { status: "saved" };
		} catch (error) {
			return { status: "failed", message: getCategoryMutationFailureMessage(error) };
		} finally {
			releaseInFlightLock(lock);
		}
	};
}
