import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";

const dbPath = process.env.DB_PATH ?? "data/finance.db";
const localDbPath = resolve(dbPath);
const dbUrl = process.env.TURSO_DATABASE_URL || `file:${localDbPath}`;
const dbAuthToken = process.env.TURSO_AUTH_TOKEN;

if (process.env.VERCEL === "1" && !process.env.TURSO_DATABASE_URL) {
	throw new Error(
		"Missing TURSO_DATABASE_URL in Vercel. Configure Turso env vars before deploying.",
	);
}

if (!process.env.TURSO_DATABASE_URL) {
	mkdirSync(dirname(localDbPath), { recursive: true });
}

export const db = createClient({
	url: dbUrl,
	authToken: dbAuthToken,
});

let initPromise = null;

export async function ensureDbInitialized() {
	initPromise ??= initDb();
	return initPromise;
}

export async function initDb() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS movement_overrides (
      user_email TEXT NOT NULL,
      movement_key TEXT NOT NULL,
      patch_json TEXT NOT NULL DEFAULT '{}',
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_email, movement_key)
    )
  `);

	await db.execute(`
    CREATE TABLE IF NOT EXISTS manual_movements (
      movement_key TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT NOT NULL UNIQUE,
      occurred_at TEXT,
      amount INTEGER,
      currency TEXT NOT NULL DEFAULT 'CLP',
      direction TEXT NOT NULL DEFAULT 'outflow',
      kind TEXT NOT NULL DEFAULT 'unknown',
      counterparty TEXT,
      description TEXT,
      category TEXT,
      confidence REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'manual',
      raw_preview TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

	await db.execute(`
    CREATE TABLE IF NOT EXISTS counterparty_category_rules (
      user_email TEXT NOT NULL,
      counterparty_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_email, counterparty_key)
    )
  `);

	await db.execute(`
    CREATE TABLE IF NOT EXISTS categories (
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_email, name)
    )
  `);

	await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_email TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    )
  `);

	await db.execute(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS google_tokens (
      user_email TEXT PRIMARY KEY,
      token_json TEXT NOT NULL DEFAULT '{}',
      profile_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
	`);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS financial_preferences (
			user_email TEXT PRIMARY KEY,
			selected_start_date TEXT NOT NULL,
			selected_end_date_exclusive TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`);

	await db.execute(`
		CREATE TABLE IF NOT EXISTS financial_periods (
			user_email TEXT NOT NULL,
			start_date TEXT NOT NULL,
			end_date_exclusive TEXT NOT NULL,
			income_amount INTEGER,
			completed_at TEXT,
			actual_balance INTEGER,
			actual_balance_at TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY(user_email, start_date, end_date_exclusive)
		)
	`);

	await ensureFinancialPeriodsColumns();
}

async function ensureFinancialPeriodsColumns() {
	const info = await db.execute("PRAGMA table_info(financial_periods)");
	const columns = new Set(info.rows.map((row) => String(row.name)));
	if (!columns.has("actual_balance")) {
		await db.execute("ALTER TABLE financial_periods ADD COLUMN actual_balance INTEGER");
	}
	if (!columns.has("actual_balance_at")) {
		await db.execute("ALTER TABLE financial_periods ADD COLUMN actual_balance_at TEXT");
	}
}

function normalizeActualBalance(value) {
	return value === null || value === undefined ? null : Number(value);
}

export async function getFinancialCycleSettings(userEmail) {
	const result = await db.execute({
		sql: `SELECT p.selected_start_date AS startDate,
			p.selected_end_date_exclusive AS endDateExclusive,
			f.income_amount AS incomeAmount, f.completed_at AS completedAt,
			f.actual_balance AS actualBalance, f.actual_balance_at AS actualBalanceAt
			FROM financial_preferences p
			LEFT JOIN financial_periods f ON f.user_email = p.user_email
				AND f.start_date = p.selected_start_date
				AND f.end_date_exclusive = p.selected_end_date_exclusive
			WHERE p.user_email = ?`,
		args: [userEmail],
	});
	const row = result.rows[0];
	return row
		? {
				selectedPeriod: {
					startDate: row.startDate,
					endDateExclusive: row.endDateExclusive,
				},
				incomeAmount: row.incomeAmount,
				completedAt: row.completedAt,
				actualBalance: normalizeActualBalance(row.actualBalance),
				actualBalanceAt: row.actualBalanceAt ?? null,
			}
		: null;
}

export async function getFinancialCyclePeriod(userEmail, period) {
	const result = await db.execute({
		sql: `SELECT income_amount AS incomeAmount, completed_at AS completedAt,
			actual_balance AS actualBalance, actual_balance_at AS actualBalanceAt
			FROM financial_periods
			WHERE user_email = ? AND start_date = ? AND end_date_exclusive = ?`,
		args: [userEmail, period.startDate, period.endDateExclusive],
	});
	const row = result.rows[0];
	return row
		? {
				selectedPeriod: period,
				incomeAmount: row.incomeAmount,
				completedAt: row.completedAt,
				actualBalance: normalizeActualBalance(row.actualBalance),
				actualBalanceAt: row.actualBalanceAt ?? null,
			}
		: null;
}

export async function upsertFinancialCycleReconciliation(userEmail, record) {
	const { selectedPeriod, actualBalance, actualBalanceAt } = record;
	await db.execute({
		sql: `INSERT INTO financial_periods (user_email, start_date, end_date_exclusive, actual_balance, actual_balance_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(user_email, start_date, end_date_exclusive) DO UPDATE SET
			actual_balance = excluded.actual_balance,
			actual_balance_at = excluded.actual_balance_at,
			updated_at = CURRENT_TIMESTAMP`,
		args: [
			userEmail,
			selectedPeriod.startDate,
			selectedPeriod.endDateExclusive,
			actualBalance,
			actualBalanceAt,
		],
	});
	return getFinancialCyclePeriod(userEmail, selectedPeriod);
}

export async function completeFinancialCyclePeriod(userEmail, record) {
	const { selectedPeriod, incomeAmount, completedAt } = record;
	await db.execute({ sql: `INSERT INTO financial_periods (user_email, start_date, end_date_exclusive, income_amount, completed_at)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_email, start_date, end_date_exclusive) DO UPDATE SET completed_at = excluded.completed_at, updated_at = CURRENT_TIMESTAMP`, args: [userEmail, selectedPeriod.startDate, selectedPeriod.endDateExclusive, incomeAmount, completedAt] });
	return getFinancialCyclePeriod(userEmail, selectedPeriod);
}

export async function upsertFinancialCycleSettings(userEmail, record) {
	const { selectedPeriod, incomeAmount, completedAt = null } = record;
	await db.batch([
		{
			sql: `INSERT INTO financial_preferences (user_email, selected_start_date, selected_end_date_exclusive)
				VALUES (?, ?, ?) ON CONFLICT(user_email) DO UPDATE SET
				selected_start_date = excluded.selected_start_date,
				selected_end_date_exclusive = excluded.selected_end_date_exclusive,
				updated_at = CURRENT_TIMESTAMP`,
			args: [userEmail, selectedPeriod.startDate, selectedPeriod.endDateExclusive],
		},
		{
			sql: `INSERT INTO financial_periods (user_email, start_date, end_date_exclusive, income_amount, completed_at)
				VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_email, start_date, end_date_exclusive) DO UPDATE SET
				income_amount = excluded.income_amount,
				completed_at = COALESCE(excluded.completed_at, financial_periods.completed_at),
				updated_at = CURRENT_TIMESTAMP`,
			args: [userEmail, selectedPeriod.startDate, selectedPeriod.endDateExclusive, incomeAmount, completedAt],
		},
	]);
	return getFinancialCycleSettings(userEmail);
}

export async function listManualMovements(
	userEmail,
	month = monthKey(new Date()),
) {
	const { start, end } = monthRange(month);
	const result = await db.execute({
		sql: `
      SELECT
        movement_key AS id,
        movement_key AS movementKey,
        user_email AS userEmail,
        source,
        source_id AS sourceId,
        occurred_at AS occurredAt,
        amount,
        currency,
        direction,
        kind,
        counterparty,
        description,
        category,
        confidence,
        status,
        raw_preview AS rawPreview,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM manual_movements
      WHERE user_email = ?
        AND occurred_at >= ?
        AND occurred_at < ?
      ORDER BY COALESCE(occurred_at, created_at) DESC, movement_key DESC
    `,
		args: [userEmail, start, end],
	});
	return result.rows.map((movement) => ({ ...movement, isManual: true }));
}

export async function insertManualMovement(input, userEmail) {
	const movementKey = input.movementKey ?? `manual_${cryptoRandomId()}`;
	await db.execute({
		sql: `
    INSERT INTO manual_movements (
      movement_key, user_email, source, source_id, occurred_at, amount, currency,
      direction, kind, counterparty, description, category, confidence, status, raw_preview
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
		args: [
			movementKey,
			userEmail,
			"manual",
			input.sourceId ?? movementKey,
			input.occurredAt,
			input.amount,
			input.currency ?? "CLP",
			input.direction ?? "outflow",
			input.kind ?? "unknown",
			input.counterparty,
			input.description,
			input.category,
			input.confidence ?? 1,
			input.status ?? "manual",
			input.rawPreview ?? null,
		],
	});
	return getManualMovement(movementKey, userEmail);
}

