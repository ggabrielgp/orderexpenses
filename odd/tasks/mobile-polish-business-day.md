# Mobile polish and last-business-day period

Four fixes from one request: the manual expense sheet on mobile, an auto-dismissing period notice,
the movements view on mobile, and a "último día hábil" pay day choice. User asked to ship to main.

## Specs
- S1 — "el modal de agregar gasto en mobile se ve mal y al parecer no respeta el diseño del producto."
  → the Nuevo gasto dialog uses the product sheet design of the period dialog (grab handle, title,
  white bordered fields, money field with `$`/`CLP`, sticky footer with Cancelar + wide primary).
- S2 — "El mensaje de Periodo guardado y resumen acutalizado, despues de unos segundo se debe ir, con una animacion smooth."
- S3 — "En movimientos hay cosas que no se adaptan a mobile" (screenshot: the selection bar squeezes
  "Sin selección", the category select and its buttons into broken columns; sort chips wrap).
- S4 — "me gustaria que elmodal para selecionar periodo, donde dice desde mi dia de pago, sería bueno incluir una opcion de ultimo dia habil del mes."

## Tasks
- [x] T1 (S4) — `lastBusinessDayCycle` + "Último día hábil" chip; weekends move to the previous Friday (no holiday calendar). Route: inline, test-first (RED→GREEN). Commit 7e92670.
- [x] T2 (S2) — success period notice fades out after 4 s (pausable on hover/focus, immediate under reduced motion). Route: inline, test-first. Commit 88b85c7.
- [x] T3 (S1) — expense dialog on the cycle sheet shell; verified with mobile and desktop screenshots. Commit b817f5d.
- [x] T4 (S3) — movements mobile: bulk bar stacked, sort chips one scrollable row, card meta aligned; also fixed the floating selection bar rendering below the page (shell transform). Verified with screenshots. Commit f92ec88.

## Log
- L1 — User request (verbatim): "el modal de agregar gasto en mobile se ve mal y al parecer no respeta el diseño del producto.
El mensaje de Periodo guardado y resumen acutalizado, despues de unos segundo se debe ir, con una animacion smooth.
En movimientos hay cosas que no se adaptan a mobile, te adjunto captura: [Image#1].
y me gustaria que elmodal para selecionar periodo, donde dice desde mi dia de pago, sería bueno incluir una opcion de ultimo dia habil del mes.
Hazlo todo no me preguntes, que yo voy a salir ahora, cuando esté listo subelo a main, para pasar a prod."
- L2 — User: "continua".
- L3 — Visual checks ran against the Vite dev server with mocked `/api` responses (Playwright, 412×800 and 1280×860).
