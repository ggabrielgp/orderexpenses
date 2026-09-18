import type { CompleteFinancialCycleResponse, FinancialPeriod } from "../../api/types";
import {
	acquireInFlightLock,
	releaseInFlightLock,
	type InFlightLockRef,
} from "../movements/CreateManualExpenseDialog";
import { getCycleClosureDate } from "./cycleSettings";

/**
 * Financial-cycle completion decisions. `POST /api/financial-cycle/complete` synchronizes Gmail first and writes the
 * closure only if that synchronization completes (`src/server.js:408-472`): `partial` and `disconnected` are answered before
 * the write, while a 502 can follow a closure that was already applied, because the handler's catch wraps the write and the
 * read-back. The copy, the reading that tells a fresh closure from an idempotent re-close, and the in-flight lock are pure
 * here because this harness has no DOM.
 */

/** The handler exposes no progress signal, so no percentage, estimate or count exists to render. The second sentence is the
 * only honest escape this surface has: there is no cancellation (aborting would not stop the server's sequential Gmail work
 * nor prevent a written closure), so it says when the dialog becomes closable and that a reload abandons the wait. */
export const CYCLE_COMPLETION_PENDING_MESSAGE =
	"Cerrando el periodo y revisando el correo de Gmail... La revisión puede tardar y no es posible mostrar un avance parcial. Puedes cerrar esta ventana cuando la revisión termine, y recargar la página abandona la espera.";

export type CycleCompletionNotice = { message: string; tone: "success" | "warning" | "error" };

/**
 * One settled closure attempt. `alreadyClosed` says the server returned the closure it already had; `partial` and
 * `disconnected` wrote nothing, because the handler answers both before the write (`src/server.js:419-447`). `error` has no
 * usable verdict: its 502 catch also wraps the write, so the period may already be closed. `failed` has no verdict and no
 * message either, because this endpoint answers with its own error object (`src/server.js:521-523`), never with user copy.
 */
export type CycleCompletionSubmitOutcome =
	| { status: "closed"; completedAt: string; alreadyClosed: boolean; reloadFailed: boolean }
	| { status: "partial"; failedCount: number }
	| { status: "disconnected" }
	| { status: "error" }
	| { status: "failed" }
	| { status: "busy" };

/** Every outcome except the one that left no request behind. */
export type CycleCompletionSettledOutcome = Exclude<CycleCompletionSubmitOutcome, { status: "busy" }>;

/** Whether a settled outcome owns the in-flight phase. `busy` settled nothing, so clearing the phase there
 * would re-enable the confirm control while an earlier attempt is still unresolved. */
export function shouldClearCycleCompletionPhase(
	outcome: CycleCompletionSubmitOutcome,
): outcome is CycleCompletionSettledOutcome {
	return outcome.status !== "busy";
}

/**
 * Whether the closure the server returned was already registered before this attempt. The handler reuses a stored
 * `completed_at` (`src/server.js:452`), so a second close answers with the original timestamp, and the only evidence is the
 * closure the summary had loaded; both sides are instants that may be serialized differently.
 */
export function isCycleAlreadyClosed(
	returnedCompletedAt: string | null | undefined,
	loadedCompletedAt: string | null | undefined,
): boolean {
	if (typeof returnedCompletedAt !== "string" || !returnedCompletedAt.trim()) return false;
	if (typeof loadedCompletedAt !== "string" || !loadedCompletedAt.trim()) return false;
	const returned = Date.parse(returnedCompletedAt);
	const loaded = Date.parse(loadedCompletedAt);
	if (Number.isNaN(returned) || Number.isNaN(loaded)) {
		return returnedCompletedAt === loadedCompletedAt;
	}
	return returned === loaded;
}

export type CycleCompletionSubmitter = (period: FinancialPeriod) => Promise<CycleCompletionSubmitOutcome>;

export interface CycleCompletionSubmitterDeps {
	/** POSTs the closure; rejects on a refused request, a network failure, or a body this client cannot read. */
	complete: (period: FinancialPeriod) => Promise<CompleteFinancialCycleResponse>;
	/** The reload the summary publishes as `FinancialDashboardHandle.reload`; resolves `false` when it failed. */
	reload: () => Promise<boolean>;
	/** The closure already loaded, the evidence a re-close is compared against. */
	loadedCompletedAt: string | null;
	/** The same single in-flight lock the movement dialogs, the sync and the settings use. */
	lock: InFlightLockRef;
}

/**
 * Creates the callback the confirmation dialog awaits. The lock is taken before the first `await`, so two clicks in the same
 * tick cannot issue two closures, and it is released on every settled attempt so a refusal stays retryable. Only a successful
 * synchronization reloads: the reload runs after the closure is stored, so its outcome is stale data, never a failed closure.
 * `partial` and `disconnected` wrote nothing, and the `error` state has no verdict this submitter could reload against — its
 * copy sends the user to a reload instead.
 */
