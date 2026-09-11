# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome extension (Manifest V3) that walks a job search the user already ran
manually on LinkedIn (and, later, other job boards via a per-site adapter),
scores each posting against the user's CV, and shows a ranked list. It never
applies to anything automatically, and it never starts on its own — only from
the popup's Start button. Full write-up and legal/ToS disclaimer: `README.md`.

Two independent parts, at different stages:
- `extension/` — TypeScript, Manifest V3. **Functional skeleton exists.**
- `matching-service/` — Go service (CV parsing + Claude API for scoring).
  **Not implemented yet** — currently just `matching-service/README.md`
  describing the planned `POST /analyze` contract. `background.ts` already
  calls this endpoint and degrades gracefully (`score: null`) when it's not
  running, so the extension is testable standalone.

## Commands

All commands run from `extension/`. Use **yarn**, not npm, for this project.

```bash
yarn install
yarn build      # bundles src/ -> dist/ with esbuild, copies public/ (manifest.json, popup.html)
yarn watch      # same, rebuilds on change (re-run `build` once if you edit manifest.json/popup.html — watch only bundles TS)
yarn typecheck  # tsc --noEmit
```

Load `extension/dist` as an unpacked extension via `chrome://extensions` →
Developer mode → "Load unpacked". There is no test suite yet.

## Architecture

**Everything that acts on the page goes through `chrome.debugger` (CDP), not
content scripts or synthetic DOM events.** This is a deliberate, load-bearing
choice, not an implementation detail:
- Clicks/scrolls use real `Input.dispatchMouseEvent` (mouseMoved/Pressed/Released,
  mouseWheel in small steps) — never `element.click()` / `window.scrollTo()` —
  so the automation is visually indistinguishable from a human driving the
  mouse and can be watched live.
- DOM reads (counting cards, extracting job text) also go through
  `Runtime.evaluate` rather than a content script, keeping a single code path
  and a minimal permission set (`debugger`, `storage`, `downloads` — no
  `scripting`, no broad `content_scripts`).
- All of this lives in `extension/src/lib/cdp.ts`; nothing else in the
  extension talks to `chrome.debugger` directly.

**Adapter pattern is the extension point for new job sites.** A `SiteAdapter`
(`extension/src/adapters/types.ts`) is a plain object of JS-expression
strings (as text, evaluated via CDP) plus per-site timings — not a class
hierarchy. `background.ts`'s loop only calls the `SiteAdapter` interface and
has zero LinkedIn-specific knowledge. To support a new portal, add one file
under `extension/src/adapters/` and register it in `registry.ts`; do not
touch `background.ts`.

**State machine lives in `chrome.storage.local`**, not in memory, via
`extension/src/lib/storage.ts` (`RunState`: status idle/running/paused/done/error,
`currentIndex`, accumulated `results`). This is what makes Stop lossless and
Start resumable: the loop in `background.ts::runLoop` re-reads status at the
top of every iteration and appends each result to storage as soon as it's
scored, before moving on. Popup and background never share memory — they
only communicate via `chrome.runtime.sendMessage` (see
`extension/src/lib/messaging.ts` for the message/response shapes) and
`chrome.storage.onChanged` (popup uses this to live-refresh instead of polling).

**Go service boundary**: `background.ts`'s `analyzeWithGoService` POSTs
`{title, company, text}` to `http://localhost:8787/analyze` and expects
`{score, reasoning}` back. This URL/port is the only coupling point between
the two halves of the project — when building `matching-service/`, match this
contract (or update the constant + `host_permissions` in
`extension/public/manifest.json` together if the port changes).

## Known placeholder / to calibrate

`extension/src/adapters/linkedin.ts`'s CSS selectors are explicitly marked as
placeholders — LinkedIn's DOM changes often, and this project's own plan is
to calibrate them live against a real search-results page before relying on
them (see README roadmap). Don't treat them as settled; expect to adjust
alongside `AdapterTimings` (click/scroll delays) during live testing.
