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

`resources/` holds local, gitignored files the user drops in (only
`resources/cv/` today — the CV PDF; more subfolders may be added later).
`scripts/start.sh` is the one-command entry point: builds the extension,
resolves `CV_PATH` from `resources/cv/` if not already set, builds and
starts `matching-service`, and launches Chrome with the extension pre-loaded
in a dedicated profile.

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

Run everything at once with `./scripts/start.sh` (from the repo root) —
builds the extension, resolves the CV from `resources/cv/`, builds and starts
`matching-service`, and launches Chrome with the extension pre-loaded.
Requires `ANTHROPIC_API_KEY` and exactly one PDF in `resources/cv/` (or
`CV_PATH` set explicitly) — either exported in the shell, or via a `.env`
file (copy `.env.example` to `.env`; gitignored, loaded automatically by
`start.sh`, and never overrides a variable already exported in the shell).

To run each half individually:

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
touch `background.ts`. `extension/src/adapters/shared.ts` holds the one
genuinely site-agnostic helper (`rectExprFor`) — reuse it instead of copying
LinkedIn's version when writing a new adapter.

New adapters are written the same way LinkedIn's was: the user pastes real
HTML from the target site (search-results page, detail view, pagination
control), and the selectors/logic are derived from that sample rather than
a live browsing session — so, like LinkedIn's, they're calibrated against a
single snapshot and should be treated as placeholders until confirmed with
a real run (see below). Run `/add-portal` (`.claude/commands/add-portal.md`)
to drive this end to end — it asks for the URL/HTML it needs, writes the
adapter file, registers it, updates `manifest.json`'s `host_permissions` if
needed, and documents whatever it couldn't verify without a live browser.

Not every job board fits LinkedIn's "click opens an in-page panel" model,
either. `extension/src/adapters/welcometothejungle.ts` targets
`www.welcometothejungle.com/en/jobs-matches`, a card grid where clicking a
card is a full navigation (same tab) to a separate job detail page, not a
panel. Since only `background.ts` can open tabs (not something a
page-evaluated expression can do) and this project's rule is that adapters
never need `background.ts` changes, this adapter instead has `extractExpr`
navigate back to the list itself (`history.back()`) as its last
step, once everything's already been read off the detail page — see that
file's header for the full reasoning, including the known trade-off (the
list's order isn't stable across reloads, mitigated by the jobId dedup
`processCard` already does for every adapter) and why a new-tab-per-job
approach was considered and rejected.

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

Same caveat applies to `workplaceTypeExprFor` in that file: it assumes
LinkedIn appends the workplace type in parentheses to the card's location
text (e.g. `"Bogotá, Colombia (Hybrid)"`) — unverified against a live
on-site/hybrid posting. If the DOM reports `'unknown'` for a posting you know
isn't remote, recalibrate the parenthetical-text regex against the real DOM
rather than relying on the LLM fallback described below.

The workplace-type filter itself is a user setting (`Settings.workplacePreference`
in `extension/src/lib/storage.ts`: `'remote' | 'hybrid' | 'onsite' | 'any'`,
picked from the popup's "Workplace" dropdown, default `'remote'`) — not a
hardcoded "must be remote" rule. `background.ts`'s `finalizeScore` compares
the posting's resolved workplace type against that preference: a mismatch
forces `score: 0` and `discarded: true` (instead of `null`, so it's
distinguishable from a matching-service failure) without spending an LLM
call, provided the LinkedIn DOM tag alone is enough to know it doesn't
match. When the DOM says `'unknown'`, there's no second request for this —
`matching-service`'s existing scoring prompt/schema (`score.go`) already
asks the model to read the workplace type off the posting text in the same
call, and `finalizeScore` applies the same preference check to that answer.
`'any'` disables the filter entirely: nothing is ever discarded on workplace
type, though the resolved type is still recorded on the result.

`extension/src/adapters/welcometothejungle.ts` (targeting
`www.welcometothejungle.com/en/jobs-matches`) is calibrated from pasted
samples (Sep 2026) — the list page and one job's detail page — not a live
run; same placeholder status as LinkedIn's selectors. Specifically
unverified: whether `job-list-pagination-arrow-next` actually gets
`disabled=""` at the end of pagination (only the *previous*-page button was
observed disabled, on page 1); the `countCardsExpr` fallback of `10` while
mid-navigation-back is a guess tied to the one page size seen; and the
workplace-type keyword match only has a confirmed sample for "Fully-remote"
— the hybrid/onsite branches are unverified by analogy with the other
adapters. See that file's header for the (accepted, documented) list-order
instability this adapter works around via jobId dedup rather than a new
tab per job.