export async function getManualMovement(movementKey, userEmail) {
	const result = await db.execute({
		sql: `
      SELECT
        movement_key AS id,
        movement_key AS movementKey,
        user_email AS userEmail,
        source,
        source_id AS sourceId,
        occurred_at AS occurredAt,
        amount,
        currency,
        direction,
        kind,
        counterparty,
        description,
        category,
        confidence,
        status,
        raw_preview AS rawPreview,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM manual_movements
      WHERE movement_key = ? AND user_email = ?
    `,
		args: [movementKey, userEmail],
	});
	return result.rows[0] || null;
}

export async function updateManualMovement(movementKey, patch, userEmail) {
	const current = await getManualMovement(movementKey, userEmail);
	if (!current) return null;
	const next = {
		occurredAt: valueOrCurrent(patch, "occurredAt", current.occurredAt),
		amount: valueOrCurrent(patch, "amount", current.amount),
		direction: valueOrCurrent(patch, "direction", current.direction),
		kind: valueOrCurrent(patch, "kind", current.kind),
		counterparty: valueOrCurrent(patch, "counterparty", current.counterparty),
		description: valueOrCurrent(patch, "description", current.description),
		category: valueOrCurrent(patch, "category", current.category),
		status: valueOrCurrent(patch, "status", "manual"),
	};
	await db.execute({
		sql: `
    UPDATE manual_movements SET
      occurred_at = ?,
      amount = ?,
      direction = ?,
      kind = ?,
      counterparty = ?,
      description = ?,
      category = ?,
      status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE movement_key = ? AND user_email = ?
  `,
		args: [
			next.occurredAt,
			next.amount,
			next.direction,
			next.kind,
			next.counterparty,
			next.description,
			next.category,
			next.status,
			movementKey,
			userEmail,
		],
	});
	return getManualMovement(movementKey, userEmail);
}

