# Order Expenses

Privacy-first personal expense dashboard for Banco de Chile Gmail movements.

## What it does

- Connects Gmail with read-only OAuth.
- Reads Banco de Chile transactional emails for the selected period.
- Parses movements at runtime instead of storing every Gmail-derived expense permanently.
- Stores only local configuration and user-authored data:
  - OAuth sessions/tokens/profile data
  - manual movements
  - movement corrections/overrides
  - hidden movement flags
  - category rules by counterparty
  - custom categories and colors
  - view/budget preferences where applicable

## Home previews

The home promises **Tus comprobantes, convertidos en un resumen claro**, not unattended sync or
budget editing. The process has three steps: **Conecta Gmail → Elige y sincroniza el periodo →
Revisa tus gastos**. **Probar demo** opens `/app/demo`, with **Sin conectar tu cuenta** beside it.
The security section distinguishes broad read-only Gmail consent from bank/period-filtered queries,
runtime processing from stored tokens/profile and user-authored data (including period/income settings),
and local disconnection from Google permission revocation. It states that no automatic deletion period
is defined and links to Google's third-party connections for revocation.

The floating phone uses the dashboard's actual weekday chart, category donut and balance views,
with the same synthetic `/demo-data.json` fixture as the public demo. The home loads that fixture
once for both the phone and the **Recorrido por la app** gallery; a failed load shows an explicit
message instead of invented figures.

The horizontal gallery includes the dashboard charts, period selection, the mobile expense table,
adding an expense and categorizing it through **Editar movimiento**. Its five phones reuse the hero's
frame at a smaller scale and upright. The slider has previous/next arrows,
position indicators and touch/keyboard navigation. Screens loop around the centered selection without
cloning forms or IDs. Autoplay starts an advance every 2 seconds with a 1.2-second transition,
without pause controls or hover/focus suspension. Drag with the mouse or swipe on touchscreens to
change screens; long drags recycle the existing screens during the gesture so the gallery wraps
without an empty end. The tour omits numbered titles/descriptions and swipe notices, but shows one gallery-wide notice
that the screens are illustrations: their fields/buttons cannot be used and do not save changes.
Previews remain inert and retain accessible screen names.
An active drag takes priority over an automatic tick. Reduced-motion preferences
keep automatic advances running but make transitions instantaneous.
The original phone dimensions remain fixed (up to 328px wide, aspect ratio 20:41).
Only the illustrated content scales to fit the available screen; the daily chart retains its extra headroom. Calendar and movement views are shared with the
app; form previews are inert, read-only illustrations with no account writes. Swipe the gallery or
focus it and use arrow keys. **Explorar la demo** opens `/app/demo` without connecting an account.
The demo starts on **Resumen**; **Movimientos** opens the production movement table with synthetic
expenses, search, filters, sorting and read-only details. Movements are not appended below the summary.
**Ver gastos** in a demo category detail opens **Movimientos** filtered by that category.
Demo navigation is local and never enables editing, deletion or account writes.
The demo explicitly labels its example data and explains **Edición deshabilitada en la demo**;
unavailable selection and bulk-edit controls are omitted, while browsing and details remain available.
Both dashboard views show the available period below the title, without inventing dates while loading.
A positive balance percentage names the income remaining, not a safety rating or trend.
Period budgeting is not yet available.

Check the home at 320px, 390px and desktop widths: both charts must fit inside the floating phone,
and the gallery must scroll without widening the page. Focused checks:
`node --test test/landing-dashboard-preview.test.js test/landing-tour.test.js test/landing-preview-integration.test.js test/landing-preview-refinement.test.js`.
Shared chart views accept optional heading/detail IDs for repeated illustrations; the dashboard's
existing identifiers remain their defaults.

## Dashboard loading

The first financial load shows layout-matched skeleton cards and charts with the message
“Preparando los movimientos de tu período...”. Placeholders are decorative: they do not show
estimated progress, provisional balances or pretend that an empty period has been confirmed.
The navigation remains available, and the existing retry and financial-cycle setup states are preserved.

“Gmail conectado” means Gmail authorization is available, not that all movements have been read.
Refreshes keep the previous dashboard visible while loading. Skeleton shimmer and the short
content reveal are disabled when the system requests reduced motion.

