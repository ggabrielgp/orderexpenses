import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// Isolate: use a temp SQLite DB so this test never touches production data.
const tmpDir = mkdtempSync(resolve(tmpdir(), "orderexpenses-test-"));
process.env.DB_PATH = resolve(tmpDir, "test.db");
delete process.env.TURSO_DATABASE_URL;

test("upsertMovementOverride() returns id equal to movementKey", async () => {
	const db = await import("../src/db.js");
	await db.ensureDbInitialized();

	const result = await db.upsertMovementOverride(
		"test@example.com",
		"gm_abc123",
		{ category: "Comida" },
		false,
	);

	assert.ok("id" in result, "result must include an id field");
	assert.equal(
		result.id,
		"gm_abc123",
		"id must equal the movementKey passed in",
	);
	assert.equal(result.movementKey, "gm_abc123", "movementKey preserved");
	assert.deepEqual(result.patch, { category: "Comida" }, "patch returned");
	assert.equal(result.hidden, false, "hidden flag preserved");
});

test("hidden overrides include id in return (Gmail DELETE path)", async () => {
	const db = await import("../src/db.js");
	await db.ensureDbInitialized();

	const result = await db.upsertMovementOverride(
		"test@example.com",
		"gm_hidden",
		{},
		true,
	);

	assert.ok("id" in result, "hidden result must include an id field");
	assert.equal(result.id, "gm_hidden", "id must equal the movementKey");
	assert.equal(result.movementKey, "gm_hidden", "movementKey preserved");
	assert.deepEqual(result.patch, {}, "patch returned (empty is valid)");
	assert.equal(result.hidden, true, "hidden flag preserved");
});