export async function deleteManualMovement(movementKey, userEmail) {
	const result = await db.execute({
		sql: "DELETE FROM manual_movements WHERE movement_key = ? AND user_email = ?",
		args: [movementKey, userEmail],
	});
	return Number(result.rowsAffected || 0) > 0;
}

export async function getOverrides(userEmail) {
	const result = await db.execute({
		sql: `
      SELECT movement_key AS movementKey, patch_json AS patchJson, hidden
      FROM movement_overrides
      WHERE user_email = ?
    `,
		args: [userEmail],
	});
	return result.rows.map((row) => ({
		movementKey: row.movementKey,
		patch: safeJson(row.patchJson),
		hidden: Boolean(row.hidden),
	}));
}

export async function upsertMovementOverride(
	userEmail,
	movementKey,
	patch = {},
	hidden = false,
) {
	const currentResult = await db.execute({
		sql: "SELECT patch_json AS patchJson, hidden FROM movement_overrides WHERE user_email = ? AND movement_key = ?",
		args: [userEmail, movementKey],
	});
	const current = currentResult.rows[0];
	const nextPatch = {
		...(current ? safeJson(current.patchJson) : {}),
		...patch,
	};
	const nextHidden = hidden || Boolean(current?.hidden);
	await db.execute({
		sql: `
    INSERT INTO movement_overrides (user_email, movement_key, patch_json, hidden)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_email, movement_key) DO UPDATE SET
      patch_json = excluded.patch_json,
      hidden = excluded.hidden,
      updated_at = CURRENT_TIMESTAMP
  `,
		args: [
			userEmail,
			movementKey,
			JSON.stringify(nextPatch),
			nextHidden ? 1 : 0,
		],
	});
	return { movementKey, patch: nextPatch, hidden: nextHidden };
}

