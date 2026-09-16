# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome extension (Manifest V3) that walks a job search the user already ran
manually on LinkedIn (and, later, other job boards via a per-site adapter),
scores each posting against the user's CV, and shows a ranked list. It never
applies to anything automatically, and it never starts on its own — only from
the popup's Start button. Full write-up and legal/ToS disclaimer: `README.md`.

Three independent parts:
- `extension/` — TypeScript, Manifest V3. Functional skeleton.
- `matching-service/` — Go service serving `POST /analyze`: sends the CV (as
  a native PDF document block, read once at startup) plus the job posting
  text to Claude via the official `anthropic-sdk-go`, constrained to
  structured `{score, reasoning}` JSON via `output_config.format`.
  `background.ts` degrades gracefully (`score: null`) when this service
  isn't running, so the extension is testable standalone.
- `/tailor-cv` — a Claude Code slash command (`.claude/commands/tailor-cv.md`),
  **not code that ships in this repo's build** — fully isolated from
  `extension/` and `matching-service/`, not wired into `scripts/start.sh`.
  Given a job posting URL or pasted text, it tailors the user's CV to that
  posting: reordering/rewording existing, true content (from the CV itself
  and from `resources/profile/`) to better surface skills the posting asks
  for — never inventing anything. See "tailor-cv" below. (This used to be a
  standalone Go CLI, `cv-tailor/`; it was removed in favor of a slash
  command run inside Claude Code, so the whole flow — fetching the
  posting, reading the CV, asking clarifying questions, rewriting — happens
  in a session Claude can see and debug directly, instead of behind an
  opaque API call in a separate binary.)

`resources/` holds local, gitignored files the user drops in:
`resources/cv/` (the CV — a `.tex` source plus its compiled PDF, which is
what `matching-service` reads, and what `/tailor-cv` reads and tailors) and
`resources/profile/` (a free-form skills/achievements file only
`/tailor-cv` reads). More subfolders may be added later. `scripts/start.sh`
is the one-command entry point for the extension + `matching-service` pair:
builds the extension, resolves `CV_PATH` from `resources/cv/` if not
already set, builds and starts `matching-service`, and launches Chrome with
the extension pre-loaded in a dedicated profile. `/tailor-cv` is invoked
separately and manually from within Claude Code — see "tailor-cv" below.

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

`/tailor-cv` (optional, requires a `.tex` CV in `resources/cv/` — see
`.claude/commands/tailor-cv.md`; not part of `./scripts/start.sh`, run
manually per job offer) is invoked from within a Claude Code session:

```
/tailor-cv https://example.com/jobs/1234
```

(or paste the posting text directly instead of a URL).

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
navigate back to the list itself (`history.back()`) as its last step, once
everything's already been read off the detail page. The list also
re-sorts on every view (viewing a job pulls it to the front, ahead of
everything else) — confirmed live to follow that rule exactly, which is
why the adapter can still safely click position `index` directly (already-
viewed jobs always end up clustered at the front, so `index` always lands
on a fresh one) instead of tracking visited jobIds itself. See that file's
header for the full reasoning, including why a new-tab-per-job approach
was considered and rejected.

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

**tailor-cv** (`.claude/commands/tailor-cv.md`) used to be a separate Go
module (`cv-tailor/`, own `go.mod`, its own `anthropic-sdk-go` call) —
removed after repeated `context deadline exceeded` failures that were hard
to debug from outside a black-box binary. It's now a Claude Code slash
command: the whole flow (fetching the posting, reading the CV and profile,
gap analysis, clarifying questions, rewriting, writing output, compiling)
runs as ordinary tool calls inside the current session, so any failure is
directly visible and debuggable instead of hidden behind a single API
request with its own timeout. Its base CV is `resources/cv/<name>.tex`
(exactly one `.tex` file must be there), the same source the compiled
`resources/cv/*.pdf` — the one `matching-service` reads — is generated
from. Run manually per job offer (`/tailor-cv <url-or-text>` inside Claude
Code), never from `scripts/start.sh`. Format fidelity is enforced by
explicit instruction rather than code-level structural separation: the
command tells Claude to split the base `.tex` at `\begin{document}` into a
preamble (copied byte-for-byte into the output, never touched) and a body
(the only part ever reordered/reworded), and to run a grounding pass
before writing anything to disk. The command drives a gap analysis against
the CV and `resources/profile/skills.md` (a free-form, user-maintained
file of true skills/achievements that don't fit on a one-page CV —
auto-scaffolded on first run if missing, which stops the run so the user
can fill it in before continuing), asks the user clarifying questions
directly in chat for genuine gaps, and incorporates an answer only when it
affirmatively confirms something true — never invents employers, dates, or
technologies. Output never overwrites the base CV: it's written to
`resources/cv/tailored/<company>-<role>/` (`cv.tex`, `changelog.md`, and a
compiled `cv.pdf` if `pdflatex` is on `PATH`) — a subfolder, so
`scripts/start.sh`'s "exactly one PDF in `resources/cv/`" auto-detect for
`matching-service` stays unaffected. Job posting fetch uses Claude Code's
own `WebFetch` tool — a deliberate improvement over the old plain HTTP GET,
though it still won't reliably work on JS-rendered or login-gated pages
(LinkedIn, most SPA-based boards), so a failed or too-thin fetch falls back
to asking the user to paste the posting text directly in chat instead.

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
`www.welcometothejungle.com/en/jobs-matches`) went through two live-tested
redesigns, not just a calibration pass. First problem: treating the list's
card index as a stable position broke in an actual run, since the site
re-sorts on every view. Second attempt tracked visited jobIds itself in
`sessionStorage` and scanned for "first not visited" instead of trusting
`index` — unnecessarily, it turned out: the user confirmed precisely how
the re-sort works (viewing a job pulls it to the front, ahead of
everything else, preserving relative order otherwise), which means
`index` *is* safe to click directly after all, since already-viewed jobs
always cluster at the front. The current version does exactly that and
drops the `sessionStorage` tracking entirely. What actually needed fixing
was `countCardsExpr` treating a still-loading partial render (right after
`history.back()`) as the page's true size, firing pagination mid-page —
now anything under 5 rendered cards is treated as "not settled yet" rather
than trusted (see that file's header for why 5, and the trade-off if a
real final page legitimately has fewer). `/en/jobs-matches` also turned out
to have two separate sections — "New matches" and "Seen jobs" (a job moves
from one to the other once viewed), each with its own pagination nav
differing only by a `seen-` testid prefix — this adapter currently only
paginates "Seen jobs" (`nextPageRectExpr`); "New matches" is an
intentional, separate follow-up. Still unverified: whether
`seen-job-list-pagination-arrow-next` ever actually gets reached/disabled
at the end, and the workplace-type keyword match only has a confirmed
sample for "Fully-remote" (hybrid/onsite branches are an unverified guess
by analogy
with the other adapters).
