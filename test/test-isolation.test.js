import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const platformEnvironment = process.platform === "win32" && process.env.SystemRoot
	? { SystemRoot: process.env.SystemRoot } : {};
// No inherited NODE_OPTIONS reaches these probes, including the initial safe RED.
function probe(source, { preload = true, env = {} } = {}) {
	const args = ["--experimental-test-module-mocks"];
	if (preload) args.push("--import", "./test/helpers/isolation.js");
	args.push("--input-type=module", "--eval", source);
	return spawnSync(process.execPath, args, {
		cwd: root,
		env: { PATH: process.env.PATH, ...platformEnvironment, ...env },
		encoding: "utf8",
	});
}
function passed(result) {
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("every final Vite fixture config disables env-file loading, including spread config", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import fs from 'node:fs';
		import { basename, dirname, join } from 'node:path';
		import { fileURLToPath } from 'node:url';
		import { syncBuiltinESMExports } from 'node:module';
		import { runInNewContext } from 'node:vm';
		const { tmpdir } = await import('node:os');
		const { after } = await import('node:test');
		const directory = fs.mkdtempSync(join(tmpdir(), 'vite-env-isolation-'));
		after(() => fs.rmSync(directory, { recursive: true }));
		for (const name of ['.env', '.env.local', '.env.test', '.env.test.local']) {
			fs.writeFileSync(join(directory, name), 'VITE_ISOLATION_SENTINEL=harmless-fixture\\n');
		}
		// Never permit an env-file read outside these generated sentinel files, even
		// during RED. Instrument before importing Vite so its named fs imports see it.
		let envReads = 0;
		const originalRead = fs.readFileSync;
		fs.readFileSync = (path, ...args) => {
			const filename = path instanceof URL ? fileURLToPath(path) : String(path);
			if (basename(filename).startsWith('.env')) {
				assert.equal(dirname(filename), directory, 'real env-file read forbidden');
				envReads++;
			}
			return originalRead(path, ...args);
		};
		syncBuiltinESMExports();
		const { resolveConfig } = await import('vite');
		for (const file of ['react-vite-foundation', 'demo-fixture', 'landing-navigation', 'landing-tour', 'landing-dashboard-preview', 'landing-preview-integration']) {
			const source = fs.readFileSync('./test/' + file + '.test.js', 'utf8');
			// Evaluate only the first final createServer options literal, not the test
			// module or application imports. Current fixture shapes are intentionally pinned.
			const literal = source.match(/\\b(?:createRawViteServer|createViteServer|createServer)\\((\\{[\\s\\S]*?\\})\\s*\\)/)?.[1];
			assert.ok(literal, 'final Vite config literal required: ' + file);
			const inherited = {
				root: directory, envDir: directory, envFile: true,
				configFile: false, mode: 'test', server: { middlewareMode: true },
			};
			const options = runInNewContext('(' + literal + ')', { config: inherited, loaded: { config: inherited } });
			// The no-spread fixture gets a controlled root too; no root .env is inspected.
			options.root = directory;
			options.envDir = directory;
			const resolved = await resolveConfig(options, 'serve', 'test');
			assert.equal(resolved.env.VITE_ISOLATION_SENTINEL, undefined, file + ' loaded fake env');
			assert.equal(resolved.envFile, false, file + ' must explicitly disable env files');
			assert.equal(resolved.server.hmr, false);
			assert.equal(resolved.server.ws, false);
			if (!['demo-fixture', 'landing-navigation'].includes(file)) {
				assert.equal(resolved.optimizeDeps.noDiscovery, true, file + ' must not discover dependencies');
				assert.deepEqual(Array.from(resolved.optimizeDeps.include), []);
				assert.equal(resolved.server.watch, null, file + ' must not watch files');
			}
		}
		assert.equal(envReads, 0, 'disabled env files must never be read');
		// Exercise installed guards only against a generated sentinel, never a real
		// env file. Sync, callback, stream and promise access must all fail before I/O.
		const file = join(directory, '.env');
		const { pathToFileURL } = await import('node:url');
		const { readFileSync: namedRead } = await import('node:fs');
		const denied = /isolation.*file reads/i;
		for (const read of [
			() => originalRead(file),
			() => namedRead(pathToFileURL(file)),
			() => fs.openSync(Buffer.from(file), 'r'),
			() => fs.readFile(file, () => assert.fail('callback must not run')),
			() => fs.open(file, 'r', () => assert.fail('callback must not run')),
			() => fs.createReadStream(file),
		]) assert.throws(read, denied);
		const promises = await import('node:fs/promises');
		await assert.rejects(promises.readFile(file), denied);
		await assert.rejects(promises.open(file, 'r'), denied);
	`));
});

test("preload retains Windows native infrastructure but not hostile application variables", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		assert.equal(process.env.SystemRoot, ${JSON.stringify(process.platform === "win32" ? process.env.SystemRoot : undefined)});
		assert.equal(process.env.HOSTILE_APPLICATION_SETTING, undefined);
	`, { env: { ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}), HOSTILE_APPLICATION_SETTING: 'hostile' } }));
});

