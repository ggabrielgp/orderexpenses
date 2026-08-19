import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.VERCEL = "1";
process.env.TURSO_DATABASE_URL = "file:./data/finance.db";
const { default: handleRequest } = await import("../src/server.js");

function request(pathname) {
	return new Promise((resolve, reject) => {
		const response = {
			headers: {},
			setHeader(name, value) {
				this.headers[name.toLowerCase()] = value;
			},
			writeHead(status, headers = {}) {
				this.status = status;
				Object.assign(this.headers, headers);
			},
			end(body = "") {
				resolve({ status: this.status, headers: this.headers, body: String(body) });
			},
		};

		Promise.resolve(
			handleRequest(
				{ url: pathname, method: "GET", headers: { host: "localhost:3000" } },
				response,
			),
		).catch(reject);
	});
}

test("serves the marketing landing at the root", async () => {
	const response = await request("/");
	assert.equal(response.status, 200);
	assert.match(response.headers["content-type"], /^text\/html/);
	assert.match(response.body, /Acceder con Google/);
	assert.doesNotMatch(response.body, /id="dashboard"/);
});

test("serves the product dashboard from the clean app route", async () => {
	for (const pathname of ["/app", "/app/"]) {
		const response = await request(pathname);
		assert.equal(response.status, 200);
		assert.match(response.body, /id="dashboard"/);
		assert.match(response.body, /src="\/app\.js"/);
	}
});

test("serves dashboard assets from absolute paths", async () => {
	const response = await request("/app.css");
	assert.equal(response.status, 200);
	assert.match(response.headers["content-type"], /^text\/css/);
	assert.match(response.body, /\.dashboard/);
});

test("OAuth success returns users to the dashboard with auto-sync enabled", async () => {
	const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
	assert.match(source, /location: "\/app\?gmail=connected"/);
});
