import type { FinancialTransaction, MovementUpdateTarget } from "../../api/types";
import { isMovementNotFoundError } from "./manualExpense";

/**
 * Lifecycle of a single movement removal.
 *
 * The removal flow is a pure state machine on purpose: this repository's test harness
 * has no DOM, so the invariants that protect irreversible data (one in-flight request,
 * no re-send after success, truthful stale list) must be provable without a component.
 */
export type RemovalPhase = "closed" | "confirming" | "removing" | "failed" | "notFound" | "removed";

export type RemovalState = {
	phase: RemovalPhase;
	/** Movement being acted on. Kept after a failure so a retry targets the same record, and
	 * kept after `notFound` so the dialog can still name what it could not locate. */
	movementId: string | null;
	/** Truthful failure message; null unless the phase is `failed` or `notFound`. */
	errorMessage: string | null;
	/**
	 * True when the removal succeeded but the follow-up reload failed, so the visible
	 * list may still show the removed movement. The caller must say so instead of
	 * pretending the refresh worked.
	 */
	reloadFailed: boolean;
	/**
	 * Movements whose removal already completed, in completion order. Serializable on
	 * purpose: `RemovalState` stays a plain value the tests can deep-compare.
	 *
	 * The caller's list can keep rendering a removed movement until it refreshes, so a
	 * second click on that stale row must not start another removal; otherwise the server
	 * answers 404 and the dialog reports a not-found state for a movement that was already gone.
	 */
	removedMovementIds: string[];
};

export type RemovalEvent =
	| { type: "open"; movementId?: string | null }
	| { type: "cancel" }
	| { type: "confirm" }
	| { type: "succeeded"; hadReloadFailure: boolean }
	| { type: "failed"; message: string }
	| { type: "notFound"; message: string };

export type RemovalMovement = Pick<
	FinancialTransaction,
	"counterparty" | "description" | "isManual"
>;

export type RemovalConfirmation = {
	/** Resolved movement label used in the title; falls back like the legacy dialog. */
	movementName: string;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	/** True when the removal deletes a manually recorded movement for good. */
	isPermanent: boolean;
};

const REMOVAL_FALLBACK_NAME = "este gasto";
const REMOVAL_FAILURE_MESSAGE = "No se pudo eliminar el movimiento. Intenta nuevamente.";
/**
 * A 404 means the server could not locate the movement at all. That is all it proves, so the copy
 * states only the possibilities it cannot rule out: the movement may already have been removed or
 * hidden elsewhere, or a previous edit may have changed its date. It never blames the single
 * lookup month, which the server ignores for a `manual_` id and which is not the only way a
 * record disappears.
 */
const REMOVAL_NOT_FOUND_MESSAGE =
	"El servidor no pudo encontrar el movimiento, así que no se eliminó. Puede que ya se haya eliminado u ocultado en otro lugar, o que una edición anterior haya cambiado su fecha. Actualiza la página para ver el estado real.";

export function createRemovalState(): RemovalState {
	return {
		phase: "closed",
		movementId: null,
		errorMessage: null,
		reloadFailed: false,
		removedMovementIds: [],
	};
}

/**
 * The single in-flight lock: a removal may only be submitted while the state is
 * `confirming` (first attempt) or `failed` (retry of a removal that did not happen).
 * `removing` is already in flight and `removed` already happened.
 */
export function canSubmitRemoval(state: RemovalState): boolean {
	return state.phase === "confirming" || state.phase === "failed";
}