test("sensitive file guard rejects before an inert reader is called", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import { guardSensitiveFileReader } from './test/helpers/isolation.js';
		let reads = 0;
		const reader = guardSensitiveFileReader(() => { reads++; return 'safe'; });
		for (const path of ['.env', '.env.local', '.env.test', '.env.test.local', 'data/google-credentials.json', 'application_default_credentials.json']) {
			assert.throws(() => reader(path), /isolation.*file reads/i);
		}
		assert.equal(reads, 0);
		assert.equal(reader('test/fixture.json'), 'safe');
		assert.equal(reads, 1);
	`));
});

test("Node supports pre-import ESM module mocks on this runtime", () => {
	passed(probe(`
		import { mock } from 'node:test';
		import assert from 'node:assert/strict';
		const specifier = 'data:text/javascript,export const value = 1';
		mock.module(specifier, { namedExports: { value: 2 } });
		assert.equal((await import(specifier)).value, 2);
	`, { preload: false }));
});

test("preload scrubs hostile inherited application configuration before imports", () => {
	for (const url of ["libsql://production.invalid", "file:./node_modules/.tmp/isolation-must-not-exist.db"]) {
		passed(probe(`
			import assert from 'node:assert/strict';
			assert.equal(process.env.TURSO_DATABASE_URL, 'file::memory:');
			assert.equal(process.env.TURSO_AUTH_TOKEN, undefined);
			assert.equal(process.env.NODE_OPTIONS, undefined);
			assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
			assert.equal(process.env.GOOGLE_CLIENT_ID, 'test-client-id');
			assert.equal(process.env.GOOGLE_CLIENT_SECRET, 'test-client-secret');
			assert.equal(process.env.VERCEL, '1');
			assert.equal(process.env.HOST, '127.0.0.1');
			assert.equal(process.env.SESSION_COOKIE_NAME, 'finance_session');
			assert.equal(process.env.APP_BASE_URL, 'http://localhost:3000');
		`, { env: {
			TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "inherited-token",
			DB_PATH: "forbidden.db", GOOGLE_CLIENT_ID: "inherited-id",
			GOOGLE_CLIENT_SECRET: "inherited-secret", GOOGLE_CREDENTIALS_PATH: "forbidden.json",
			GOOGLE_APPLICATION_CREDENTIALS: "forbidden.json", HOST: "0.0.0.0",
			SESSION_COOKIE_NAME: "inherited-cookie", APP_BASE_URL: "https://production.invalid",
		} }));
	}
	assert.equal(existsSync(new URL("../node_modules/.tmp/isolation-must-not-exist.db", import.meta.url)), false);
});

test("database URL guard rejects before an inert factory is called", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import { guardDatabaseFactory } from './test/helpers/isolation.js';
		let calls = 0;
		const factory = guardDatabaseFactory(() => { calls++; return { close() {} }; });
		for (const url of ['file:forbidden.db', 'libsql://production.invalid', 'https://production.invalid', undefined]) {
			assert.throws(() => factory({ url }), /isolation/i);
		}
		assert.throws(() => factory({ url: 'file::memory:', authToken: 'secret' }), /isolation/i);
		assert.equal(calls, 0);
		factory({ url: 'file::memory:' });
		assert.equal(calls, 1);
	`));
});

