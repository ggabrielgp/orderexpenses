import { ApiError } from "../../api/client";
import type { FinancialCycleResponse, UpdateFinancialCycleRequest } from "../../api/types";
import {
	acquireInFlightLock,
	releaseInFlightLock,
	type InFlightLockRef,
} from "../movements/CreateManualExpenseDialog";
import { formatIncomeInput } from "../movements/manualExpense";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../../shared/review-period.js";

/**
 * Financial-cycle edit decisions.
 *
 * Reopening the configured period and editing it is the same act in this period-scoped surface: there
 * is no month axis to walk. Every rule that keeps the flow honest is pure here — the draft that
 * prefills the form, the validation that must refuse before a request leaves, the completion
 * consequence that is invisible otherwise, and the single in-flight lock — because this repository's
 * test harness has no DOM, and an invariant that cannot be rendered has to be execurable.
 */

/** Legacy wizard copy, in its own order (`public/financial-cycle.js:44-74`). */
export const CYCLE_START_REQUIRED_MESSAGE = "Selecciona la fecha Desde.";
export const CYCLE_END_REQUIRED_MESSAGE = "Selecciona la fecha Hasta.";
export const CYCLE_END_BEFORE_START_MESSAGE =
	"La fecha Hasta debe ser igual o posterior a la fecha Desde.";
export const CYCLE_INCOME_INVALID_MESSAGE = "Ingresa un monto entero positivo en CLP.";

export type CycleEditDraft = {
	/** Inclusive first day, as the date input holds it. */
	startDate: string;
	/** Inclusive last day, as the date input holds it; the payload converts it to an exclusive one. */
	endDate: string;
	/** Income as the field renders it, including the thousands separator. */
	incomeValue: string;
};

/** Shared empty draft, and what a cycle without a configured period derives to. */
export const EMPTY_CYCLE_EDIT_DRAFT: CycleEditDraft = {
	startDate: "",
	endDate: "",
	incomeValue: "",
};

/**
 * Prefills the edit form from the configured cycle.
 *
 * The end date is converted to the inclusive date the input shows, through the same shared
 * `ReviewPeriod` helper the setup form uses, so the two surfaces cannot disagree about which day a
 * period ends on. The income goes through `formatIncomeInput`, the same formatter the field uses, so
 * an untouched save sends back exactly the amount that was stored.
 */
export function createCycleEditDraft(
	cycle: FinancialCycleResponse | null | undefined,
): CycleEditDraft {
	const selectedPeriod = cycle?.selectedPeriod;
	if (!selectedPeriod) return { ...EMPTY_CYCLE_EDIT_DRAFT };
	const period = ReviewPeriod.create(selectedPeriod);
	return {
		startDate: period.startDate,
		endDate: period.visibleEndDate,
		incomeValue: cycle.incomeAmount === null ? "" : formatIncomeInput(cycle.incomeAmount),
	};
}

/**
 * The single income rule for a configured period.
 *
 * Blank is `null`, which is what the server stores for "no income" and what `PUT
 * /api/financial-cycle` accepts; anything else must be a whole, positive, safe CLP integer written
 * with or without thousands dots. It is owned here so the setup form (through
 * `createFinancialCycleSetupPayload`) and the edit draft (through `validateCycleEditDraft`) cannot
 * drift apart, and reading the dotted form back is what lets an untouched save of a stored income
 * succeed.
 */
export function parseCycleIncome(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const digits = trimmed.replaceAll(".", "");
	if (
		(!/^\d+$/.test(trimmed) && !/^\d{1,3}(?:\.\d{3})+$/.test(trimmed)) ||
		!/^\d+$/.test(digits)
	) {
		throw new TypeError("Income must be a positive whole safe CLP integer");
	}
	const incomeAmount = Number(digits);
	if (!Number.isSafeInteger(incomeAmount) || incomeAmount <= 0) {
		throw new TypeError("Income must be a positive whole safe CLP integer");
	}
	return incomeAmount;
}

