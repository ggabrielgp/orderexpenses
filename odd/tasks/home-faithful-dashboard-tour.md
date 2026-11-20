# Faithful landing dashboard and screen tour
Objective: faithful phone preview and a home screen gallery. Branch: framework_react.
Delivery: ask-on-risk; two independently reversible units, no publishing planned. Checks: Node tests, TypeScript/Vite build, browser check if available.

## Specs
S1. "quiero que la app dentro del diseño del telefono flotante sea fidedigna a lo que es realmente el dashboard, en especial sus graficos."
S2. "Y ademas en paralelo quiero que trabajes en agregar al home una seccion como la de https://inspectra-lovat-xi-52.vercel.app/#demo en la seccion con clase \"tour\", esto con las pantallas importantes de nuestro app, como lo son el modal de elegir periodo, tabla de gastos, agregar un gasto, categorizarlo, etc..."

S3. "si se ve mas fidedingo, pero siento que se le quita importancia al grafico de dias, quizas darle un poco mas de espacio, ya que las barras tocan arriba."
S4. "Y por otra parte la seccion nueva de \"demo\", los telefonos deben ser igual al de arriba, pero quizas reducirlo un poco todos en tamaño, y tambien agregar la pantalla de arriba (la de los graficos)."

S5. "ojo los telefonos de la demo deben estar derechos... y me gustaria con un componente tipo asi: C:\Users\Guzman\AppData\Local\Temp\pi-clipboard-85eabb96-fbf2-46fa-b01c-dee00b3495c1.png, tipo slider... sabes"

S6. "ojo no modifiques por nada del mundo el tamaño del telefono que teniamos antes de todos estos cambios, ese tamaño era perfecto."

S7. "me gusta como va quedando pero mira la parte de las demos, C:\Users\Guzman\AppData\Local\Temp\pi-clipboard-cdb21fff-3deb-4eaf-811e-a2568c493a07.png, hay un scroll abajo horrible, quitalo. Y ademas no estan centrados o sea watafac bro. Y agregale a ese slide animacione tipo carousel automatico lento, es decir que se vayan mostrando solas las pantallas pero lentamente avanzando a la siguiente"

S8. "quita el pausar recorrido, siempre tiene que estar funcionando. y cada 2 segundos. Ademas debe poder cambiar de pantalla del carrusel tambien simplemente arrastrando."

S9. "C:\Users\Guzman\AppData\Local\Temp\pi-clipboard-d1a235b2-a1a6-4615-b984-378211c85a8d.png. mira. al arrastrar al final es como si no quedara ninguno y debería dar la vuelta al priemro sin problema. revisa eso, ademas quita el texto de desliza para recorrer, ya que es evidente. tambien quita datos de ejemplo vista solo lectura"

S10. User request (verbatim):
```text
quita esos textos d ela seccion: Datos de ejemplo · vista de solo lectura

Desliza para recorrer las pantallas. Con teclado, enfoca la galería y usa las flechas.


04
Agregar un gasto
Registra también lo que no llegó por correo, con los datos del gasto.


05
Categorizar un gasto
Desde Editar movimiento, revisa su categoría y los demás datos.




01
Resumen de tu periodo
Tu total, saldo disponible y los gráficos que explican tus gastos.
```

## Tasks
T1 | S1-S2 | inline planning | done | commit: ace0660; shared synthetic data and disjoint worker surfaces defined; reference HTML verified.
T2 | S1-S2-S4-S5-S6 | concurrent foreground phone/tour workers + inline refinement | pending acceptance | commit: pending; source/own checks complete; independent Codex now PASS after correcting first-ready dashboard overflow. Full suite job-12 pending.
T3 | S1-S2 | inline landing integration | done | commit: pending work-unit boundary; integration RED 2/2 then GREEN; one abortable public fixture request supplies both previews and explicit failure message.
T4 | S1-S10 | inline checks + independent verifier | in_progress | commit: pending; corrected profile and authorized attempt used Codex/gpt-5.6-sol. Initial C1 overflow47.01px corrected; targeted revalidation PASS at1440/390/320 including touch. Full suite npm test job-12 running; native review pending applicable committed-only assessment. User directs source-only commit/push excluding allMarkdown/tests.

