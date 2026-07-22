import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { parseBancoChileEmail } from "./parser.js";
import {
	disconnectGoogle,
	getAuthUrl,
	getSessionUserProfile,
	hasGoogleCredentials,
	hasGoogleToken,
	saveTokenFromCode,
} from "./gmail.js";
import {
	clearSessionUser,
	configureOAuthTokenEncryption,
	createSession,
	deleteCounterpartyCategoryRule,
	deleteManualMovement,
	deleteUserCategory,
	ensureDbInitialized,
	getSession,
	hideMovement,
	insertManualMovement,
	listCounterpartyCategoryRules,
	listUserCategories,
	touchSession,
	updateManualMovement,
	upsertCounterpartyCategoryRule,
	upsertUserCategory,
} from "./db.js";
import {
	loadIncomeCandidateMovements,
	loadMovementsForMonthResult,
	normalizeCounterpartyKey,
	saveMovementOverride,
	syncRuntimeMovements,
	toRuntimeMovement,
} from "./movements.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
if (!isLoopbackHost(HOST) && process.env.ALLOW_UNSAFE_HOST !== "true") {
	throw new Error(
		`Refusing to bind to ${HOST}. This app contains local finance/Gmail data. Use HOST=127.0.0.1 or set ALLOW_UNSAFE_HOST=true only if you understand the risk.`,
	);
}
const MAX_BODY_BYTES = 256 * 1024;
const PUBLIC_DIR = join(process.cwd(), "public");
const SESSION_COOKIE_NAME =
	process.env.SESSION_COOKIE_NAME ?? "finance_session";
const SESSION_TTL_DAYS = normalizeSessionTtlDays(
	process.env.SESSION_TTL_DAYS ?? 30,
);
const APP_BASE_URL = process.env.APP_BASE_URL ?? null;

configureOAuthTokenEncryption(process.env);

const DEFAULT_CATEGORIES = [
	{ name: "Supermercado", color: "#16a34a", builtin: true },
	{ name: "Comida", color: "#f97316", builtin: true },
	{ name: "Transporte", color: "#2563eb", builtin: true },
	{ name: "Salud", color: "#dc2626", builtin: true },
	{ name: "Educación", color: "#7c3aed", builtin: true },
	{ name: "Servicios", color: "#0891b2", builtin: true },
	{ name: "Entretenimiento", color: "#db2777", builtin: true },
	{ name: "Ocio", color: "#a855f7", builtin: true },
	{ name: "Hogar", color: "#65a30d", builtin: true },
	{ name: "Transferencias", color: "#64748b", builtin: true },
	{ name: "Suscripciones", color: "#9333ea", builtin: true },
	{ name: "Otros", color: "#475569", builtin: true },
];

const mimeTypes = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

