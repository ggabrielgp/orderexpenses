// @ts-expect-error The shared JavaScript review-period contract has no TypeScript declaration.
import { ReviewPeriod } from "../../../shared/review-period.js";
import type {
  FinancialPeriod,
  FinancialTransaction,
  RecognizedExpenseKind,
  UpdateFinancialCycleRequest,
} from "../../api/types";
import {
  getSpendingChartKindLabel,
  type SpendingChartDetailMovement,
} from "../analytics/spendingChart";
import { parseCycleIncome } from "../financial-cycle/cycleSettings";
import {
  getMovementUpdateTarget,
  normalizeLocalDateTime,
  recognizedExpenseKinds,
  type EditableRecognizedExpenseMovement,
  type RecognizedExpenseMovement,
} from "./manualExpense";

type DatedRecognizedExpense = FinancialTransaction & {
  amount: number;
  occurredAt: string;
};

export function isRecognizedExpense(transaction: FinancialTransaction) {
  return (
    transaction.direction === "outflow" &&
    typeof transaction.kind === "string" &&
    recognizedExpenseKinds.has(transaction.kind)
  );
}

export function selectLatestRecognizedExpense(
  transactions: FinancialTransaction[],
  period: FinancialPeriod,
) {
  const reviewPeriod = ReviewPeriod.create(period);
  let latestExpense: DatedRecognizedExpense | null = null;
  let latestDateTime: string | null = null;

  for (const transaction of transactions) {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      continue;
    }
    const normalizedDateTime = normalizeLocalDateTime(transaction.occurredAt);
    if (
      normalizedDateTime === null ||
      !reviewPeriod.includes(normalizedDateTime.slice(0, 10)) ||
      (latestDateTime !== null && normalizedDateTime <= latestDateTime)
    ) {
      continue;
    }
    latestExpense = transaction as DatedRecognizedExpense;
    latestDateTime = normalizedDateTime;
  }

  return latestExpense;
}

export function getRecognizedExpenseIdentity(
  transaction: Pick<FinancialTransaction, "counterparty" | "description">,
) {
  for (const value of [transaction.counterparty, transaction.description]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Gasto sin identificar";
}

export function formatMovementDate(occurredAt: unknown) {
  const normalizedDateTime = normalizeLocalDateTime(occurredAt);
  return normalizedDateTime === null ? "—" : normalizedDateTime.slice(0, 10);
}

function getMovementCategory(category: unknown) {
  return typeof category === "string" && category.trim()
    ? category.trim()
    : "Sin categoría";
}

export function getRecognizedExpenseMovements(
  transactions: FinancialTransaction[],
): RecognizedExpenseMovement[] {
  return transactions.flatMap((transaction) => {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      return [];
    }
    const rawOccurredAt =
      typeof transaction.occurredAt === "string" ? transaction.occurredAt : "";
    return [{
      id: typeof transaction.id === "string" && transaction.id.trim()
        ? transaction.id.trim()
        : null,
      counterparty: getRecognizedExpenseIdentity(transaction),
      amount: transaction.amount,
      date: formatMovementDate(transaction.occurredAt),
      category: getMovementCategory(transaction.category),
      // The read-only detail projection: the same row, plus the fields the modal names. They
      // come from the stored values only, so an absent field is reported as unavailable
      // instead of being filled with a display fallback the user could mistake for data.
      description: getMovementTextField(transaction.description),
      kind: transaction.kind as RecognizedExpenseKind,
      status: typeof transaction.status === "string" ? transaction.status : null,
      source: typeof transaction.source === "string" ? transaction.source : null,
      occurredAt: normalizeLocalDateTime(transaction.occurredAt),
      hasTime: /\d{2}:\d{2}/.test(rawOccurredAt),
    }];
  });
}

/**
 * The read-only day-detail rows the spending chart shows for a selected bar. It reuses the same
 * recognized/finite predicate as the summary projection and keeps the identity and kind text; the
 * stored timestamp is normalized locally, and a date-only row reports no time instead of a
 * fabricated midnight. Identity stays optional: a row without an id is still readable here, because
 * this surface never offers an edit action.
 */
