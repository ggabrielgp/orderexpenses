import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const css = () => read("src/client/dashboard-mobile-ergonomics.css");
const withModules = async (run) => {
	const vite = await createServer({
		configFile: false, envFile: false,
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false, ws: false },
	});
	try { await run(vite); } finally { await vite.close(); }
};
const identity = { name: "Una identidad de nombre muy largo", email: "cuenta@example.com", initials: "UI", avatarSrc: null };
const noop = () => {};
const props = { identity, isOpen: true, menuId: "test-account", onToggle: noop, onKeyDown: noop, onMenuClick: noop };
const actions = () => [
	createElement("button", { key: "settings", type: "button", onClick: noop }, "Configuración"),
	createElement("button", { key: "logout", type: "button", onClick: noop }, "Cerrar sesión"),
];
const render = (View, overrides = {}) => renderToStaticMarkup(createElement(View, { ...props, ...overrides }, ...actions()));
const region = (html) => html.slice(html.indexOf('class="react-account-menu"'));

for (const [label, value, expected] of [
	["omitted connection defaults to disconnected", undefined, "Gmail no conectado"],
	["false connection is not inferred from an email", false, "Gmail no conectado"],
	["true connection presents the caller's actual state", true, "Gmail conectado"],
]) {
	test(label, () => withModules(async (vite) => {
		const { AccountMenuView } = await vite.ssrLoadModule("/src/client/components/account/AccountMenuComponent.tsx");
		const html = region(render(AccountMenuView, { gmailConnected: value }));
		assert.ok(html.includes(expected));
	}));
}

test("identity and connection are informational menu content, not cloned actions or tab stops", () => withModules(async (vite) => {
	const { AccountMenuView } = await vite.ssrLoadModule("/src/client/components/account/AccountMenuComponent.tsx");
	const html = region(render(AccountMenuView, { gmailConnected: true }));
	assert.ok(html.includes(identity.name) && html.includes(identity.email));
	const info = html.slice(html.indexOf('class="react-account-menu-identity"'), html.indexOf('<button'));
	assert.ok(info.includes("Gmail conectado"));
	assert.doesNotMatch(info, /role="menuitem"|tabindex|<button|<a\b/);
	assert.equal((html.match(/role="menuitem"/g) ?? []).length, 2);
	assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 2);
}));

test("closed and open menu retain disclosure naming, refs, callbacks and action ownership", () => withModules(async (vite) => {
	const { AccountMenuView } = await vite.ssrLoadModule("/src/client/components/account/AccountMenuComponent.tsx");
	const closed = render(AccountMenuView, { isOpen: false });
	assert.match(closed, /aria-label="Abrir menú de cuenta"/);
	assert.match(closed, /aria-haspopup="menu"/);
	assert.match(closed, /aria-expanded="false"/);
	assert.match(closed, /aria-controls="test-account"/);
	assert.match(region(closed), /role="menu"[^>]*hidden/);
	assert.doesNotMatch(region(render(AccountMenuView)), /hidden=""/);
	let toggles = 0;
	const keys = [], clicks = [];
	const containerRef = { current: null }, triggerRef = { current: null }, menuRef = { current: null };
	const tree = AccountMenuView({ ...props, children: actions(), containerRef, triggerRef, menuRef,
		onToggle() { toggles++; }, onKeyDown(event) { keys.push(event); }, onMenuClick(event) { clicks.push(event); },
	});
	assert.equal(tree.props.ref, containerRef);
	const [trigger, menu] = tree.props.children;
	assert.equal(trigger.props.ref, triggerRef);
	assert.equal(menu.props.ref, menuRef);
	trigger.props.onClick();
	assert.equal(toggles, 1);
	for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) tree.props.onKeyDown({ key });
	assert.deepEqual(keys.map((event) => event.key), ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]);
	const event = { target: {} };
	menu.props.onClick(event);
	assert.equal(clicks[0], event);
	const items = menu.props.children[1];
	assert.equal(items.length, 2);
	assert.equal(items[0].props.onClick, noop);
	assert.equal(items[0].props.role, "menuitem");
	assert.equal(items[0].props.tabIndex, -1);
}));

