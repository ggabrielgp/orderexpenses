export const INCOME_CACHE_TTL_MS = 30_000;
export const INCOME_CACHE_QUERY_VERSION = "banco-chile-v1";

export function incomeCandidateCacheKey({
	userEmail,
	month,
	payTiming = "varies",
	limit = 200,
	queryVersion = INCOME_CACHE_QUERY_VERSION,
}) {
	return JSON.stringify([
		String(userEmail).trim().toLowerCase(),
		String(month),
		String(payTiming).trim().toLowerCase(),
		Number(limit),
		String(queryVersion),
	]);
}

export function createIncomeCandidateCache({
	clock = () => Date.now(),
	clone = structuredClone,
	observe = () => {},
	capacity = 100,
} = {}) {
	if (!Number.isInteger(capacity) || capacity < 1) {
		throw new TypeError("capacity must be a positive integer");
	}
	const entries = new Map();
	const orderByKey = new Map();
	const latestManualByKey = new Map();

	function nextOrder(key) {
		const next = (orderByKey.get(key) ?? 0) + 1;
		orderByKey.set(key, next);
		return next;
	}

	function read(key) {
		try {
			const entry = entries.get(key);
			if (!entry) return null;
			if (clock() - entry.writtenAt >= INCOME_CACHE_TTL_MS) {
				entries.delete(key);
				safeObserve(observe, "expired");
				return null;
			}
			entries.delete(key);
			entries.set(key, entry);
			safeObserve(observe, "hit");
			return clone(entry.projection);
		} catch {
			safeObserve(observe, "error");
			return null;
		}
	}

	function tryStore(key, fullMovements, writeOrder) {
		try {
			const projection = projectMovements(fullMovements);
			const stored = clone(projection);
			const current = entries.get(key);
			if (current && writeOrder < current.writeOrder) return projection;
			const now = clock();
			for (const [entryKey, entry] of entries) {
				if (now - entry.writtenAt >= INCOME_CACHE_TTL_MS) {
					entries.delete(entryKey);
				}
			}
			entries.delete(key);
			while (entries.size >= capacity) {
				entries.delete(entries.keys().next().value);
				safeObserve(observe, "evicted");
			}
			entries.set(key, { projection: stored, writtenAt: now, writeOrder });
			safeObserve(observe, "stored");
			return projection;
		} catch {
			safeObserve(observe, "error");
			return null;
		}
	}

	async function scanPassiveFresh(keyParts, { scan }) {
		const key = incomeCandidateCacheKey(keyParts);
		const startOrder = nextOrder(key);
		const fullMovements = await scan();
		tryStore(key, fullMovements, startOrder);
		return fullMovements;
	}

	async function readCandidatesOrScan(keyParts, { scan }) {
		const key = incomeCandidateCacheKey(keyParts);
		const cached = read(key);
		if (cached) return hydrateProjection(cached);
		safeObserve(observe, "miss");
		const startOrder = nextOrder(key);
		const fullMovements = await scan();
		const projection = projectMovements(fullMovements);
		tryStore(key, fullMovements, startOrder);
		return hydrateProjection(projection);
	}

	async function scanManualFresh(keyParts, { scan }) {
		const key = incomeCandidateCacheKey(keyParts);
		const startOrder = nextOrder(key);
		latestManualByKey.set(key, startOrder);
		const fullMovements = await scan();
		if (latestManualByKey.get(key) === startOrder) {
			const commitOrder = nextOrder(key);
			tryStore(key, fullMovements, commitOrder);
		}
		return fullMovements;
	}

	return {
		scanPassiveFresh,
		readCandidatesOrScan,
		scanManualFresh,
		clear() {
			entries.clear();
			orderByKey.clear();
			latestManualByKey.clear();
		},
		size() {
			return entries.size;
		},
	};
}

function projectMovements(movements) {
	return movements.map((movement) => ({
		movementKey: movement.movementKey,
		occurredAt: movement.occurredAt,
		amount: movement.amount,
		currency: movement.currency,
		direction: movement.direction,
		kind: movement.kind,
		counterparty: movement.counterparty,
		counterpartyKey: movement.counterpartyKey,
		description: movement.description,
		category: movement.category,
		confidence: movement.confidence,
		status: movement.status,
	}));
}

function hydrateProjection(projection) {
	return projection.map((movement) => ({
		...movement,
		id: movement.movementKey,
		isManual: false,
		source: "gmail_banco_chile",
	}));
}

function safeObserve(observe, outcome) {
	try {
		observe({ event: "income_cache", outcome });
	} catch {
		// Observability must not affect Gmail behavior.
	}
}