export type CycleEditValidation =
	| { ok: true; payload: UpdateFinancialCycleRequest }
	| { ok: false; message: string };

/**
 * Validates a draft and produces the exact `PUT /api/financial-cycle` body.
 *
 * The order is the legacy wizard's — start, end, range, income — so a draft that fails more than one
 * rule reports the one the user has to fix first. A draft that fails here is an invalid draft, never
 * a rejected request, so the caller reports it without sending anything. The inclusive end date is
 * converted to the exclusive boundary the server validates through the shared `ReviewPeriod` helper.
 */
export function validateCycleEditDraft(draft: CycleEditDraft): CycleEditValidation {
	const startDate = String(draft?.startDate ?? "").trim();
	const endDate = String(draft?.endDate ?? "").trim();
	if (!startDate) return { ok: false, message: CYCLE_START_REQUIRED_MESSAGE };
	if (!endDate) return { ok: false, message: CYCLE_END_REQUIRED_MESSAGE };

	let selectedPeriod: { startDate: string; endDateExclusive: string };
	try {
		selectedPeriod = ReviewPeriod.fromInclusive(startDate, endDate).toJSON();
	} catch {
		return { ok: false, message: CYCLE_END_BEFORE_START_MESSAGE };
	}

	let incomeAmount: number | null;
	try {
		incomeAmount = parseCycleIncome(String(draft?.incomeValue ?? ""));
	} catch {
		return { ok: false, message: CYCLE_INCOME_INVALID_MESSAGE };
	}

	return { ok: true, payload: { selectedPeriod, incomeAmount } };
}

/**
 * Calendar date of a closure record, in the viewer's own timezone.
 *
 * `completedAt` is a UTC instant (`new Date().toISOString()`, `src/server.js:452`), so its first ten
 * characters are the UTC calendar date, which is a different day from the one the user closed the
 * period on whenever the two sides of midnight differ. Formatting the instant through `Intl` with an
 * explicit `timeZone` keeps that honest and, unlike a `Date` read formatted by the host's own ICU
 * default, lets the suite pin the zone instead of depending on the machine that runs it.
 *
 * `timeZone` is that seam. It exists for the tests; production passes nothing and gets
 * `resolvedOptions().timeZone`, the viewer's zone. An absent or unreadable timestamp has no date, and
 * the callers below then state the closure without one instead of inventing a day.
 */
