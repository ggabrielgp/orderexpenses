import { ApiError } from "../../api/client";
import type {
	CounterpartyRule,
	UpsertCounterpartyRuleRequest,
	UpsertCounterpartyRuleResponse,
} from "../../api/types";
import {
	acquireInFlightLock,
	releaseInFlightLock,
	type InFlightLockRef,
} from "../movements/CreateManualExpenseDialog";

/**
 * Counterparty category rule decisions.
 *
 * The server applies these rules only while it loads movements
 * (`applyStoredCounterpartyRules`, `src/movements.js:249-284`), and it matches them by key, so a key
 * computed differently is stored and then never matches. That, plus a test harness without a DOM, is
 * why the key mirror, the validation, the rows and the submitter are pure functions here.
 */

/** Select value of the clearing option, and the category an empty rule is stored with. */
export const NO_CATEGORY_VALUE = "";
/** Label of the clearing option, and of a rule whose stored category is blank. */
export const NO_CATEGORY_LABEL = "Sin categoría";
/**
 * Select value of the placeholder, rendered only while no category has been chosen. It is not a
 * category and never reaches a request body: the select disables the option that carries it, the
 * change handler reads it as "still unchosen" instead of storing it, and validation refuses it even
 * if a future caller hands it over. The draft holds `null` until a real option is picked, so an
 * untouched form cannot clear an existing rule by accident.
 *
 * It is collision-proof by construction, not by convention: the server normalizes every stored
 * category name with `normalizeCategoryName` (`src/server.js:773-778`) — trim, collapse repeated
 * whitespace, slice to 40 characters — so a name the catalog can contain is always a fixed point of
 * that rule and never longer than 40 characters. This sentinel exceeds that limit, so the rule
 * always changes it and the server can never produce a category equal to it; a category literally
 * named like it cannot exist. The `disabled` option, the `null` coercion and the validation guard
 * remain as defense in depth.
 */
export const UNCHOSEN_CATEGORY_VALUE =
	"__sin_elegir__no_es_una_categoria_almacenable_del_servidor";
export const COUNTERPARTY_NAME_REQUIRED_MESSAGE = "Ingresa la contraparte de la regla.";
export const COUNTERPARTY_CATEGORY_REQUIRED_MESSAGE =
	"Elige una categoría o selecciona Sin categoría para quitar la regla.";

/**
 * Mirrors `normalizeCounterpartyKey` (`src/movements.js:294-301`) operation by operation: NFD,
 * strip combining diacritics, lowercase, trim, collapse whitespace, and `""` for a value that
 * normalizes to nothing. The duplication is deliberate — a shared module would mean the server
 * importing from `src/client` — and a divergence test compares both over a fixture set.
 */
