# Save feedback and perceived save speed

Unify the success check for every mutation, fix the dark-mode toast overlay, and stop blocking dialogs on the post-save dashboard reload.

## Specs
- S1: "las que hacen alguna modificacion de categoria muestran un check debería ir para todos los que guardan algo" — every successful save/delete shows the centered success check (movements, manual expense, period, bulk category, actual balance, categories, counterparty rules, undo, Gmail sync/disconnect).
- S2: "en el telefono al menos lo vi pero cuando aparecia el fondo que era la app se desaaparecia hasta que el check se desaparece ahi recien vuelve la app" — the app stays visible behind the check (dark mode painted the full-screen overlay).
- S3: "ve como optimizar al velocidad de guardado" — chosen: "Cerrar al guardar y recargar en segundo plano". The dialog closes and the check appears as soon as the server confirms; the dashboard reloads in the background; a failed reload shows one stale-list warning with a retry.
- S4: chosen: "Check 'Eliminado' y cerrar" — removals close at once with the check, no intermediate result screen.
- S5: chosen: "Sí, solo check; banner para errores" — success banners that duplicate the check are removed; banners stay for errors, stale reloads and actions such as Deshacer.

## Tasks
- T1 (S2) dark-mode toast overlay fix + regression test — inline — uncommitted→final commit
- T2 (S1) toast provider lifted to the page, rendered in the top layer above dialogs; settings, Gmail and reconciliation use it — inline
- T3 (S3) background reload + stale notice + parallel cycle/transactions refresh — inline
- T4 (S4) immediate removal close + local hide of removed rows — inline
- T5 (S5) drop duplicate success banners — inline
- T6 tests, build, push to main (user: "luego de que termines sube todo a main")

## Log
- L1: "quiero que revises la experiencia de usuario en todas las ejecuciones de servicios, viendo como optimizarlas, agrupandolas por tipo como por ej las que hacen alguna modificacion de categoria muestran un check debería ir para todos los que guardan algo ademas revisa ese check ya que en en el telefono al menos lo vi pero cuando aparecia el fondo que era la app se desaaparecia hasta que el check se desaparece ahi recien vuelve la app. Tambien ve como optimizar al velocidad de guardado."
- L2: answers: speed = background reload; removals = check and close; duplicates = only check, banners for errors.
- L3: "Sobre esta mejoras toma acciones, sobre tus recomendaciones y ejecuta. yo tengo que hacer otra cosa, asi que no preguntes solo ejecuta."
- L4: "luego de que termines sube todo a main"
- L5: decision: the period edit keeps its foreground reload when the period itself changes (income-only already patches locally); showing old-period numbers under a "Período actualizado" check would be wrong.