This improves the waiting experience; it does not change Gmail reads or shorten their duration.
To check the initial state locally, open `/app` in a fresh tab (not a duplicated tab with its existing
session cache). Use DevTools network throttling if the load is too fast to observe, and check both
**Resumen** and **Movimientos**. A normal reload may reuse the existing tab's dashboard cache.

## Dashboard feedback and dialogs

Settled save confirmations show a short decorative check only on success; warnings and errors
remain readable. The account menu, movement selection toolbar and category-view height changes
use short motion without delaying controls or data. The weekday spending chart uses the same measured
200ms height transition when switching periods or selected-day details, including days without expenses.
The active highlights in the chart tabs and period-summary rows slide from the previous selection to
 the current one over 200ms, adapting to different sizes and wrapped tabs. Layout changes refresh their
 positions without motion; static previews retain their active backgrounds.
Controls stay mounted and usable; rapid changes cancel superseded motion. Live system reduced-motion
preferences disable these transitions. Check populated/empty days and rapid tab changes locally;
automated effect/SSR checks do not establish browser animation playback.

Clicking a native dialog's backdrop requests the same cancellation as Escape. Clicking inside,
dragging from inside to outside, or a pending operation's cancellation veto does not dismiss it.
The initial period setup can also be dismissed while idle; **Configurar período** reopens it with
its current draft. Fields retain existing labels, validation, disabled/read-only states and keyboard use.

To check locally, try backdrop versus dialog padding, Escape and reopening, native movement
checkboxes, pending save/removal guards, nested account/disconnect dialogs and light/dark themes.
Also enable reduced motion. Automated EventTarget/SSR tests do not establish real-browser focus
trapping, restoration or visual playback.

## Mobile dashboard

On narrow screens, the account trigger uses a compact avatar; identity and Gmail connection state
remain available inside its menu. The existing **Resumen** and **Movimientos** navigation stays in place.
The period, refresh and **Nuevo gasto** controls share one mobile row. The period displays a compact
`DD/MM–DD/MM` range and refresh uses its icon; the complete date range and refresh state retain their
accessible names. Desktop keeps the full dates and the **Actualizar** text. At widths up to 640px,
**Total gastado** and **Saldo disponible** share a compact row, followed by the weekday spending
chart and category distribution. Income/budget information and secondary analyses remain below.
Week tabs use three compact columns with 44px minimum height; all seven weekday bars fit without
horizontal scrolling at 320–640px. Dashboard-only mobile labels abbreviate approximate CLP amounts
(for example, **$194 mil**); digits stay together and a note points to exact amounts in day detail.
Full amounts remain in accessible names and hover titles. Desktop and static home illustrations keep their layout.
Tapping a chart day opens its detail in a native modal, including days without expenses; the default
selection and period-tab changes do not open it. Close with **Cerrar**, Escape or the backdrop.
Desktop retains its inline selected-day panel. Resizing closes an open day modal rather than keeping
a stale overlay; opening a movement closes the day modal first. The read-only demo shares this
presentation without adding editing or writes. Static home previews remain unchanged.

At widths up to 760px, movements use cards instead of the desktop table. Cards share the same
filtered and sorted rows, selection, select-all, similar-counterparty selection and bulk-category
controls. **Detalle y acciones** exposes the existing view/edit/delete actions; read-only rows retain
their detail view. Search and secondary filters can be expanded, with active filters visible even
when collapsed. The inactive table/card projection is removed from layout and keyboard navigation.
Mobile fields, touch targets and native-dialog scrolling are adapted without changing validation,
cancellation guards or submit behavior. Desktop keeps its table and analytics columns.

To check locally, inspect 320, 375, 390, 480 and 768px widths, then desktop. Try long account names,
large amounts, category jumps, mixed/all/empty selection, expanded filters and read-only movements.
Check that all seven chart days and week tabs fit without horizontal scrolling at 320, 390 and 640px,
including very large amounts. Also check reduced motion, dialogs with the virtual keyboard and focus after closing.
Automated SSR/callback tests check shared actions and markup; they do not establish rendered viewport
sizes, touch behavior, keyboard occlusion or native focus handling.

## Gmail read performance