export async function hideMovement(userEmail, movementKey) {
	return upsertMovementOverride(userEmail, movementKey, {}, true);
}

export async function listCounterpartyCategoryRules(userEmail) {
	const result = await db.execute({
		sql: `SELECT
				counterparty_key AS counterpartyKey,
				display_name AS displayName,
				category,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM counterparty_category_rules
			WHERE user_email = ?
			ORDER BY updated_at DESC, counterparty_key ASC`,
		args: [userEmail],
	});
	return result.rows;
}

export async function upsertCounterpartyCategoryRule(
	userEmail,
	{ counterpartyKey, displayName, category },
) {
	await db.execute({
		sql: `INSERT INTO counterparty_category_rules (
			user_email,
			counterparty_key,
			display_name,
			category
		)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_email, counterparty_key) DO UPDATE SET
			display_name = excluded.display_name,
			category = excluded.category,
			updated_at = CURRENT_TIMESTAMP`,
		args: [userEmail, counterpartyKey, displayName, category],
	});
	const result = await db.execute({
		sql: `SELECT
				counterparty_key AS counterpartyKey,
				display_name AS displayName,
				category,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM counterparty_category_rules
			WHERE user_email = ? AND counterparty_key = ?`,
		args: [userEmail, counterpartyKey],
	});
	return result.rows[0] || null;
}

export async function deleteCounterpartyCategoryRule(
	userEmail,
	counterpartyKey,
) {
	const result = await db.execute({
		sql: "DELETE FROM counterparty_category_rules WHERE user_email = ? AND counterparty_key = ?",
		args: [userEmail, counterpartyKey],
	});
	return Number(result.rowsAffected || 0) > 0;
}

export async function listUserCategories(userEmail) {
	const result = await db.execute({
		sql: `SELECT
				name,
				color,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM categories
			WHERE user_email = ?
			ORDER BY name COLLATE NOCASE ASC`,
		args: [userEmail],
	});
	return result.rows;
}

export async function upsertUserCategory(userEmail, { name, color }) {
	const normalizedName = normalizeCategoryName(name);
	const normalizedColor = normalizeCategoryColor(color);
	await db.execute({
		sql: `INSERT INTO categories (user_email, name, color)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_email, name) DO UPDATE SET
		   color = excluded.color,
		   updated_at = CURRENT_TIMESTAMP`,
		args: [userEmail, normalizedName, normalizedColor],
	});
	const result = await db.execute({
		sql: `SELECT
				name,
				color,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM categories
			WHERE user_email = ? AND name = ?`,
		args: [userEmail, normalizedName],
	});
	return result.rows[0] || null;
}

