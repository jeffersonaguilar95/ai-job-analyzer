# AI Job Analyzer

Extensión de Chrome que recorre los resultados de una búsqueda de empleo que
**vos ya hiciste manualmente** (login y búsqueda incluidos), y puntúa cada
oferta de 0 a 100 contra tu CV, usando un servicio local en Go que llama a la
API de Claude para el razonamiento del match.

**No aplica automáticamente a nada.** Solo lee, extrae texto y muestra un
ranking. El click "Start" lo das vos desde el popup; nunca arranca solo.

## ⚠️ Aviso legal

Esta extensión automatiza clicks y scrolls reales (vía `chrome.debugger` / CDP)
sobre páginas de LinkedIn ya autenticadas con tu sesión. **Automatizar
interacciones en LinkedIn puede violar sus Términos de Servicio** y exponerte a
una restricción o baneo de cuenta. Este proyecto es de uso personal/educativo;
usalo bajo tu propio criterio y riesgo. No está afiliado a LinkedIn ni a
ningún otro portal.

## Cómo funciona (arquitectura)

```
┌─────────────────────────┐        fetch localhost         ┌──────────────────────┐
│  Extensión (TS, MV3)     │ ─────────────────────────────▶ │ matching-service (Go) │
│                          │                                 │  (próxima fase)       │
│  popup:  Start / Stop /  │                                 │  - parsea tu CV (PDF) │
│          export CSV/JSON │                                 │  - llama a Claude API │
│                          │ ◀───────────────────────────── │  - devuelve score 0-100│
│  background: loop de     │        { score, reasoning }     └──────────────────────┘
│  scoring, controlado por │
│  chrome.storage.local    │
│         │                │
│         ▼ chrome.debugger (CDP)
│  clicks/scrolls REALES  │
│  sobre la pestaña activa │
└─────────────────────────┘
```

- **Sin eventos sintéticos**: los clicks y scrolls se disparan con
  `Input.dispatchMouseEvent` sobre el protocolo CDP (`chrome.debugger`), no con
  `element.click()` ni `window.scrollTo()`. Esto es intencional: permite
  verlo actuar "como si fuera vos" con el mouse, para poder monitorearlo en
  vivo mientras calibrás selectores/timings.
- **Arquitectura de adapters**: cada portal (LinkedIn, y a futuro otros) es un
  objeto `SiteAdapter` (`extension/src/adapters/`) con los selectores y
  expresiones JS propias del sitio. El loop en `background.ts` no conoce
  detalles de ningún portal — solo llama a la interfaz del adapter.
- **Resumable**: el progreso (`currentIndex`, resultados ya obtenidos) vive en
  `chrome.storage.local`. Un "Detener" no reprocesa lo ya hecho.
- **Comunicación con el servicio Go**: `fetch` a `http://localhost:8787`. Si el
  servicio no está corriendo, la extensión sigue funcionando igual (guarda
  `score: null`) — útil para probar el prototipo de click/scroll sin depender
  de Go todavía.

## Estructura del repo

- `extension/` — extensión Chrome MV3 en TypeScript (esqueleto ya funcional).
- `matching-service/` — servicio de scoring en Go (CV + Claude API). **Todavía
  no implementado**, ver `matching-service/README.md`.

## Extensión: cómo correrla en local

```bash
cd extension
yarn install
yarn build      # o `yarn watch` para rebuild automático
```

Luego en Chrome: `chrome://extensions` → activar "Modo de desarrollador" →
"Cargar descomprimida" → seleccionar `extension/dist`.

Uso:
1. Andá manualmente a `linkedin.com`, logueate y hacé tu búsqueda de empleo.
2. Con esa pestaña activa, abrí el popup de la extensión y tocá **Start**.
3. Vas a ver la extensión clickeando y scrolleando la lista de resultados como
   si fuera un mouse real (Chrome muestra un banner de "esta extensión está
   depurando este navegador" — es esperado, es justamente lo que te permite
   monitorearla).
4. **Detener** en cualquier momento pausa sin perder lo ya procesado; **Start**
   de nuevo retoma desde donde quedó.
5. Exportá CSV/JSON con los resultados ordenados de mayor a menor score.

### Agregar un portal nuevo

Escribí un `SiteAdapter` nuevo en `extension/src/adapters/` (selectores +
timings propios del sitio) y sumalo en `extension/src/adapters/registry.ts`.
El loop de `background.ts` no requiere cambios.

## Estado / roadmap

- [x] Esqueleto de la extensión (manifest MV3 + permiso `debugger`).
- [x] Prototipo de click/scroll real vía CDP + adapter de LinkedIn (selectores
      a calibrar en vivo).
- [x] Loop resumable, popup con Start/Stop, export CSV/JSON.
- [ ] `matching-service` en Go: parseo de CV en PDF + llamada a Claude API.
- [ ] Calibración en vivo de selectores/timings contra LinkedIn real.
- [ ] Adapters para otros portales (2–4h adicionales cada uno).
