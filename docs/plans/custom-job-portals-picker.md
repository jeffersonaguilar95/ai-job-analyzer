# Wizard visual "point-and-click" para agregar portales de empleo sin código

## Contexto

Hoy solo existe un `SiteAdapter` (LinkedIn), escrito a mano en `extension/src/adapters/linkedin.ts` como
expresiones JS en texto evaluadas vía CDP (`Runtime.evaluate`) — requiere saber TypeScript, CSS selectors
y el DOM del sitio. El usuario pidió explícitamente que **cualquier persona sin conocimientos de
programación** pueda agregar su propio portal, y de las opciones presentadas (config JSON+formulario,
selector visual point-and-click, o ambas por fases) **eligió el selector visual point-and-click**: la
persona hace clic directamente sobre la página real del portal (tarjeta de empleo, título, empresa,
etc.) y la extensión genera los selectores CSS automáticamente — cero CSS, cero JS, cero texto que
escribir salvo un nombre y opcionalmente saltarse campos opcionales.

Esto es coherente con el principio ya documentado en `CLAUDE.md` ("Adapter pattern is the extension point
for new job sites") y con la regla de "todo pasa por `chrome.debugger`, nunca content scripts" — el picker
se implementa 100% con el mismo mecanismo (`Runtime.evaluate` + `Input.dispatchMouseEvent`) que ya usa
`background.ts::runLoop`, sin agregar `content_scripts` ni `chrome.scripting`.

Un sub-agente de planeación exploró el repo a fondo y propuso un diseño basado en `Runtime.addBinding` +
eventos `Runtime.bindingCalled` para el canal de reporte del picker (evita polling bloqueante dentro de
un handler de mensaje). Lo evalué y decidí **no usarlo**: introduce un dominio CDP nuevo (`Runtime.enable`,
`addBinding`, `onEvent`) que no puedo probar en un navegador real desde este entorno, y este proyecto ya
tiene un patrón probado y funcionando para exactamente este problema (esperas largas, cancelables, sin
bloquear el service worker): polling desde un lugar que **no muere** — no el service worker de MV3, sino
la pestaña de `options.html`, que es una página normal de larga vida mientras el usuario la mantenga
abierta. Esto simplifica el diseño y elimina la necesidad de un `PickerState` persistido en storage o de
lógica de reanudación tras un reinicio del service worker: `options.ts` es la única fuente de verdad del
progreso del wizard (en memoria, en esa pestaña), y cada mensaje al background es una operación corta y
sin estado (`arma este paso`, `¿ya hicieron clic?`, `prueba esta config`). Si el service worker muere entre
un poll y el siguiente, el próximo mensaje simplemente lo despierta (todo mensaje de `chrome.runtime`
despierta un service worker terminado — comportamiento garantizado de MV3) y re-adjunta el debugger si
hace falta; nada se pierde porque el estado nunca vivió ahí.

También recorté el alcance de campos capturables: sin `salary` como paso del wizard (se puede agregar
después; no es esencial para que un portal nuevo funcione) para mantener el flujo lo más corto posible,
tal como pidió el usuario.

## Diseño final

### 1. Esquema de storage — `extension/src/lib/storage.ts`

Nueva sección, mismo estilo que `Settings`/`RunState` (una key de storage, merge sobre defaults):

```ts
export interface FieldSelector {
  selector: string;
  /** true: se resuelve por tarjeta con `card.querySelector(selector)`.
   *  false: se resuelve una sola vez, página-completa, con `document.querySelector(selector)`
   *  (p. ej. un panel de detalle que aparece fuera de la tarjeta, como en LinkedIn). */
  relativeToCard: boolean;
}

export interface CustomAdapterConfig {
  id: string;           // `custom-<slug>-<random6>`, asignado al guardar
  label: string;         // nombre que puso la persona, p. ej. "Indeed"
  urlPattern: string;    // prefijo literal; matches(url) = url.startsWith(urlPattern)
  cardSelector: string;
  fields: {
    title: FieldSelector;
    company: FieldSelector | null;
    location: FieldSelector | null;
    description: FieldSelector;       // requerido: sin texto no hay nada que puntuar
    url: FieldSelector | null;        // opcional; si falta, se usa location.href (igual que el fallback de LinkedIn)
  };
  nextPageSelector: string | null;    // null = sitio de una sola página
  timings: AdapterTimings;            // v1: defaults fijos, sin UI de ajuste
  createdAt: string;
  updatedAt: string;
}

const CUSTOM_ADAPTERS_KEY = 'customAdapters';
export async function listCustomAdapters(): Promise<CustomAdapterConfig[]>
export async function saveCustomAdapter(config: CustomAdapterConfig): Promise<void> // upsert por id
export async function deleteCustomAdapter(id: string): Promise<void>
```

### 2. Extracción de helpers compartidos — nuevo `extension/src/adapters/shared.ts`

Saca de `linkedin.ts` (sin cambiar su comportamiento) las dos únicas piezas genéricas:
- `rectExprFor(elementExpr: string): string`
- `scrollContainerRectExprFor(firstCardExpr: string): string` (el truco de "subir hasta el ancestro
  scrolleable más cercano", generalizado para recibir la expresión de la primera tarjeta como parámetro)

`linkedin.ts` pasa a importarlas de `./shared` en vez de definirlas localmente.

### 3. El adapter genérico — nuevo `extension/src/adapters/generic.ts`

`buildGenericAdapter(config: CustomAdapterConfig): SiteAdapter`, traduce la config capturada al mismo
contrato `SiteAdapter` (strings de expresión JS) que ya consume `background.ts`:

- `countCardsExpr` / `cardRectExpr` / `scrollContainerRectExpr`: triviales con `rectExprFor`/`scrollContainerRectExprFor`.
- Resolución de campo (dual, relativo-o-absoluto, en ese orden):
  ```ts
  function resolveFieldExpr(cardExpr: string, field: FieldSelector | null): string {
    if (!field) return `''`;
    return field.relativeToCard
      ? `((${cardExpr})?.querySelector(${JSON.stringify(field.selector)})?.innerText?.trim() ?? '')`
      : `(document.querySelector(${JSON.stringify(field.selector)})?.innerText?.trim() ?? '')`;
  }
  ```
- `detailReadyExpr`: listo cuando la misma resolución de `description` da texto no vacío.
- `extractExpr(index)`: arma `{jobId, title, company, location, salary: '', url, text, workplaceType: 'unknown'}`.
  - `workplaceType` siempre `'unknown'` — **no se construye detección de tipo de lugar de trabajo para
    adapters genéricos**; ya existe el fallback vía `matching-service` (`score.go` le pide al modelo leer
    el tipo desde el texto cuando el DOM reporta `'unknown'`, y `finalizeScore` en `background.ts` ya
    aplica la misma política de descarte) — los portales nuevos heredan el filtro de "workplace" gratis,
    sin tocar esa lógica.
  - `jobId`: **hash de contenido** de `title|company|location` (no hay nada tan confiable como el
    `componentkey`/URL canónica de LinkedIn en un sitio genérico). Documentar inline como limitación
    conocida (dedup más débil: dos postings distintos con título/empresa/ubicación idénticos colisionan).
  - `url`: usa el `FieldSelector` de `url` si existe; si no, `location.href` (igual fallback que LinkedIn).
- `nextPageRectExpr`: `rectExprFor(...)` si hay `nextPageSelector`, si no el string literal `'null'`
  (mismo contrato ya documentado en `types.ts`: "returns null if there isn't one").

### 4. El script inyectado del picker — nuevo `extension/src/lib/picker.ts`

Funciones puras que devuelven strings de JS para `evaluate()`, mismo patrón que `linkedin.ts`. Todo vive
en `window.__aiPicker__` dentro de la página (nunca en el service worker):

```
buildArmStepScript(step, cardSelector | null): string
buildPollScript(): string       // lee y limpia window.__aiPicker__.result; retorna el resultado o null
buildDisarmScript(): string     // remueve listeners/overlay si quedaron activos
buildOpenFirstCardScript(cardSelector): string  // usado antes de armar el paso "description"
buildTestExtractScript(config, index): string   // arma un SiteAdapter temporal in-memory y corre extractExpr(0)
```

**`buildArmStepScript`** instala (vía un IIFE evaluado una vez por paso):
- Un overlay `position:fixed` que resalta el elemento bajo el cursor en cada `mousemove` (con
  `document.elementFromPoint`).
- Un listener de `click` en `document` con `capture:true` que hace `preventDefault()` +
  `stopImmediatePropagation()` **antes que nada** — el clic real de la persona nunca navega ni dispara
  nada del sitio; solo identifica el elemento.
- Al hacer clic: calcula el selector (ver algoritmo abajo), lo guarda en `window.__aiPicker__.result`, y
  se auto-desarma (remueve sus propios listeners y el overlay).
- Reemplaza cualquier instalación anterior de forma idempotente (`window.__aiPicker__?.disarm?.()` al
  principio) — así rearmar un paso, o recuperarse de un service worker reiniciado, siempre parte de un
  estado limpio.

**Heurística para el paso "tarjeta"** (encontrar el ancestro que se repite — la técnica estándar de
"find the repeating template" que usan las herramientas de scraping): subir desde el elemento clickeado
hasta 8 niveles; en cada nivel construir `tag.clase1.clase2...` y contar `document.querySelectorAll(sel)`;
devolver el primer ancestro cuyo conteo esté en `[2, 500]` y cuya altura sea razonable
(`< 2 * innerHeight`). El primer nivel que cumple casi siempre es la tarjeta individual, no el contenedor
de la lista (que da conteo 1).

**Selector para campos dentro de la tarjeta** (`title`/`company`/`location`): si `el.closest(cardSelector)`
existe, construir una ruta relativa a esa tarjeta vía `nth-child` (`:scope > div:nth-child(2) > h2`).

**Selector absoluto** (`description`/`url`/`nextPage`, o campos de tarjeta que resultan estar fuera de
ella): ruta `nth-child` desde `document.body`, **con un atajo**: si algún ancestro en el camino tiene
`id`, cortar ahí y usar `#ese-id` como raíz (mucho más estable que una cadena larga de `nth-child`, mismo
criterio de estabilidad que ya se usa a mano en `linkedin.ts`).

```js
function pathFrom(root, target) {
  const parts = [];
  for (let n = target; n && n !== root; n = n.parentElement) {
    if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); return parts.join(' > '); }
    const idx = [...n.parentElement.children].indexOf(n) + 1;
    parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${idx})`);
  }
  return parts.join(' > ');
}
```

**Paso "description"**: como el contenido casi siempre vive en un panel que solo existe tras un clic real
(igual que LinkedIn), antes de armar este paso `background.ts` dispara `buildOpenFirstCardScript` +
`realClick` (reutilizando `scrollUntilVisible`/`realClick` de `cdp.ts`, exactamente como hace `runLoop`)
sobre la primera tarjeta encontrada, para que la persona pueda hacer clic sobre la descripción ya
visible. Si el sitio en realidad muestra la descripción completa dentro de la misma tarjeta (sin panel),
no pasa nada malo: el clic no cambia nada nuevo y el selector resultante sale `relativeToCard: true` de
forma natural.

**Preview en vivo**: justo después de cada paso de campo, `background.ts` corre una evaluación extra que
aplica el selector recién capturado sobre hasta 5 tarjetas de muestra y devuelve
`{matched, sampled, examples}` — se muestra en el wizard sin pasos adicionales.

### 5. Protocolo de mensajes — `extension/src/lib/messaging.ts`

Todas sin estado del lado del background (options.ts es quien recuerda en qué paso va):

```ts
| { type: 'PICKER_ARM_STEP'; tabId: number; step: PickerStepId; cardSelector: string | null }
| { type: 'PICKER_POLL'; tabId: number }              // {picked: null} o {picked: {...}}
| { type: 'PICKER_DISARM'; tabId: number }
| { type: 'PICKER_OPEN_FIRST_CARD'; tabId: number; cardSelector: string }
| { type: 'PICKER_PREVIEW_FIELD'; tabId: number; cardSelector: string; field: FieldSelector }
| { type: 'PICKER_TEST'; tabId: number; config: CustomAdapterConfig }
| { type: 'PICKER_SAVE'; config: CustomAdapterConfig }
| { type: 'LIST_CUSTOM_ADAPTERS' }
| { type: 'DELETE_CUSTOM_ADAPTER'; id: string }
```

`background.ts` agrega estos casos al switch de `chrome.runtime.onMessage` que ya existe, reusando
`attach`/`evaluate`/`realClick`/`scrollUntilVisible` de `cdp.ts`. `PICKER_ARM_STEP`/`PICKER_DISARM` hacen
`attach(tabId)` de forma tolerante (si ya está adjunto, `chrome.debugger.attach` rechaza — capturar y
seguir). Nada de esto bloquea un handler esperando el clic: `PICKER_ARM_STEP` retorna apenas instala los
listeners; es `options.ts` quien llama a `PICKER_POLL` cada ~700ms con `setInterval` hasta recibir un
resultado no nulo.

### 6. Cómo se entera options.ts de qué pestaña configurar — permiso `activeTab`

`chrome.tabs.query` no devuelve `url`/`title` reales para pestañas fuera de `host_permissions`, y los
portales nuevos por definición nunca están ahí. Agregar `"activeTab"` a `permissions` en
`manifest.json` (sin warning de instalación, otorga acceso temporal a la pestaña activa en el momento en
que la persona invoca la extensión — el clic en el ícono que abre el popup ya califica).

Flujo:
1. Persona en la pestaña del portal nuevo → clic en el ícono → se abre `popup.html`.
2. Si `findAdapter(tab.url)` da `null`, el popup muestra un botón "🎯 Agregar este portal" (en vez de, o
   junto a, el error "No adapter for this URL" que ya existe en `start()`).
3. Clic en ese botón → `chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '?tabId=' + tab.id + '&url=' + encodeURIComponent(tab.url) })`.
4. `options.ts` lee `tabId`/`url` de su propio query string (sobrevive a todo, incluido un reinicio del
   service worker, porque vive en la URL de la pestaña).

`options.html` abierto sin esos parámetros (vía un link "Gestionar portales" en el popup, usando
`chrome.runtime.openOptionsPage()`) muestra solo la lista de adapters guardados (editar/borrar/probar) —
**v1 no soporta iniciar una captura nueva desde ahí mismo**, porque el gesto de clic ocurriría en la
pestaña de opciones, no en la del portal objetivo, y no hay forma de redirigir `activeTab` a otra pestaña
sin pedir el permiso mucho más amplio `"tabs"`. Limitación explícita, no un descuido.

Agregar a `manifest.json`: `"options_ui": { "page": "options.html", "open_in_tab": true }` (no el
`options_page` viejo) — `open_in_tab: true` es lo que garantiza que la página quede en una pestaña
normal e independiente en vez de embebida en `chrome://extensions`, que es justo lo que se necesita:
**el popup se cierra apenas la persona hace clic en la otra pestaña**, así que el wizard no puede vivir
ahí.

