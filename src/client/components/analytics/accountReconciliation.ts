import type { FinancialTransaction } from "../../api/types";
import { isRecognizedExpense } from "../movements/movementSummary";

export type ReconciliationKind = "no-income" | "empty" | "gap" | "surplus" | "matched";
export type ReconciliationTone = "neutral" | "tight" | "calm";
export type ReconciliationCalloutTone = "neutral" | "warn" | "calm";

export interface ReconciliationCallout {
	tone: ReconciliationCalloutTone;
	title: string;
	body: string;
}

export interface AccountReconciliationInput {
	incomeAmount: number | null;
	totalSpending: number;
	pendingAmountCount: number;
	actualBalance: number | null;
	actualBalanceAt: string | null;
	transactions: readonly FinancialTransaction[];
	now?: Date;
}

export interface AccountReconciliationModel {
	kind: ReconciliationKind;
	theoreticalRemaining: number | null;
	actualBalance: number | null;
	actualBalanceAt: string | null;
	difference: number | null;
	updatedLabel: string;
	/** Compact timestamp for the chip ("hoy 19:20", "ayer 19:20", "hace 3 días"); null without a balance. */
	shortUpdatedLabel: string | null;
	/** Amount drawn from a credit line when the real balance is below zero; null otherwise. */
	creditLineUsed: number | null;
	badgeLabel: string;
	badgeTone: ReconciliationTone;
	diffLabel: string;
	diffTone: ReconciliationTone;
	movementsAfterCount: number;
	pendingAmountCount: number;
	callout: ReconciliationCallout;
}