test("real mocked export rejects explicit environment changes without creating a file", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		const { createClient } = await import('@libsql/client');
		for (const url of ['file:./node_modules/.tmp/isolation-must-not-exist.db', 'libsql://production.invalid']) {
			process.env.TURSO_DATABASE_URL = url;
			assert.throws(() => createClient({ url: process.env.TURSO_DATABASE_URL }), /isolation/i);
		}
	`));
	assert.equal(existsSync(new URL("../node_modules/.tmp/isolation-must-not-exist.db", import.meta.url)), false);
});

test("Google operations fail locally unless explicitly configured", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		const { google } = await import('googleapis');
		const oauth = new google.auth.OAuth2();
		await assert.rejects(oauth.getToken('code'), /Unconfigured fixture/);
		await assert.rejects(google.oauth2().userinfo.get(), /Unconfigured fixture/);
		await assert.rejects(google.gmail().users.messages.list({}), /Unconfigured fixture/);
		await assert.rejects(google.gmail().users.messages.get({}), /Unconfigured fixture/);
	`));
});

test("network calls fail before any external or unregistered loopback connection", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import http from 'node:http';
		import https from 'node:https';
		import net from 'node:net';
		import tls from 'node:tls';
		for (const url of ['https://production.invalid', 'http://127.0.0.1:1']) {
			await assert.rejects(fetch(url), /isolation/i);
			assert.throws(() => (url.startsWith('https') ? https : http).get(url), /isolation/i);
		}
		assert.throws(() => net.connect(443, 'production.invalid'), /isolation/i);
		assert.throws(() => tls.connect(443, 'production.invalid'), /isolation/i);
	`));
});

test("application imports cannot read inherited credential files", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import fs from 'node:fs';
		import { syncBuiltinESMExports } from 'node:module';
		let reads = 0;
		// Node may read JavaScript source through fs during ESM loading. Count
		// credential access, not the runtime's legitimate module source reads.
		for (const name of ['existsSync', 'readFileSync']) {
			const original = fs[name];
			fs[name] = (file, ...args) => {
				if (name === 'readFileSync' && /\\.(?:c|m)?js(?:[?#]|$)/.test(String(file))) return original(file, ...args);
				reads++;
				throw new Error('credential read forbidden');
			};
		}
		syncBuiltinESMExports();
		const { createOAuthClient, hasGoogleCredentials } = await import('./src/gmail.js');
		assert.equal(hasGoogleCredentials(), true);
		const client = await createOAuthClient();
		assert.equal(client.clientId, 'test-client-id');
		assert.equal(reads, 0);
	`, { env: {
		GOOGLE_CREDENTIALS_PATH: 'inherited-credentials.json',
		GOOGLE_APPLICATION_CREDENTIALS: 'inherited-credentials.json',
	} }));
});

