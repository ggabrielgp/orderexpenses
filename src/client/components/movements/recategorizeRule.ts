/**
 * Recategorize with "always use" and undo (S7): pure orchestration over existing endpoints only.
 *
 * The server applies counterparty rules when it loads movements (`src/movements.js`), so the rule is
 * stored under the same normalized key it computes. Undo restores the rule state first and then the
 * movement's category, so the reload that follows reads the state from before the change.
 */
import type {
	CounterpartyRule,
	UpdateTransactionRequest,
	UpsertCounterpartyRuleRequest,
} from "../../api/types";
import { normalizeCounterpartyKey } from "../settings/counterpartyRules";
import type { MovementUpdateTarget } from "../../api/types";

export interface AlwaysUseInput {
	originalCategory: string | null | undefined;
	category: string;
	counterparty: string;
}

/** Label for the opt-in, or null when there is no category change or no counterparty to bind. */
export function getAlwaysUseLabel({ originalCategory, category, counterparty }: AlwaysUseInput): string | null {
	const next = category.trim();
	const name = counterparty.trim();
	if (!next || !name || !normalizeCounterpartyKey(name)) return null;
	if (next === (originalCategory ?? "").trim()) return null;
	return `Usar siempre para ${name}`;
}

export interface SaveRuleDeps {
	getRules: () => Promise<CounterpartyRule[]>;
	upsertRule: (rule: UpsertCounterpartyRuleRequest) => Promise<unknown>;
}

/**
 * Stores the rule and returns the previous rule state for undo; `category: ""` means there was none
 * (the documented clearing body). Reading the rules first means a failed read writes nothing.
 */
export async function saveAlwaysUseRule(
	deps: SaveRuleDeps,
	{ counterparty, category }: { counterparty: string; category: string },
): Promise<UpsertCounterpartyRuleRequest> {
	const displayName = counterparty.trim();
	const counterpartyKey = normalizeCounterpartyKey(displayName);
	const existing = (await deps.getRules()).find((rule) => rule.counterpartyKey === counterpartyKey);
	await deps.upsertRule({ counterpartyKey, displayName, category: category.trim() });
	return existing
		? { counterpartyKey, displayName: existing.displayName, category: existing.category }
		: { counterpartyKey, displayName, category: "" };
}

/** Everything needed to revert one saved recategorization. */
export interface RecategorizeUndo {
	target: MovementUpdateTarget;
	/** The payload that was saved; undo re-sends it with the previous category. */
	payload: UpdateTransactionRequest;
	previousCategory: string | null;
	/** Previous rule state when a rule was saved in the same step; null when none was touched. */
	previousRule: UpsertCounterpartyRuleRequest | null;
}

export interface UndoDeps {
	upsertRule: (rule: UpsertCounterpartyRuleRequest) => Promise<unknown>;
	updateMovement: (target: MovementUpdateTarget, payload: UpdateTransactionRequest) => Promise<void>;
	reload: () => Promise<boolean>;
}

/** Rejects when a write fails; a failed reload only marks the list as possibly stale. */
export async function undoRecategorize(deps: UndoDeps, undo: RecategorizeUndo): Promise<{ reloadFailed: boolean }> {
	if (undo.previousRule) await deps.upsertRule(undo.previousRule);
	await deps.updateMovement(undo.target, { ...undo.payload, category: undo.previousCategory });
	try {
		return { reloadFailed: (await deps.reload()) === false };
	} catch {
		return { reloadFailed: true };
	}
}

export type RecategorizeNotice = { tone: "success" | "warning"; message: string };
export type RuleOutcome = "none" | "saved" | "failed";

const STALE_LIST =
	"El movimiento se guardó correctamente, pero la lista no se pudo actualizar y puede estar desactualizada. Actualiza la página para ver el estado real.";

export function getRecategorizeNotice({
	reloadFailed,
	ruleOutcome,
	counterparty,
	category,
}: {
	reloadFailed: boolean;
	ruleOutcome: RuleOutcome;
	counterparty: string;
	category: string;
}): RecategorizeNotice {
	const name = counterparty.trim();
	if (ruleOutcome === "failed") {
		return {
			tone: "warning",
			message: `El movimiento se guardó, pero no se pudo guardar la regla para ${name}. Puedes crearla en Configuración.`,
		};
	}
	if (reloadFailed) return { tone: "warning", message: STALE_LIST };
	if (ruleOutcome === "saved") {
		return { tone: "success", message: `Movimiento guardado. Desde ahora, ${name} va siempre a ${category.trim()}.` };
	}
	return { tone: "success", message: "El movimiento se guardó correctamente." };
}

export function getUndoNotice(
	outcome: { status: "done"; reloadFailed: boolean } | { status: "failed" },
): RecategorizeNotice {
	if (outcome.status === "failed") return { tone: "warning", message: "No se pudo deshacer el cambio. Intenta de nuevo." };
	if (outcome.reloadFailed) {
		return {
			tone: "warning",
			message: "Cambio deshecho, pero la lista no se pudo actualizar. Actualiza la página para ver el estado real.",
		};
	}
	return { tone: "success", message: "Cambio deshecho." };
}
