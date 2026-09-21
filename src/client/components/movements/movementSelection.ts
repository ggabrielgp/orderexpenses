import type { MovementUpdateTarget, UpdateTransactionRequest } from "../../api/types";
import {
	isMovementNotFoundError,
	type EditableRecognizedExpenseMovement,
	type RecognizedExpenseMovement,
} from "./manualExpense";

/**
 * Row selection and bulk-category decisions for the period-scoped movements table.
 *
 * Legacy let the user tick rows, assign a category to the whole selection, jump to every movement
 * sharing a counterparty ("N similares") and clear the selection
 * (`public/app.js:3733-3799`). The surface is small but the rules are worth proving without a DOM,
 * exactly like the filter and sort modules it sits beside: which rows are selectable, what the
 * select-all checkbox reports, what the similar-counterparty affordance offers, and what a bulk PATCH
 * may and may not claim to have changed.
 *
 * A row is selectable only when the mutation-side projection produced a target for it
 * (`getEditableRecognizedExpenseMovements`): a movement without a usable id or a parseable original
 * date stays readable in the table and in its detail dialog, but it is not tickable and never enters a
 * bulk request. That is the same rule that decides whether a row offers Editar/Eliminar at all, kept
 * in one place so the two surfaces cannot disagree.
 *
 * No React import: these are decisions, not rendering.
 */

/** The ids the user ticked, stored as a set because membership is the only question asked of it. */
export type MovementSelection = ReadonlySet<string>;

/** The neutral selection: nothing ticked. It is both the initial state and the result of clearing. */
export function createMovementSelection(): MovementSelection {
	return new Set();
}

/**
 * The identity a counterparty is grouped by for the "N similares" affordance.
 *
 * It mirrors `normalizeCounterpartyKey` (`src/movements.js:294-301`) operation for operation — NFD,
 * strip combining diacritics, lowercase, collapse whitespace — so a merchant written "Caf\u00e9" and
 * "cafe" is one group. The duplication is deliberate, exactly like the store-side mirror in
 * `settings/counterpartyRules.ts`: this module must stay free of the React-importing settings module
 * it would otherwise depend on, and the grouping is a local read-only decision that never reaches a
 * request body.
 */
