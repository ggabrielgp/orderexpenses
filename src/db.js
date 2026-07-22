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
	return { id: movementKey, movementKey, patch: nextPatch, hidden: nextHidden };
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

export async function createSession(
	sessionId,
	expiresAt = null,
	createdAt = new Date().toISOString(),
) {
	await db.execute({
		sql: `INSERT INTO sessions (
			session_id, created_at, updated_at, expires_at
		 ) VALUES (?, ?, ?, ?)
		 ON CONFLICT(session_id) DO UPDATE SET
		   updated_at = excluded.updated_at,
		   expires_at = COALESCE(excluded.expires_at, sessions.expires_at)`,
		args: [sessionId, createdAt, createdAt, expiresAt],
	});
	return getSession(sessionId);
}

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
	return result.rows[0] || null;
}

export async function touchSession(sessionId) {
	await db.execute({
		sql: "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = ?",
		args: [sessionId],
	});
	return getSession(sessionId);
}

export async function linkSessionToUser(sessionId, userEmail) {
	await db.execute({
		sql: `UPDATE sessions
		 SET user_email = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE session_id = ?`,
		args: [userEmail, sessionId],
	});
	return getSession(sessionId);
}

export async function clearSessionUser(sessionId) {
	await db.execute({
		sql: `UPDATE sessions
		 SET user_email = NULL, updated_at = CURRENT_TIMESTAMP
		 WHERE session_id = ?`,
		args: [sessionId],
	});
	return getSession(sessionId);
}

export async function deleteSession(sessionId) {
	const result = await db.execute({
		sql: "DELETE FROM sessions WHERE session_id = ?",
		args: [sessionId],
	});
	return Number(result.rowsAffected || 0) > 0;
}

export async function saveOAuthState(state, sessionId, createdAt = Date.now()) {
	await db.execute({
		sql: `INSERT INTO oauth_states (state, session_id, created_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(state) DO UPDATE SET
		   session_id = excluded.session_id,
		   created_at = excluded.created_at`,
		args: [state, sessionId, createdAt],
	});
}

export async function consumeOAuthState(state) {
	const result = await db.execute({
		sql: `SELECT state, session_id AS sessionId, created_at AS createdAt
			 FROM oauth_states
			 WHERE state = ?`,
		args: [state],
	});
	const saved = result.rows[0] || null;
	if (!saved) return null;
	await db.execute({
		sql: "DELETE FROM oauth_states WHERE state = ?",
		args: [state],
	});
	return saved;
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