### 7. Registro async — `extension/src/adapters/registry.ts`

```ts
export async function findAdapter(url: string): Promise<SiteAdapter | null> {
  const builtIn = [linkedinAdapter].find((a) => a.matches(url));
  if (builtIn) return builtIn;
  const customs = await listCustomAdapters();
  const match = customs.find((c) => url.startsWith(c.urlPattern));
  return match ? buildGenericAdapter(match) : null;
}
```

Único call site a actualizar: `background.ts::start()` — `const adapter = findAdapter(tab.url!);` pasa a
`await findAdapter(tab.url!)`.

### 8. Wizard UI — nuevo `extension/public/options.html` + `extension/src/options.ts`

HTML/TS plano, mismo estilo inline que `popup.html` (sin framework). Estado del wizard en memoria dentro
de `options.ts` (un objeto simple con lo capturado hasta el momento). Pasos:

1. **Bienvenida** — hostname de la pestaña objetivo (leído del query string), campos de texto editables
   `label` (precargado del hostname) y `urlPattern` (precargado con origin + primer segmento de path).
2. **Tarjeta** — "Ve a la otra pestaña y haz clic sobre un aviso de empleo completo." Al recibir el pick:
   "Encontramos 24 elementos parecidos en la página — ¿se ve bien?" [Sí, continuar] / [No, intentar de
   nuevo] (vuelve a armar el mismo paso).
