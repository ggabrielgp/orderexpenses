import { after, mock } from "node:test";
import fs, { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import dgram from "node:dgram";
import { google } from "./fixtures.js";

// Risky tests import this before dynamically importing application modules. A raw
// `node --test` therefore fails closed instead of opening the default finance database.
if (typeof mock.module !== "function") {
	throw new Error("Test isolation requires npm test (--experimental-test-module-mocks)");
}
const temporaryDirectory = fileURLToPath(new URL("../../node_modules/.tmp/", import.meta.url));
mkdirSync(temporaryDirectory, { recursive: true });
const path = process.env.PATH;
// Keep only the native Windows infrastructure needed by nested Node processes.
const systemRoot = process.platform === "win32" ? process.env.SystemRoot : undefined;
// Node's test-worker protocol is infrastructure, not application configuration.
const testContext = process.env.NODE_TEST_CONTEXT;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, {
	PATH: path,
	...(systemRoot ? { SystemRoot: systemRoot } : {}),
	HOME: temporaryDirectory,
	TMPDIR: temporaryDirectory,
	LANG: "C.UTF-8",
	TZ: "UTC",
	NODE_ENV: "test",
	TURSO_DATABASE_URL: "file::memory:",
	DB_PATH: `${temporaryDirectory}/unused.db`,
	GOOGLE_CLIENT_ID: "test-client-id",
	GOOGLE_CLIENT_SECRET: "test-client-secret",
	GOOGLE_REDIRECT_URI: "http://localhost:3000/auth/google/callback",
	GOOGLE_CREDENTIALS_PATH: `${temporaryDirectory}/unused-google-credentials.json`,
	VERCEL: "1",
	HOST: "127.0.0.1",
	PORT: "3000",
	SESSION_COOKIE_NAME: "finance_session",
	SESSION_TTL_DAYS: "30",
	COOKIE_SECURE: "false",
	APP_BASE_URL: "http://localhost:3000",
});
if (testContext) process.env.NODE_TEST_CONTEXT = testContext;

// Defense in depth for Node fs consumers, installed before Vite/application imports.
// This is not an OS sandbox: it protects named env files and known Google credential
// files, not arbitrary native code, aliased paths or already-open descriptors.
export function guardSensitiveFileReader(reader) {
	return function (file, ...args) {
		const name = basename(file instanceof URL ? fileURLToPath(file) : String(file));
		if (/^\.env(?:\.|$)/.test(name) ||
			["google-credentials.json", "credentials.json", "application_default_credentials.json"].includes(name)) {
			throw new Error("Test isolation denies environment/credential-file reads");
		}
		return reader.call(this, file, ...args);
	};
}
for (const name of ["readFileSync", "readFile", "openSync", "open", "createReadStream"]) {
	fs[name] = guardSensitiveFileReader(fs[name]);
}
for (const name of ["readFile", "open"]) {
	const guarded = guardSensitiveFileReader(fs.promises[name]);
	fs.promises[name] = async (...args) => guarded(...args);
}

const clients = new Set();
export function closeDatabaseClients() {
	for (const client of clients) client.close();
	clients.clear();
}
export function guardDatabaseFactory(factory) {
	return (options) => {
		if (options?.url !== "file::memory:" || options.authToken != null) {
			throw new Error("Test isolation permits only unauthenticated file::memory: databases");
		}
		const client = factory(options);
		clients.add(client);
		return client;
	};
}

// Only this complete reserved SQL expression is a controlled-clock seam.
// Production evaluates native SQL time; isolated memory tests sample Date.now
// when the local SDK reads a statement's SQL inside its execution loop.
const oauthClockMarker = "/* oauth-clock-ms */";
const oauthClockSql = "CAST(ROUND(unixepoch('now', 'subsec') * 1000) AS INTEGER) /* oauth-clock-ms */";

function substituteOAuthClock(sql) {
	let output = "";
	let cursor = 0;
	let sampled;
	while (cursor < sql.length) {
		if (sql.startsWith(oauthClockSql, cursor) && (cursor === 0 || !/[\w$]/.test(sql[cursor - 1]))) {
			sampled ??= Date.now();
			if (!Number.isSafeInteger(sampled)) throw new TypeError("Invalid controlled OAuth SQL clock");
			output += String(sampled);
			cursor += oauthClockSql.length;
			continue;
		}
		const start = cursor;
		const character = sql[cursor];
		if (["'", '"', "`", "["].includes(character)) {
			const end = character === "[" ? "]" : character;
			cursor++;
			while (cursor < sql.length) {
				if (sql[cursor++] === end) {
					if (sql[cursor] === end) { cursor++; continue; }
					break;
				}
			}
		} else if (sql.startsWith("--", cursor)) {
			cursor = sql.indexOf("\n", cursor);
			if (cursor < 0) cursor = sql.length;
		} else if (sql.startsWith("/*", cursor)) {
			if (sql.startsWith(oauthClockMarker, cursor)) throw new TypeError("Unsupported OAuth SQL clock expression");
			const end = sql.indexOf("*/", cursor + 2);
			cursor = end < 0 ? sql.length : end + 2;
		} else {
			cursor++;
		}
		output += sql.slice(start, cursor);
	}
	return output;
}

