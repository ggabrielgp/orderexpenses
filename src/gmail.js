import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { google } from "googleapis";

import {
	consumeOAuthState,
	getGoogleProfile,
	getGoogleToken,
	linkSessionToUser,
	saveOAuthState,
	upsertGoogleProfile,
	upsertGoogleToken,
	deleteGoogleToken,
	deleteGoogleProfile,
} from "./db.js";

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/userinfo.email",
];
const BANCO_CHILE_SENDER_FILTER =
	"from:(enviodigital@bancochile.cl OR serviciodetransferencias@bancochile.cl)";
const BANCO_CHILE_EXPENSE_FILTER =
	'(subject:("Transferencia a Terceros" OR "Cargo en Cuenta") OR "se ha realizado una compra" OR "Transferencia a terceros")';
const BANCO_CHILE_INCOME_FILTER =
	'(subject:("Transferencia recibida" OR "Abono recibido" OR "Depósito recibido" OR "Deposito recibido") OR ("has recibido" "transferencia") OR ("recibiste" "transferencia") OR "abono recibido" OR "abono en tu cuenta" OR "abono a tu cuenta" OR "depósito recibido" OR "deposito recibido")';
const DEFAULT_LIMIT = 200;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

const credentialsPath =
	process.env.GOOGLE_CREDENTIALS_PATH ??
	join(process.cwd(), "data", "google-credentials.json");

export function hasGoogleCredentials() {
	return hasGoogleCredentialsEnv() || existsSync(credentialsPath);
}

export async function hasGoogleToken(userEmail) {
	if (!userEmail) return false;
	const token = await getGoogleToken(userEmail);
	return Boolean(token?.access_token || token?.refresh_token);
}

export async function disconnectGoogle(userEmail) {
	if (!userEmail) return;
	await deleteGoogleToken(userEmail);
	await deleteGoogleProfile(userEmail);
}

export async function createOAuthClient(userEmail = null) {
	const clientConfig = loadGoogleClientConfig();
	const redirectUri = pickRedirectUri(clientConfig.redirect_uris ?? []);
	const client = new google.auth.OAuth2(
		clientConfig.client_id,
		clientConfig.client_secret,
		redirectUri,
	);

	if (userEmail) {
		const token = await getGoogleToken(userEmail);
		if (token && (token.access_token || token.refresh_token)) {
			client.setCredentials(token);
		}
	}

	if (userEmail) {
		client.on("tokens", (tokens) => {
			saveTokenForUser(userEmail, tokens).catch((error) => {
				console.error("Failed to persist refreshed OAuth token", error);
			});
		});
	}

	return client;
}

export async function getAuthUrl(sessionId) {
	if (!sessionId) {
		const error = new Error("Session is required for OAuth flow");
		error.status = 400;
		throw error;
	}
	const client = await createOAuthClient();
	const state = randomBytes(32).toString("hex");
	await saveOAuthState(state, sessionId, Date.now());
	return client.generateAuthUrl({
		access_type: "offline",
		prompt: "consent",
		scope: SCOPES,
		state,
	});
}

export async function saveTokenFromCode(code, state) {
	const oauthState = await verifyOAuthState(state);
	const client = await createOAuthClient();
	const { tokens } = await client.getToken(code);
	client.setCredentials(tokens);
	const profile = await fetchUserProfileFromClient(client);
	await saveTokenForUser(profile.email, tokens);
	await upsertGoogleProfile(profile.email, profile);
	await linkSessionToUser(oauthState.sessionId, profile.email);
	return { profile, sessionId: oauthState.sessionId };
}

export async function getProfile(userEmail) {
	if (!userEmail) return null;
	return getGoogleProfile(userEmail);
}

export async function fetchUserProfile(userEmail) {
	if (!userEmail || !(await hasGoogleToken(userEmail))) return null;
	const client = await createOAuthClient(userEmail);
	const profile = await fetchUserProfileFromClient(client);
	await upsertGoogleProfile(userEmail, profile);
	if (profile.email && profile.email !== userEmail) {
		const token = await getGoogleToken(userEmail);
		if (token) {
			await upsertGoogleToken(profile.email, token);
			await deleteGoogleToken(userEmail);
		}
		await upsertGoogleProfile(profile.email, profile);
		await deleteGoogleProfile(userEmail);
	}
	return profile;
}

export async function getSessionUserProfile(session) {
	if (!session?.userEmail) return null;
	const saved = await getProfile(session.userEmail);
	if (saved?.email) return saved;
	if (!(await hasGoogleToken(session.userEmail))) return null;
	return fetchUserProfile(session.userEmail);
}

export async function listBancoChileEmails(
	userEmail,
	{ limit = DEFAULT_LIMIT, month, payTiming = "varies" } = {},
) {
	const client = await createOAuthClient(userEmail);
	if (!(await hasGoogleToken(userEmail))) {
		const error = new Error("Gmail is not connected yet");
		error.status = 401;
		throw error;
	}

	const queries = bancoChileQueriesForPayTiming(payTiming, month);
	const gmail = google.gmail({ version: "v1", auth: client });
	const messagesById = new Map();

	for (const query of queries) {
		const messages = await listMessagesForQuery(gmail, query, limit);
		for (const message of messages) {
			if (message.id) messagesById.set(message.id, message);
		}
	}

	const emails = [];
	for (const message of messagesById.values()) {
		const detail = await gmail.users.messages.get({
			userId: "me",
			id: message.id,
			format: "full",
		});
		emails.push(toEmailInput(detail.data));
	}

	return { emails, query: queries.join(" OR ") };
}