export default async function handleRequest(req, res) {
	try {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		if (isStaticRequest(url.pathname, req.method)) {
			return await serveStatic(url.pathname, res);
		}

		await ensureDbInitialized();
		guardMutationRequest(req);
		const session = await getOrCreateSession(req, res);

		if (url.pathname === "/api/transactions" && req.method === "GET") {
			const user = await getSessionUserProfile(session);
			const month = normalizeMonthParam(url.searchParams.get("month"));
			if (!user?.email) return sendJson(res, { transactions: [] });
			const result = await loadMovementsForMonthResult(user.email, {
				month,
				payTiming: url.searchParams.get("payTiming") ?? "varies",
			});
			return sendJson(res, {
				transactions: result.movements,
				warning: result.warning,
			});
		}

		if (url.pathname === "/api/income-candidates" && req.method === "GET") {
			const user = await getSessionUserProfile(session);
			const month = normalizeMonthParam(url.searchParams.get("month"));
			const payTiming = url.searchParams.get("payTiming") ?? "varies";
			return sendJson(res, {
				candidates: user?.email
					? await loadIncomeCandidateMovements(user.email, { month, payTiming })
					: [],
			});
		}

		if (url.pathname === "/api/transactions" && req.method === "POST") {
			const user = await requireActiveUser(session);
			const body = await readJson(req);
			const transaction = await insertManualMovement(
				createManualTransaction(body),
				user.email,
			);
			return sendJson(res, { transaction }, 201);
		}

		if (url.pathname === "/api/categories" && req.method === "GET") {
			const user = await requireActiveUser(session);
			return sendJson(res, {
				categories: mergeCategories(await listUserCategories(user.email)),
			});
		}

		if (url.pathname === "/api/categories" && req.method === "PUT") {
			const user = await requireActiveUser(session);
			const body = await readJson(req);
			const name = normalizeCategoryName(body.name);
			if (!name) throw httpError(400, "name es obligatorio");
			const color = normalizeCategoryColor(body.color);
			if (!color) throw httpError(400, "color inválido");
			const category = await upsertUserCategory(user.email, { name, color });
			return sendJson(res, { category });
		}

		const categoryMatch = url.pathname.match(/^\/api\/categories\/([^/]+)$/);
		if (categoryMatch && req.method === "DELETE") {
			const user = await requireActiveUser(session);
			const name = normalizeCategoryName(decodeURIComponent(categoryMatch[1]));
			if (!name) throw httpError(400, "name inválido");
			const deleted = await deleteUserCategory(user.email, name);
			if (!deleted) return sendJson(res, { error: "Category not found" }, 404);
			return sendJson(res, { ok: true });
		}

		if (url.pathname === "/api/counterparty-rules" && req.method === "GET") {
			const user = await requireActiveUser(session);
			return sendJson(res, {
				rules: await listCounterpartyCategoryRules(user.email),
			});
		}

		if (url.pathname === "/api/counterparty-rules" && req.method === "PUT") {
			const user = await requireActiveUser(session);
			const body = await readJson(req);
			const counterpartyKey = normalizeCounterpartyKey(body.counterpartyKey);
			if (!counterpartyKey) {
				throw httpError(400, "counterpartyKey es obligatorio");
			}
			const category = String(body.category ?? "").trim();
			if (!category) {
				await deleteCounterpartyCategoryRule(user.email, counterpartyKey);
				return sendJson(res, { ok: true, deleted: true });
			}
			const displayName =
				String(body.displayName ?? "").trim() || counterpartyKey;
			const rule = await upsertCounterpartyCategoryRule(user.email, {
				counterpartyKey,
				displayName,
				category,
			});
			return sendJson(res, { rule });
		}

		const ruleMatch = url.pathname.match(
			/^\/api\/counterparty-rules\/([^/]+)$/,
		);
		if (ruleMatch && req.method === "DELETE") {
			const user = await requireActiveUser(session);
			const counterpartyKey = normalizeCounterpartyKey(
				decodeURIComponent(ruleMatch[1]),
			);
			if (!counterpartyKey)
				return sendJson(res, { error: "counterpartyKey inválido" }, 400);
			const deleted = await deleteCounterpartyCategoryRule(
				user.email,
				counterpartyKey,
			);
			if (!deleted) return sendJson(res, { error: "Rule not found" }, 404);
			return sendJson(res, { ok: true });
		}

		if (url.pathname === "/api/gmail/status" && req.method === "GET") {
			const profile = await getSessionUserProfile(session);
			return sendJson(res, {
				hasCredentials: hasGoogleCredentials(),
				connected: Boolean(
					session.userEmail && (await hasGoogleToken(session.userEmail)),
				),
				activeEmail: profile?.email ?? session.userEmail ?? null,
			});
		}

		if (url.pathname === "/api/gmail/profile" && req.method === "GET") {
			const profile = await getSessionUserProfile(session);
			return sendJson(res, profile ?? { connected: false });
		}

		if (url.pathname === "/api/gmail/disconnect") {
			if (req.method !== "POST") {
				return sendJson(res, { error: "Use POST to disconnect Gmail" }, 405);
			}
			if (session.userEmail) await disconnectGoogle(session.userEmail);
			await clearSessionUser(session.sessionId);
			return sendJson(res, { ok: true });
		}

		if (isAuthPath(url.pathname, "/google") && req.method === "GET") {
			res.writeHead(302, { location: await getAuthUrl(session.sessionId) });
			return res.end();
		}

		if (isAuthPath(url.pathname, "/google/callback") && req.method === "GET") {
			const oauthError = url.searchParams.get("error");
			if (oauthError) throw httpError(400, `Google OAuth error: ${oauthError}`);
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			if (!code) throw httpError(400, "Missing OAuth code");
			const result = await saveTokenFromCode(code, state);
			if (result.sessionId === session.sessionId) {
				refreshSessionCookie(
					res,
					session.sessionId,
					session.expiresAt,
					new Date(),
				);
			}
			res.writeHead(302, { location: "/?gmail=connected" });
			return res.end();
		}

		if (url.pathname === "/api/gmail/sync" && req.method === "POST") {
			const user = await requireActiveUser(session);
			const body = await readJson(req);
			const result = await syncGmail(body, user.email);
			return sendJson(res, result);
		}

		if (url.pathname === "/api/parse" && req.method === "POST") {
			await requireActiveUser(session);
			const body = await readJson(req);
			const parsed = parseBancoChileEmail(body.rawEmail, {
				subject: body.subject,
			});
			const transaction = toRuntimeMovement({
				...parsed,
				source: "manual_email_parse",
				sourceId: parsed.sourceId,
			});
			return sendJson(res, { transaction, parsed });
		}

		const updateMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
		if (updateMatch && req.method === "PATCH") {
			const user = await requireActiveUser(session);
			const body = await readJson(req);
			const movementId = decodeURIComponent(updateMatch[1]);
			const patch = sanitizePatch(body);
			const transaction = movementId.startsWith("manual_")
				? await updateManualMovement(movementId, patch, user.email)
				: await saveExistingMovementOverride(user.email, movementId, patch, {
						month: normalizeMonthParam(
							url.searchParams.get("month") ?? body.month,
						),
						payTiming: body.payTiming,
					});
			if (!transaction)
				return sendJson(res, { error: "Transaction not found" }, 404);
			return sendJson(res, { transaction });
		}

		if (updateMatch && req.method === "DELETE") {
			const user = await requireActiveUser(session);
			const body = await readOptionalJson(req);
			const movementId = decodeURIComponent(updateMatch[1]);
			const deleted = movementId.startsWith("manual_")
				? await deleteManualMovement(movementId, user.email)
				: await hideExistingMovement(user.email, movementId, {
						month: normalizeMonthParam(
							url.searchParams.get("month") ?? body.month,
						),
						payTiming: body.payTiming,
					});
			if (!deleted)
				return sendJson(res, { error: "Transaction not found" }, 404);
			return sendJson(res, { ok: true });
		}

		return await serveStatic(url.pathname, res);
	} catch (error) {
		if (error.status)
			return sendJson(res, { error: error.message }, error.status);
		console.error(error);
		return sendJson(res, { error: "Internal server error" }, 500);
	}
}