test("configured Google fixtures expose deterministic results, counters and failures", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import { configureGoogleFixtures, resetGoogleFixtures, googleCalls } from './test/helpers/fixtures.js';
		const { google } = await import('googleapis');
		configureGoogleFixtures({
			exchange: { tokens: { access_token: 'fixture-token' } },
			profile: { data: { email: 'owner@example.com' } },
			list: ({ q }) => ({ data: { messages: [{ id: q }] } }),
			get: new Error('fixture get failure'),
		});
		assert.deepEqual(await new google.auth.OAuth2().getToken('fixture-code'), { tokens: { access_token: 'fixture-token' } });
		assert.equal((await google.oauth2().userinfo.get()).data.email, 'owner@example.com');
		assert.deepEqual((await google.gmail().users.messages.list({ q: 'query' })).data.messages, [{ id: 'query' }]);
		await assert.rejects(google.gmail().users.messages.get({ id: 'message' }), /fixture get failure/);
		assert.deepEqual(googleCalls.exchange, ['fixture-code']);
		assert.equal(googleCalls.profile.length, 1);
		assert.equal(googleCalls.list.length, 1);
		assert.equal(googleCalls.get.length, 1);
		configureGoogleFixtures({ list: new Error('fixture list failure') });
		await assert.rejects(google.gmail().users.messages.list({}), /fixture list failure/);
		resetGoogleFixtures();
		assert.equal(googleCalls.list.length, 0);
		await assert.rejects(new google.auth.OAuth2().getToken('code'), /Unconfigured fixture/);
	`));
});

test("memory clients execute locally and are explicitly closed", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import { closeDatabaseClients } from './test/helpers/isolation.js';
		const { createClient } = await import('@libsql/client');
		const client = createClient({ url: 'file::memory:' });
		assert.equal((await client.execute('SELECT 1 AS value')).rows[0].value, 1);
		closeDatabaseClients();
		assert.equal(client.closed, true);
	`));
});

test("request stubs preserve cookies, headers, methods and async body chunks", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import { request } from './test/helpers/request.js';
		async function* chunks() { yield '{"value":'; yield '1}'; }
		const response = await request(async (req, res) => {
			assert.equal(req.method, 'PUT');
			assert.equal(req.headers.origin, 'http://localhost:3000');
			assert.equal(req.headers.cookie, 'other=fixture; finance_session=session');
			let body = '';
			for await (const chunk of req) body += chunk;
			assert.deepEqual(JSON.parse(body), { value: 1 });
			res.setHeader('Set-Cookie', ['finance_session=rotated']);
			res.writeHead(201, { 'Content-Type': 'application/json' });
			res.end('{"ok":true}');
		}, '/api/fixture', {
			method: 'PUT', headers: { Origin: 'http://localhost:3000' },
			cookies: { other: 'fixture' }, sessionId: 'session', chunks: chunks(),
		});
		assert.equal(response.status, 201);
		assert.equal(response.headers['content-type'], 'application/json');
		assert.deepEqual(response.headers['set-cookie'], ['finance_session=rotated']);
		assert.equal(response.body, '{"ok":true}');
	`));
});

test("network guards allow an explicit loopback fixture and revoke access on close", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import { once } from 'node:events';
		import http from 'node:http';
		import { allowLoopbackFixture, withLoopbackListener } from './test/helpers/isolation.js';
		const server = http.createServer((req, res) => res.end('fixture'));
		assert.throws(() => server.listen(0, '127.0.0.1'), /isolation/i);
		await withLoopbackListener(async () => {
			server.listen(0, '127.0.0.1');
			await once(server, 'listening');
		});
		const url = 'http://127.0.0.1:' + server.address().port;
		await assert.rejects(fetch(url), /isolation/i);
		allowLoopbackFixture(server);
		assert.equal(await (await fetch(url)).text(), 'fixture');
		await new Promise((resolve) => server.close(resolve));
		await assert.rejects(fetch(url), /isolation/i);
	`));
});

test("risky raw test files fail closed without the launcher's mock flag", () => {
	for (const file of ['gmail', 'movements', 'server-financial-cycle', 'server-logout', 'static-routing', 'react-vite-foundation']) {
		const result = spawnSync(process.execPath, ['--test', 'test/' + file + '.test.js'], {
			cwd: root, env: { PATH: process.env.PATH, ...platformEnvironment }, encoding: 'utf8',
		});
		assert.notEqual(result.status, 0, file);
		assert.match(result.stdout + result.stderr, /Test isolation requires npm test/, file);
	}
});