test("avatar fallback and real picture remain safe with an empty fallback identity", () => withModules(async (vite) => {
	const { AccountMenuView } = await vite.ssrLoadModule("/src/client/components/account/AccountMenuComponent.tsx");
	const html = render(AccountMenuView, { identity: { name: "Usuario", email: "", initials: "U", avatarSrc: null } });
	assert.match(html, /react-account-avatar-fallback[^>]*aria-hidden="true"[^>]*>U</);
	assert.doesNotMatch(html, /<img|class="react-account-menu-email"/);
	const picture = render(AccountMenuView, { identity: { ...identity, avatarSrc: "https://example.com/avatar.png" } });
	assert.match(picture, /<img[^>]*alt=""[^>]*referrerpolicy="no-referrer"/i);
}));

test("existing two navigation tabs retain desktop markup and immediate view callbacks", () => withModules(async (vite) => {
	const { AppHeader } = await vite.ssrLoadModule("/src/client/components/shell/AppHeader.tsx");
	const changes = [];
	const tree = AppHeader({ view: "summary", onViewChange: (view) => changes.push(view), children: "Account" });
	const navigation = tree.props.children.props.children[1];
	const buttons = navigation.props.children;
	assert.deepEqual(buttons.map((button) => button.props.children), ["Resumen", "Movimientos"]);
	assert.deepEqual(buttons.map((button) => button.props["aria-pressed"]), [true, false]);
	buttons.forEach((button) => button.props.onClick());
	assert.deepEqual(changes, ["summary", "movements"]);
	assert.match(renderToStaticMarkup(tree), /aria-label="Vistas del panel"/);
}));

// CSS assertions verify declared safeguards only, not rendered viewport/keyboard proof.
test("mobile movement field overrides outrank the existing view-qualified field rules", async () => {
	const source = await css();
	assert.match(source, /\.react-shell \.react-movements-view :is\(input\[type="search"\], select, textarea\)\s*\{[^}]*font-size: 16px;[^}]*min-height: 44px/s);
});

test("mobile cycle calendar overrides both dimensions of the compact edit targets", async () => {
	const source = await css();
	assert.match(source, /\.react-financial-cycle-edit-dialog \.react-cycle-calendar-day,\s*\.react-financial-cycle-edit-dialog \.react-cycle-calendar-nav-button\s*\{[^}]*min-height: 44px;[^}]*height: 44px/s);
	assert.match(source, /\.react-financial-cycle-edit-dialog \.react-cycle-calendar-nav-button\s*\{[^}]*width: 44px/s);
});

test("mobile selection resets global field geometry inside a full-size label target", async () => {
	const source = await css();
	assert.match(source, /\.react-mobile-movements input\[type="checkbox"\]\s*\{[^}]*width: 20px;[^}]*height: 20px;[^}]*min-height: 20px;[^}]*padding: 0;[^}]*margin: 0/s);
	assert.match(source, /\.react-mobile-movement-selection\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px/s);
});
test("mobile header compacts only trigger text and external Gmail badge, keeping tabs and desktop identity", async () => {
	const source = await css();
	const mobile = source.slice(source.indexOf("@media (max-width: 800px)"));
	assert.match(mobile, /\.react-account-trigger-text,\s*\.react-gmail-connected-badge\s*\{\s*display: none/);
	assert.match(mobile, /\.react-account-trigger\s*\{[^}]*width: 44px;[^}]*min-height: 44px/s);
	assert.match(mobile, /\.react-app-header-inner\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/s);
	assert.match(mobile, /\.react-app-navigation\s*\{[^}]*grid-column: 1 \/ -1/s);
	assert.doesNotMatch(source.slice(0, source.indexOf("@media")), /react-account-trigger-text|react-gmail-connected-badge/);
});