3. **Título** (requerido) — igual patrón, con preview: "Coincide en 5/5 tarjetas de muestra. Ejemplos:
   '…', '…'."
4. **Empresa / Ubicación** (opcionales) — mismo patrón + botón [Omitir].
5. **Descripción** (requerido) — el background abre el detalle de la primera tarjeta automáticamente
   (spinner: "Abriendo el primer aviso…") antes de armar el paso.
6. **URL** (opcional) — "Haz clic en el enlace o título que lleva al aviso completo (opcional)." Si se
   omite: aviso corto de que todos los resultados exportados compartirán la misma URL.
7. **Página siguiente** (opcional) — "Haz clic en el botón de 'siguiente página'" o [Omitir — este
   portal no tiene paginación].
8. **Revisar y guardar** — tabla de campo → valor de ejemplo capturado (los selectores CSS quedan
   escondidos detrás de un "Avanzado" colapsado — la persona nunca necesita verlos); [Guardar].
9. **Probar** — botón que corre `PICKER_TEST` (arma el adapter con `buildGenericAdapter` y evalúa
   `countCardsExpr`/`extractExpr(0)` sobre la pestaña real) y muestra inline título/empresa/
   ubicación/descripción extraídos. [Se ve bien, listo] termina y hace `detach`; [Algo está mal] regresa
   al paso correspondiente sin perder el resto.
