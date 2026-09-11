# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome extension (Manifest V3) that walks a job search the user already ran
manually on LinkedIn (and, later, other job boards via a per-site adapter),
scores each posting against the user's CV, and shows a ranked list. It never
applies to anything automatically, and it never starts on its own — only from
the popup's Start button. Full write-up and legal/ToS disclaimer: `README.md`.

Two independent parts:
- `extension/` — TypeScript, Manifest V3. Functional skeleton.
- `matching-service/` — Go service serving `POST /analyze`: sends the CV (as
  a native PDF document block, read once at startup) plus the job posting
  text to Claude via the official `anthropic-sdk-go`, constrained to
  structured `{score, reasoning}` JSON via `output_config.format`.
  `background.ts` degrades gracefully (`score: null`) when this service
  isn't running, so the extension is testable standalone.

## Language convention

All generated content — code, comments, commit messages, docs — must be in
English, even though the user communicates with Claude in Spanish. Do not
introduce Spanish into any file in this repository.

## Autonomous workflow

- Work continuously without asking for confirmation on routine steps
  (creating files, installing dependencies, running builds/tests).
- Make small, frequent commits — one per logical unit of change (a new
  selector, a function, a fix). Commit messages: descriptive, in English,
  `type(module): description` (see git log for the pattern already in use).
- NEVER run `git push` or configure remotes — that stays under the user's
  manual control.
- Stop and ask only when:
  - There's a real architecture/library trade-off to pick between (e.g.
    fetch vs. Native Messaging for extension <-> Go communication).
  - A LinkedIn selector can't be inferred without seeing the live DOM.
  - A decision affects project scope (adding a new job board, changing the
    score format).
  - An error can't be resolved after 2-3 attempts.
- Update this CLAUDE.md, `.gitignore`, and `README.md` whenever the project
  needs it (new folder, new dependency, new build command) — don't wait for
  explicit instruction.

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

From `matching-service/` (requires Go 1.24+ and `ANTHROPIC_API_KEY` /
`CV_PATH` env vars — see `matching-service/README.md`):

```bash
go build -o bin/matching-service .
./bin/matching-service
```

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
`{score, reasoning}` back (implemented in `matching-service/score.go`). This
URL/port is the only coupling point between the two halves of the project —
if the port changes, update the constant in `background.ts` and the matching
`host_permissions` entry in `extension/public/manifest.json` together.
`matching-service` reads the CV once at startup (no per-request disk I/O,
nothing written to disk) and uses Claude's native PDF document input rather
than a separate Go PDF-parsing library.

## Known placeholder / to calibrate

`extension/src/adapters/linkedin.ts`'s CSS selectors are explicitly marked as
placeholders — LinkedIn's DOM changes often, and this project's own plan is
to calibrate them live against a real search-results page before relying on
them (see README roadmap). Don't treat them as settled; expect to adjust
alongside `AdapterTimings` (click/scroll delays) during live testing.