test("menu hidden always overrides grid display and long menu identity wraps within the viewport", async () => {
	const source = await css();
	assert.match(source, /\.react-account-menu\[hidden\]\s*\{\s*display: none/);
	assert.match(source, /\.react-account-menu\s*\{[^}]*max-width: calc\(100vw - 24px\)/s);
	assert.match(source, /\.react-account-menu-identity\s*\{[^}]*overflow-wrap: anywhere/s);
});

test("shared mobile controls declare 16px fields and 44px targets without owning filter layout", async () => {
	const source = await css();
	assert.match(source, /:is\(input, select, textarea\)\s*\{[^}]*font-size: 16px/s);
	assert.match(source, /:is\(button, \.button\)\s*\{[^}]*min-height: 44px/s);
	assert.doesNotMatch(source, /react-movement-filter|react-summary|react-mobile-movement-card/);
});

test("native dialogs keep available-height scroll and do not force hidden dialogs open", async () => {
	const source = await css();
	assert.match(source, /dialog\[class\*="react-"\]\s*\{[^}]*max-height: calc\(100dvh - 24px\);[^}]*overflow-y: auto/s);
	assert.match(source, /max-height: calc\(100vh - 24px\)/);
	assert.match(source, /padding-bottom: max\(16px, env\(safe-area-inset-bottom\)\)/);
	assert.doesNotMatch(source, /dialog[^{}]*\{[^}]*display:/s);
	assert.doesNotMatch(source, /animation:|transition:|scroll-behavior: smooth/);
});

test("mobile header actions share one compact row while desktop labels and existing guards remain", async () => {
	const source = await css();
	const page = await read("src/client/pages/DashboardPage.tsx");
	assert.match(source, /\.react-dashboard-period-range-compact\s*\{\s*display: none/);
	assert.match(source, /\.react-shell \.react-dashboard-controls\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) 44px max-content;[^}]*width: 100%/s);
	assert.match(source, /\.react-shell \.react-dashboard-period-range-full,\s*\.react-shell \.react-dashboard-refresh-label\s*\{\s*display: none/);
	assert.match(source, /\.react-shell \.react-dashboard-period-range-compact\s*\{\s*display: inline/);
	assert.match(page, /title=\{formatPeriodLabel\(financialDashboard\.period\)\}/);
	assert.match(page, /className="react-dashboard-period-range react-dashboard-period-range-full"/);
	assert.match(page, /className="react-dashboard-period-range react-dashboard-period-range-compact"/);
	assert.match(page, /<span className="react-dashboard-refresh-label">Actualizar<\/span>/);
	assert.match(page, /onClick=\{financialDashboard\.onEditPeriod\}/);
	assert.match(page, /onClick=\{refreshFromHeader\}\s*disabled=\{isRefreshing\}\s*aria-busy=\{isRefreshing\}/);
	assert.match(page, /onClick=\{financialDashboard\.onCreateExpense\}/);
	assert.match(page, /aria-label=\{isRefreshing \? "Actualizando gastos del periodo" : "Actualizar gastos del periodo"\}/);
});

test("chart swipe cue and readable legend remain mobile-only and preserve horizontal scroll", async () => {
	const source = await css();
	const mobile = source.slice(source.indexOf("@media (max-width: 800px)"));
	assert.match(mobile, /\.react-spending-chart-bars\s*\{[^}]*overflow-x: auto;[^}]*scrollbar-width: auto/s);
	assert.match(mobile, /\.react-spending-chart-header::after\s*\{[^}]*content: "Desliza para ver más días →"/s);
	assert.match(mobile, /\.react-category-legend-item\s*\{[^}]*min-height: 44px/s);
	assert.match(mobile, /\.react-category-legend-item strong\s*\{[^}]*overflow-wrap: anywhere/s);
});