test("launcher forwards exact test filenames and scrubs NODE_OPTIONS in its child", () => {
	// This existence assertion makes initial RED safe: never fall back to the old npm test.
	assert.ok(existsSync(new URL("../scripts/run-tests.js", import.meta.url)), "isolated launcher required");
	const result = probe(`
		process.env.NODE_OPTIONS = '--definitely-invalid-in-child';
		process.argv = [process.execPath, 'scripts/run-tests.js', 'test/period.test.js'];
		await import('./scripts/run-tests.js');
	`, { preload: false });
	passed(result);
	assert.match(result.stdout, /tests 8/);
	assert.doesNotMatch(result.stdout, /OAuth|logout|preload scrubs/);
});

test("launcher rejects invalid selectors with exact error output and failing status", () => {
	const result = probe(`
		process.argv = [process.execPath, 'scripts/run-tests.js', '../invalid.test.js'];
		await import('./scripts/run-tests.js').catch(error => {
			console.error(error.message);
			process.exitCode = 1;
		});
	`, { preload: false });
	assert.equal(result.status, 1);
	assert.equal(result.stdout, '');
	assert.equal(result.stderr, 'Pass project test filenames, e.g. npm test -- test/gmail.test.js\n');
});

test("native Vite config paths load SSR modules without URL pathname conversion", () => {
	passed(probe(`
		import assert from 'node:assert/strict';
		import { readFileSync } from 'node:fs';
		import { fileURLToPath } from 'node:url';
		import { createServer, loadConfigFromFile } from 'vite';
		const url = new URL('./vite.config.ts', import.meta.url);
		const configPath = fileURLToPath(url);
		const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configPath);
		assert.equal(loaded.path, configPath.replaceAll('\\\\', '/'));
		const source = readFileSync('./test/react-vite-foundation.test.js', 'utf8');
		assert.doesNotMatch(source, /new URL\\([^\\n]*vite\\.config\\.ts[^\\n]*\\.pathname/);
		const vite = await createServer({ ...loaded.config, configFile: false, envFile: false,
			optimizeDeps: { noDiscovery: true, include: [] },
			server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
		try {
			const demo = await vite.ssrLoadModule('/src/client/demo-data.ts');
			assert.equal(typeof demo.createDemoDashboardData, 'function');
		} finally { await vite.close(); }
	`));
});

const oauthClockSql = "CAST(ROUND(unixepoch('now', 'subsec') * 1000) AS INTEGER) /* oauth-clock-ms */";
const clockProbePrelude = `
	import assert from 'node:assert/strict';
	import { mock } from 'node:test';
	import { createClient } from '@libsql/client';
	const CLOCK = ${JSON.stringify(oauthClockSql)};
	const N = 1893456000000;
	const client = createClient({ url: 'file::memory:' });
`;

test("OAuth SQL clock samples at native statement dispatch after BEGIN, with rollback intact", () => {
	passed(probe(clockProbePrelude + `
		await client.execute('CREATE TABLE dispatch (value INTEGER NOT NULL)');
		await client.execute('INSERT INTO dispatch VALUES (0)');
		let clock = N, reads = 0;
		const snapshots = [];
		mock.method(Date, 'now', () => {
			reads++;
			snapshots.push(client.execute('SELECT value FROM dispatch').then(result => result.rows[0].value));
			return clock;
		});
		const statements = ['UPDATE dispatch SET value = 1', 'SELECT ' + CLOCK + ' AS ms'];
		assert.equal(reads, 0, 'no clock sampling while constructing SQL');
		clock = N + 1;
		const results = await client.batch(statements, 'write');
		assert.equal(results[1].rows[0].ms, N + 1);
		assert.equal(reads, 1);
		assert.deepEqual(await Promise.all(snapshots), [1], 'clock runs after the prior in-transaction mutation');
		await client.execute('UPDATE dispatch SET value = 0');
		await assert.rejects(client.batch([
			'UPDATE dispatch SET value = 1', 'SELECT ' + CLOCK + ' AS ms', 'INSERT INTO dispatch VALUES (NULL)',
		], 'write'), /NOT NULL/);
		assert.equal((await client.execute('SELECT value FROM dispatch')).rows[0].value, 0);
	`));
});

