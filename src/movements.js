import { createHash } from "node:crypto";

import { listBancoChileEmails } from "./gmail.js";
import { parseBancoChileEmail } from "./parser.js";
import {
	getOverrides,
	listCounterpartyCategoryRules,
	listManualMovements,
	monthRange,
	upsertMovementOverride,
} from "./db.js";

export async function loadMovementsForMonth(
	userEmail,
	{ month, payTiming = "varies", limit = 200 } = {},
) {
	const result = await loadMovementsForMonthResult(userEmail, {
		month,
		payTiming,
		limit,
	});
	return result.movements;
}

export async function loadMovementsForMonthResult(
	userEmail,
	{ month, payTiming = "varies", limit = 200 } = {},
) {
	const manualMovements = await listManualMovements(userEmail, month);
	const { movements: gmailMovements, warning } = await safeLoadGmailMovements(
		userEmail,
		{
			month,
			payTiming,
			limit,
		},
	);
	const selectedMonthMovements = gmailMovements.filter((movement) =>
		isInMonth(movement.occurredAt, month),
	);
	const movements = await applyStoredCounterpartyRules(userEmail, [
		...selectedMonthMovements,
		...manualMovements,
	]);
	return {
		movements: await applyStoredOverrides(userEmail, movements),
		warning,
	};
}

export async function loadIncomeCandidateMovements(
	userEmail,
	{ month, payTiming = "varies", limit = 200 } = {},
) {
	const { movements: gmailMovements } = await safeLoadGmailMovements(
		userEmail,
		{
			month,
			payTiming,
			limit,
		},
	);
	const candidates = (
		await applyStoredOverrides(
			userEmail,
			await applyStoredCounterpartyRules(userEmail, gmailMovements),
		)
	)
		.filter(
			(movement) =>
				movement.direction === "inflow" &&
				hasKnownAmount(movement) &&
				Number(movement.amount) > 0,
		)
		.sort(
			(a, b) =>
				Number(b.amount) - Number(a.amount) ||
				String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")),
		);
	return candidates.slice(0, 2);
}

export async function syncRuntimeMovements(
	userEmail,
	{ month, payTiming = "varies", limit = 200 } = {},
) {
	const { emails, query } = await listBancoChileEmails(userEmail, {
		month,
		payTiming,
		limit,
	});
	const gmailMovements = parseEmailsToMovements(emails);
	const selectedMonthMovements = gmailMovements.filter((movement) =>
		isInMonth(movement.occurredAt, month),
	);
	const manualMovements = await listManualMovements(userEmail, month);
	const movements = await applyStoredOverrides(
		userEmail,
		await applyStoredCounterpartyRules(userEmail, [
			...selectedMonthMovements,
			...manualMovements,
		]),
	);
	return { query, scanned: emails.length, transactions: movements };
}

async function safeLoadGmailMovements(userEmail, { month, payTiming, limit }) {
	try {
		const { emails } = await listBancoChileEmails(userEmail, {
			month,
			payTiming,
			limit,
		});
		return { movements: parseEmailsToMovements(emails), warning: null };
	} catch (error) {
		return {
			movements: [],
			warning:
				error.status === 401
					? "Gmail no está conectado; se muestran solo movimientos manuales."
					: "No se pudo leer Gmail; se muestran solo movimientos manuales.",
		};
	}
}

export function parseEmailsToMovements(emails) {
	const movementsByKey = new Map();
	for (const email of emails) {
		const parsed = parseBancoChileEmail(email.body, { subject: email.subject });
		const sourceId = parsed.sourceId?.startsWith("banco-chile:")
			? parsed.sourceId
			: `gmail:${email.gmailId}`;
		const movement = toRuntimeMovement({
			...parsed,
			source: "gmail_banco_chile",
			sourceId,
		});
		movementsByKey.set(movement.movementKey, movement);
	}
	return [...movementsByKey.values()];
}

export function toRuntimeMovement(input) {
	const movementKey = computeMovementKey(input);
	const counterparty = input.counterparty ?? null;
	return {
		id: movementKey,
		movementKey,
		isManual: false,
		userEmail: input.userEmail ?? null,
		source: input.source ?? "gmail_banco_chile",
		sourceId: input.sourceId ?? null,
		occurredAt: input.occurredAt ?? null,
		amount: input.amount ?? null,
		currency: input.currency ?? "CLP",
		direction: input.direction ?? "outflow",
		kind: input.kind ?? "unknown",
		counterparty,
		counterpartyKey: normalizeCounterpartyKey(counterparty),
		description: input.description ?? null,
		category: input.category ?? null,
		confidence: input.confidence ?? 0.5,
		status: input.status ?? "detected",
		rawPreview: input.rawPreview ?? null,
		createdAt: input.createdAt ?? null,
		updatedAt: input.updatedAt ?? null,
	};
}

export function computeMovementKey(input) {
	if (input.movementKey) return String(input.movementKey);
	const source = normalizePart(input.source ?? "unknown");
	const sourceId = normalizePart(input.sourceId ?? "");
	if (sourceId) return `gm_${sha256(`${source}:${sourceId}`)}`;
	return `gm_${sha256(
		[
			source,
			input.occurredAt ?? "",
			input.amount ?? "",
			input.direction ?? "",
			input.kind ?? "",
			input.counterparty ?? "",
			input.description ?? "",
		]
			.map(normalizePart)
			.join("|"),
	)}`;
}

export function applyMovementOverrides(movements, overrides) {
	const overridesByKey = new Map(
		overrides.map((override) => [override.movementKey, override]),
	);
	return movements.flatMap((movement) => {
		if (movement.isManual) return [movement];
		const override = overridesByKey.get(movement.movementKey);
		if (!override) return [movement];
		if (override.hidden) return [];
		return [
			{
				...movement,
				...override.patch,
				id: movement.movementKey,
				movementKey: movement.movementKey,
				isManual: false,
				override: true,
			},
		];
	});
}

export function saveMovementOverride(userEmail, movementKey, patch) {
	return upsertMovementOverride(userEmail, movementKey, patch, false);
}

async function applyStoredOverrides(userEmail, movements) {
	return applyMovementOverrides(movements, await getOverrides(userEmail));
}

async function applyStoredCounterpartyRules(userEmail, movements) {
	const rules = await listCounterpartyCategoryRules(userEmail);
	return applyCounterpartyCategoryRules(movements, rules);
}

export function applyCounterpartyCategoryRules(movements, rules) {
	if (!rules?.length) {
		return movements.map((movement) => ({
			...movement,
			counterpartyKey:
				movement.counterpartyKey ??
				normalizeCounterpartyKey(movement.counterparty),
		}));
	}
	const ruleByKey = new Map(
		rules.map((rule) => [rule.counterpartyKey, rule.category]),
	);
	return movements.map((movement) => {
		const counterpartyKey =
			movement.counterpartyKey ??
			normalizeCounterpartyKey(movement.counterparty);
		const categoryRule = counterpartyKey
			? ruleByKey.get(counterpartyKey)
			: null;
		if (!categoryRule) {
			return {
				...movement,
				counterpartyKey,
			};
		}
		return {
			...movement,
			counterpartyKey,
			category: categoryRule,
		};
	});
}

function normalizePart(value) {
	return String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

export function normalizeCounterpartyKey(value) {
	const normalized = String(value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
	return normalized || "";
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function hasKnownAmount(movement) {
	return movement.amount !== null && Number.isFinite(Number(movement.amount));
}

function isInMonth(value, month) {
	if (!value) return false;
	const { start, end } = monthRange(month);
	return String(value) >= start && String(value) < end;
}