10. **Vista de gestión** (cuando `options.html` se abre sin `tabId`): lista de adapters guardados con
    Editar (reabre el wizard precargado, salta directo a Revisar) / Borrar / Probar, vía
    `LIST_CUSTOM_ADAPTERS`/`DELETE_CUSTOM_ADAPTER`.

### 9. Cambios de build/manifest

- `extension/esbuild.config.mjs`: agregar `'src/options.ts'` a `entryPoints`.
- `extension/public/options.html`: nuevo archivo (se copia solo, ya que `cpSync('public','dist')` copia
  todo `public/`).
- `extension/public/manifest.json`: agregar `"activeTab"` a `permissions`; agregar
  `"options_ui": {"page": "options.html", "open_in_tab": true}`.
- `extension/public/popup.html` / `popup.ts`: botón "🎯 Agregar este portal" (se muestra cuando
  `START` falla con "No adapter for this URL") + link "Gestionar portales" (`chrome.runtime.openOptionsPage()`).

### 10. Documentación

- `CLAUDE.md`, sección Architecture: nueva subsección describiendo el wizard — sigue siendo cero content
  scripts (`Runtime.evaluate` para todo, incluido el picker), `registry.ts::findAdapter` ahora es async.
- `CLAUDE.md`, sección "Known placeholder / to calibrate": nuevas notas sobre (a) el `jobId` por hash de
  contenido siendo más débil que el de LinkedIn, (b) la fragilidad de los selectores `nth-child`
  relativos ante rediseños del sitio — esperar que la persona tenga que re-correr el wizard si el portal
  cambia su HTML.