export function normalizeCounterpartyKey(value: unknown): string {
	const normalized = String(value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
	return normalized || "";
}

export type CounterpartyRuleDraft = {
	/** The counterparty as the user types it; the stored key is derived from this. */
	counterparty: string;
	/** `null` until the user picks a category; `NO_CATEGORY_VALUE` means "clear the rule". */
	category: string | null;
};

export function createCounterpartyRuleDraft(): CounterpartyRuleDraft {
	return { counterparty: "", category: null };
}

export type CounterpartyRuleDraftValidation =
	| { ok: true; payload: UpsertCounterpartyRuleRequest }
	| { ok: false; message: string };

/**
 * Validates a draft and produces the exact `PUT /api/counterparty-rules` body.
 *
 * An empty key is refused instead of sent, because the server answers 400
 * `"counterpartyKey es obligatorio"` for it. The display name is trimmed only, which is all the
 * server does (`src/server.js:219`): collapsing its internal whitespace would store a name the user
 * did not write.
 */
export function validateCounterpartyRuleDraft(
	draft: CounterpartyRuleDraft,
): CounterpartyRuleDraftValidation {
	const counterpartyKey = normalizeCounterpartyKey(draft?.counterparty);
	if (!counterpartyKey) return { ok: false, message: COUNTERPARTY_NAME_REQUIRED_MESSAGE };
	if (draft.category === null || draft.category === undefined) {
		return { ok: false, message: COUNTERPARTY_CATEGORY_REQUIRED_MESSAGE };
	}
	// Defensive: the placeholder is a rendering device, not a category. The select cannot pick it and
	// the change handler never stores it, but a future caller passing the sentinel must be refused
	// here instead of storing a rule whose category is that literal.
	if (String(draft.category).trim() === UNCHOSEN_CATEGORY_VALUE) {
		return { ok: false, message: COUNTERPARTY_CATEGORY_REQUIRED_MESSAGE };
	}
	return {
		ok: true,
		payload: {
			counterpartyKey,
			displayName: String(draft.counterparty ?? "").trim() || counterpartyKey,
			category: String(draft.category).trim(),
		},
	};
}

export type CounterpartyRuleRow = {
	/** Normalized key the server matches movements against. */
	key: string;
	displayName: string;
	/** Stored category text; `""` when the rule carries none. */
	category: string;
	/** What the list shows for the stored category. */
	categoryLabel: string;
};

/**
 * Derives the display rows from `GET /api/counterparty-rules`.
 *
 * The server's order is preserved: it is `updated_at DESC, counterparty_key ASC`
 * (`src/db.js:409-423`), so the rule edited last stays first. A row whose key normalizes to nothing
 * is dropped instead of rendered, because no request could target it, and a blank `displayName`
 * falls back to the key, which is the same fallback the server stores.
 */
export function getCounterpartyRuleRows(rules: CounterpartyRule[]): CounterpartyRuleRow[] {
	const rows: CounterpartyRuleRow[] = [];
	for (const rule of rules) {
		const key = normalizeCounterpartyKey(rule?.counterpartyKey);
		if (!key) continue;
		const category = typeof rule.category === "string" ? rule.category.trim() : "";
		rows.push({
			key,
			displayName:
				typeof rule.displayName === "string" && rule.displayName.trim()
					? rule.displayName.trim()
					: key,
			category,
			categoryLabel: category || NO_CATEGORY_LABEL,
		});
	}
	return rows;
}

export type CounterpartyRuleListPhase = "idle" | "loading" | "ready" | "failed";

export type CounterpartyRuleListState = {
	phase: CounterpartyRuleListPhase;
	/** Only ever the rules a successful load returned. */
	rules: CounterpartyRule[];
	/** Truthful failure detail; null unless the phase is `failed`. */
	errorMessage: string | null;
};

export type CounterpartyRuleListEvent =
	| { type: "loadStarted" }
	| { type: "loaded"; rules: CounterpartyRule[] }
	| { type: "loadFailed" };

const COUNTERPARTY_RULES_LOAD_FAILURE_MESSAGE =
	"No se pudieron cargar las reglas de contraparte. Puedes reintentar la carga.";
/**
 * Copy for a refresh that failed while a list was already loaded. Only a load that never succeeded
 * may claim no rules could be loaded; with a known list on screen, the honest statement is that it
 * may be stale.
 */
const COUNTERPARTY_RULES_STALE_MESSAGE =
	"No se pudo actualizar la lista de reglas y puede estar desactualizada. Se muestra la última versión conocida.";

export function createCounterpartyRuleListState(): CounterpartyRuleListState {
	return { phase: "idle", rules: [], errorMessage: null };
}

/**
 * Pure list reducer. A failed load keeps what the last successful one returned: a failed refresh
 * after a mutation must not erase the user's rules from the screen and present a network failure as
 * if they had been deleted.
 */
export function reduceCounterpartyRuleList(
	state: CounterpartyRuleListState,
	event: CounterpartyRuleListEvent,
): CounterpartyRuleListState {
	switch (event.type) {
		case "loadStarted":
			return { phase: "loading", rules: state.rules, errorMessage: null };
		case "loaded":
			return { phase: "ready", rules: [...event.rules], errorMessage: null };
		case "loadFailed":
			return {
				phase: "failed",
				rules: state.rules,
				errorMessage:
					state.rules.length > 0
						? COUNTERPARTY_RULES_STALE_MESSAGE
						: COUNTERPARTY_RULES_LOAD_FAILURE_MESSAGE,
			};
	}
}

export type CounterpartyRuleSource = (
	payload: UpsertCounterpartyRuleRequest,
) => Promise<UpsertCounterpartyRuleResponse>;

/** Re-runs the cycle-first dashboard load; resolves `false` when the reload failed. */
export type CounterpartyPeriodReload = () => Promise<boolean>;

export type CounterpartyRuleSubmitOutcome =
	| { status: "saved"; reloadFailed: boolean }
	| { status: "cleared"; reloadFailed: boolean }
	| { status: "failed"; message: string }
	/** No request left: another attempt already holds the single in-flight lock. */
	| { status: "busy" };

export type CounterpartyRuleSubmitter = (
	draft: CounterpartyRuleDraft,
) => Promise<CounterpartyRuleSubmitOutcome>;

/** Every outcome except the one that left no request behind. */
export type CounterpartyRuleSettledOutcome = Exclude<
	CounterpartyRuleSubmitOutcome,
	{ status: "busy" }
>;

export interface CounterpartyRuleSubmitterDeps {
	/** PUTs the rule or its clearing; rejects when the server refuses it. */
	upsertRule: CounterpartyRuleSource;
	/**
	 * The dashboard handle's reload, or `null` while the financial summary has not published it yet.
	 * `null` is reported as a failed refresh, never as a refresh: the rule is stored either way, and
	 * the movements on screen may not show it yet.
	 */
	reload: CounterpartyPeriodReload | null;
	/** The same single in-flight lock the movements dialogs, the sync and the settings use. */
	lock: InFlightLockRef;
}

const COUNTERPARTY_RULE_MUTATION_FAILURE_MESSAGE =
	"No se pudo guardar la regla de contraparte. Inténtalo de nuevo.";

/**
 * A rejection the API layer produced carries the server's own message
 * (`"counterpartyKey es obligatorio"`, `"Rule not found"`), which is user-facing and shown as-is;
 * any other rejection is local, so its technical text is replaced with copy that names the
 * operation.
 */
export function getCounterpartyRuleMutationFailureMessage(error: unknown): string {
	if (error instanceof ApiError && error.message.trim()) return error.message.trim();
	return COUNTERPARTY_RULE_MUTATION_FAILURE_MESSAGE;
}

/**
 * Whether a settled outcome owns the in-flight phase and must release it. `busy` is the one outcome
 * that settled nothing — no request left, because an earlier attempt holds the lock — so releasing
 * there would re-enable the form while that attempt is unresolved; every other outcome, failures
 * included, belongs to this attempt. It is a type predicate so the caller gets the narrowed union
 * instead of a second `busy` check.
 */
export function shouldClearCounterpartyRuleMutationPhase(
	outcome: CounterpartyRuleSubmitOutcome,
): outcome is CounterpartyRuleSettledOutcome {
	return outcome.status !== "busy";
}

export type CounterpartyRuleNotice = {
	message: string;
	tone: "success" | "warning";
};

/**
 * Copy for a rule that was stored or cleared.
 *
 * The write and the refresh are two statements, matching the shipped convention for the movements,
 * category and sync surfaces: a rule that was written and a list that could not be reloaded is
 * stale data, never a failed write. The cleared variants exist because "guardada" would be false
 * for the empty-category PUT, which deletes the rule.
 */
export function getCounterpartyRuleNotice(outcome: {
	status: "saved" | "cleared";
	reloadFailed: boolean;
}): CounterpartyRuleNotice {
	const cleared = outcome.status === "cleared";
	if (outcome.reloadFailed) {
		return {
			message: cleared
				? "La regla se eliminó, pero la lista de movimientos no se pudo actualizar y puede estar desactualizada. Actualiza la página para ver el estado real."
				: "La regla se guardó, pero la lista de movimientos no se pudo actualizar y puede estar desactualizada. Actualiza la página para ver el estado real.",
			tone: "warning",
		};
	}
	return {
		message: cleared
			? "Regla eliminada y lista de movimientos actualizada."
			: "Regla guardada y lista de movimientos actualizada.",
		tone: "success",
	};
}

/**
 * Creates the callback the dialog awaits.
 *
 * The invalid draft is refused and the lock is acquired before the first `await`, so nothing leaves
 * for a bad draft and two clicks in the same tick cannot issue two mutations — the second reports
 * `busy`. The lock is released on every settled attempt, so a failure stays retryable.
 *
 * A cleared rule reloads the period too: the movements the rule was recategorizing only read their
 * category when the server loads them, so skipping the reload would leave the deletion invisible.
 */
export function createCounterpartyRuleSubmitter({
	upsertRule,
	reload,
	lock,
}: CounterpartyRuleSubmitterDeps): CounterpartyRuleSubmitter {
	return async (draft) => {
		const validation = validateCounterpartyRuleDraft(draft);
		if (!validation.ok) return { status: "failed", message: validation.message };
		if (!acquireInFlightLock(lock)) return { status: "busy" };
		try {
			const response = await upsertRule(validation.payload);
			let reloadFailed: boolean;
			try {
				reloadFailed = reload === null || (await reload()) === false;
			} catch {
				reloadFailed = true;
			}
			return response.outcome === "cleared"
				? { status: "cleared", reloadFailed }
				: { status: "saved", reloadFailed };
		} catch (error) {
			return { status: "failed", message: getCounterpartyRuleMutationFailureMessage(error) };
		} finally {
			releaseInFlightLock(lock);
		}
	};
}