T5 | S3-S6 | inline refinement | pending acceptance (T4) | commit: pending; canonical width/aspect/min-height unchanged. Codex detected initial47.01px clipping; measure before paint via useLayoutEffect, apply scale directly in ResizeObserver and after fonts.ready. Own job-11 GREEN23/23/build/browser and targeted Codex revalidation PASS with0.46-0.53px bottom clearance at1440/390/320. Await full suite/commit, no further revalidation needed.

T6 | S7-S10 + S6 constraint | inline carousel refinement | pending acceptance (T4) | commit: pending; numbered captions/headings/descriptions and obsolete props/CSS removed; help/disclaimer absent, accessible names/five phones retained. Final own job-11 and independent targeted Codex revalidation PASS at1440/390/320, circular mouse/touch drag, native vertical scroll and2s cadence. Await full suite/commit.

## Log
L1. Original request: quiero que la app dentro del diseño del telefono flotante sea fidedigna a lo que es realmente el dashboard, en especial sus graficos. Y ademas en paralelo quiero que trabajes en agregar al home una seccion como la de https://inspectra-lovat-xi-52.vercel.app/#demo en la seccion con clase "tour", esto con las pantallas importantes de nuestro app, como lo son el modal de elegir periodo, tabla de gastos, agregar un gasto, categorizarlo, etc...
L2. Explorer succeeded after session profile rebinding. Reference HTML retrieved: .tour contains a horizontal .tour-track of individual phones plus captions. Existing hero uses invented bars; actual dashboard uses CategoryDistributionPanel (ECharts donut) and SpendingChartView/Panel (weekday columns). Public fixture and demo adapter are isolated from account API.
L3. Route: two independent units, each more substantial than an agent launch. Disjoint exact source/test surfaces and separate CSS modules; parent owns LandingPage and shared data hook. Foreground agents will be launched concurrently in one parallel tool call, respecting background-subagents off. Authenticated views, APIs, and routes remain unchanged. Preexisting untracked odd/tasks documents are excluded from this work.
L4. Initial forecast: approximately 380-500 authored lines, dependent on faithful view reuse. PR shape is not decided and no PR is requested; surface oversized review risk before any delivery step.
L5. Both foreground workers completed. Phone and tour observed RED before implementation and GREEN afterward. Their first typechecks saw the tour CalendarRange missing awaitingEnd; tour corrected it with createCalendarRange. Parent npx tsc -b (job-1) then exited 0. SSR does not prove pixels; browser check remains pending.
L6. Integration test initially had a Vite SSR/CJS harness error (require undefined); corrected the harness to existing React imports/config pattern before behavioral RED. Valid RED then reported missing tour and missing failure state; GREEN passed 17 focused checks. Existing landing-navigation tests emitted Vite dependency scan shutdown warnings despite exit 0; report these separately from failures. Full build job-2 launched.
L7. Browser RED: actual donut clipped at 320px; original tour screens clipped edit controls and expense rows at narrow width. Fixed minimum hero screen height, scaled the real-size donut canvas, increased tour phone height and completed the real period modal fields after a focused RED/GREEN test. First visual recheck then found period content 701px versus 676px available; scaled that illustration to .85. Final build passed; final layout recheck is running at 1440/390/320px.
L8. Earlier suite job log disappeared when background-job registry changed; its result is unavailable, not a pass. A final suite over the corrected candidate is running with durable output data/landing-preview-proof/tests-final.log. No default profile/model changes or publishing were performed. Current authored diff is approximately 984 lines including tests/CSS; a delivery strategy decision is required before the next commit.
L9. Final browser attempt: desktop1440 passed real canvas, seven bars, all four screen contents within 676px and keyboard scrolling. Subsequent390 navigation timed out waiting for previews (12s), so final390/320 proof is unavailable; no further browser retry. Required independent verifier mv7n6m0r-1-r4ne failed before tools: child log shows deepseek/deepseek-flash with HTTP402 Insufficient Balance, not intended Codex. Do not retry or claim verification. Native inspect excluded unrelated untracked docs, but another ASSESS still returned unassessable; no lineage START or review verdict exists. Stop as Needs your decision; implementation remains staged, no source commit/push/PR.
L10. User refinement (verbatim): a ver... C:\Users\Guzman\AppData\Local\Temp\pi-clipboard-d2b53c71-1c0b-45d1-8a61-7bf1de61eddc.png, si se ve mas fidedingo, pero siento que se le quita importancia al grafico de dias, quizas darle un poco mas de espacio, ya que las barras tocan arriba. Y por otra parte la seccion nueva de "demo", los telefonos deben ser igual al de arriba, pero quizas reducirlo un poco todos en tamaño, y tambien agregar la pantalla de arriba (la de los graficos).
L11. Screenshot confirms compressed weekday chart. Refinement stays inline: hero and tour must share a phone frame, so this is one coupled edit unit rather than parallel disjoint writes. Add optional chart IDs with legacy defaults to support two preview instances without duplicate IDs. Prior verifier/model blocker remains unresolved; new UI request does not silently change model routing.
L12. Refinement observed RED (5 failures), then 17/17 focused GREEN and build exit0. Browser job-6 found padding ineffective for absolute fills; scaleY(.86) preserves bar ratios and reserves headroom. Job-8 confirmed headroom at1440px but found dashboard tour content extending ~75px below its body; 390/320 checks did not execute. No source commits or publishing; independent verifier blocker unchanged.
L13. User correction (verbatim): ojo los telefonos de la demo deben estar derechos... y me gustaria con un componente tipo asi: C:\Users\Guzman\AppData\Local\Temp\pi-clipboard-85eabb96-fbf2-46fa-b01c-dee00b3495c1.png, tipo slider... sabes
L14. Screenshot shows upright phones with centered captions, previous/next chevrons and compact position indicators, the active indicator elongated. Implement this within the existing tour, using native horizontal scrolling without dependencies or autoplay. Scope upright styling to the tour, not the hero. Existing account forms remain inert.
L15. S5 RED reproduced missing arrows/dots, upright styling and centered snap. First implementation18/19: indicator assertion included calendar aria-current; scoped to dots, then19/19 GREEN. Browser exposed missing final centering gutter; max-content list width fixed it. At320px, minimum12px gutter prevented initial centering; allow0px minimum. Navigation then passed1440/390/320, but diagnostic clipping remained. Compact preview legend min-height/copy margins and avoid modal typography leaking into dashboard; raise shared frame to760px. Final19/19 focused GREEN and job-13 exit0: build (existing chunk-size warnings), upright smaller tour phones, preserved hero tilt, arrows/dots/Home/End/Left/Right, active/disabled bounds, unique IDs, daily bar headroom and clipping:none in all3 viewports. Durable geometry/screenshots: data/landing-preview-proof/refinement-*. Current native ASSESS again unassessable because unrelated untracked files lack declaration; separate independent verifier required. No native review lineage, source commits or publishing. Stop for exact verifier profile/retry decision, not more automatic verification.
L16. User correction (verbatim): ojo no modifiques por nada del mundo el tamaño del telefono que teniamos antes de todos estos cambios, ese tamaño era perfecto.
L17. HEAD confirms original .landing-phone width:min(328px,calc(100% - 8px)), aspect-ratio:20/41, min-height:0. The760px workaround violates S6; restore original frame and adapt content instead. Keep earlier requested tour scaling and upright orientation. Reopen only T5; independent verifier blocker unchanged.
L18. S6 RED observed for enlarged frames and missing fitting wrapper. Remove all frame height overrides, derive tour illustration height from328*41/20, and measure untransformed content vs available body height; scale only content. CSS-isolation assertion caught an unscoped wrapper rule; scoped to hero/tour. Final20/20 focused GREEN; job-14 exit0 (build with chunk-size warnings and browser). Original maxwidth328,20/41 aspect ratio,minHeight0 explicitly asserted for all six frames, alongside navigation, headroom, unique IDs and clipping:none at1440/390/320. Previous760px candidate superseded. No source commit/push/PR; independent verification blocker remains.
L19. User correction (verbatim): me gusta como va quedando pero mira la parte de las demos, C:\Users\Guzman\AppData\Local\Temp\pi-clipboard-cdb21fff-3deb-4eaf-811e-a2568c493a07.png, hay un scroll abajo horrible, quitalo. Y ademas no estan centrados o sea watafac bro. Y agregale a ese slide animacione tipo carousel automatico lento, es decir que se vayan mostrando solas las pantallas pero lentamente avanzando a la siguiente
L20. Screenshot reproduces visible scrollbar and blank left half from first-slide edge gutters. Keep original phone size; center the selected screen with cyclic neighbors, recycling existing keyed children without clones. Add7s dwell/1.2s autoplay, pause/resume, interaction and visibility suspension and reduced-motion opt-out. Earlier no-autoplay route L14 is superseded by S7. Inline coupled slider/CSS unit; no independent model/profile retry.
L21. S7 RED observed for missing hidden-scrollbar rule, cyclic centered ordering and pause control. Final21/21 focused GREEN and build job-15 exit0 with existing chunk-size warnings. Browser job-16 exit0 at1440/390/320: scrollbar-width:none and WebKit display:none, selected-screen center, cyclic arrows/dots/Home/End/Left/Right, reduced-motion opt-out, unique IDs, original20/41/max328/minHeight0 frames and clipping:none. Desktop real-clock autoplay measured7107ms dwell and1125ms transition; pause held8.5s and resume advanced. Screenshot inspected: selected phone balanced between neighboring screens, no blank left half. Hover/focus/visibility suspension implemented but not separately exercised by this browser probe. Broader verifier/profile/full-suite/delivery blockers unchanged; no source commit or publishing. ASSESS on the normalized S7 candidate again returned unassessable (untracked declaration), requiring separate independent verification; no review lineage exists.
L22. User correction (verbatim): quita el pausar recorrido, siempre tiene que estar funcionando. y cada 2 segundos. Ademas debe poder cambiar de pantalla del carrusel tambien simplemente arrastrando.
L23. User authorized continuation: continua. Reviewed delivered earlier worker outputs; their original partial typecheck/calendar issues were already resolved and superseded by parent builds. No new verifier output exists. Existing preview job-5 exited1073807364 after56m, with missing API backend proxy errors; not a source-test failure and not a confirmed timeout. Diagnose separately; use a new local static proof server for the updated candidate, not an automatic retry of the old process.
L24. Implement a fixed2s interval (not2s dwell plus animation), no pause control or hover/focus gating. Only avoid fighting an active drag. Preserve native touch pan; mouse Pointer Events use capture and displacement to change screens. Motion-reduced users still advance, without animation. Size invariant S6 unchanged.
L25. S8 RED observed for pause UI and missing grab/grabbing support. Final22/22 focused GREEN; build job-1 exit0 with existing chunk-size warning. Separate anonymous static preview job-2 on4177 serves dist without API proxy/account access. Browser job-3 exit0: real mouse drag both directions, real native touch drag, arrows/dots/keyboard, centered cyclic screens, hidden scrollbar, no pause control, original max328/20:41/min-height0 dimensions and clipping:none at1440/390/320. Real-clock intervals1993ms with reduced motion and1999.9ms with animation, continued while hovered/focused. Older7s/pause proof superseded. No source commits/publishing; independent verifier and full-suite/delivery blockers unchanged.
L26. User correction (verbatim): C:\Users\Guzman\AppData\Local\Temp\pi-clipboard-d1a235b2-a1a6-4615-b984-378211c85a8d.png. mira. al arrastrar al final es como si no quedara ninguno y debería dar la vuelta al priemro sin problema. revisa eso, ademas quita el texto de desliza para recorrer, ya que es evidente. tambien quita datos de ejemplo vista solo lectura
L27. Screenshot shows a blank gallery edge with a held/long drag. Reproduce before assuming current loop works: add real long mouse input and assert both gallery edges remain populated throughout. Existing recycling occurs on settle, which is suppressed while dragging; fix recycling during drag rather than enlarging frames or cloning IDs. Remove section help/disclaimer and associated dangling aria-describedby/CSS only; keep inert previews and chart facts. Independent verifier blocker unchanged.
L28. Original browser RED job-4 exit1 reproduced109.524px blank edge; separate copy-removal RED recorded. First recycling revision job-5 build passed and1440px long drag passed, but390px touch failed;320px not reached. Horizontal native compositor scrolling conflicted with scrollLeft rebasing, so unify mouse/touch using Pointer Events/capture and CSS pan-y pinch-zoom for native vertical scrolling/zoom. No independent retry or source commit.
L29. Final job-6 exit0:22/22 focused GREEN, build passed (existing >500kB chunk warning), public browser1440/390/320 no clipping/original phone dimensions. Held long mouse drag crosses last↔first with both edges populated; held touch wraps last→first, releases centered, and native vertical page scrolling passes. Cyclic arrows/dots/keyboard, hidden scrollbar, no pause UI and2s cadence while hovered/focused continue passing. Both redundant section texts absent; inert controls/chart facts unchanged. S9 own checks complete, T6 pending T4 acceptance; previous native assessment/independent verifier/full-suite/delivery blockers unchanged.
L30. User correction (verbatim):
```text
quita esos textos d ela seccion: Datos de ejemplo · vista de solo lectura

Desliza para recorrer las pantallas. Con teclado, enfoca la galería y usa las flechas.


04
Agregar un gasto
Registra también lo que no llegó por correo, con los datos del gasto.


05
Categorizar un gasto
Desde Editar movimiento, revisa su categoría y los demás datos.




01
Resumen de tu periodo
Tu total, saldo disponible y los gráficos que explican tus gastos.
```
L31. Help/disclaimer already absent from S9. Remove shared visible caption block and unused step/description props/CSS without deleting phones or accessible screen names. Caption removal test RED observed (tour-captions-red.log); no source change/verification yet.
L32. Removed common caption markup plus unused step/description props and CSS; retained title for accessible illustrations/dot names, actual internal screen headings and five phone frames. Job-7 exit1: new test mistakenly banned all h3 elements including actual phone content; build/browser not run. Scoped assertion to outer caption headings. Final job-8 exit0:23/23 focused GREEN, build success with existing >500kB warnings, public browser1440/390/320 verifies no numbered captions/help/disclaimer and original dimensions/no clipping. Arrows/dots/keyboard, held circular mouse/touch drag, native vertical page touch and2s cadence preserved; slider logic/frame unchanged for S10. T6 own outcome complete, pending T4 acceptance; prior independent-verifier/full-suite/delivery blockers remain. No source commits/publishing.
L33. User: "ojo pero antes de estos cambios haz commit y push de lo que habiamos hecho antes." User: "sin subir los md y los test obviamente". Steep styling remains unimplemented; publish previous CODE ONLY, retaining local Markdown/tests.
L34. User explicitly selected "Sí, reorganizar conservando los archivos" for the unpublished planning commit, no force-push; initially verifier profile "Todavía no está listo", then user: "ya esta listo el profile correspondiente". One new independent attempt authorized.
L35. Codex/openai-codex/gpt-5.6-sol medium mv8m5npp-1-q1gl:23/23 focused PASS; public browser failed initial dashboard overflow47.01px at1440, before mobile. Correct LandingPhoneFrame to measure in useLayoutEffect and apply transform directly rather than deferred React state, guarded fonts.ready refit; preserve hardware. Own job-11 exit0 (23/23/build/browser). Targeted Codex mv8mglen-2-prvs exit0: no clipping at1440/390/320, locked dimensions, touch/vertical scroll completed. Initial-ready regression assertion added to ignored browser proof; no new full sweep.
L36. Remote fetch job-10 exit0, origin/framework_react confirmed a23335f35bf27549217bfa33ccd7199a2157b2fc. Authorized soft reset ace066072d778d71269ab4e6e6a32bf1a570b129 to that parent; planning commit remains in reflog, not publication history. All21 changed/untracked files hashed before/after and preserved byte-for-byte. README, this local spec and four tests unstaged; exactly10 src files staged, zero Markdown/tests,928 insertions/58 deletions. No source commit/push yet. Full suite npm test job-12 pending.