const santiagoTimeFormatter = new Intl.DateTimeFormat("es-CL", {
	timeZone: "America/Santiago",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const santiagoDayFormatter = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Santiago",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

const santiagoShortDateFormatter = new Intl.DateTimeFormat("es-CL", {
	timeZone: "America/Santiago",
	day: "numeric",
	month: "short",
});

export function formatReconciliationClp(amount: number): string {
	return `$${Math.abs(Math.round(amount)).toLocaleString("es-CL")}`;
}

/** Signed CLP amount: "-$120.000" below zero, "$495.070" otherwise. */
export function formatSignedReconciliationClp(amount: number): string {
	const formatted = formatReconciliationClp(amount);
	return Math.round(amount) < 0 ? `-${formatted}` : formatted;
}

/**
 * Parses a user-entered CLP balance string.
 * - Blank string -> `null` (means clear)
 * - Whole CLP string (e.g. "$495.070", "0", "1.200.000") -> integer
 * - One leading minus ("-120.000", "-$120.000", "$-120.000", typographic "−") -> negative integer,
 *   for accounts drawn into a credit line
 * - Decimal, misplaced minus, or non-numeric garbage -> `undefined` (invalid)
 */
export function parseClpBalanceInput(raw: string): number | null | undefined {
	const trimmed = raw.trim().replace(/−/g, "-");
	if (trimmed === "") return null;
	if (trimmed.includes(",")) return undefined;
	const stripped = trimmed.replace(/[$\s.]/g, "");
	const match = /^(-?)(\d+)$/.exec(stripped);
	if (!match) return undefined;
	const magnitude = Number.parseInt(match[2], 10);
	if (!Number.isSafeInteger(magnitude)) return undefined;
	return match[1] === "-" && magnitude !== 0 ? -magnitude : magnitude;
}

function parseTimestampMs(value: unknown): number | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

function dayDiffInSantiago(from: Date, to: Date): number {
	const [fy, fm, fd] = santiagoDayFormatter.format(from).split("-").map(Number);
	const [ty, tm, td] = santiagoDayFormatter.format(to).split("-").map(Number);
	const fromUtc = Date.UTC(fy, fm - 1, fd);
	const toUtc = Date.UTC(ty, tm - 1, td);
	return Math.round((toUtc - fromUtc) / 86_400_000);
}

function formatUpdatedLabel(actualBalanceAt: string | null, now: Date): string {
	const ms = parseTimestampMs(actualBalanceAt);
	if (ms === null) return "Aún sin saldo real registrado";
	const updated = new Date(ms);
	const diffDays = dayDiffInSantiago(updated, now);
	const timeStr = santiagoTimeFormatter.format(updated);
	if (diffDays <= 0) return `Actualizado hoy a las ${timeStr}`;
	if (diffDays === 1) return `Actualizado ayer a las ${timeStr}`;
	const shortDate = santiagoShortDateFormatter.format(updated).replace(/\.$/, "");
	return `Actualizado hace ${diffDays} días (${shortDate}, ${timeStr})`;
}

function formatShortUpdatedLabel(actualBalanceAt: string | null, now: Date): string | null {
	const ms = parseTimestampMs(actualBalanceAt);
	if (ms === null) return null;
	const updated = new Date(ms);
	const diffDays = dayDiffInSantiago(updated, now);
	const timeStr = santiagoTimeFormatter.format(updated);
	if (diffDays <= 0) return `hoy ${timeStr}`;
	if (diffDays === 1) return `ayer ${timeStr}`;
	return `hace ${diffDays} días`;
}

function countRecognizedExpensesAfter(
	transactions: readonly FinancialTransaction[],
	actualBalanceAt: string | null,
): number {
	const cutoffMs = parseTimestampMs(actualBalanceAt);
	if (cutoffMs === null) return 0;
	let count = 0;
	for (const tx of transactions) {
		if (!isRecognizedExpense(tx)) continue;
		const txMs = parseTimestampMs(tx.occurredAt);
		if (txMs !== null && txMs > cutoffMs) {
			count += 1;
		}
	}
	return count;
}

function pluralize(count: number, singular: string, plural: string): string {
	return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function getAccountReconciliation({
	incomeAmount,
	totalSpending,
	pendingAmountCount,
	actualBalance,
	actualBalanceAt,
	transactions,
	now = new Date(),
}: AccountReconciliationInput): AccountReconciliationModel {
	const normalizedPending = Math.max(0, Math.trunc(pendingAmountCount));

	if (incomeAmount === null) {
		return {
			kind: "no-income",
			theoreticalRemaining: null,
			actualBalance,
			actualBalanceAt,
			difference: null,
			updatedLabel: "Define tu ingreso del ciclo para cuadrar",
			shortUpdatedLabel: null,
			creditLineUsed: actualBalance !== null && actualBalance < 0 ? -actualBalance : null,
			badgeLabel: "Requiere ingreso",
			badgeTone: "neutral",
			diffLabel: "Dinero sin seguimiento",
			diffTone: "neutral",
			movementsAfterCount: 0,
			pendingAmountCount: normalizedPending,
			callout: {
				tone: "neutral",
				title: "Configura tu ingreso primero",
				body: "Sin un ingreso del ciclo no existe un disponible teórico contra el cual comparar tu saldo real.",
			},
		};
	}

	const theoreticalRemaining = incomeAmount - totalSpending;

	if (actualBalance === null) {
		return {
			kind: "empty",
			theoreticalRemaining,
			actualBalance: null,
			actualBalanceAt: null,
			difference: null,
			updatedLabel: "Aún sin saldo real registrado",
			shortUpdatedLabel: null,
			creditLineUsed: null,
			badgeLabel: "Pendiente",
			badgeTone: "neutral",
			diffLabel: "Dinero sin seguimiento",
			diffTone: "neutral",
			movementsAfterCount: 0,
			pendingAmountCount: normalizedPending,
			callout: {
				tone: "neutral",
				title: "Compara contra tu banco",
				body: "Ingresa cuánto dinero tienes realmente disponible en tu cuenta para descubrir si hay gastos sin seguimiento.",
			},
		};
	}

	const difference = theoreticalRemaining - actualBalance;
	const movementsAfterCount = countRecognizedExpensesAfter(transactions, actualBalanceAt);
	const updatedLabel = formatUpdatedLabel(actualBalanceAt, now);

	let kind: ReconciliationKind;
	let badgeLabel: string;
	let badgeTone: ReconciliationTone;
	let diffLabel: string;
	let diffTone: ReconciliationTone;

	if (difference > 0) {
		kind = "gap";
		badgeLabel = "Sin seguimiento";
		badgeTone = "tight";
		diffLabel = "Dinero sin seguimiento";
		diffTone = "tight";
	} else if (difference < 0) {
		kind = "surplus";
		badgeLabel = "A favor";
		badgeTone = "calm";
		diffLabel = "Saldo a favor no registrado";
		diffTone = "calm";
	} else {
		kind = "matched";
		badgeLabel = "Cuadrado";
		badgeTone = "calm";
		diffLabel = "Diferencia";
		diffTone = "calm";
	}

	let callout: ReconciliationCallout;
	if (normalizedPending > 0 && movementsAfterCount > 0) {
		callout = {
			tone: "warn",
			title: `${pluralize(normalizedPending, "movimiento sin monto", "movimientos sin monto")} y saldo desactualizado`,
			body: `Hay ${pluralize(normalizedPending, "movimiento", "movimientos")} sin monto conocido que aún no se descuentan del teórico, y se registraron ${pluralize(movementsAfterCount, "gasto posterior", "gastos posteriores")} al corte.`,
		};
	} else if (normalizedPending > 0) {
		callout = {
			tone: "warn",
			title: `${pluralize(normalizedPending, "movimiento sin monto conocido", "movimientos sin monto conocido")}`,
			body: "Esos movimientos todavía no se descuentan del disponible teórico, por lo que la brecha real podría ser menor.",
		};
	} else if (movementsAfterCount > 0) {
		callout = {
			tone: "warn",
			title: "Saldo posiblemente desactualizado",
			body: `Se ${movementsAfterCount === 1 ? "registró" : "registraron"} ${pluralize(movementsAfterCount, "gasto", "gastos")} después de tu último corte. Ingresa tu saldo actual para volver a cuadrar.`,
		};
	} else if (kind === "gap") {
		callout = {
			tone: "neutral",
			title: "¿Qué significa esta diferencia?",
			body: `Tienes ${formatReconciliationClp(difference)} menos en tu cuenta que lo calculado: suele ser efectivo, comisiones o compras sin correo.`,
		};
	} else if (kind === "surplus") {
		callout = {
			tone: "calm",
			title: `Tienes ${formatReconciliationClp(difference)} más de lo calculado`,
			body: "Puede deberse a un ingreso no contemplado en el ingreso del ciclo, saldo arrastrado o un gasto duplicado.",
		};
	} else {
		callout = {
			tone: "calm",
			title: "Números cuadrados",
			body: "Tu saldo real coincide exactamente con el disponible calculado en este ciclo.",
		};
	}

	return {
		kind,
		theoreticalRemaining,
		actualBalance,
		actualBalanceAt,
		difference,
		updatedLabel,
		shortUpdatedLabel: formatShortUpdatedLabel(actualBalanceAt, now),
		creditLineUsed: actualBalance < 0 ? -actualBalance : null,
		badgeLabel,
		badgeTone,
		diffLabel,
		diffTone,
		movementsAfterCount,
		pendingAmountCount: normalizedPending,
		callout,
	};
}