export function getCycleClosureDate(
	completedAt: string | null | undefined,
	timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
	if (typeof completedAt !== "string" || !completedAt.trim()) return null;
	const timestamp = Date.parse(completedAt);
	if (Number.isNaN(timestamp)) return null;
	return new Intl.DateTimeFormat("es-CL", {
		timeZone,
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(timestamp);
}

/**
 * The discrete closure mark the summary shows next to the configured period.
 *
 * It states the fact and then denies the implication: `PUT /api/financial-cycle` never consults
 * `completedAt` (`src/server.js:403-407`), so a mark that read as a lock would be false.
 */
export function getCycleClosureMark(
	completedAt: string | null | undefined,
	timeZone?: string,
): string | null {
	if (typeof completedAt !== "string" || !completedAt.trim()) return null;
	const date = getCycleClosureDate(completedAt, timeZone);
	return `Cierre registrado${date === null ? "" : ` el ${date}`}. Es un registro informativo: el periodo sigue siendo editable.`;
}

export type CycleClosureNotice = {
	/** That the configured period is closed, or `null` when it carries no closure record. */
	closedMessage: string | null;
	/** What the pending save does to that record, or `null` when there is no record or no save. */
	consequenceMessage: string | null;
	/** Whether the submittable draft would save a different range than the configured one. */
	rangeChanged: boolean;
};

/**
 * The completion consequence, stated before the save.
 *
 * It is derived from what `upsertFinancialCycleSettings` really does, not from what would be
 * convenient to promise: the same range keeps `completed_at` through `COALESCE` (`src/db.js:183-202`,
 * `:198`), while a different range is a different conflict key that keeps whatever record it already
 * carried — `NULL` only if that range was never closed. The copy is written so it stays true in both
 * cases, because the UI cannot tell which one the new range is: it only knows the current cycle.
 *
 * A draft that cannot be submitted performs no write, so it gets no consequence either: the range
 * statement is derived from the exact draft `validateCycleEditDraft` accepts, which is the same
 * validation the submitter runs, so the notice and the write can never describe different drafts.
 * The fact that the configured period is closed does not depend on the draft and is always stated.
 */
export function getCycleClosureNotice(
	cycle: FinancialCycleResponse | null | undefined,
	draft: CycleEditDraft,
	timeZone?: string,
): CycleClosureNotice {
	const completedAt = cycle?.completedAt;
	const selectedPeriod = cycle?.selectedPeriod;
	if (typeof completedAt !== "string" || !completedAt.trim() || !selectedPeriod) {
		return { closedMessage: null, consequenceMessage: null, rangeChanged: false };
	}

	const date = getCycleClosureDate(completedAt, timeZone);
	const closedMessage = `Este periodo tiene un cierre registrado${date === null ? "" : ` el ${date}`}.`;

	const validation = validateCycleEditDraft(draft);
	if (!validation.ok) {
		return { closedMessage, consequenceMessage: null, rangeChanged: false };
	}
	const draftPeriod = validation.payload.selectedPeriod;
	const rangeChanged =
		`${draftPeriod.startDate}|${draftPeriod.endDateExclusive}` !==
		`${selectedPeriod.startDate}|${selectedPeriod.endDateExclusive}`;

	return {
		closedMessage,
		consequenceMessage: rangeChanged
			? "Al guardar, el rango cambia: el cierre registrado no se traslada al nuevo periodo. El nuevo rango mantiene el registro de cierre que ya tuviera, si existe."
			: "Al guardar, el rango no cambia y el registro de cierre se conserva.",
		rangeChanged,
	};
}

export type CycleEditSubmitOutcome =
	| { status: "saved"; reloadFailed: boolean }
	| { status: "failed"; message: string }
	/** No request left: another attempt already holds the single in-flight lock. */
	| { status: "busy" };

/** Every outcome except the one that left no request behind. */
export type CycleEditSettledOutcome = Exclude<CycleEditSubmitOutcome, { status: "busy" }>;

export type CycleEditSubmitter = (draft: CycleEditDraft) => Promise<CycleEditSubmitOutcome>;

export interface CycleEditSubmitterDeps {
	/** PUTs the cycle; rejects when the server refuses it. */
	updateCycle: (payload: UpdateFinancialCycleRequest) => Promise<FinancialCycleResponse>;
	/**
	 * The reload the financial summary publishes as `FinancialDashboardHandle.reload`, or `null` while
	 * it has not been published. `null` is reported as a failed refresh, never as a refresh: the period
	 * is stored either way, and the summary on screen may not show it yet.
	 */
	reload: (() => Promise<boolean>) | null;
	/** The same single in-flight lock the movement dialogs, the sync and the settings use. */
	lock: InFlightLockRef;
	/**
	 * Optional fast path. Prepared before PUT so the saved draft can be compared with the loaded cycle,
	 * then applied only after PUT with its authoritative response. Returning false requests the normal
	 * cycle-first reload; callers without this dependency retain that behavior.
	 */
	prepareIncomeOnlyReuse?: (
		payload: UpdateFinancialCycleRequest,
	) => ((savedCycle: FinancialCycleResponse) => boolean) | null;
}

const CYCLE_EDIT_FAILURE_MESSAGE = "No se pudo guardar el periodo. Inténtalo de nuevo.";

/**
 * A rejection the API layer produced carries the failing path and status, which is the only detail
 * that survives it: `updateFinancialCycle` does not read the server's body, so there is no
 * user-facing message to pass through here. Any other rejection is local and its text is not written
 * for the user, so it is replaced with copy that names the operation.
 */
export function getCycleEditFailureMessage(error: unknown): string {
	if (error instanceof ApiError && error.message.trim()) return error.message.trim();
	return CYCLE_EDIT_FAILURE_MESSAGE;
}

/**
 * Whether a settled outcome owns the in-flight phase. `busy` settled nothing — no request left,
 * because an earlier attempt holds the lock — so releasing there would re-enable the form while that
 * attempt is unresolved. It is a type predicate so the caller gets the narrowed union instead of a
 * second `busy` check.
 */
export function shouldClearCycleEditPhase(
	outcome: CycleEditSubmitOutcome,
): outcome is CycleEditSettledOutcome {
	return outcome.status !== "busy";
}

export type CycleEditNotice = {
	message: string;
	tone: "success" | "warning";
};

/**
 * Copy for a saved period. The write and the refresh are two statements, matching the shipped
 * convention for the movements, category and counterparty surfaces: a period that was written and a
 * summary that could not be reloaded is stale data, never a failed write.
 */
export function getCycleEditNotice(outcome: { status: "saved"; reloadFailed: boolean }): CycleEditNotice {
	if (outcome.reloadFailed) {
		return {
			message:
				"El periodo se guardó, pero el resumen no se pudo actualizar y puede estar desactualizado. Actualiza la página para ver el estado real.",
			tone: "warning",
		};
	}
	return { message: "Periodo guardado y resumen actualizado.", tone: "success" };
}

/**
 * Creates the callback the edit dialog awaits.
 *
 * The invalid draft is refused and the lock is acquired before the first `await`, so nothing leaves
 * for a bad draft and two clicks in the same tick cannot issue two saves — the second reports `busy`.
 * The lock is released on every settled attempt, so a refusal stays retryable. Only a validated
 * income-only change can reuse the current summary; every other settled save reloads cycle-first.
 */
export function createCycleEditSubmitter({
	updateCycle,
	reload,
	lock,
	prepareIncomeOnlyReuse,
}: CycleEditSubmitterDeps): CycleEditSubmitter {
	return async (draft) => {
		const validation = validateCycleEditDraft(draft);
		if (!validation.ok) return { status: "failed", message: validation.message };
		if (!acquireInFlightLock(lock)) return { status: "busy" };
		try {
			// Preparation reads the currently loaded cycle, but never changes state or cache before PUT.
			let reuse: ((savedCycle: FinancialCycleResponse) => boolean) | null = null;
			try {
				reuse = prepareIncomeOnlyReuse?.(validation.payload) ?? null;
			} catch {
				// A missing or unsafe fast path must not prevent the normal save and reload.
			}
			const savedCycle = await updateCycle(validation.payload);
			let reused = false;
			const savedPeriod = savedCycle.selectedPeriod;
			const requestedPeriod = validation.payload.selectedPeriod;
			if (
				reuse !== null && savedPeriod !== null &&
				savedPeriod.startDate === requestedPeriod.startDate &&
				savedPeriod.endDateExclusive === requestedPeriod.endDateExclusive &&
				savedCycle.incomeAmount === validation.payload.incomeAmount
			) {
				try {
					reused = reuse(savedCycle);
				} catch {
					// A rejected reuse is still a stored save: report a failed refresh only if reload fails.
				}
			}
			let reloadFailed = false;
			if (!reused) {
				try {
					reloadFailed = reload === null || (await reload()) === false;
				} catch {
					reloadFailed = true;
				}
			}
			return { status: "saved", reloadFailed };
		} catch (error) {
			return { status: "failed", message: getCycleEditFailureMessage(error) };
		} finally {
			releaseInFlightLock(lock);
		}
	};
}