export async function deleteUserCategory(userEmail, name) {
	const normalizedName = normalizeCategoryName(name);
	if (!normalizedName) return false;
	const result = await db.execute({
		sql: "DELETE FROM categories WHERE user_email = ? AND name = ?",
		args: [userEmail, normalizedName],
	});
	return Number(result.rowsAffected || 0) > 0;
}

export async function createSession(sessionId, expiresAt = null) {
	await db.execute({
		sql: `INSERT INTO sessions (session_id, expires_at)
		 VALUES (?, ?)
		 ON CONFLICT(session_id) DO UPDATE SET
		   updated_at = CURRENT_TIMESTAMP`,
		args: [sessionId, expiresAt],
	});
	return getSession(sessionId);
}

// Persisted deadlines are ISO date-times with an explicit timezone. Reject loose
// Date.parse inputs (e.g. "123") and calendar rollovers instead of guessing.
export function sessionExpiryTime(expiresAt) {
	if (typeof expiresAt !== "string") return NaN;
	const match = expiresAt.match(/^((?:\d{4}|[+-]\d{6})-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
	if (!match) return NaN;
	const calendarDate = new Date(`${match[1]}T00:00:00.000Z`);
	if (!Number.isFinite(calendarDate.getTime()) || !calendarDate.toISOString().startsWith(`${match[1]}T`)) return NaN;
	return Date.parse(expiresAt);
}

// Reusable active-session contract: return the persisted row only while its
// finite deadline is strictly in the future. No grace period or sliding renewal.
export async function getSession(sessionId) {
	const result = await db.execute({
		sql: `SELECT
				session_id AS sessionId,
				user_email AS userEmail,
				created_at AS createdAt,
				updated_at AS updatedAt,
				expires_at AS expiresAt
			FROM sessions
			WHERE session_id = ?`,
		args: [sessionId],
	});
	const session = result.rows[0];
	if (!session) {
		// Also remove states orphaned by an earlier deletion. A concurrently
		// inserted replacement keeps its states because absence is checked in SQL.
		await db.execute({
			sql: "DELETE FROM oauth_states WHERE session_id = ? AND NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = ?)",
			args: [sessionId, sessionId],
		});
		return null;
	}
	if (sessionExpiryTime(session.expiresAt) > Date.now()) return session;
	// Lazy cleanup is session-scoped. Never remove account, finance or token data.
	// Compare the observed deadline so a concurrent replacement is not deleted.
	await db.batch([
		{ sql: "DELETE FROM sessions WHERE session_id = ? AND expires_at IS ?", args: [sessionId, session.expiresAt] },
		{ sql: "DELETE FROM oauth_states WHERE session_id = ? AND NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = ?)", args: [sessionId, sessionId] },
	], "write");
	return null;
}

export async function touchSession(sessionId) {
	await db.execute({
		sql: "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = ?",
		args: [sessionId],
	});
	return getSession(sessionId);
}

// Cancel all public states and private claims in the same write transaction as
// any identity change, including anonymous logout and same-user/ABA changes.
// These compatibility helpers never renew deadlines or delete account records.
async function setSessionUser(sessionId, userEmail) {
	await db.batch([
		{ sql: "DELETE FROM oauth_states WHERE session_id = ?", args: [sessionId] },
		{ sql: "UPDATE sessions SET user_email = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?", args: [userEmail, sessionId] },
	], "write");
	return getSession(sessionId);
}

export async function linkSessionToUser(sessionId, userEmail) {
	return setSessionUser(sessionId, userEmail);
}

export async function clearSessionUser(sessionId) {
	return setSessionUser(sessionId, null);
}

export async function deleteSession(sessionId) {
	const results = await db.batch([
		{ sql: "DELETE FROM oauth_states WHERE session_id = ?", args: [sessionId] },
		{ sql: "DELETE FROM sessions WHERE session_id = ? RETURNING session_id", args: [sessionId] },
	], "write");
	return results[1].rows.length > 0;
}

// NUL-prefixed rows are repository-private capabilities, never browser states.
// Keeping the claim in this table means logout/expiry can cancel in-flight work.
const OAUTH_PRIVATE_PREFIX = "\u0000oauth:";
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
// Native SQL time is the final OAuth validity authority at statement execution.
// No JS/seconds fallback: missing functions error; NULL makes gates reject.
const OAUTH_SQL_CLOCK_MS = "CAST(ROUND(unixepoch('now', 'subsec') * 1000) AS INTEGER) /* oauth-clock-ms */";
const claimKey = (claimId) => `${OAUTH_PRIVATE_PREFIX}claim:${claimId}`;
const publicOAuthState = (state) => typeof state === "string" && state.length > 0 && !state.startsWith(OAUTH_PRIVATE_PREFIX);
const validClaim = (claim) => typeof claim?.claimId === "string" && claim.claimId.length > 0 && typeof claim.sessionId === "string" && claim.sessionId.length > 0;

// Snapshot checks use the same strict deadline parser as getSession. SQL compares
// the exact observed identity/deadline as well, so a replacement cannot inherit
// authorization from a stale read. Activity timestamps are deliberately ignored.
function activeSessionGate(session) {
	return {
		sql: `EXISTS (SELECT 1 FROM sessions WHERE session_id = ? AND user_email IS ? AND expires_at IS ?) AND ? > ${OAUTH_SQL_CLOCK_MS}`,
		args: [session.sessionId, session.userEmail, session.expiresAt, sessionExpiryTime(session.expiresAt)],
	};
}

// Returns the persisted public state or null. Never creates a session, rebinds a
// duplicate state, or extends an existing deadline. Old callers may ignore it.
// Explicit creation timestamps remain supported; future timestamps cannot be
// claimed until their clock time, and age is enforced at claim/completion time.
export async function saveOAuthState(state, sessionId, createdAt = Date.now()) {
	if (!publicOAuthState(state) || !sessionId || !Number.isSafeInteger(createdAt) || createdAt < 0) return null;
	const session = await getSession(sessionId);
	if (!session) return null;
	const gate = activeSessionGate(session);
	const result = await db.execute({
		sql: `INSERT INTO oauth_states (state, session_id, created_at)
			SELECT ?, ?, ? WHERE ${gate.sql}
			ON CONFLICT(state) DO NOTHING
			RETURNING state, session_id AS sessionId, created_at AS createdAt`,
		args: [state, sessionId, createdAt, ...gate.args],
	});
	return result.rows[0] || null;
}

// Compatibility-only unbound consumption until Gmail switches to claimOAuthState.
// A single DELETE RETURNING prevents SELECT/DELETE races; private work is hidden.
export async function consumeOAuthState(state) {
	if (!publicOAuthState(state)) return null;
	const result = await db.execute({
		sql: `DELETE FROM oauth_states WHERE state = ?
			RETURNING state, session_id AS sessionId, created_at AS createdAt`,
		args: [state],
	});
	return result.rows[0] || null;
}

// Must run before exchanging a code. Only the initiating browser can convert a
// fresh public state into a single-consumer private claim. Rejection returns null
// without consuming another browser's state. The claim's original age is retained.
export async function claimOAuthState(state, sessionId) {
	if (!publicOAuthState(state) || !sessionId) return null;
	const session = await getSession(sessionId);
	if (!session) return null;
	const gate = activeSessionGate(session);
	const claimId = randomUUID();
	const result = await db.execute({
		sql: `UPDATE oauth_states SET state = ?
			WHERE state = ? AND session_id = ?
			AND typeof(created_at) = 'integer' AND created_at > ${OAUTH_SQL_CLOCK_MS} - ? AND created_at <= ${OAUTH_SQL_CLOCK_MS}
			AND ${gate.sql}
			RETURNING session_id AS sessionId, created_at AS createdAt`,
		args: [claimKey(claimId), state, sessionId, OAUTH_STATE_MAX_AGE_MS, ...gate.args],
	});
	return result.rows[0] ? { claimId, ...result.rows[0] } : null;
}

// Exchange/profile/configuration failures cancel only their own private work.
export async function cancelOAuthClaim(claim) {
	if (!validClaim(claim)) return false;
	const result = await db.execute({
		sql: "DELETE FROM oauth_states WHERE state = ? AND session_id = ? RETURNING state",
		args: [claimKey(claim.claimId), claim.sessionId],
	});
	return result.rows.length > 0;
}

// Returns the committed fresh session or null for lost/cancelled/expired claims
// or ID collisions. Invalid identity/token/deadline input throws TypeError; SQL
// failures propagate and roll back all writes, leaving the claim retryable.
// Supply a NEW random sessionId and a configured fresh absolute expiresAt after
// exchange/profile retrieval. Tokens use JSON Merge Patch: omitted stored fields
// (notably refresh_token) survive, explicit null removes the corresponding field.
export async function completeOAuthAuthentication(claim, { sessionId, expiresAt, profile, tokens } = {}) {
	if (!validClaim(claim)) return null;
	if (!(sessionExpiryTime(expiresAt) > Date.now())) throw new TypeError("Authentication requires a future session deadline");
	if (typeof profile?.email !== "string" || !profile.email.trim()) throw new TypeError("Authentication requires a profile email");
	if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) throw new TypeError("Authentication requires tokens as an object");
	if (typeof sessionId !== "string" || !sessionId || sessionId === claim.sessionId) return null;
	const tokenJson = JSON.stringify(tokens);
	const profileJson = JSON.stringify(profile);
	const session = await getSession(claim.sessionId);
	if (!session) return null;
	if (!(sessionExpiryTime(expiresAt) > Date.now())) throw new TypeError("Authentication requires a future session deadline");
	const activeGate = activeSessionGate(session);
	const completionKey = `${OAUTH_PRIVATE_PREFIX}complete:${randomUUID()}`;
	const gate = "EXISTS (SELECT 1 FROM oauth_states WHERE state = ? AND session_id = ?)";
	const gateArgs = [completionKey, claim.sessionId];
	// Authorization linearizes at the conditional UPDATE, not final COMMIT.
	// Check source, claim and supplied fresh deadline against SQL execution time.
	// Store the supplied deadline unchanged: no skew offset, grace or rebasing.
	// Zero rows at step one DO NOT abort a batch. Every subsequent mutation must
	// explicitly require this unique completion gate, including cleanup itself.
	const results = await db.batch([
		{
			sql: `UPDATE oauth_states SET state = ? WHERE state = ? AND session_id = ?
				AND typeof(created_at) = 'integer' AND created_at > ${OAUTH_SQL_CLOCK_MS} - ? AND created_at <= ${OAUTH_SQL_CLOCK_MS}
				AND ${activeGate.sql} AND ? > ${OAUTH_SQL_CLOCK_MS}
				AND NOT EXISTS (SELECT 1 FROM sessions WHERE session_id = ?)
				RETURNING state`,
			args: [completionKey, claimKey(claim.claimId), claim.sessionId, OAUTH_STATE_MAX_AGE_MS, ...activeGate.args, sessionExpiryTime(expiresAt), sessionId],
		},
		{
			sql: `INSERT INTO google_tokens (user_email, token_json, profile_json)
				SELECT ?, ?, ? WHERE ${gate}
				ON CONFLICT(user_email) DO UPDATE SET
					token_json = json_patch(google_tokens.token_json, excluded.token_json),
					profile_json = excluded.profile_json, updated_at = CURRENT_TIMESTAMP`,
			args: [profile.email, tokenJson, profileJson, ...gateArgs],
		},
		{
			sql: `INSERT INTO sessions (session_id, user_email, expires_at)
				SELECT ?, ?, ? WHERE ${gate}
				RETURNING session_id AS sessionId, user_email AS userEmail,
					created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt`,
			args: [sessionId, profile.email, expiresAt, ...gateArgs],
		},
		{
			sql: `DELETE FROM oauth_states WHERE session_id = ? AND state != ? AND ${gate}`,
			args: [claim.sessionId, completionKey, ...gateArgs],
		},
		{
			sql: `DELETE FROM sessions WHERE session_id = ? AND ${gate}`,
			args: [claim.sessionId, ...gateArgs],
		},
		{
			sql: `DELETE FROM oauth_states WHERE state = ? AND session_id = ? AND ${gate} RETURNING state`,
			args: [...gateArgs, ...gateArgs],
		},
	], "write");
	return results[0].rows.length > 0 ? results[2].rows[0] || null : null;
}

export async function upsertGoogleToken(userEmail, token) {
	await db.execute({
		sql: `INSERT INTO google_tokens (user_email, token_json)
		 VALUES (?, ?)
		 ON CONFLICT(user_email) DO UPDATE SET
		   token_json = excluded.token_json,
		   updated_at = CURRENT_TIMESTAMP`,
		args: [userEmail, JSON.stringify(token)],
	});
}

export async function getGoogleToken(userEmail) {
	const result = await db.execute({
		sql: "SELECT token_json AS tokenJson FROM google_tokens WHERE user_email = ?",
		args: [userEmail],
	});
	const row = result.rows[0];
	return row ? safeJson(row.tokenJson) : null;
}

export async function deleteGoogleToken(userEmail) {
	const result = await db.execute({
		sql: "DELETE FROM google_tokens WHERE user_email = ?",
		args: [userEmail],
	});
	return Number(result.rowsAffected || 0) > 0;
}

export async function upsertGoogleProfile(userEmail, profile) {
	await db.execute({
		sql: `INSERT INTO google_tokens (user_email, token_json, profile_json)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_email) DO UPDATE SET
		   profile_json = excluded.profile_json,
		   updated_at = CURRENT_TIMESTAMP`,
		args: [
			userEmail,
			JSON.stringify((await getGoogleToken(userEmail)) || {}),
			JSON.stringify(profile),
		],
	});
}

export async function getGoogleProfile(userEmail) {
	const result = await db.execute({
		sql: "SELECT profile_json AS profileJson FROM google_tokens WHERE user_email = ?",
		args: [userEmail],
	});
	const row = result.rows[0];
	if (!row?.profileJson) return null;
	const parsed = safeJson(row.profileJson);
	return parsed?.email ? parsed : null;
}

export async function deleteGoogleProfile(userEmail) {
	await db.execute({
		sql: `UPDATE google_tokens
		 SET profile_json = NULL,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE user_email = ?`,
		args: [userEmail],
	});
}

export function monthRange(month) {
	const referenceDate = parseMonth(month);
	const startDate = new Date(
		referenceDate.getFullYear(),
		referenceDate.getMonth(),
		1,
	);
	const endDate = new Date(
		referenceDate.getFullYear(),
		referenceDate.getMonth() + 1,
		1,
	);
	return {
		start: formatDateTimeForDb(startDate),
		end: formatDateTimeForDb(endDate),
	};
}

function parseMonth(value) {
	const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
	if (!match) return new Date();
	const year = Number(match[1]);
	const month = Number(match[2]);
	if (!year || month < 1 || month > 12) return new Date();
	return new Date(year, month - 1, 1);
}

function monthKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateTimeForDb(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T00:00:00`;
}

function valueOrCurrent(patch, key, currentValue) {
	return Object.hasOwn(patch, key) ? patch[key] : currentValue;
}

function normalizeCategoryName(name) {
	return String(name ?? "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 40);
}

function normalizeCategoryColor(color) {
	const normalized = String(color ?? "").trim();
	return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "#64748b";
}

function safeJson(value) {
	try {
		return value ? JSON.parse(value) : {};
	} catch {
		return {};
	}
}

function cryptoRandomId() {
	return randomUUID().replace(/-/g, "");
}