export function getSpendingChartDetailMovements(
  transactions: FinancialTransaction[],
): SpendingChartDetailMovement[] {
  return transactions.flatMap((transaction) => {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      return [];
    }
    const occurredAt = normalizeLocalDateTime(transaction.occurredAt);
    if (occurredAt === null) return [];
    const rawOccurredAt =
      typeof transaction.occurredAt === "string" ? transaction.occurredAt : "";
    return [{
      id: typeof transaction.id === "string" && transaction.id.trim()
        ? transaction.id.trim()
        : null,
      label: getRecognizedExpenseIdentity(transaction),
      kindLabel: getSpendingChartKindLabel(transaction.kind),
      amount: transaction.amount,
      dateKey: occurredAt.slice(0, 10),
      time: /\d{2}:\d{2}/.test(rawOccurredAt) ? occurredAt.slice(11, 16) : "",
    }];
  });
}

function getMovementTextField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The records the edit dialog can actually PATCH, alongside the read-side projection above.
 *
 * Every exclusion is deliberate and leaves the movement with no edit affordance instead of a
 * broken one:
 * - recognized expenses only, through the same predicate the summary uses;
 * - a finite amount only, because a recognized movement with an unknown or non-finite amount is
 *   reported separately as a pending count and never itemized, so it has no row to edit;
 * - identity and date eligibility is delegated to `getMovementUpdateTarget`, which owns the
 *   rule that a PATCH needs a non-empty id and a parseable original `occurredAt` (the server
 *   derives its single lookup month from that date);
 * - `occurredAt` is normalized to a full local `YYYY-MM-DDTHH:mm:ss` so the edit draft is always
 *   a valid `datetime-local` value, including for the date-only rows the server can store;
 * - the fields start from the stored text rather than from the display fallbacks, so editing an
 *   untouched movement never writes the "Gasto sin identificar"/"Sin categoría" placeholders back
 *   to the server.
 */
export function getEditableRecognizedExpenseMovements(
  transactions: FinancialTransaction[],
): EditableRecognizedExpenseMovement[] {
  return transactions.flatMap((transaction) => {
    if (
      !isRecognizedExpense(transaction) ||
      typeof transaction.amount !== "number" ||
      !Number.isFinite(transaction.amount)
    ) {
      return [];
    }
    const target = getMovementUpdateTarget({
      id: transaction.id,
      occurredAt: transaction.occurredAt,
      isManual: transaction.isManual,
    });
    const occurredAt = normalizeLocalDateTime(transaction.occurredAt);
    if (target === null || occurredAt === null) return [];
    return [{
      id: target.movementId,
      counterparty: getMovementTextField(transaction.counterparty),
      amount: transaction.amount,
      date: occurredAt.slice(0, 10),
      category: getMovementTextField(transaction.category),
      description: getMovementTextField(transaction.description),
      kind: transaction.kind as RecognizedExpenseKind,
      direction: "outflow",
      occurredAt,
      isManual: target.isManual,
    }];
  });
}

export function summarizeRecognizedExpenses(transactions: FinancialTransaction[]) {
  return transactions.reduce(
    (summary, transaction) => {
      if (!isRecognizedExpense(transaction)) return summary;
      if (typeof transaction.amount !== "number" || !Number.isFinite(transaction.amount)) {
        return { ...summary, pendingAmountCount: summary.pendingAmountCount + 1 };
      }
      return {
        count: summary.count + 1,
        totalSpending: summary.totalSpending + transaction.amount,
        pendingAmountCount: summary.pendingAmountCount,
      };
    },
    { count: 0, totalSpending: 0, pendingAmountCount: 0 },
  );
}

export function summarizeRecognizedExpensesByKind(transactions: FinancialTransaction[]) {
  return transactions.reduce(
    (totals, transaction) => {
      if (
        !isRecognizedExpense(transaction) ||
        typeof transaction.amount !== "number" ||
        !Number.isFinite(transaction.amount)
      ) {
        return totals;
      }

      switch (transaction.kind) {
        case "purchase":
          totals.purchase += transaction.amount;
          break;
        case "transfer":
          totals.transfer += transaction.amount;
          break;
        case "payment":
          totals.payment += transaction.amount;
      }
      return totals;
    },
    { purchase: 0, transfer: 0, payment: 0 },
  );
}

export function formatClp(amount: number) {
  const formatted = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  return amount < 0 ? `-${formatted}` : formatted;
}

export function createFinancialCycleSetupPayload(
  startDate: string,
  endDate: string,
  incomeValue: string,
): UpdateFinancialCycleRequest {
  return {
    selectedPeriod: ReviewPeriod.fromInclusive(startDate, endDate).toJSON(),
    // The same rule the edit draft uses, owned by the cycle module: one income parser for both
    // surfaces instead of two copies that could drift apart.
    incomeAmount: parseCycleIncome(incomeValue),
  };
}