function normalizeMovementId(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getMovementName(movement: RemovalMovement) {
	for (const value of [movement.counterparty, movement.description]) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return REMOVAL_FALLBACK_NAME;
}

/**
 * Builds the confirmation copy. Manual removal is permanent; a Gmail-derived movement is
 * only hidden from the dashboard and its email is never deleted, so the two cases must
 * never read alike.
 *
 * An unknown provenance is presented as the conservative hide: promising a permanent
 * delete for a row we cannot prove is manual would be the misleading direction.
 */
export function getRemovalConfirmation(movement: RemovalMovement): RemovalConfirmation {
	const movementName = getMovementName(movement);
	const isPermanent = movement.isManual === true;
	return {
		movementName,
		title: `¿Eliminar ${movementName}?`,
		message: isPermanent
			? "Este movimiento manual se elimina de forma permanente y no se puede deshacer."
			: "El movimiento desaparece del dashboard. El correo de Gmail no se elimina y esta acción no se puede deshacer.",
		confirmLabel: isPermanent ? "Eliminar movimiento" : "Ocultar del dashboard",
		cancelLabel: "Cancelar",
		isPermanent,
	};
}

function normalizeFailureMessage(message: unknown) {
	return typeof message === "string" && message.trim() ? message.trim() : REMOVAL_FAILURE_MESSAGE;
}

/** Copy for a movement the server could not locate; terminal, so it never offers a retry. */
export function getRemovalNotFoundMessage(): string {
	return REMOVAL_NOT_FOUND_MESSAGE;
}

function normalizeMovementNotFoundMessage(message: unknown) {
	return typeof message === "string" && message.trim()
		? message.trim()
		: REMOVAL_NOT_FOUND_MESSAGE;
}

/**
 * Dismissal transition for a terminal phase (`removed`, `failed` or `notFound`), where the `cancel`
 * event is deliberately a no-op. It always keeps `removedMovementIds`, so closing the result of a
 * removal cannot re-enable a second DELETE for the same movement; use the `cancel` event while the
 * phase is still `confirming`.
 *
 * Like every illegal event, it returns the identical state for phases it does not own.
 */
export function dismissRemoval(state: RemovalState): RemovalState {
	if (state.phase !== "removed" && state.phase !== "failed" && state.phase !== "notFound")
		return state;
	return { ...createRemovalState(), removedMovementIds: state.removedMovementIds };
}

/**
 * Maps a dismissal intent to the only truthful transition for the current phase. This is the
 * mapping the mounted dialog's `onCancel` must use: `confirming` closes through the reducer's
 * `cancel` event, and a terminal phase (`removed`/`failed`/`notFound`) closes through
 * `dismissRemoval`, which keeps `removedMovementIds`.
 *
 * Closing a terminal removal with a fresh `createRemovalState()` would erase that guard and let a
 * stale row send a second DELETE for a movement that is already gone.
 */
export function reduceRemovalDismissal(state: RemovalState): RemovalState {
	if (state.phase === "confirming") return reduceRemovalState(state, { type: "cancel" });
	if (state.phase === "removed" || state.phase === "failed" || state.phase === "notFound")
		return dismissRemoval(state);
	return state;
}

/**
 * Pure reducer for the removal lifecycle. Events that cannot legally apply are no-ops and
 * return the identical state, so `reduceRemovalState(state, event) === state` proves that
 * nothing happened.
 */
export function reduceRemovalState(state: RemovalState, event: RemovalEvent): RemovalState {
	switch (event.type) {
		case "open": {
			// A removal already in flight owns the lifecycle and cannot be replaced.
			if (state.phase === "removing") return state;
			const movementId = normalizeMovementId(event.movementId) ?? state.movementId;
			// A movement that already completed removal cannot be removed again, no matter how
			// stale the caller's list still is: re-opening it would send a second DELETE and
			// report a false failure for a record that is already gone.
			if (movementId !== null && state.removedMovementIds.includes(movementId)) return state;
			return {
				phase: "confirming",
				movementId,
				errorMessage: null,
				reloadFailed: false,
				removedMovementIds: state.removedMovementIds,
			};
		}
		case "cancel":
			// Cancelling is only truthful before the request is sent.
			if (state.phase !== "confirming") return state;
			// What was already removed stays remembered; forgetting it here would let an
			// unrelated open/cancel pair re-arm a removal that already happened.
			return { ...createRemovalState(), removedMovementIds: state.removedMovementIds };
		case "confirm":
			if (!canSubmitRemoval(state)) return state;
			return { ...state, phase: "removing", errorMessage: null, reloadFailed: false };
		case "succeeded": {
			// Only the request that was in flight can complete; a late response is ignored.
			if (state.phase !== "removing") return state;
			const removedMovementId = state.movementId;
			return {
				phase: "removed",
				movementId: removedMovementId,
				errorMessage: null,
				reloadFailed: event.hadReloadFailure === true,
				removedMovementIds:
					removedMovementId !== null &&
					!state.removedMovementIds.includes(removedMovementId)
						? [...state.removedMovementIds, removedMovementId]
						: state.removedMovementIds,
			};
		}
		case "failed":
			if (state.phase !== "removing") return state;
			return {
				phase: "failed",
				movementId: state.movementId,
				errorMessage: normalizeFailureMessage(event.message),
				reloadFailed: false,
				removedMovementIds: state.removedMovementIds,
			};
		case "notFound":
			// A 404 is terminal, exactly like the edit flow: the server could not locate the movement
			// at all, so repeating the identical DELETE cannot succeed. The phase is separate from
			// `failed` because it must not offer a retry. The movement is deliberately NOT recorded in
			// `removedMovementIds`: this client did not remove it, so only the copy may claim what a
			// 404 proves.
			if (state.phase !== "removing") return state;
			return {
				phase: "notFound",
				movementId: state.movementId,
				errorMessage: normalizeMovementNotFoundMessage(event.message),
				reloadFailed: false,
				removedMovementIds: state.removedMovementIds,
			};
	}
}

export type MovementRemovalSubmitOutcome =
	| { status: "removed"; reloadFailed: boolean }
	| { status: "notFound" }
	| { status: "failed"; message: string };

export type MovementRemovalSubmitter = (
	target: MovementUpdateTarget,
) => Promise<MovementRemovalSubmitOutcome>;

export interface MovementRemovalSubmitterDeps {
	/** DELETEs the movement; rejects when the server refuses it. */
	removeMovement: (target: MovementUpdateTarget) => Promise<void>;
	/** Re-runs the cycle-first dashboard load. Resolves `false` when the reload failed. */
	reload: () => Promise<boolean>;
}

/**
 * Maps a rejection to Spanish copy for the retryable failure case. A 404 never reaches here: the
 * submitter classifies it as the terminal `notFound` outcome through the single rule shared with
 * the edit flow (`isMovementNotFoundError`), so the same condition behaves the same way in both
 * flows and cannot offer an impossible retry.
 */
export function getRemovalErrorMessage(error: unknown): string {
	return REMOVAL_FAILURE_MESSAGE;
}

/**
 * Creates the submit callback the removal dialog awaits.
 *
 * A rejected DELETE is a real failure and never triggers the reload, so a removal that did not
 * happen cannot be reported as one that did. A successful DELETE always resolves with the reload
 * outcome, so a refresh that failed (or threw) says the visible list may be stale and never
 * re-sends the successful DELETE.
 */
export function createMovementRemovalSubmitter({
	removeMovement,
	reload,
}: MovementRemovalSubmitterDeps): MovementRemovalSubmitter {
	return async (target) => {
		try {
			await removeMovement(target);
		} catch (error) {
			if (isMovementNotFoundError(error)) return { status: "notFound" };
			return { status: "failed", message: getRemovalErrorMessage(error) };
		}
		try {
			return { status: "removed", reloadFailed: (await reload()) === false };
		} catch {
			return { status: "removed", reloadFailed: true };
		}
	};
}

export type RemovalNotice = {
	message: string;
	tone: "success" | "warning";
};

/**
 * Copy for the outcome shown on the dashboard once the result dialog is dismissed, read from the
 * authoritative removal state. A removal whose refresh failed is reported as a stale list, never
 * as a removal that did not happen, and a phase that did not complete a removal publishes nothing.
 */
export function getRemovalNotice(state: RemovalState): RemovalNotice | null {
	if (state.phase !== "removed") return null;
	if (state.reloadFailed) {
		return {
			message:
				"El movimiento se eliminó correctamente, pero la lista no se pudo actualizar y puede estar desactualizada. Actualiza la página para ver el estado real.",
			tone: "warning",
		};
	}
	return { message: "El movimiento se eliminó correctamente.", tone: "success" };
}