Full Gmail messages are downloaded with at most **four concurrent calls per read**. Query pagination,
selected-period coverage, deduplication and returned message order stay unchanged; period reads are
not cut off at 200 messages. A failed detail download stops new dispatch, waits for already-started
calls and keeps the existing manual-only fallback. This does not add retries, caching or permissions.

Manual dashboard synchronization reads the complete configured period and reuses the returned
assembled movements, without a second Gmail read or a financial-cycle change. Reuse also updates
the current account's tab cache. Partial/unusable responses or intervening refreshes/state changes
retain the fresh-load fallback. Logout or unmount discard the result without starting another account
load; **Actualizar** still fetches fresh data. `POST /api/gmail/sync` with `period` and no `limit` now exhausts pagination, matching the period
GET. Explicit limits and the month-mode default keep their existing 200-message-per-query cap.

To check in DevTools → **Network**, clear the list and click **Sincronizar**: an ordinary successful
sync sends one `/api/gmail/sync` POST without a following `/api/transactions` GET. A fallback may
still send that GET. Deterministic coverage: `npm test -- test/gmail-sync-reuse.test.js`.

Authenticated `GET /api/transactions` responses include a `Server-Timing` header:

| Stage | Measured work |
| --- | --- |
| `gmail-list` | Gmail query traversal and pagination |
| `gmail-details` | Full-message downloads and email decoding |
| `transactions` | Transaction assembly, including Gmail, parsing and local configuration reads |

Durations are milliseconds from a monotonic clock. The header contains fixed names and numeric
values only, without account identifiers, tokens or email content. Durations are recorded even when
Gmail falls back after a failure; timing does **not** establish success or completeness. The transaction
JSON remains unchanged. These timings do not include prior session/profile requests, initial database
setup, browser downloads or rendering.

To measure your real first load, open DevTools → **Network**, enter `/app` in a fresh tab, and inspect
`/api/transactions` → **Response Headers** → `Server-Timing` (or the request's **Timing** panel).
An existing tab's dashboard cache can avoid that request entirely. Repeat with the same period and
compare stages; the controlled fixture below is not a real Gmail speed guarantee:

```bash
npm test -- test/gmail-performance.test.js
```

## Requirements

- Node.js >= 24
- Gmail API OAuth credentials
- Optional for deploy: Turso database and Vercel project

## Install

```bash
npm install
```

## Run locally

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

For frontend development with watch mode:

```bash
npm run dev
```

This starts the Node backend at `http://127.0.0.1:3000` and the Vite development server together. The process coordinator shuts both down together, so Vite proxy requests always have a running backend. Open the Vite app at:

```text
http://localhost:5173
```

Google login returns to the domain and port where you started, not to a fixed frontend URL.
The registered Google callback stays on the backend; the return origin is validated and bound
into single-use OAuth state. Production domains must match `APP_BASE_URL` or `VERCEL_URL`;
unconfigured local development supports loopback hosts at any frontend port. See
[Gmail return-origin setup](./GMAIL_SETUP.md#return-to-the-pages-original-domain) for details.

## Test

```bash
npm test
# Focused selection uses project-relative test filenames:
npm test -- test/test-isolation.test.js test/test-runner-platform.test.js
```

The launcher allowlists the child environment (including only `SystemRoot` as
Windows-native infrastructure). Application configuration and `NODE_OPTIONS` are
scrubbed; database, credential-file and network guards remain active. Foundation
and landing SSR fixtures disable env-file loading, dependency discovery, file
watching and HMR/WebSockets.

## Gmail setup

See [`GMAIL_SETUP.md`](./GMAIL_SETUP.md).

## Environment examples

Use the checked-in templates and replace placeholder values only:

```text
.env.example
.env.turso.example
.env.vercel.example
```

## Deploy

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the Turso + Vercel + Gmail OAuth steps.

## Local data

By default the app stores local runtime/configuration data in:

```text
data/finance.db
```

When `TURSO_DATABASE_URL` is set, the same async database layer uses Turso/libSQL instead.

The `data/` folder is intentionally ignored by git because it can contain private financial data and OAuth credentials.

## Important privacy note

This app is designed so Gmail-derived expenses are parsed for the current view/period and are not stored as a permanent full transaction history. User-created configuration, rules, manual movements, and corrections are stored locally so the app can remember the user's decisions.