test("OAuth SQL clock preserves argument overloads and one value for repeated same-step expressions", () => {
	passed(probe(clockProbePrelude + `
		let reads = 0;
		mock.method(Date, 'now', () => N + reads++);
		const query = 'SELECT ' + CLOCK + ' AS first, ' + CLOCK + ' AS second, ? AS bound';
		const inputs = [
			await client.execute(query, [11]),
			await client.execute({ sql: query, args: [13] }),
			(await client.batch([[query, [17]]], 'write'))[0],
			await client.execute({ sql: 'SELECT ' + CLOCK + ' AS first, :value AS bound', args: { value: 19 } }),
		];
		assert.deepEqual(inputs.map(result => result.rows[0].first), [N, N + 1, N + 2, N + 3]);
		assert.deepEqual(inputs.slice(0, 3).map(result => result.rows[0].second), [N, N + 1, N + 2]);
		assert.deepEqual(inputs.map(result => result.rows[0].bound), [11, 13, 17, 19]);
		assert.equal(reads, 4);
	`));
});

test("OAuth SQL clock is lexically confined and ordinary/native queries remain untouched", () => {
	passed(probe(clockProbePrelude + `
		let reads = 0;
		mock.method(Date, 'now', () => { reads++; return N; });
		const literal = CLOCK.replaceAll("'", "''");
		const result = await client.execute("SELECT '" + literal + "' AS literal, 7 AS ordinary -- " + CLOCK + '\\n');
		assert.equal(result.rows[0].literal, CLOCK);
		assert.equal(result.rows[0].ordinary, 7);
		const identifier = CLOCK.replaceAll('"', '""');
		assert.equal((await client.execute('SELECT 9 AS "' + identifier + '"')).rows[0][CLOCK], 9);
		assert.equal((await client.execute('/* nested marker text: /* oauth-clock-ms */ SELECT 23 AS ordinary')).rows[0].ordinary, 23);
		assert.equal((await client.execute("SELECT CAST(ROUND(unixepoch('now', 'subsec') * 1000) AS INTEGER) AS ms")).rows[0].ms === N, false);
		assert.equal(reads, 0, 'unrelated SQL must not add Date.now calls');
		await assert.rejects(client.execute("SELECT unixepoch('now') /* oauth-clock-ms */"), /Unsupported OAuth SQL clock expression/);
	`));
});

test("OAuth SQL fixture cannot conceal stale timestamps or missing authorization gates", () => {
	passed(probe(clockProbePrelude + `
		mock.method(Date, 'now', () => N + 1);
		await client.execute('CREATE TABLE gates (id TEXT PRIMARY KEY, deadline INTEGER NOT NULL)');
		await client.execute({ sql: 'INSERT INTO gates VALUES (?, ?)', args: ['synthetic', N + 1] });
		const stale = await client.execute({ sql: 'UPDATE gates SET id = id WHERE deadline > ? RETURNING id', args: [N] });
		assert.equal(stale.rows.length, 1, 'fixture must leave the stale-bound-time bug visible');
		const missing = await client.execute('UPDATE gates SET id = id WHERE ' + CLOCK + ' > 0 RETURNING id');
		assert.equal(missing.rows.length, 1, 'fixture must not invent an authorization gate');
		const actual = await client.execute('UPDATE gates SET id = id WHERE deadline > ' + CLOCK + ' RETURNING id');
		assert.equal(actual.rows.length, 0);
	`));
});

