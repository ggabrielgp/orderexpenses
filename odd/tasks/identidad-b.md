# Identidad B · Semáforo sereno

Restyle the authenticated product to identity direction B (`design/identidad-gastos/02,05-08`) plus UX improvements that reuse the current API.
Worktree `../gastoscontrolados-identidad`, branch `feat/identidad-b` from `main` 8e5fb82. Baseline: `npm run build && npm test` → 385/385 pass.

## Specs

- **S1 — No loss.** "el sitio no debe perder funcionalidad, ni visualizacion de la informacion". Every panel, action and piece of information in the current inventory stays reachable and visible: app header (Gmail conectado badge, account menu with Configuración and Cerrar sesión), dashboard header (greeting, title, period context, period button, Actualizar, Nuevo gasto), lead (total gastado, saldo disponible, % del ingreso disponible, Al límite / En peligro), budget panel (income, budget card), Distribución de gastos, spending chart (tabs, bars, summary, day panel, note), Dónde se fue tu plata (donut, legend, detail), Top Comercios y Personas, insights, financial warning, feedback notices, all dialogs; movements view (header, 4 metrics, pending note, filters, kind tabs, active filters, bulk actions, mobile list, table with Ver/Editar/Eliminar); demo view (read-only badge, footer); loading, failed and unconfigured states. New elements are additive or a restyle of the same element.
- **S2 — Identity.** Direction B "Semáforo sereno": state colors en ritmo `#0b7a6b` (soft `#e2f3ef`), ajustado `#9a6700` (soft `#fdf3d8`), pasado `#b4412f` (soft `#fbe9e5`), track `#efeee9`; keep canvas `#f6f5f2` and ink `#131b2e`. Logo = the month gauge mark (ring + "today" tick), used in the app header, landing header/footer and as favicon. `index.html` gains favicon, meta description, Open Graph/Twitter title+description and a web manifest. Existing tokens stay (tests pin them); new tokens are added.
- **S3 — Month gauge.** The summary shows the gauge from artboard 02/08: "Te quedan" + remaining amount, "$X por día" for the days left, % of income spent vs % of cycle elapsed (ring + tick), a state with word and icon — "En ritmo", "Ajustado", "Pasado" — and a sentence "Llevas N% del ingreso y pasó el M% del ciclo. Si sigues así, cierras con unos $X de sobra." (or "…terminas unos $X bajo cero."). Rules: elapsed = days elapsed including today / cycle days (0 before start, 1 after end); spent = totalSpending / income; Pasado when remaining < 0 or spent > elapsed + 0.10; Ajustado when spent > elapsed; else En ritmo; projection = totalSpending / elapsed. Without income: no state, and an action to add the income. Works in the demo.
- **S4 — Mobile navigation.** On narrow screens the view navigation becomes a bottom bar (Resumen, Movimientos) with a central "Agregar gasto" button that opens the same manual-expense dialog; hidden in the demo where creation is disabled. Desktop keeps the top header restyled.
- **S5 — States.** Empty summary offers actions ("Agregar gasto", "Actualizar") next to the existing copy; loading keeps the skeleton; failed state says data already saved is safe and keeps "Reintentar resumen financiero".
- **S6 — Manual expense.** Amount first, large, `inputmode="numeric"`, thousands formatting while typing; date defaults to now when inside the period; jargon "Catálogo de solo lectura" replaced by plain copy. All fields and validation stay.
- **S7 — Recategorize with rule + undo.** When changing a movement's category, an option "Usar siempre para <comercio>" saves a counterparty rule in the same step; the confirmation offers "Deshacer", which restores the previous category and the previous rule state.
- **S8 — Onboarding.** Step 1 (unauthenticated): trust in 3 points — "Qué leemos", "Qué nunca hacemos", "Cómo salir" — plus a link to the demo. Step 2 (cycle setup): presets "Mes calendario" and "Desde mi día de pago" that fill the existing date inputs; calendar and inputs stay. Step 3: after the first cycle setup, a dismissible explanation of how to read the gauge.
- **S9 — Honest consent.** Consent copy states that Google grants read access to the whole Gmail and the app filters Banco de Chile mails; data the user applies is stored on the server tied to the account (not "localmente"); no mention of a monthly budget that does not exist.
- **S10 — No backend.** "Lo anterior + mejoras de UX sin backend": no server, schema or API changes; only existing endpoints.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S2 | worker W1 (brand, tokens, index.html, public/) | — |
| T2 | S3 | worker W2 (pace model + gauge component, unmounted) | — |
| T3 | S6 | worker W3 (manual expense dialog) | — |
| T4 | S8, S9 | worker W4 (consent copy + onboarding connect component, unmounted) | — |
| T5 | S1, S3, S5 | inline: mount gauge, empty/failed actions, reskin summary panels | — |
| T6 | S1, S4 | inline: mobile bottom bar + add button | — |
| T7 | S7 | inline/worker: recategorize rule + undo | — |
| T8 | S8 | inline: cycle presets, first-result explainer, mount onboarding connect | — |
| T9 | S1–S10 | verify: full build + suite, inventory check, differential review | — |

## Log

- **L1** (user, verbatim): "Me gusta, pero ojo el sitio no debe perder funcionalidad, ni visualizacion de la informacion. Pero el diseño esta buenisimo. Mandale"
- **L2** (user decisions): Dónde → "Worktree aparte (recomendado)". Alcance → "Lo anterior + mejoras de UX sin backend" (identity + layout with all current panels intact, plus onboarding 3 steps, manual expense amount-first, recategorize with rule and undo, honest consent copy; no topes/budgets).
- **L3** (user, earlier): chose direction B only ("dale con la B solamente"); rejected the B+C topes mix (artboard 04).
- **L4** (evidence): the shared worktree moved to `main`; `framework_react` is merged into `main`, so the branch starts from `main` 8e5fb82. Baseline tests need `dist/` (run build first).
- **L5** (decision): desktop keeps the top header (restyled) instead of the side rail of artboard 08, to avoid moving header behavior that tests and users rely on; the rail can be a follow-up.