- `README.md`: actualizar "cómo agregar un portal nuevo" para mencionar ambos caminos (adapter escrito a
  mano, o el wizard visual para quien no programa).

### 11. Alcance explícito v1 — qué se deja afuera

- Sitios de scroll infinito sin botón "siguiente" real: se tratan como una sola página (igual que hoy
  cuando `nextPageRectExpr` da `null`).
- Muros de login/CAPTCHA/2FA a mitad de la automatización: mismo supuesto que ya existe hoy para LinkedIn
  (la persona debe estar logueada manualmente antes de correr el proceso).
- Sitios donde la heurística de "tarjeta repetida" no encuentra un ancestro con clases distintivas: el
  wizard lo reporta y pide reintentar el clic; sin fallback a atributos tipo `componentkey` en v1.
- Navegación de página completa a una URL de detalle separada (no un panel tipo SPA): v1 asume un detalle
  estilo LinkedIn (panel que aparece sin cambiar de página).
- Shadow DOM / iframes de otro origen en los listados: `querySelectorAll`/`elementFromPoint` no los
  atraviesan; `Runtime.evaluate` corre en el frame/contexto principal.
- Iniciar una captura nueva desde la pestaña de `options.html` misma (sin pasar por el popup) — ver
  punto 6.

## Archivos a tocar

