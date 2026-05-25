# Auditoría responsive frontend — orderexpenses

> Alcance auditado: `public/index.html`, `public/styles.css`, `public/app.js`, `public/demo-data.json`. No se modificaron archivos fuente del proyecto. Desktop se considera perfecto; la propuesta sólo apunta a anchos `<1150px`, con enfoque mobile-first. Validación propuesta: checklist responsive, no screenshots.

## 1) Arquitectura UI actual

- La UI es una app estática servida desde `public/`: `public/index.html` define el shell, paneles base, templates y modales; `public/app.js` renderiza la mayor parte del contenido en DOM; `public/styles.css` concentra tokens, layout, componentes y media queries.
- `public/index.html:23-87` estructura el flujo principal: `.shell` → `.hero` con `#heroKpis`, `.product-panel` con `.panel-header`, controles de periodo/vista/acciones, `#dashboard.dashboard` y `#transactions.transactions-table-wrap`.
- `public/index.html:89-123` agrega el panel de configuración Gmail (`.setup-panel`, `.status-box`, `.progress-card`). `public/index.html:139-224` y posteriores definen modales (`dialog.modal`) para detalle, comercio, consentimiento, settings y nuevo gasto.
- `public/app.js:930-970` decide entre vista resumen y vista detalle, re-renderiza KPIs, dashboard o tabla según `state.view`.
- Dashboard dinámico en `public/app.js:1009-1118`: arma `monthStory`, `budgetToggle`, `budgetCard`, `metric-grid`, gráfico semanal, distribución por categoría, insights y breakdown.
- Tabla dinámica en `public/app.js:986-995` y `3146-3340`: genera `.table-summary`, `.bulk-action-bar`, `.transactions-table` con columnas `select`, `date`, `amount`, `counterparty`, `category` y acción. El wrapper `.transactions-table-wrap` ya tiene scroll horizontal.
- Gráficos:
  - `public/app.js:1901-1991` crea `.chart-card`, `.chart-tabs`, `.chart-body`, `.weekly-chart` y barras DOM (`.weekly-bar`).
  - `public/app.js:2345-2400` crea `.category-distribution-card`; usa ECharts desde CDN para donut si está disponible, con fallback DOM.
- Datos demo: `public/demo-data.json` contiene 23 movimientos, 22 `outflow` y 1 `inflow`; categorías variadas y counterparty corto. Es útil para smoke responsive, pero no cubre nombres muy largos.

## 2) Breakpoints actuales y áreas problemáticas bajo 1150px

### Breakpoints existentes

- Base desktop: `.shell { width: min(1200px, calc(100% - 32px)); margin: 40px auto; }` en `public/styles.css:170-173`.
- Sólo `.hero-kpis` cambia a 2 columnas en `max-width: 1024px` (`public/styles.css:188-198`) y a 1 columna en `max-width: 640px` (`public/styles.css:200-204`).
- La mayoría de la adaptación real ocurre recién en `max-width: 800px` (`public/styles.css:2427-2585`): reduce shell/panel, convierte headers a grid, métricas/dashboard/budget/story/counterparty a 1 columna, apila chart body, bulk bar, modal grid, settings.
- Ajuste extra en `max-width: 480px` (`public/styles.css:2587-2609`): apila `.period-controls`, KPIs a 1 columna y baja padding de KPI.

### Hueco principal: 801–1149px

Como desktop se considera perfecto, el riesgo está en que entre `801px` y `1149px` casi todo sigue con layout desktop. Sólo `hero-kpis` cambia a 2 columnas desde `1024px`; el resto espera hasta `800px`.

Áreas probables de fricción:

1. **Header de panel / controles**
   - `.panel-header` es `flex` con `justify-content: space-between` (`public/styles.css:363-369`) y `.button-row` es flex wrap alineado a la derecha (`public/styles.css:515-520`).
   - Los controles combinan `.period-controls` con mínimo de `170px`, view switch y botones (`public/styles.css:546-560`, `578-620`). En 900–1100px puede quedar comprimido o con wraps visualmente desordenados antes del breakpoint de 800.

2. **KPIs y cards de resumen**
   - `.hero-kpis` pasa de 4 a 2 columnas a 1024 (`public/styles.css:188-198`), bien encaminado.
   - `.metric-grid` sigue en 4 columnas hasta 800 (`public/styles.css:731-734`), aunque sus valores usan `clamp` y las cards tienen `min-height` (`public/styles.css:1039-1065`, `styles.css:737-754`). En 801–1024px puede verse apretado.