if (process.env.VERCEL !== "1") {
	const server = createServer(handleRequest);
	server.listen(PORT, HOST, () => {
		process.stdout.write(`Finance MVP running at http://${HOST}:${PORT}\n`);
	});
}

async function readJson(req) {
	if (!String(req.headers["content-type"] ?? "").includes("application/json")) {
		throw httpError(415, "Content-Type must be application/json");
	}
	return readJsonBody(req);
}

async function readOptionalJson(req) {
	const contentType = String(req.headers["content-type"] ?? "");
	if (contentType && !contentType.includes("application/json")) {
		throw httpError(415, "Content-Type must be application/json");
	}
	return readJsonBody(req);
}

async function readJsonBody(req) {
	const chunks = [];
	let size = 0;

	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES)
			throw httpError(413, "Request body is too large");
		chunks.push(chunk);
	}

	const raw = Buffer.concat(chunks).toString("utf8");
	try {
		return raw ? JSON.parse(raw) : {};
	} catch {
		throw httpError(400, "Invalid JSON body");
	}
}

async function syncGmail(body, userEmail) {
	const limit = Math.min(Math.max(Number(body.limit ?? 200), 1), 200);
	return syncRuntimeMovements(userEmail, {
		limit,
		month: normalizeMonthParam(body.month),
		payTiming: body.payTiming,
	});
}

async function saveExistingMovementOverride(
	userEmail,
	movementId,
	patch,
	options,
) {
	if (!(await runtimeMovementExists(userEmail, movementId, options)))
		return null;
	return await saveMovementOverride(userEmail, movementId, patch);
}

async function hideExistingMovement(userEmail, movementId, options) {
	if (!(await runtimeMovementExists(userEmail, movementId, options)))
		return false;
	await hideMovement(userEmail, movementId);
	return true;
}