export function getMovementCounterpartyKey(value: unknown): string {
	return String(value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

/**
 * The tickable ids among the rows the table is rendering, in render order and without duplicates.
 *
 * The rows carry the read projection's `id`, which may be `null`; the editable set carries the
 * mutation identity. A row is selectable only when both agree on a non-empty id. Rows with no id (or
 * whose date the server cannot accept) are intentionally absent, so the select-all control counts only
 * what a bulk PATCH could actually target.
 */
export function getSelectableMovementIds(
	rows: RecognizedExpenseMovement[],
	editableMovements: EditableRecognizedExpenseMovement[],
): string[] {
	const editableIds = new Set(editableMovements.map((movement) => movement.id));
	const seen = new Set<string>();
	const selectable: string[] = [];
	for (const row of rows) {
		if (row.id === null || seen.has(row.id) || !editableIds.has(row.id)) continue;
		seen.add(row.id);
		selectable.push(row.id);
	}
	return selectable;
}

/**
 * Drops ids the current rows no longer make selectable, keeping the selection object identical while
 * nothing changed so the caller can commit only on a real transition. This is what a category filter
 * or a reload uses to prevent a hidden or edited-away row from staying silently selected.
 */
export function reconcileMovementSelection(
	selection: MovementSelection,
	selectableIds: string[],
): MovementSelection {
	const allowed = new Set(selectableIds);
	let changed = false;
	const next = new Set<string>();
	for (const id of selection) {
		if (allowed.has(id)) next.add(id);
		else changed = true;
	}
	return changed ? next : selection;
}

/** Ticks or unticks one movement; a no-op for an id the caller may not select. */
export function toggleMovementSelection(
	selection: MovementSelection,
	id: string,
	selectableIds: string[],
): MovementSelection {
	if (!selectableIds.includes(id)) return selection;
	const next = new Set(selection);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

/**
 * The select-all transition: with every selectable row already ticked it clears, otherwise it selects
 * all of them. It never invents a third state, which is what keeps the header checkbox's
 * checked/unchecked coupling truthful.
 */
export function toggleAllMovementSelection(
	selection: MovementSelection,
	selectableIds: string[],
): MovementSelection {
	const view = getMovementSelectionView(selection, selectableIds);
	return view.allSelected ? createMovementSelection() : new Set(selectableIds);
}

/** Selects exactly the given ids, used by the "N similares" affordance. */
export function selectMovementIds(ids: string[]): MovementSelection {
	return new Set(ids);
}

export type MovementSelectionView = {
	/** Tickable ids in the current rows, in render order and deduplicated. */
	selectableIds: string[];
	/** Ticked ids that still belong to the current rows. */
	selectedIds: string[];
	selectedCount: number;
	selectableCount: number;
	/** True when every selectable row is ticked. */
	allSelected: boolean;
	/** True when some but not all selectable rows are ticked. */
	someSelected: boolean;
	/** The header checkbox's mixed state, true exactly when `someSelected`. */
	indeterminate: boolean;
	/** Header checkbox `checked` value. */
	headerChecked: boolean;
	/** Announced statement, or `null` while nothing is selected. */
	message: string | null;
};

/**
 * Everything the selection UI needs for one render, derived from the stored set and the tickable ids
 * so the header checkbox, the count and the row checkboxes can never disagree.
 */
export function getMovementSelectionView(
	selection: MovementSelection,
	selectableIds: string[],
): MovementSelectionView {
	const unique = [...new Set(selectableIds)];
	const selectedIds = unique.filter((id) => selection.has(id));
	const selectedCount = selectedIds.length;
	const selectableCount = unique.length;
	const allSelected = selectableCount > 0 && selectedCount === selectableCount;
	const someSelected = selectedCount > 0 && !allSelected;
	return {
		selectableIds: unique,
		selectedIds,
		selectedCount,
		selectableCount,
		allSelected,
		someSelected,
		indeterminate: someSelected,
		headerChecked: allSelected,
		message:
			selectedCount === 0
				? null
				: `${selectedCount} de ${selectableCount} movimientos seleccionados`,
	};
}

export type SimilarCounterpartyAffordance = {
	/** Normalized counterparty key the rows were grouped by. */
	key: string;
	/** Tickable rows sharing the key, the reference row included when it is selectable. */
	ids: string[];
	/** How many tickable similar movements the affordance would select. */
	count: number;
	/** Legacy's label for the control. */
	label: string;
};

/**
 * The "N similares" affordance for one row: the tickable movements sharing its normalized
 * counterparty. It is computed over the rows the table is currently rendering, so a category filter
 * cannot make the control select a row the user cannot see.
 */
export function getSimilarCounterpartyAffordance(
	movement: RecognizedExpenseMovement,
	rows: RecognizedExpenseMovement[],
	selectableIds: string[],
): SimilarCounterpartyAffordance {
	const key = getMovementCounterpartyKey(movement.counterparty);
	const selectable = new Set(selectableIds);
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		if (row.id === null || seen.has(row.id) || !selectable.has(row.id)) continue;
		if (getMovementCounterpartyKey(row.counterparty) !== key) continue;
		seen.add(row.id);
		ids.push(row.id);
	}
	return { key, ids, count: ids.length, label: `${ids.length} similares` };
}

export type BulkCategoryFailure = {
	movementId: string;
	message: string;
	kind: "failed" | "notFound";
};

/**
 * The exact result of one bulk attempt. It is a plain value the caller can render without a second
 * request: how many movements were targeted, how many changed, how many failed, and whether the
 * follow-up reload left the visible list stale.
 */
export type BulkCategoryAssignment = {
	total: number;
	succeeded: number;
	failed: number;
	notFound: number;
	reloadFailed: boolean;
	failures: BulkCategoryFailure[];
};

export type BulkCategorySubmitter = (
	targets: MovementUpdateTarget[],
	category: string,
) => Promise<BulkCategoryAssignment>;

export interface BulkCategorySubmitterDeps {
	/** PATCHes one movement; rejects when the server refuses it. */
	updateMovement: (
		target: MovementUpdateTarget,
		patch: Partial<UpdateTransactionRequest>,
	) => Promise<void>;
	/** Re-runs the cycle-first dashboard load. Resolves `false` when the reload failed. */
	reload: () => Promise<boolean>;
}

const BULK_CATEGORY_FAILURE_MESSAGE =
	"No se pudo actualizar este movimiento. No se reintentó automáticamente.";

/**
 * Creates the callback the bulk action awaits.
 *
 * It sends the minimal `{ category }` PATCH the server merges, and nothing else: a category change
 * must not rewrite the amount, kind, date or counterparty the user did not touch. Each movement is
 * attempted exactly once — a 404 or a rejection is recorded, never retried — and a single reload runs
 * only when at least one PATCH succeeded, so a selection that changed nothing does not churn the
 * dashboard. The returned counts are the truth the feedback copy is built from.
 */
export function createBulkCategorySubmitter({
	updateMovement,
	reload,
}: BulkCategorySubmitterDeps): BulkCategorySubmitter {
	return async (targets, category) => {
		const patch: Partial<UpdateTransactionRequest> = {
			category: category.trim() || null,
		};
		let succeeded = 0;
		let failed = 0;
		let notFound = 0;
		const failures: BulkCategoryFailure[] = [];

		for (const target of targets) {
			try {
				await updateMovement(target, patch);
				succeeded += 1;
			} catch (error) {
				if (isMovementNotFoundError(error)) {
					notFound += 1;
					failures.push({
						movementId: target.movementId,
						message:
							"El servidor no encontró este movimiento, así que no se actualizó. No se reintentó.",
						kind: "notFound",
					});
					continue;
				}
				failed += 1;
				failures.push({
					movementId: target.movementId,
					message: BULK_CATEGORY_FAILURE_MESSAGE,
					kind: "failed",
				});
			}
		}

		let reloadFailed = false;
		if (succeeded > 0) {
			try {
				reloadFailed = (await reload()) === false;
			} catch {
				reloadFailed = true;
			}
		}

		return { total: targets.length, succeeded, failed, notFound, reloadFailed, failures };
	};
}

export type BulkCategoryFeedback = {
	tone: "success" | "warning" | "error";
	message: string;
};

/**
 * Truthful copy for a bulk outcome. It states the exact success count out of the target count, never
 * rounds a partial application up to a success, and adds the stale-list sentence only when the
 * reload actually failed. A `null` result means there is nothing to say — the caller rendered no
 * selection, so no request ran.
 */
export function getBulkCategoryFeedback(
	outcome: BulkCategoryAssignment,
): BulkCategoryFeedback | null {
	if (outcome.total === 0) return null;
	const totalLabel = outcome.total === 1 ? "movimiento" : "movimientos";
	const stale = outcome.reloadFailed
		? " La lista de movimientos no se pudo actualizar y puede estar desactualizada: actualiza la página para ver el estado real."
		: "";
	if (outcome.succeeded === outcome.total) {
		const succeededLabel =
			outcome.succeeded === 1 ? "movimiento" : "movimientos";
		return {
			tone: "success",
			message: `Se asignó la categoría a ${outcome.succeeded} ${succeededLabel}.${stale}`,
		};
	}
	if (outcome.succeeded === 0) {
		return {
			tone: "error",
			message: `No se pudo asignar la categoría a ninguno de los ${outcome.total} ${totalLabel}. No se aplicaron cambios.${stale}`,
		};
	}
	return {
		tone: "warning",
		message: `Se asignó la categoría a ${outcome.succeeded} de ${outcome.total} ${totalLabel}. Los otros ${outcome.total - outcome.succeeded} no se pudieron actualizar.${stale}`,
	};
}

/**
 * Resolves the movement targets a bulk action may send. It reads the editable projection, so a
 * selection can never expand into a movement without a valid target even if a stale id survived in
 * state.
 */
export function getBulkCategoryTargets(
	movements: EditableRecognizedExpenseMovement[],
	selectedIds: string[],
): EditableRecognizedExpenseMovement[] {
	const selected = new Set(selectedIds);
	return movements.filter(
		(movement) => movement.id !== null && selected.has(movement.id),
	);
}