async function listMessagesForQuery(gmail, query, limit) {
	const messages = [];
	let pageToken;
	const cap = Math.max(Number(limit) || DEFAULT_LIMIT, 1);

	do {
		const remaining = cap - messages.length;
		const list = await gmail.users.messages.list({
			userId: "me",
			q: query,
			maxResults: Math.min(remaining, 100),
			pageToken,
		});
		messages.push(...(list.data.messages ?? []));
		pageToken = list.data.nextPageToken;
	} while (pageToken && messages.length < cap);

	return messages;
}

async function verifyOAuthState(receivedState) {
	if (!receivedState) {
		const error = new Error("Invalid OAuth state");
		error.status = 400;
		throw error;
	}
	const saved = await consumeOAuthState(receivedState);
	if (!saved) {
		const error = new Error("Invalid OAuth state");
		error.status = 400;
		throw error;
	}
	const stateFresh =
		Date.now() - Number(saved.createdAt ?? 0) < OAUTH_STATE_MAX_AGE_MS;
	if (!stateFresh) {
		const error = new Error("Invalid OAuth state");
		error.status = 400;
		throw error;
	}
	return saved;
}

async function saveTokenForUser(userEmail, tokens) {
	const current = (await getGoogleToken(userEmail)) || {};
	const merged = { ...current, ...tokens };
	if (!merged.refresh_token && current.refresh_token) {
		merged.refresh_token = current.refresh_token;
	}
	await upsertGoogleToken(userEmail, merged);
}

async function fetchUserProfileFromClient(client) {
	const oauth2 = google.oauth2({ version: "v2", auth: client });
	const { data } = await oauth2.userinfo.get();
	return {
		name: data.name ?? "",
		email: data.email ?? "",
		picture: data.picture ?? "",
	};
}

function bancoChileQueriesForPayTiming(payTiming = "varies", month) {
	const referenceDate = parseMonth(month);
	const expenseRange = currentMonthRange(referenceDate);
	const incomeRange = incomeCandidateRange(payTiming, referenceDate);

	return [
		bancoChileQuery(BANCO_CHILE_EXPENSE_FILTER, expenseRange),
		bancoChileQuery(BANCO_CHILE_INCOME_FILTER, incomeRange),
	];
}

function bancoChileQuery(filter, { start, end }) {
	return `${BANCO_CHILE_SENDER_FILTER} ${filter} after:${formatGmailDate(start)} before:${formatGmailDate(end)}`;
}

function currentMonthRange(referenceDate) {
	return {
		start: new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1),
		end: new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1),
	};
}

function incomeCandidateRange(payTiming, referenceDate) {
	const year = referenceDate.getFullYear();
	const month = referenceDate.getMonth();

	if (payTiming === "first_week") {
		return { start: new Date(year, month, 1), end: new Date(year, month, 8) };
	}
	if (payTiming === "mid_month") {
		return { start: new Date(year, month, 8), end: new Date(year, month, 22) };
	}
	if (payTiming === "last_week") {
		return { start: new Date(year, month, -6), end: new Date(year, month, 1) };
	}
	return {
		start: new Date(year, month, -6),
		end: new Date(year, month + 1, 1),
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

function formatGmailDate(date) {
	return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function toEmailInput(message) {
	const headers = message.payload?.headers ?? [];
	const subject =
		headers.find((header) => header.name?.toLowerCase() === "subject")?.value ??
		"";
	const from =
		headers.find((header) => header.name?.toLowerCase() === "from")?.value ??
		"";
	const internalDate = message.internalDate
		? new Date(Number(message.internalDate)).toISOString()
		: null;
	const body = extractBody(message.payload) || message.snippet || "";

	return {
		gmailId: message.id,
		threadId: message.threadId,
		subject,
		from,
		internalDate,
		body,
	};
}

function extractBody(payload) {
	const preferred =
		findPart(payload, "text/html") ??
		findPart(payload, "text/plain") ??
		payload;
	return decodeBody(preferred?.body?.data);
}

function findPart(part, mimeType) {
	if (!part) return null;
	if (part.mimeType === mimeType && part.body?.data) return part;
	for (const child of part.parts ?? []) {
		const found = findPart(child, mimeType);
		if (found) return found;
	}
	return null;
}

function decodeBody(data) {
	if (!data) return "";
	return Buffer.from(
		data.replace(/-/g, "+").replace(/_/g, "/"),
		"base64",
	).toString("utf8");
}

function loadGoogleClientConfig() {
	if (hasGoogleCredentialsEnv()) {
		return {
			client_id: process.env.GOOGLE_CLIENT_ID,
			client_secret: process.env.GOOGLE_CLIENT_SECRET,
			redirect_uris: [process.env.GOOGLE_REDIRECT_URI].filter(Boolean),
		};
	}

	if (!existsSync(credentialsPath)) {
		const error = new Error(
			`Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or save credentials at ${credentialsPath}`,
		);
		error.status = 400;
		throw error;
	}

	const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
	const clientConfig = credentials.installed ?? credentials.web;
	if (!clientConfig) {
		const error = new Error(
			"Invalid Google credentials file: expected installed or web OAuth client",
		);
		error.status = 400;
		throw error;
	}
	return clientConfig;
}

function hasGoogleCredentialsEnv() {
	return Boolean(
		process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
	);
}

function pickRedirectUri(uris) {
	if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
	return (
		uris.find((uri) => uri.includes("127.0.0.1:3000")) ??
		uris.find((uri) => uri.includes("localhost:3000")) ??
		uris[0]
	);
}
