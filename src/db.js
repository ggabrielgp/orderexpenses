import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";


const dbPath = process.env.DB_PATH ?? join(process.cwd(), "data", "finance.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

ensurePrivacyTables();
ensureAuthTables();

export function listManualMovements(userEmail, month = monthKey(new Date())) {
	const { start, end } = monthRange(month);
	return db
		.prepare(`
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
    `)
		.all(userEmail, start, end)
		.map((movement) => ({ ...movement, isManual: true }));
}

export function insertManualMovement(input, userEmail) {
	const movementKey = input.movementKey ?? `manual_${cryptoRandomId()}`;
	db.prepare(`
    INSERT INTO manual_movements (
      movement_key, user_email, source, source_id, occurred_at, amount, currency,
      direction, kind, counterparty, description, category, confidence, status, raw_preview
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
	);
	return getManualMovement(movementKey, userEmail);
}

export function getManualMovement(movementKey, userEmail) {
	return db
		.prepare(`
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
    `)
		.get(movementKey, userEmail);
}

export function updateManualMovement(movementKey, patch, userEmail) {
	const current = getManualMovement(movementKey, userEmail);
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
	db.prepare(`
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
  `).run(
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
	);
	return getManualMovement(movementKey, userEmail);
}

export function deleteManualMovement(movementKey, userEmail) {
	const result = db
		.prepare(
			"DELETE FROM manual_movements WHERE movement_key = ? AND user_email = ?",
		)
		.run(movementKey, userEmail);
	return result.changes > 0;
}

export function getOverrides(userEmail) {
	return db
		.prepare(`
      SELECT movement_key AS movementKey, patch_json AS patchJson, hidden
      FROM movement_overrides
      WHERE user_email = ?
    `)
		.all(userEmail)
		.map((row) => ({
			movementKey: row.movementKey,
			patch: safeJson(row.patchJson),
			hidden: Boolean(row.hidden),
		}));
}

export function upsertMovementOverride(
	userEmail,
	movementKey,
	patch = {},
	hidden = false,
) {
	const current = db
		.prepare(
			"SELECT patch_json AS patchJson, hidden FROM movement_overrides WHERE user_email = ? AND movement_key = ?",
		)
		.get(userEmail, movementKey);
	const nextPatch = {
		...(current ? safeJson(current.patchJson) : {}),
		...patch,
	};
	const nextHidden = hidden || Boolean(current?.hidden);
	db.prepare(`
    INSERT INTO movement_overrides (user_email, movement_key, patch_json, hidden)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_email, movement_key) DO UPDATE SET
      patch_json = excluded.patch_json,
      hidden = excluded.hidden,
      updated_at = CURRENT_TIMESTAMP
  `).run(userEmail, movementKey, JSON.stringify(nextPatch), nextHidden ? 1 : 0);
	return { movementKey, patch: nextPatch, hidden: nextHidden };
}

export function hideMovement(userEmail, movementKey) {
	return upsertMovementOverride(userEmail, movementKey, {}, true);
}

export function listCounterpartyCategoryRules(userEmail) {
	return db
		.prepare(
			`SELECT
				counterparty_key AS counterpartyKey,
				display_name AS displayName,
				category,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM counterparty_category_rules
			WHERE user_email = ?
			ORDER BY updated_at DESC, counterparty_key ASC`,
		)
		.all(userEmail);
}

export function upsertCounterpartyCategoryRule(
	userEmail,
	{ counterpartyKey, displayName, category },
) {
	db.prepare(
		`INSERT INTO counterparty_category_rules (
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
	).run(userEmail, counterpartyKey, displayName, category);
	return db
		.prepare(
			`SELECT
				counterparty_key AS counterpartyKey,
				display_name AS displayName,
				category,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM counterparty_category_rules
			WHERE user_email = ? AND counterparty_key = ?`,
		)
		.get(userEmail, counterpartyKey);
}

export function deleteCounterpartyCategoryRule(userEmail, counterpartyKey) {
	const result = db
		.prepare(
			"DELETE FROM counterparty_category_rules WHERE user_email = ? AND counterparty_key = ?",
		)
		.run(userEmail, counterpartyKey);
	return result.changes > 0;
}

export function listUserCategories(userEmail) {
	return db
		.prepare(
			`SELECT
				name,
				color,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM categories
			WHERE user_email = ?
			ORDER BY name COLLATE NOCASE ASC`,
		)
		.all(userEmail);
}

export function upsertUserCategory(userEmail, { name, color }) {
	const normalizedName = normalizeCategoryName(name);
	const normalizedColor = normalizeCategoryColor(color);
	db.prepare(
		`INSERT INTO categories (user_email, name, color)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_email, name) DO UPDATE SET
		   color = excluded.color,
		   updated_at = CURRENT_TIMESTAMP`,
	).run(userEmail, normalizedName, normalizedColor);
	return db
		.prepare(
			`SELECT
				name,
				color,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM categories
			WHERE user_email = ? AND name = ?`,
		)
		.get(userEmail, normalizedName);
}

export function deleteUserCategory(userEmail, name) {
	const normalizedName = normalizeCategoryName(name);
	if (!normalizedName) return false;
	const result = db
		.prepare("DELETE FROM categories WHERE user_email = ? AND name = ?")
		.run(userEmail, normalizedName);
	return result.changes > 0;
}

export function createSession(sessionId, expiresAt = null) {
	db.prepare(
		`INSERT INTO sessions (session_id, expires_at)
		 VALUES (?, ?)
		 ON CONFLICT(session_id) DO UPDATE SET
		   updated_at = CURRENT_TIMESTAMP,
		   expires_at = COALESCE(excluded.expires_at, sessions.expires_at)`,
	).run(sessionId, expiresAt);
	return getSession(sessionId);
}

export function getSession(sessionId) {
	return db
		.prepare(
			`SELECT
				session_id AS sessionId,
				user_email AS userEmail,
				created_at AS createdAt,
				updated_at AS updatedAt,
				expires_at AS expiresAt
			FROM sessions
			WHERE session_id = ?`,
		)
		.get(sessionId);
}

export function touchSession(sessionId) {
	db.prepare(
		"UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = ?",
	).run(sessionId);
	return getSession(sessionId);
}

export function linkSessionToUser(sessionId, userEmail) {
	db.prepare(
		`UPDATE sessions
		 SET user_email = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE session_id = ?`,
	).run(userEmail, sessionId);
	return getSession(sessionId);
}

export function clearSessionUser(sessionId) {
	db.prepare(
		`UPDATE sessions
		 SET user_email = NULL, updated_at = CURRENT_TIMESTAMP
		 WHERE session_id = ?`,
	).run(sessionId);
	return getSession(sessionId);
}

export function deleteSession(sessionId) {
	const result = db
		.prepare("DELETE FROM sessions WHERE session_id = ?")
		.run(sessionId);
	return result.changes > 0;
}

export function saveOAuthState(state, sessionId, createdAt = Date.now()) {
	db.prepare(
		`INSERT INTO oauth_states (state, session_id, created_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(state) DO UPDATE SET
		   session_id = excluded.session_id,
		   created_at = excluded.created_at`,
	).run(state, sessionId, createdAt);
}

export function consumeOAuthState(state) {
	const saved = db
		.prepare(
			`SELECT state, session_id AS sessionId, created_at AS createdAt
			 FROM oauth_states
			 WHERE state = ?`,
		)
		.get(state);
	if (!saved) return null;
	db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
	return saved;
}

export function upsertGoogleToken(userEmail, token) {
	db.prepare(
		`INSERT INTO google_tokens (user_email, token_json)
		 VALUES (?, ?)
		 ON CONFLICT(user_email) DO UPDATE SET
		   token_json = excluded.token_json,
		   updated_at = CURRENT_TIMESTAMP`,
	).run(userEmail, JSON.stringify(token));
}

export function getGoogleToken(userEmail) {
	const row = db
		.prepare(
			"SELECT token_json AS tokenJson FROM google_tokens WHERE user_email = ?",
		)
		.get(userEmail);
	return row ? safeJson(row.tokenJson) : null;
}

export function deleteGoogleToken(userEmail) {
	const result = db
		.prepare("DELETE FROM google_tokens WHERE user_email = ?")
		.run(userEmail);
	return result.changes > 0;
}

export function upsertGoogleProfile(userEmail, profile) {
	db.prepare(
		`INSERT INTO google_tokens (user_email, token_json, profile_json)
		 VALUES (?, ?, ?)
		 ON CONFLICT(user_email) DO UPDATE SET
		   profile_json = excluded.profile_json,
		   updated_at = CURRENT_TIMESTAMP`,
	).run(
		userEmail,
		JSON.stringify(getGoogleToken(userEmail) || {}),
		JSON.stringify(profile),
	);
}

export function getGoogleProfile(userEmail) {
	const row = db
		.prepare(
			"SELECT profile_json AS profileJson FROM google_tokens WHERE user_email = ?",
		)
		.get(userEmail);
	if (!row?.profileJson) return null;
	const parsed = safeJson(row.profileJson);
	return parsed?.email ? parsed : null;
}

export function deleteGoogleProfile(userEmail) {
	db.prepare(
		`UPDATE google_tokens
		 SET profile_json = NULL,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE user_email = ?`,
	).run(userEmail);
}

function ensurePrivacyTables() {
	db.exec(`
    CREATE TABLE IF NOT EXISTS movement_overrides (
      user_email TEXT NOT NULL,
      movement_key TEXT NOT NULL,
      patch_json TEXT NOT NULL DEFAULT '{}',
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_email, movement_key)
    );

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
    );

    CREATE TABLE IF NOT EXISTS counterparty_category_rules (
      user_email TEXT NOT NULL,
      counterparty_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_email, counterparty_key)
    );

    CREATE TABLE IF NOT EXISTS categories (
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_email, name)
    );
  `);
}

function ensureAuthTables() {
	db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_email TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_tokens (
      user_email TEXT PRIMARY KEY,
      token_json TEXT NOT NULL DEFAULT '{}',
      profile_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
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

function incomeCandidateRange(payTiming, monthValue) {
	const timing = normalizePayTiming(payTiming);
	const referenceDate = parseMonth(monthValue);
	const year = referenceDate.getFullYear();
	const month = referenceDate.getMonth();
	let startDate;
	let endDate;

	if (timing === "first_week") {
		startDate = new Date(year, month, 1);
		endDate = new Date(year, month, 8);
	} else if (timing === "mid_month") {
		startDate = new Date(year, month, 8);
		endDate = new Date(year, month, 22);
	} else if (timing === "last_week") {
		startDate = new Date(year, month, -6);
		endDate = new Date(year, month, 1);
	} else {
		startDate = new Date(year, month, -6);
		endDate = new Date(year, month + 1, 1);
	}

	return {
		start: formatDateTimeForDb(startDate),
		end: formatDateTimeForDb(endDate),
	};
}

function normalizePayTiming(payTiming) {
	return ["first_week", "mid_month", "last_week", "varies"].includes(payTiming)
		? payTiming
		: "varies";
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
