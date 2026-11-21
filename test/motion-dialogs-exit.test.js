import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Identity B (odd/tasks/identidad-b.md, T19, S19): the dialogs that used to `return null` the moment their
// parent closed them keep their content rendered while the CSS exit plays (300ms sheet <=760px, 150ms
// desktop) and release it afterwards through `useRetainedWhileClosing`; reduced motion releases at once.
// There is no DOM in this suite, so the retained behaviour is pinned the way motion-dialog-exit pins the
// movement viewer: the hook's release rules are unit tested there, and here every dialog is proven to be
// wired to it and to still render nothing when it never opened and its full content when open.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const DIALOGS = {
	edit: "src/client/components/movements/EditMovementDialog.tsx",
	remove: "src/client/components/movements/RemoveMovementDialog.tsx",
	account: "src/client/components/settings/AccountSettingsDialog.tsx",
	categories: "src/client/components/settings/CategorySettingsDialog.tsx",
	rules: "src/client/components/settings/CounterpartyRulesDialog.tsx",
	consent: "src/client/components/gmail/GmailConsentDialog.tsx",
	complete: "src/client/components/financial-cycle/CompleteCycleDialog.tsx",
	cycle: "src/client/components/financial-cycle/FinancialCycleEditDialog.tsx",
};
let vite, cache, motion, m;

test.before(async () => {
	cache = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "motion-dialogs-exit-"));
	vite = await createServer({
		configFile: false,
		envFile: false,
		cacheDir: cache,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	});
	motion = await vite.ssrLoadModule("/src/client/components/feedback/motion.ts");
	m = Object.fromEntries(
		await Promise.all(Object.entries(DIALOGS).map(async ([key, path]) => [key, await vite.ssrLoadModule(`/${path}`)])),
	);
});
test.after(async () => {
	await vite?.close();
	await rm(cache, { recursive: true, force: true });
});

const noop = () => {};
const period = { startDate: "2026-02-01", endDateExclusive: "2026-03-01" };
const cycle = { selectedPeriod: period, incomeAmount: 900000, completedAt: null };
const movement = {
	id: "m1", occurredAt: "2026-02-10T10:00:00", date: "2026-02-10", amount: 5000, kind: "purchase",
	direction: "outflow", category: "Comida", counterparty: "Café", isManual: true, hasTime: true,
};
const consent = { phase: "open", acknowledged: false, message: null };
const settingsProps = {
	onClose: noop,
	submitMutation: async () => ({ status: "saved" }),
};

// Each entry renders the dialog closed (never opened) and open.
const renders = {
	edit: (isOpen) => createElement(m.edit.EditMovementDialog, {
		isOpen, movement: isOpen ? movement : null, period, onClose: noop, onSaved: noop, submitEdit: async () => ({ status: "saved" }),
	}),
	remove: (isOpen) => createElement(m.remove.RemoveMovementDialog, {
		movement: isOpen ? { id: "m1", counterparty: "Café", amount: 5000, date: "2026-02-10" } : null,
		state: { phase: isOpen ? "confirming" : "closed", errorMessage: null, reloadFailed: false, removedMovementIds: [] },
		onCancel: noop, onConfirm: noop,
	}),
	account: (isOpen) => createElement(m.account.AccountSettingsDialog, {
		isOpen, onClose: noop, profile: null, authenticated: true, initialConnected: false,
		connectControl: () => createElement("button", { type: "button" }, "Conectar"),
		submitSync: null, submitCategoryMutation: async () => ({ status: "saved" }),
		submitCounterpartyRule: async () => ({ status: "saved", reloadFailed: false }),
	}),
	categories: (isOpen) => createElement(m.categories.CategorySettingsDialog, { isOpen, ...settingsProps }),
	rules: (isOpen) => createElement(m.rules.CounterpartyRulesDialog, { isOpen, ...settingsProps }),
	consent: (isOpen) => createElement(m.consent.GmailConsentDialog, {
		isOpen, state: consent, connectUrl: "/auth/google", onAcknowledge: noop, onClose: noop,
	}),
	complete: (isOpen) => createElement(m.complete.CompleteCycleDialog, {
		isOpen, cycle, onClose: noop, submitCompletion: async () => ({ status: "failed" }),
	}),
	cycle: (isOpen) => createElement(m.cycle.FinancialCycleEditDialog, {
		isOpen, cycle, onClose: noop, onSaved: noop, submitCycle: async () => ({ status: "saved", reloadFailed: false }),
	}),
};

for (const key of Object.keys(DIALOGS)) {
	test(`${key}: renders nothing when it never opened and its dialog when open`, () => {
		assert.equal(renderToStaticMarkup(renders[key](false)), "");
		assert.match(renderToStaticMarkup(renders[key](true)), /<dialog/);
	});

	test(`${key}: keeps its content while closing through useRetainedWhileClosing and releases on transitionend`, async () => {
		const src = await read(DIALOGS[key]);
		assert.match(src, /useRetained(WhileClosing|Open)/, "wired to the shared retain hook");
		assert.match(src, /onTransitionEnd=\{[^}]+\}/, "the dialog releases early on its own transitionend");
		assert.doesNotMatch(src, /if \(!isOpen[^)]*\) return null;\s*return \(\s*<dialog/, "closing no longer unmounts abruptly");
		assert.match(src, /syncNativeModalDialog\(dialogRef\.current, isOpen\)/, "still closes through the native lifecycle");
		// A closing dialog must not report its own programmatic close back to the parent as a dismissal
		// (the removal dismissal is not idempotent: it would overwrite the notice it just produced).
		assert.match(src, /onClose=\{isOpen \? (onClose|onCancel) : undefined\}/, "dismissal wiring only while open");
	});
}

test("the retained-open helper is built on the shared hook so every dialog shares one release rule", async () => {
	const src = await read("src/client/components/feedback/motion.ts");
	assert.match(src, /export function useRetainedOpen/);
	assert.equal(typeof motion.useRetainedOpen, "function");
});

test("reduced motion releases a retained dialog immediately, with no timer", () => {
	const reduced = { matchMedia: (query) => ({ matches: query.includes("prefers-reduced-motion") }) };
	assert.equal(motion.getDialogExitMs(reduced), 0);
	let released = 0;
	const timers = [];
	const exit = motion.createDeferredUnmount({
		ms: motion.getDialogExitMs(reduced),
		onUnmount: () => { released++; },
		setTimer: (callback) => { timers.push(callback); return timers.length; },
		clearTimer: noop,
	});
	exit.begin();
	assert.equal(released, 1);
	assert.equal(timers.length, 0);
});

test("a closing edit or removal dialog cannot be driven: it is inert while it fades out", async () => {
	for (const key of ["edit", "remove", "complete", "cycle", "consent", "account", "categories", "rules"]) {
		const src = await read(DIALOGS[key]);
		assert.match(src, /inert=\{/, `${key} must be inert while closing`);
	}
});

test("the removal dialog keeps the reducer guard against a second DELETE and the edit dialog its in-flight lock", async () => {
	const remove = await read(DIALOGS.remove);
	assert.match(remove, /reduceRemovalState\(state, \{ type: "cancel" \}\)/);
	assert.match(remove, /canSubmitRemoval\(state\)/);
	assert.match(remove, /reduceRemovalDismissal\(state\)/);
	const edit = await read(DIALOGS.edit);
	assert.match(edit, /acquireInFlightLock\(saveLock\)/);
	assert.match(edit, /releaseInFlightLock\(saveLock\)/);
});