export function createCycleCompletionSubmitter({
	complete,
	reload,
	loadedCompletedAt,
	lock,
}: CycleCompletionSubmitterDeps): CycleCompletionSubmitter {
	return async (period) => {
		if (!acquireInFlightLock(lock)) return { status: "busy" };
		try {
			const response = await complete(period);
			if (response.outcome === "partial") {
				return { status: "partial", failedCount: response.failedCount };
			}
			if (response.outcome === "disconnected") return { status: "disconnected" };
			if (response.outcome !== "success") return { status: "error" };

			const alreadyClosed = isCycleAlreadyClosed(response.completedAt, loadedCompletedAt);
			let reloadFailed = true;
			try {
				reloadFailed = (await reload()) === false;
			} catch {
				// A failed refresh is stale data, never a failed closure.
			}
			return { status: "closed", completedAt: response.completedAt, alreadyClosed, reloadFailed };
		} catch {
			return { status: "failed" };
		} finally {
			releaseInFlightLock(lock);
		}
	};
}

const COMPLETION_REFRESHED = "El resumen financiero se actualizó y muestra el cierre registrado.";
const COMPLETION_STALE =
	"El cierre quedó registrado, pero el resumen no se pudo actualizar y puede estar desactualizado. Actualiza la página para ver el estado real.";

/** Copy for the outcomes that carry no value from the server, plus the one that produced no verdict. */
const FIXED_COMPLETION_NOTICES: Record<"disconnected" | "error" | "failed", CycleCompletionNotice> = {
	disconnected: {
		message: "El cierre no se registró y el periodo sigue abierto: tu cuenta de Gmail no está conectada y cerrar el periodo necesita leer el correo. Usa el botón «Conectar Gmail» del panel de conexión y vuelve a intentarlo.",
		tone: "warning",
	},
	error: { tone: "error", message: "El cierre no se pudo completar y no es posible confirmar si quedó registrado. Vuelve a cargar el resumen para ver el estado real; reintentar el cierre es seguro, porque cerrar un periodo ya cerrado conserva el registro original." },
	failed: { tone: "error", message: "No es posible confirmar si el cierre quedó registrado. Vuelve a cargar el resumen para ver el estado real." },
};

/**
 * Copy for a settled attempt, per outcome. A re-closure states that the original record is the one kept, and `partial` states
 * that the period is still open. The date comes from `getCycleClosureDate`, the formatter the closure mark uses, so the dialog
 * and the summary cannot disagree about the day.
 *
 * `partial` and `disconnected` may say nothing was recorded and the period stays open because the handler answers both before
 * it touches the closure (`src/server.js:419-447`). `error` may not: its 502 catch wraps the synchronization, the read and the
 * write (`src/server.js:430-471`) and the upsert happens before the read-back (`src/db.js:176-181`), so the closure can be on
 * record even though the answer says `completedAt: null`. Its copy states that the closure could not be completed and that the
 * record is unknown, naming no step as the failing one, and never denies a closure the client cannot rule out.
 *
 * `failed` is the same restraint without the one fact it lacks: the request produced no verdict at all — a refused request, a
 * dropped connection or a body this client could not read — so its copy states only that the record is unconfirmed and sends
 * the user to the summary, and never promises that nothing happened.
 */
export function getCycleCompletionNotice(
	outcome: CycleCompletionSettledOutcome,
	timeZone?: string,
): CycleCompletionNotice {
	if (outcome.status === "closed") {
		const date = getCycleClosureDate(outcome.completedAt, timeZone);
		const opening = outcome.alreadyClosed
			? `Este periodo ya tenía un cierre registrado${date === null ? "" : ` el ${date}`} y se conserva ese registro.`
			: `Periodo cerrado. ${date === null ? "Cierre registrado." : `Cierre registrado el ${date}.`}`;
		return {
			message: `${opening} ${outcome.reloadFailed ? COMPLETION_STALE : COMPLETION_REFRESHED}`,
			tone: outcome.reloadFailed ? "warning" : "success",
		};
	}
	if (outcome.status === "partial") {
		const failures = outcome.failedCount === 1 ? "1 consulta a Gmail no se pudo completar" : `${outcome.failedCount} consultas a Gmail no se pudieron completar`;
		return {
			message: `El cierre no se registró y el periodo sigue abierto: ${failures}. Puedes reintentar el cierre.`,
			tone: "warning",
		};
	}
	return FIXED_COMPLETION_NOTICES[outcome.status];
}