test("invalid controlled OAuth SQL clock rejects without fallback and rolls back earlier mutations", () => {
	passed(probe(clockProbePrelude + `
		await client.execute('CREATE TABLE rollback (value INTEGER NOT NULL)');
		await client.execute('INSERT INTO rollback VALUES (0)');
		for (const invalid of [NaN, Infinity, null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
			mock.method(Date, 'now', () => invalid);
			await assert.rejects(client.execute('SELECT ' + CLOCK + ' AS ms'), /Invalid controlled OAuth SQL clock/);
			await assert.rejects(client.batch(['UPDATE rollback SET value = 1', 'SELECT ' + CLOCK + ' AS ms'], 'write'), /Invalid controlled OAuth SQL clock/);
			assert.equal((await client.execute('SELECT value FROM rollback')).rows[0].value, 0);
		}
	`));
});

test("guarded native-clock memory helper proves precision and real execution-time expiry without fixture substitution", () => {
	passed(probe(clockProbePrelude + `
		import { createNativeClockMemoryClient, closeDatabaseClients } from './test/helpers/isolation.js';
		import { setTimeout as delay } from 'node:timers/promises';
		const native = createNativeClockMemoryClient();
		assert.equal(native.protocol, 'file');
		mock.method(Date, 'now', () => N);
		const nativeNow = (await native.execute('SELECT ' + CLOCK + ' AS ms')).rows[0].ms;
		assert.ok(Number.isSafeInteger(nativeNow));
		assert.notEqual(nativeNow, N, 'native helper must keep the actual SQL clock');
		const samples = [];
		for (const suffix of ['000', '001', '002', '999']) {
			samples.push((await native.execute({ sql: "SELECT CAST(ROUND(unixepoch(?, 'subsec') * 1000) AS INTEGER) AS ms", args: ['2030-01-01T00:00:00.' + suffix + 'Z'] })).rows[0].ms);
		}
		assert.deepEqual(samples, [N, N + 1, N + 2, N + 999]);
		await native.execute('CREATE TABLE native_gates (id TEXT PRIMARY KEY, source INTEGER, created INTEGER, fresh INTEGER)');
		await native.execute('CREATE TABLE targets (id TEXT PRIMARY KEY)');
		const batchFor = (id, expression = CLOCK) => [
			{ sql: 'UPDATE native_gates SET id = id WHERE id = ? AND source > ' + expression + ' AND created <= ' + expression + ' AND created > ' + expression + ' - 600000 AND fresh > ' + expression + ' RETURNING id', args: [id] },
		];
		await native.execute({ sql: 'INSERT INTO native_gates VALUES (?, ?, ?, ?)', args: ['source', nativeNow + 150, nativeNow, nativeNow + 60000] });
		await native.execute({ sql: 'INSERT INTO native_gates VALUES (?, ?, ?, ?)', args: ['claim', nativeNow + 60000, nativeNow - 600000 + 150, nativeNow + 60000] });
		await native.execute({ sql: 'INSERT INTO native_gates VALUES (?, ?, ?, ?)', args: ['fresh', nativeNow + 60000, nativeNow, nativeNow + 150] });
		const constructed = ['source', 'claim', 'fresh'].map(id => batchFor(id));
		await delay(400);
		for (const statements of constructed) assert.equal((await native.batch(statements, 'write'))[0].rows.length, 0);
		assert.equal((await native.batch(batchFor('source', "unixepoch('now', 'unsupported-clock-modifier')"), 'write'))[0].rows.length, 0, 'NULL clock fails closed');
		await assert.rejects(native.batch(["INSERT INTO targets VALUES ('synthetic')", 'SELECT unavailable_oauth_clock()'], 'write'), /no such function/i);
		assert.equal((await native.execute('SELECT count(*) AS n FROM targets')).rows[0].n, 0, 'missing function rolls back, without fallback');
		closeDatabaseClients();
		assert.equal(native.closed, true);
		assert.equal(client.closed, true);
	`));
});
