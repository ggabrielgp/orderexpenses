import type {
	CreateManualExpenseRequest,
	FinancialPeriod,
	FinancialTransaction,
	ManualExpenseKind,
	MovementUpdateTarget,
	RecognizedExpenseKind,
	UpdateTransactionRequest,
} from "../../api/types";
// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../../shared/review-period.js";

/**
 * Mutation-side contract for manual movements: the drafts the dialogs edit, the request
 * bodies they submit, and the pure helpers that validate them.
 *
 * It lives under `components/movements` because both the create and edit dialogs own it.
 * Keeping it in the page module created a cycle (page imports the dialog, the dialog
 * imported the page back), which is fragile under hot-module reloading. The read-side
 * projection stays in `pages/DashboardPage.tsx`; review unit C2 owns that split.
 *
 * The low-level primitives it shares with the read side (`normalizeLocalDateTime`,
 * `formatIncomeInput`, `recognizedExpenseKinds`) are exported here so there is exactly one
 * definition of each; the page imports them.
 */

/** Read projection row for a recognized expense; the edit and create flows extend it. */
export type RecognizedExpenseMovement = {
	/** Movement identity carried through the read projection so mutations can target it. */
	id: string | null;
	counterparty: string;
	amount: number;
	date: string;
	category: string;
};

export type EditableRecognizedExpenseMovement = RecognizedExpenseMovement & {
	description: string;
	kind: RecognizedExpenseKind;
	direction: "outflow" | "inflow";
	/** Full local `YYYY-MM-DDTHH:mm:ss`, already padded for the server's date-only rows. */
	occurredAt: string;
	/**
	 * Provenance flag for the edit UI: a Gmail-derived movement keeps its original date
	 * because the server refuses a date change on it.
	 */
	isManual: boolean;
};

export type ManualExpenseDraft = {
	occurredAt: string;
	amount: string;
	kind: ManualExpenseKind;
	counterparty: string;
	category: string;
	description: string;
};

export type MovementEditDraft = {
	occurredAt: string;
	amount: string;
	kind: RecognizedExpenseKind;
	direction: "outflow" | "inflow";
	category: string;
	counterparty: string;
	description: string;
};

export type ManualExpenseCreationPhase = "idle" | "invalid" | "saving" | "failed" | "saved";

export type ManualExpenseCreationFeedback = {
	message: string | null;
	tone: "error" | "pending" | "success" | null;
	/** True while the form must keep the entered values so the user can retry. */
	keepDraft: boolean;
};