3. **Story/budget/dashboard grids**
   - `.month-story-card` usa 2 columnas hasta 800 (`public/styles.css:756-763`), con una columna derecha mínima de 220px. Puede funcionar en tablet landscape, pero en 850–950px pierde aire.
   - `.budget-card` usa dos columnas `minmax(260px, 1fr)` hasta 800 (`public/styles.css:930+`, `2480-2487`); requiere ~520px + gaps dentro de card, pero con paneles y copy largo puede sentirse justo.
   - `.dashboard-grid` usa 3 columnas hasta 800 (`public/styles.css:1431-1434`), sensible a textos como “Principal comercio/persona”.

4. **Gráfico semanal**
   - `.chart-body` mantiene tres columnas `200–260 / 1fr / 180–240` hasta 800 (`public/styles.css:1172-1180`). En 801–1100px puede caber matemáticamente, pero reduce legibilidad del detalle y resumen.
   - `.weekly-chart` tiene barras de `40px` y `min-height: 230px` (`public/styles.css:1376-1429`); el scroll horizontal se habilita recién bajo 800 (`public/styles.css:2524-2536`).

5. **Distribución por categoría**
   - Donut ECharts se crea inline con `260px` x `260px` (`public/app.js:2381-2383`). CSS sólo reduce `.category-donut-wrap > div` a `200px !important` bajo 800 (`public/styles.css:2443-2446`). En tablets angostas puede competir con leyenda.
   - `.category-distribution-body` actualmente ya es grid centrado, no columnas (`public/styles.css:1600+`), por lo que el riesgo es más de altura/scroll que de ancho.

6. **Tabla detalle**
   - `.transactions-table-wrap` usa `overflow-x: auto` (`public/styles.css:1837+` aprox.; auditado en la sección de tabla), lo que evita overflow global.
   - El modelo de tabla conserva 6 columnas (`public/app.js:3152-3158`) y celdas con padding amplio. Bajo 800 no se transforma a cards; simplemente se scrollea. Para mobile-first, eso es funcional pero no ideal.
   - `.table-summary` recién se apila bajo 800 (`public/styles.css:2505-2509`); `.bulk-action-bar` recién se apila bajo 800 (`public/styles.css:2511-2522`).

7. **Modales y formularios**
   - `dialog.modal` ya limita a `min(560px, calc(100vw - 32px))`; `.modal-grid` pasa a 1 columna bajo 800 (`public/styles.css:2573-2584`). Bien, pero en mobile conviene revisar altura y acciones sticky/no sticky según contenido.

## 3) Estrategia responsive propuesta

En vez de parchear desktop hacia abajo, conviene introducir una capa mobile-first para `<1150px` sin alterar el look desktop:

1. **Agregar breakpoint de tablet temprana en `max-width: 1149px`**
   - Objetivo: corregir el hueco 801–1149 sin tocar desktop.
   - Ajustes sugeridos: `.panel-header` con grid o flex column cuando el header y `.button-row` no entren; `.metric-grid` a 2 columnas; `.dashboard-grid` a 2 columnas; `.chart-body` a 2 columnas o layout vertical parcial; reducir gaps/padding moderadamente.

2. **Mantener `max-width: 800px` como transición a layout mobile real**
   - Ya existe y cubre muchos componentes. Reordenarlo hacia una lógica mobile-first sería ideal en refactor posterior, pero para una intervención acotada basta con fortalecerlo.
   - Bajo 800: headers, controles, métricas, charts, budget, modales y bulk actions deben ocupar 1 columna.

3. **Refinar `max-width: 640px` y `max-width: 480px`**
   - Confirmar targets táctiles, wraps de botones y lectura de importes.
   - Evaluar tabla: mantener scroll horizontal como mínimo aceptable; si se quiere UX mobile-first real, proponer cards/lista compacta para movimientos, pero eso aumenta alcance JS/CSS.

4. **No tocar desktop `>=1150px`**
   - Todos los cambios deberían vivir en media queries `max-width: 1149px`, `max-width: 800px`, `max-width: 640px`, `max-width: 480px`, o en reglas base sólo si son verdaderamente mobile-first y neutralizadas para desktop.

## 4) Checklist componente por componente

Validar manualmente en anchos: `1149`, `1024`, `900`, `801`, `800`, `640`, `480`, `360` px. No usar screenshots como criterio de aceptación; usar esta lista.

### Shell / fondo / spacing

- [ ] En `<1150px`, `body` no genera scroll horizontal global; sólo la tabla puede scrollear dentro de `.transactions-table-wrap`.
- [ ] `.shell` mantiene margen lateral respirable: 16px aprox. en tablet, 12px aprox. en mobile.
- [ ] `.panel` no se siente sobredimensionado en mobile; padding reducido sin romper jerarquía visual.

### Hero y KPIs

- [ ] `h1#heroTitle` y `.subtitle` no se cortan ni pisan KPIs.
- [ ] `#heroKpis .kp-card` queda en 2 columnas entre tablet y phablet si hay espacio; 1 columna en mobile angosto.
- [ ] Valores monetarios largos (`.metric-value`) no desbordan.

### Panel header y controles