async function runtimeMovementExists(userEmail, movementId, options) {
	const result = await loadMovementsForMonthResult(userEmail, options);
	return result.movements.some((movement) => movement.id === movementId);
}

function createManualTransaction(body) {
	const amount = Number(body.amount);
	if (!Number.isFinite(amount) || amount <= 0)
		throw httpError(400, "Amount must be greater than 0");
	if (!body.occurredAt) throw httpError(400, "Date is required");
	const kind = body.kind || "purchase";

	return {
		source: "manual",
		sourceId: `manual:${randomUUID()}`,
		occurredAt: normalizeDateTime(body.occurredAt),
		amount: Math.round(amount),
		currency: "CLP",
		direction: body.direction || (kind === "income" ? "inflow" : "outflow"),
		kind,
		counterparty: body.counterparty || null,
		description: body.description || null,
		category: body.category || null,
		confidence: 1,
		status: "manual",
		rawPreview: null,
	};
}

function sanitizePatch(body) {
	const patch = {};
	for (const key of [
		"occurredAt",
		"direction",
		"kind",
		"counterparty",
		"description",
		"category",
		"status",
	]) {
		if (Object.hasOwn(body, key))
			patch[key] = body[key] === "" ? null : body[key];
	}
	if (Object.hasOwn(body, "amount")) {
		if (
			body.amount === "" ||
			body.amount === null ||
			body.amount === undefined
		) {
			patch.amount = null;
		} else {
			const amount = Number(body.amount);
			if (!Number.isFinite(amount) || amount < 0)
				throw httpError(400, "Invalid amount");
			patch.amount = Math.round(amount);
		}
	}
	return patch;
}

async function requireActiveUser(session) {
	const profile = await getSessionUserProfile(session);
	if (!profile?.email) throw httpError(401, "Connect Gmail first");
	return profile;
}

function normalizeMonthParam(value) {
	if (value === null || value === undefined || value === "")
		return currentMonthKey();
	const month = String(value);
	const match = month.match(/^(\d{4})-(\d{2})$/);
	if (!match) throw httpError(400, "Invalid month. Use YYYY-MM.");
	const monthNumber = Number(match[2]);
	if (monthNumber < 1 || monthNumber > 12) {
		throw httpError(400, "Invalid month. Month must be between 01 and 12.");
	}
	return month;
}