export const recognizedExpenseKinds = new Set(["purchase", "transfer", "payment"]);
const manualExpenseKinds = new Set<ManualExpenseKind>([
	"purchase",
	"transfer",
	"payment",
	"income",
]);
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export function normalizeLocalDateTime(occurredAt: unknown) {
	if (typeof occurredAt !== "string") return null;
	const match = localDateTimePattern.exec(occurredAt);
	if (!match) return null;

	const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}

	const hour = hourText === undefined ? 0 : Number(hourText);
	const minute = minuteText === undefined ? 0 : Number(minuteText);
	const second = secondText === undefined ? 0 : Number(secondText);
	if (hour > 23 || minute > 59 || second > 59) return null;
	return `${yearText}-${monthText}-${dayText}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export function formatIncomeInput(amount: number) {
	return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(amount);
}

/**
 * Single definition of the selected-period label. Both dialogs and the dashboard summary must
 * describe the same period identically, so every consumer imports this one instead of keeping a
 * local copy that could silently disagree.
 */
export function formatPeriodLabel(period: FinancialPeriod) {
	const reviewPeriod = ReviewPeriod.create(period);
	return `${reviewPeriod.startDate} – ${reviewPeriod.visibleEndDate}`;
}

const movementDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/**
 * Single definition of the "the server could not locate this movement" rule. The edit and removal
 * submitter must classify a 404 identically, so the predicate lives here instead of in two dialog
 * modules that could drift apart. The API layer reports a missing record as `... (404)`.
 */
export function isMovementNotFoundError(error: unknown): boolean {
	return error instanceof Error && /\(404\)/.test(error.message);
}

/**
 * Identity of the configured period for the create draft reset. The dashboard hands out a fresh
 * `period` object on every reload, so keying a React effect on the object would silently discard
 * typed input during an unrelated reload; only the period bounds identify it.
 */
export function getManualExpensePeriodKey(period: FinancialPeriod) {
	return `${period.startDate}|${period.endDateExclusive}`;
}

/**
 * Mirrors the legacy `parseCLP` contract: strip `$`, spaces and thousands dots;
 * a negative or unparsable amount clears the value.
 */
export function parseClpAmount(value: string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const raw = String(value).trim().replace(/[$\s.]/g, "");
	if (raw === "") return null;
	const amount = Number(raw);
	return Number.isNaN(amount) || amount < 0 ? null : amount;
}

/** Accepts a `datetime-local` value and normalizes it to seconds, like legacy `fromDatetimeLocal`. */
function normalizeMovementDateTime(value: string) {
	const trimmed = value.trim();
	if (!movementDateTimePattern.test(trimmed)) return null;
	return normalizeLocalDateTime(trimmed.length === 16 ? `${trimmed}:00` : trimmed);
}

function getLocalToday() {
	const today = new Date();
	return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export function createManualExpenseDraft(
	period: FinancialPeriod,
	today = getLocalToday(),
): ManualExpenseDraft {
	const reviewPeriod = ReviewPeriod.create(period);
	const date = reviewPeriod.includes(today) ? today : reviewPeriod.startDate;
	return {
		occurredAt: `${date}T12:00`,
		amount: "",
		kind: "purchase",
		counterparty: "",
		category: "",
		description: "",
	};
}

export function createManualExpensePayload(
	draft: ManualExpenseDraft,
	period: FinancialPeriod,
	categoryNames: string[],
): CreateManualExpenseRequest {
	const occurredAt = normalizeMovementDateTime(draft.occurredAt);
	if (occurredAt === null) {
		throw new TypeError("Expense date must be a valid local date-time.");
	}
	// The React dashboard is period-scoped: an out-of-period expense would be stored
	// but stay invisible, so it is rejected instead of looking like a failed save.
	if (!ReviewPeriod.create(period).includes(occurredAt.slice(0, 10))) {
		throw new RangeError("Expense date must be inside the selected financial period.");
	}
	const amount = parseClpAmount(draft.amount);
	if (amount === null || amount <= 0) {
		throw new TypeError("Expense amount must be a positive CLP amount.");
	}
	if (!manualExpenseKinds.has(draft.kind)) {
		throw new TypeError("Expense kind must be purchase, transfer, payment, or income.");
	}
	const category = draft.category.trim();
	if (category && !categoryNames.includes(category)) {
		throw new TypeError("Expense category must be an existing category.");
	}
	const counterparty = draft.counterparty.trim();
	const description = draft.description.trim();
	return {
		occurredAt,
		amount,
		kind: draft.kind,
		// Direction is derived instead of exposed: the recognized-expense summary counts
		// outflows only, so a `purchase` saved as `inflow` would silently disappear from it.
		direction: draft.kind === "income" ? "inflow" : "outflow",
		counterparty: counterparty || null,
		category: category || null,
		description: description || null,
	};
}

export function createMovementEditDraft(
	movement: EditableRecognizedExpenseMovement,
): MovementEditDraft {
	const trimmedOccurredAt = movement.occurredAt.trim();
	return {
		// The server can store a date-only `occurredAt`; pad it to midnight so the
		// datetime-local edit draft never fails to build.
		occurredAt: /^\d{4}-\d{2}-\d{2}$/.test(trimmedOccurredAt)
			? `${trimmedOccurredAt}T00:00`
			: movement.occurredAt.slice(0, 16),
		amount: formatIncomeInput(movement.amount),
		kind: movement.kind,
		direction: movement.direction,
		category: movement.category === "Uncategorized" ? "" : movement.category,
		counterparty: movement.counterparty === "Unidentified expense" ? "" : movement.counterparty,
		description: movement.description,
	};
}

/**
 * Builds the PATCH body. The date is only sent for manual rows, because
 * Gmail-derived movements keep their original date.
 */
export function createMovementUpdatePayload(
	draft: MovementEditDraft,
	target: MovementUpdateTarget,
	period: FinancialPeriod,
	categoryNames: string[],
): UpdateTransactionRequest {
	const amount = parseClpAmount(draft.amount);
	if (amount === null || amount <= 0) {
		throw new TypeError("Movement amount must be a positive CLP amount.");
	}
	if (!recognizedExpenseKinds.has(draft.kind)) {
		throw new TypeError("Movement kind must be purchase, transfer, or payment.");
	}
	const category = draft.category.trim();
	if (category && !categoryNames.includes(category)) {
		throw new TypeError("Movement category must be an existing category.");
	}
	const patch: UpdateTransactionRequest = {
		amount,
		kind: draft.kind,
		direction: draft.direction,
		category: category || null,
		counterparty: draft.counterparty.trim() || null,
		description: draft.description.trim() || null,
		status: target.isManual ? "manual" : "edited",
	};
	if (!target.isManual) return patch;

	const occurredAt = normalizeMovementDateTime(draft.occurredAt);
	if (occurredAt === null) {
		throw new TypeError("Movement date must be a valid local date-time.");
	}
	if (!ReviewPeriod.create(period).includes(occurredAt.slice(0, 10))) {
		throw new RangeError("Movement date must be inside the selected financial period.");
	}
	return { ...patch, occurredAt };
}

export function getMovementUpdateTarget(
	transaction: Pick<FinancialTransaction, "id" | "occurredAt" | "isManual">,
): MovementUpdateTarget | null {
	const movementId = typeof transaction.id === "string" ? transaction.id.trim() : "";
	const originalOccurredAt =
		typeof transaction.occurredAt === "string" ? transaction.occurredAt : "";
	if (!movementId || normalizeLocalDateTime(originalOccurredAt) === null) return null;
	return {
		movementId,
		originalOccurredAt,
		isManual:
			typeof transaction.isManual === "boolean"
				? transaction.isManual
				: movementId.startsWith("manual_"),
	};
}

const manualExpenseCreationFeedback: Record<
	ManualExpenseCreationPhase,
	ManualExpenseCreationFeedback
> = {
	idle: { message: null, tone: null, keepDraft: false },
	invalid: { message: "Enter a date and a positive amount.", tone: "error", keepDraft: true },
	saving: { message: "Saving expense...", tone: "pending", keepDraft: true },
	failed: {
		message: "Your expense could not be saved. Your entered values are kept so you can retry.",
		tone: "error",
		keepDraft: true,
	},
	saved: { message: "Manual expense saved.", tone: "success", keepDraft: false },
};

export function getManualExpenseCreationFeedback(
	phase: ManualExpenseCreationPhase,
): ManualExpenseCreationFeedback {
	return manualExpenseCreationFeedback[phase] ?? manualExpenseCreationFeedback.idle;
}
