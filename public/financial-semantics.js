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

export function resolveConfirmedIncome({ salaryAmount, confirmedIncomeId } = {}) {
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

export function legacyConfirmationId({ salaryAmount, confirmedIncomeId } = {}) {
	if (!isKnownAmount(salaryAmount)) return "";
	const id = String(confirmedIncomeId ?? "").trim();
	if (id) return id;
	return Number(salaryAmount) > 0 ? "manual" : "";
}