- [ ] `.panel-header` no comprime el título/copy contra `.button-row` en 801–1149.
- [ ] `.period-controls`, `.view-switch`, `#newExpenseButton`, `#refreshButton`, `#syncGmailButton` tienen wrap ordenado y targets táctiles >=44px.
- [ ] En `<=480px`, selector de periodo y sincronizar se apilan correctamente.

### Dashboard summary/cards

- [ ] `.metric-grid` no usa 4 columnas por debajo de 1150 si las cards quedan estrechas; debe pasar a 2 y luego 1.
- [ ] `.dashboard-grid` pasa a 2 o 1 columnas antes de que los textos se trunquen mal.
- [ ] `.month-story-card` conserva orden lógico: historia → lista → acción en mobile.

### Budget

- [ ] `.budget-toggle-card` no deja el switch aislado o comprimido.
- [ ] `.budget-card` y `.budget-results` no mantienen columnas cuando los inputs/resultados quedan estrechos.
- [ ] `.income-candidate-option` e `.income-actions` permiten wrap sin overflow.

### Gráfico semanal

- [ ] `.chart-header` no cruza título con total.
- [ ] `.chart-tabs` scrollea horizontalmente si no entran los tabs.
- [ ] `.chart-body` deja de usar 3 columnas antes de que `.chart-detail`, `.weekly-chart` y `.chart-summary` queden ilegibles.
- [ ] `.weekly-chart` puede scrollear horizontalmente en mobile y las barras siguen siendo táctiles.

### Distribución por categoría

- [ ] Donut ECharts/fallback no excede el ancho disponible (`donutDom` inline 260px debe reducirse bajo breakpoints).
- [ ] `.category-distribution-legend` y `.category-detail-panel` mantienen scroll vertical interno sin cortar acciones.
- [ ] Textos largos de categorías usan ellipsis donde corresponde y no rompen el layout.

### Comercios/personas frecuentes

- [ ] `.counterparty-spend-row` cambia a 1 columna antes de mobile angosto.
- [ ] Botones “Seleccionar similares” y “Ver detalle” se apilan o ocupan ancho completo en mobile.
- [ ] Nombres de comercios largos siguen con ellipsis y no empujan acciones fuera.

### Tabla detalle

- [ ] `.transactions-table-wrap` contiene todo el scroll horizontal; `body` queda sin overflow-x.
- [ ] `.table-summary` se apila antes de que monto/detalle choquen.
- [ ] `.bulk-action-bar` se apila con select y botones full-width en mobile.
- [ ] Columnas `Comercio o persona` y `Categoría` siguen legibles con scroll; si no, considerar vista cards como mejora de mayor alcance.

### Modales/settings/forms

- [ ] `dialog.modal` cabe en viewport con margen lateral y scroll si el contenido supera altura.
- [ ] `.modal-grid` queda en 1 columna en mobile.
- [ ] `.modal-actions` no invierte de forma confusa acciones destructivas/primarias; todos los botones son full-width en mobile.
- [ ] `.category-settings-row` y `.category-form` se apilan correctamente.

## 5) Riesgo de implementación y workload de review

- **Riesgo bajo-medio si se limita a CSS responsive:** agregar `max-width: 1149px` y ajustar reglas existentes debería ser seguro porque la estructura DOM ya tiene clases por componente y muchos componentes ya están parcialmente preparados para apilarse.
- **Riesgo medio en gráficos:** el donut tiene tamaño inline (`public/app.js:2381-2383`) y ECharts requiere `chart.resize()`; CSS puede reducir el contenedor con `!important`, pero una solución limpia podría tocar JS para usar tamaño responsive o `ResizeObserver`.
- **Riesgo medio-alto si se rediseña la tabla como cards mobile:** implica cambios de render en `renderTableView`, `renderTransactionRow` o una vista alternativa; aumenta pruebas de selección masiva, sorting, highlight por categoría y acciones.
- **Workload estimado recomendado:**
  - CSS-only razonable: ~120–220 LOC revisables, principalmente `public/styles.css`.
  - CSS + pequeño ajuste JS para donut/chart sizing: ~180–300 LOC.
  - Tabla mobile tipo cards: +150–300 LOC adicionales y mayor carga de QA; no lo haría en la primera iteración salvo que sea requisito.

## 6) Preguntas abiertas

No hay preguntas bloqueantes para preparar el plan. Única decisión de producto antes de implementar: ¿la vista detalle en mobile debe seguir siendo tabla con scroll horizontal aceptable, o se quiere una lista/cards mobile-first? Recomiendo dejar tabla con scroll en primera iteración y evaluar cards como mejora posterior.

## Nota de memoria

La instrucción pidió guardar descubrimientos significativos en Engram con proyecto `orderexpenses`, pero en este subagente no hay herramientas `mem_*` disponibles. No se pudo persistir memoria desde este contexto.