function lazyOAuthClockStatement(statement, executeArgs) {
	const sql = typeof statement === "string" ? statement : Array.isArray(statement) ? statement[0] : statement.sql;
	if (!sql.includes(oauthClockMarker)) return statement;
	const args = typeof statement === "string" ? executeArgs ?? [] : Array.isArray(statement) ? statement[1] ?? [] : statement.args ?? [];
	// Do not spread/evaluate this getter in the factory or batch wrapper. The
	// local SDK reads it after BEGIN, immediately before native preparation.
	return { get sql() { return substituteOAuthClock(sql); }, args };
}

function withOAuthClockFixture(client) {
	if (client.protocol !== "file") throw new Error("OAuth SQL clock fixture requires a guarded local memory client");
	const execute = client.execute.bind(client);
	const batch = client.batch.bind(client);
	client.execute = async (statement, args) => execute(lazyOAuthClockStatement(statement, args), args);
	client.batch = async (statements, mode) => batch(statements.map((statement) => lazyOAuthClockStatement(statement)), mode);
	return client;
}

// Native-clock proofs still pass through the SAME URL/auth guard and lifetime
// registry. No configurable URL, environment switch or unguarded factory escape.
export function createNativeClockMemoryClient() {
	return guardDatabaseFactory(realLibsql.createClient)({ url: "file::memory:" });
}

const allowedPorts = new Set();
let mayListen = false;
const isLoopback = (host) => host === "127.0.0.1";
function requireAddress(host, port) {
	if (!isLoopback(host) || !allowedPorts.has(Number(port))) {
		throw new Error("Test isolation denies network access outside explicit loopback fixtures");
	}
}
// Listening is opt-in and loopback-only; outbound access is granted only once the
// fixture has actually bound, and revoked on close (not an unrestricted localhost bypass).
export function allowLoopbackFixture(server) {
	const address = server.address();
	if (!address || typeof address === "string" || !isLoopback(address.address)) {
		throw new Error("Test isolation requires a bound 127.0.0.1 fixture");
	}
	allowedPorts.add(address.port);
	server.once("close", () => allowedPorts.delete(address.port));
}
export async function withLoopbackListener(start) {
	mayListen = true;
	try {
		return await start();
	} finally {
		mayListen = false;
	}
}
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
	const options = typeof args[0] === "object" ? args[0] : { host: args[1] };
	if (!mayListen || !isLoopback(options?.host)) {
		throw new Error("Test isolation denies unconfigured server listeners");
	}
	return originalListen.apply(this, args);
};
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
	// Node's internal HTTP agents pass an already-normalized [options, callback] pair.
	const normalized = Array.isArray(args[0]) ? args[0] : args;
	const options = typeof normalized[0] === "object" ? normalized[0] : {
		port: normalized[0], host: typeof normalized[1] === "string" ? normalized[1] : "localhost",
	};
	requireAddress(options.host ?? options.hostname, options.port);
	return originalConnect.apply(this, args);
};
const originalTlsConnect = tls.connect;
tls.connect = function (...args) {
	const options = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
	requireAddress(options.host ?? options.hostname, options.port);
	return originalTlsConnect.apply(this, args);
};
for (const transport of [http, https]) {
	const originalRequest = transport.request;
	transport.request = function (...args) {
		const input = args[0];
		const url = typeof input === "string" || input instanceof URL ? new URL(input) : null;
		const options = url ? { hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
			...(typeof args[1] === "object" ? args[1] : {}) } : input;
		requireAddress(options?.hostname ?? options?.host ?? "localhost", options?.port ?? 80);
		return originalRequest.apply(this, args);
	};
	transport.get = function (...args) {
		const request = transport.request(...args);
		request.end();
		return request;
	};
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, options) {
	const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
	requireAddress(url.hostname, url.port || (url.protocol === "https:" ? 443 : 80));
	return originalFetch(input, options);
};
const denyNetwork = () => { throw new Error("Test isolation denies DNS/UDP network access"); };
for (const api of [dns, dns.promises]) {
	const originalLookup = api.lookup;
	api.lookup = function (hostname, ...args) {
		if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") denyNetwork();
		return originalLookup.call(this, hostname, ...args);
	};
	for (const name of Object.keys(api)) {
		if (name.startsWith("resolve") || name === "reverse") api[name] = denyNetwork;
	}
}
dgram.Socket.prototype.send = denyNetwork;
dgram.Socket.prototype.connect = denyNetwork;
syncBuiltinESMExports();

// Importing the factory module does not open a database. Only the guarded factory
// can reach it afterwards; module mocks are registered before any application import.
const realLibsql = await import("@libsql/client");
mock.module("@libsql/client", { namedExports: {
	...realLibsql, createClient: guardDatabaseFactory((options) => withOAuthClockFixture(realLibsql.createClient(options))),
} });
mock.module("googleapis", { namedExports: { google }, defaultExport: { google } });
after(closeDatabaseClients);
process.once("exit", closeDatabaseClients);