function currentMonthKey() {
	const today = new Date();
	return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

async function serveStatic(pathname, res) {
	const requested = pathname === "/" ? "/index.html" : pathname;
	const safePath = normalize(requested).replace(/^\.\.(?:\/|$)/, "");
	const fullPath = join(PUBLIC_DIR, safePath);

	try {
		await access(fullPath);
	} catch {
		throw httpError(404, "Not found");
	}

	const content = await readFile(fullPath);
	const type = mimeTypes[extname(fullPath)] ?? "application/octet-stream";
	res.writeHead(200, { "content-type": type });
	res.end(content);
}

function normalizeDateTime(value) {
	return String(value).length === 16 ? `${value}:00` : String(value);
}

function guardMutationRequest(req) {
	if (!["POST", "PATCH", "DELETE"].includes(req.method ?? "")) return;

	const secFetchSite = req.headers["sec-fetch-site"];
	if (secFetchSite && !["same-origin", "none"].includes(secFetchSite)) {
		throw httpError(403, "Cross-site requests are not allowed");
	}

	const origin = req.headers.origin;
	if (!origin) return;
	const parsed = parseUrl(origin);
	if (!parsed) throw httpError(403, "Cross-origin requests are not allowed");
	if (APP_BASE_URL || process.env.VERCEL_URL) {
		const allowedOrigins = configuredAllowedOrigins();
		if (!allowedOrigins.has(parsed.origin)) {
			throw httpError(403, "Cross-origin requests are not allowed");
		}
		return;
	}
	if (!isLoopbackHost(parsed.hostname) || parsed.port !== String(PORT)) {
		throw httpError(403, "Cross-origin requests are not allowed");
	}
}

function mergeCategories(customCategories = []) {
	const merged = new Map(
		DEFAULT_CATEGORIES.map((category) => [
			normalizeCategoryName(category.name).toLowerCase(),
			{ ...category },
		]),
	);
	for (const category of customCategories) {
		const name = normalizeCategoryName(category.name);
		if (!name) continue;
		const key = name.toLowerCase();
		const existing = merged.get(key);
		merged.set(key, {
			name,
			color:
				normalizeCategoryColor(category.color) || existing?.color || "#64748b",
			builtin: false,
		});
	}
	return [...merged.values()].sort((a, b) =>
		a.name.localeCompare(b.name, "es"),
	);
}

function normalizeCategoryName(value) {
	return String(value ?? "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 40);
}

function normalizeCategoryColor(value) {
	const normalized = String(value ?? "").trim();
	return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "";
}

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function isLoopbackHost(host) {
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function configuredAllowedOrigins() {
	return new Set(
		[APP_BASE_URL, vercelUrl()]
			.filter(Boolean)
			.map(parseUrl)
			.filter(Boolean)
			.map((url) => url.origin),
	);
}

function parseUrl(value) {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function vercelUrl() {
	return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
}

function isStaticRequest(pathname, method) {
	return (
		method === "GET" &&
		!pathname.startsWith("/api/") &&
		!pathname.startsWith("/auth/")
	);
}

function isAuthPath(pathname, suffix) {
	return pathname === `/auth${suffix}` || pathname === `/api/auth${suffix}`;
}

function sendJson(res, payload, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
}

export function normalizeSessionTtlDays(value) {
	const days = Number(value);
	if (!Number.isFinite(days) || days < 1 || days > 3650) {
		throw new Error(
			"SESSION_TTL_DAYS must be a finite number between 1 and 3650",
		);
	}
	return days;
}

export function classifySessionExpiry(session, now = new Date()) {
	const expiresAt = session?.expiresAt;
	if (typeof expiresAt !== "string" || expiresAt.trim() === "") {
		return "indeterminate";
	}
	const expiryMs = Date.parse(expiresAt);
	const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
	if (
		!Number.isFinite(expiryMs) ||
		new Date(expiryMs).toISOString() !== expiresAt ||
		!Number.isFinite(nowMs)
	) {
		return "indeterminate";
	}
	return expiryMs > nowMs ? "valid" : "expired";
}

export function sessionCookieMaxAge(expiresAt, now = new Date()) {
	const expiryMs = Date.parse(expiresAt);
	const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
	if (!Number.isFinite(expiryMs) || !Number.isFinite(nowMs)) return 0;
	return Math.max(Math.floor((expiryMs - nowMs) / 1000), 0);
}

export async function getOrCreateSession(req, res, now = new Date()) {
	const cookies = parseCookies(req.headers.cookie ?? "");
	const fromCookie = cookies[SESSION_COOKIE_NAME];
	if (fromCookie) {
		const existing = await getSession(fromCookie);
		if (existing && classifySessionExpiry(existing, now) === "valid") {
			await touchSession(fromCookie);
			refreshSessionCookie(res, fromCookie, existing.expiresAt, now);
			return { ...existing, sessionId: fromCookie };
		}
		clearSessionCookie(res);
	}

	const sessionId = randomUUID();
	const expiresAt = new Date(
		now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();
	const created = await createSession(sessionId, expiresAt, now.toISOString());
	refreshSessionCookie(res, sessionId, expiresAt, now);
	return { ...created, sessionId };
}

function refreshSessionCookie(res, sessionId, expiresAt, now) {
	setSessionCookie(
		res,
		`${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
		sessionCookieMaxAge(expiresAt, now),
	);
}

function clearSessionCookie(res) {
	setSessionCookie(res, `${SESSION_COOKIE_NAME}=`, 0);
}

function setSessionCookie(res, nameValue, maxAgeSeconds) {
	const secure =
		process.env.COOKIE_SECURE === "true" ||
		process.env.NODE_ENV === "production";
	const cookie = [
		nameValue,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAgeSeconds}`,
		secure ? "Secure" : null,
	]
		.filter(Boolean)
		.join("; ");
	const existing = res.getHeader?.("Set-Cookie");
	res.setHeader(
		"Set-Cookie",
		existing ? [...[].concat(existing), cookie] : cookie,
	);
}

function parseCookies(cookieHeader) {
	const parsed = {};
	for (const part of String(cookieHeader).split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (!key) continue;
		parsed[key] = decodeURIComponent(value.join("=") || "");
	}
	return parsed;
}
