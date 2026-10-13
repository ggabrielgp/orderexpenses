import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = process.argv.slice(2);
if (files.some((file) => !/^test\/[\w.-]+\.test\.js$/.test(file))) {
	throw new Error("Pass project test filenames, e.g. npm test -- test/gmail.test.js");
}
// This protects the test child, not npm or this launcher against NODE_OPTIONS that Node
// already executed at startup. Use a trusted shell/runtime when launching npm itself.
const result = spawnSync(process.execPath, [
	"--experimental-test-module-mocks",
	"--import", "./test/helpers/isolation.js",
	"--test",
	...(files.length ? files : readdirSync(new URL("../test/", import.meta.url))
		.filter((name) => name.endsWith(".test.js")).sort().map((name) => `test/${name}`)),
], {
	cwd: root,
	stdio: "inherit",
	// Allowlist rather than chasing every inherited secret/configuration variable.
	env: {
		PATH: process.env.PATH,
		HOME: `${root}node_modules/.tmp`,
		TMPDIR: `${root}node_modules/.tmp`,
		LANG: "C.UTF-8",
		TZ: "UTC",
	},
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
