import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

// Inspect the actual launch boundary without starting another runner or inheriting secrets.
const launcher = readFileSync(new URL("../scripts/run-tests.js", import.meta.url), "utf8")
	.replace(/^import .*;\r?\n/gm, "")
	.replaceAll("import.meta.url", "'file:///fixture/scripts/run-tests.js'");
function launch(files, platform) {
	let captured;
	const process = { platform, execPath: "node", argv: ["node", "launcher", ...files], env: {
		PATH: "fixture-path", SystemRoot: "C:\\Windows", TURSO_AUTH_TOKEN: "hostile", NODE_OPTIONS: "hostile",
	} };
	runInNewContext(launcher, { process, URL, fileURLToPath: () => "/fixture/",
		readdirSync: () => ["z.test.js", "ignore.txt", "a.test.js"],
		spawnSync: (...args) => { captured = args; return { status: 0 }; },
	});
	return captured;
}
test("launcher retains only Windows native infrastructure alongside its fixed environment", () => {
	for (const platform of ["win32", "linux"]) {
		const [, , options] = launch(["test/period.test.js"], platform);
		assert.deepEqual({ ...options.env }, {
			PATH: "fixture-path", ...(platform === "win32" ? { SystemRoot: "C:\\Windows" } : {}),
			HOME: "/fixture/node_modules/.tmp", TMPDIR: "/fixture/node_modules/.tmp", LANG: "C.UTF-8", TZ: "UTC",
		});
	}
});
test("launcher preserves explicit selectors, sorted defaults and exact invalid-selector error", () => {
	assert.equal(launch(["test/period.test.js"], "linux")[1].at(-1), "test/period.test.js");
	assert.deepEqual(Array.from(launch([], "linux")[1].slice(-2)), ["test/a.test.js", "test/z.test.js"]);
	assert.throws(() => launch(["../invalid.test.js"], "linux"), {
		message: "Pass project test filenames, e.g. npm test -- test/gmail.test.js",
	});
});