- `extension/src/lib/storage.ts` — `CustomAdapterConfig`, `FieldSelector`, CRUD.
- `extension/src/adapters/shared.ts` (nuevo) — `rectExprFor`, `scrollContainerRectExprFor`.
- `extension/src/adapters/linkedin.ts` — importar de `shared.ts` en vez de definir localmente.
- `extension/src/adapters/generic.ts` (nuevo) — `buildGenericAdapter`.
- `extension/src/adapters/registry.ts` — `findAdapter` async, merge built-in + custom.
- `extension/src/lib/picker.ts` (nuevo) — scripts inyectables del picker.
- `extension/src/lib/messaging.ts` — nuevos tipos de mensaje.
- `extension/src/background.ts` — `await findAdapter(...)` en `start()`; handlers nuevos del picker.
- `extension/public/manifest.json` — `activeTab`, `options_ui`.
- `extension/public/options.html` (nuevo) + `extension/src/options.ts` (nuevo) — wizard + vista de gestión.
- `extension/public/popup.html` / `extension/src/popup.ts` — botón "Agregar este portal" + link "Gestionar portales".
- `extension/esbuild.config.mjs` — entry point de `options.ts`.
- `CLAUDE.md`, `README.md` — documentación.

## Verificación

No hay navegador real disponible en este entorno para probar el flujo de clics en vivo (mismo límite que
ya aplicó a los selectores de LinkedIn, marcados como placeholders a calibrar). Verificación disponible:

- `yarn typecheck` y `yarn build` en `extension/` después de cada pieza — deben pasar sin errores en todo
  momento.
- Revisión manual de cada script inyectado (leerlo tal como quedaría armado, con valores de ejemplo) para
  confirmar que la sintaxis JS generada es válida.
- Dejar documentado explícitamente en `CLAUDE.md` (sección "Known placeholder / to calibrate") que el
  wizard completo necesita una prueba en vivo contra un portal real (p. ej. Indeed) antes de confiar en
  él — mismo tratamiento que ya recibieron los selectores de LinkedIn.
- Commits pequeños y frecuentes por pieza lógica (storage → shared.ts → generic.ts → registry.ts →
  picker.ts → mensajería/background.ts → manifest+build → options UI → popup UI → docs), según la
  convención ya establecida en `CLAUDE.md`.
