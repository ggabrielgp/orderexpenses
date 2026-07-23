export function isKnownAmount(value) {
	if (typeof value !== "number" && typeof value !== "string") return false;
	if (value === "" || (typeof value === "string" && value.trim() === "")) {
		return false;
	}
	const amount = Number(value);
	return Number.isFinite(amount) && amount >= 0;
}

export function isCountedExpense(transaction) {
	return (
		transaction?.direction === "outflow" && isKnownAmount(transaction?.amount)
	);
}

export function summarizeMovements(transactions = []) {
	const summary = {
		expenseTotal: 0,
		expenseCount: 0,
		informationalInflowTotal: 0,
		informationalInflowCount: 0,
	};
	for (const transaction of Array.isArray(transactions) ? transactions : []) {
		if (!isKnownAmount(transaction?.amount)) continue;
		const amount = Number(transaction.amount);
		if (transaction.direction === "outflow") {
			summary.expenseTotal += amount;
			summary.expenseCount += 1;
		} else if (transaction.direction === "inflow") {
			summary.informationalInflowTotal += amount;
			summary.informationalInflowCount += 1;
		}
	}
	return summary;
}

export function resolveConfirmedIncome({
	salaryAmount,
	confirmedIncomeId,
} = {}) {
	const id = String(confirmedIncomeId ?? "").trim();
	if (!id || !isKnownAmount(salaryAmount)) {
		return { amount: null, source: null, reason: "Ingreso no confirmado." };
	}
	if (id === "manual") {
		return {
			amount: Number(salaryAmount),
			source: "manual",
			reason: "Ingreso manual confirmado.",
		};
	}
	return {
		amount: Number(salaryAmount),
		source: "candidate",
		reason: "Entrada seleccionada como ingreso principal.",
	};
}

export function calculateFinancialPosition({
	confirmedIncome,
	expenseTotal,
	actualRemaining,
} = {}) {
	if (!isKnownAmount(confirmedIncome?.amount)) {
		return { expectedRemaining: null, unexplained: null };
	}
	const expenses = isKnownAmount(expenseTotal) ? Number(expenseTotal) : 0;
	const expectedRemaining = Number(confirmedIncome.amount) - expenses;
	return {
		expectedRemaining,
		unexplained: isKnownAmount(actualRemaining)
			? expectedRemaining - Number(actualRemaining)
			: null,
	};
}

export function buildReconciliation({
	confirmedIncome,
	transactions,
	actualRemaining,
} = {}) {
	const result = {
		actualRemaining: isKnownAmount(actualRemaining)
			? Number(actualRemaining)
			: null,
		expectedRemaining: null,
		difference: null,
		knownOutflowTotal: 0,
		knownOutflowCount: 0,
		transferOutflowCount: 0,
		uncertainOutflowCount: 0,
		unknownOutflowCount: 0,
		informationalInflowTotal: 0,
		informationalInflowCount: 0,
		completeness: "complete",
		hypotheses: [],
	};

	for (const transaction of Array.isArray(transactions) ? transactions : []) {
		if (transaction?.direction === "outflow") {
			if (!isKnownAmount(transaction.amount)) {
				result.unknownOutflowCount += 1;
				continue;
			}
			result.knownOutflowTotal += Number(transaction.amount);
			result.knownOutflowCount += 1;
			if (transaction.kind === "transfer") result.transferOutflowCount += 1;
			if (transaction.status === "needs_review") {
				result.uncertainOutflowCount += 1;
			}
		} else if (
			transaction?.direction === "inflow" &&
			isKnownAmount(transaction.amount)
		) {
			result.informationalInflowTotal += Number(transaction.amount);
			result.informationalInflowCount += 1;
		}
	}

	if (result.unknownOutflowCount > 0) {
		result.completeness = "incomplete";
	} else if (result.uncertainOutflowCount > 0) {
		result.completeness = "uncertain";
	}

	if (isKnownAmount(confirmedIncome?.amount)) {
		result.expectedRemaining =
			Number(confirmedIncome.amount) - result.knownOutflowTotal;
	} else {
		result.hypotheses.push({ key: "income-unconfirmed", severity: "info" });
	}
	if (result.actualRemaining === null) {
		result.hypotheses.push({ key: "actual-missing", severity: "info" });
	}
	if (result.uncertainOutflowCount > 0) {
		result.hypotheses.push({
			key: "needs-review-included",
			severity: "warning",
		});
	}
	if (result.unknownOutflowCount > 0) {
		result.hypotheses.push({ key: "unknown-outflows", severity: "warning" });
	}
	if (result.expectedRemaining !== null && result.actualRemaining !== null) {
		result.difference = result.expectedRemaining - result.actualRemaining;
		let differenceKey = "reconciled";
		if (result.difference > 0) differenceKey = "difference-positive";
		if (result.difference < 0) differenceKey = "difference-negative";
		result.hypotheses.push({ key: differenceKey, severity: "info" });
	}

	return result;
}

export function legacyConfirmationId({ salaryAmount, confirmedIncomeId } = {}) {
	if (!isKnownAmount(salaryAmount)) return "";
	const id = String(confirmedIncomeId ?? "").trim();
	if (id) return id;
	return Number(salaryAmount) > 0 ? "manual" : "";
}
