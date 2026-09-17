# AI Job Analyzer

A Chrome extension that walks through a job search you've already run
manually (LinkedIn today, more job boards over time), reads each posting,
and scores it from 0 to 100 against your CV using Claude. You get back a
ranked list you can export as CSV or JSON.

**It never applies to anything automatically.** It only reads postings and
scores them. It never starts on its own — you always click "Start" in the
popup yourself.

## Table of contents

- [What is this?](#what-is-this)
- [Legal notice](#legal-notice)
- [Do you need Claude Code?](#do-you-need-claude-code)
- [What you need before you start](#what-you-need-before-you-start)
- [Quick start](#quick-start)
  - [If something goes wrong](#if-something-goes-wrong)
- [How it works (architecture)](#how-it-works-architecture)
- [Repo structure](#repo-structure)
- [Running each half manually](#running-each-half-manually)
- [Customizing your CV (optional, needs Claude Code)](#customizing-your-cv-optional)
- [Status and roadmap](#status-and-roadmap)
- [License](#license)

## What is this?

The project has two independent pieces. You only need the first one to get
value out of it; the second is a bonus if you also have Claude Code.

1. **The extension + scoring service** (always available, no Claude Code
   needed). You run a job search on LinkedIn yourself, click **Start** in
   the extension popup, and it clicks through each result the same way you
   would — reading the posting text and sending it, along with your CV, to
   Claude for a 0-100 fit score and a short explanation. Export the ranked
   list as CSV or JSON when you're done.
2. **CV tailoring** (optional, requires Claude Code — see the next
   section). Two Claude Code slash commands, `/setup-cv` and `/tailor-cv`,
   turn your CV into an editable file and can rewrite a copy of it to
   better match a specific job posting — reordering and rewording only,
   never inventing experience.

## Legal notice

This extension automates real clicks and scrolls (via Chrome's `chrome.debugger`
/ CDP API) on job board pages you're already logged into. **Automating
interactions on sites like LinkedIn may violate their Terms of Service** and
could get your account restricted or banned. This project is for personal,
educational use — use it at your own discretion and risk. It isn't affiliated
with LinkedIn, Welcome to the Jungle, or any other job board.

## Do you need Claude Code?

**Short answer: only if you want to edit or tailor your CV.** The core
extension (running a search, scoring postings, exporting results) works
completely on its own and never touches Claude Code — it only needs the
`ANTHROPIC_API_KEY` from [What you need before you start](#what-you-need-before-you-start).

Claude Code is a separate Anthropic product (a CLI / IDE agent), not the
same thing as the API key above. It's only involved in two optional
slash commands, `/setup-cv` and `/tailor-cv`, covered in
[Customizing your CV](#customizing-your-cv-optional). To use those you need:

- **Claude Code installed** — see [claude.com/claude-code](https://claude.com/product/claude-code)
  for setup instructions.
- **An active Claude subscription that includes Claude Code** (Pro, Max,
  Team, or Enterprise) or API-based billing enabled for it. Without one,
  `/setup-cv` and `/tailor-cv` simply won't run — they aren't scripts you
  can execute any other way, they only work inside a live Claude Code
  session.

If you don't have Claude Code and don't plan to get it, that's completely
fine: skip [Customizing your CV](#customizing-your-cv-optional) entirely.
Drop a plain PDF of your CV into `resources/cv/`, follow
[Quick start](#quick-start), and everything else works exactly the same.

## What you need before you start

You'll install three things and get one API key. None of this requires prior
experience with Node.js or Go.

| Requirement | Why | How to check if you have it |
| --- | --- | --- |
| **Node.js 18+** and **Yarn** | Builds the Chrome extension | `node -v` and `yarn -v` |
| **Go 1.24+** | Runs the local scoring service | `go version` |
| **Google Chrome** | Runs the extension | already installed, most likely |
| **An Anthropic API key** | Lets the scoring service call Claude | you'll create one below |
| **Your CV as a PDF** | What each job gets scored against | any PDF export works |
| **Claude Code + a subscription** *(optional)* | Only needed for `/setup-cv` and `/tailor-cv` | see [Do you need Claude Code?](#do-you-need-claude-code) |
| **LaTeX (`pdflatex`)** *(optional)* | Compiles the CV `/tailor-cv` edits into a usable PDF | `which pdflatex` — see [Customizing your CV](#customizing-your-cv-optional) |

### Installing Node.js and Yarn (macOS)

If you don't have Node yet, the easiest way is [Homebrew](https://brew.sh):

```bash
brew install node
corepack enable        # ships with Node 18+, enables `yarn` without a separate install
```

Don't have Homebrew? Download the Node.js installer directly from
[nodejs.org](https://nodejs.org/) (pick the "LTS" version), then run
`corepack enable` afterwards.

### Installing Go (macOS)

```bash
brew install go
```

Or download the installer from [go.dev/dl](https://go.dev/dl/).

### Getting an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com/) and sign
   up or log in.
2. Open **API Keys** in the left sidebar and click **Create Key**.
3. Copy the key (starts with `sk-ant-...`) — you'll paste it into `.env` in
   step 2 below. Keep it private; anyone with this key can spend on your
   account.

Using Claude costs a small amount per job scored (this project defaults to
the inexpensive `claude-haiku-4-5` model). You'll need billing set up on
your Anthropic account for the key to work.

This key is separate from Claude Code — it's used only by the local
`matching-service`, and it's all you need for the core extension flow.

## Quick start

Five steps, from a fresh clone to a working extension. Every command below
goes in a terminal (on macOS: the **Terminal** app, or press `Cmd+Space`,
type "Terminal", hit Enter).

**1. Clone this repo and open a terminal in it.**

```bash
git clone <this-repo-url>
cd ai-job-analyzer
```

**2. Set your API key.**

```bash
cp .env.example .env
```

Open `.env` in any text editor and replace the placeholder with the key you
copied above:

```
ANTHROPIC_API_KEY=sk-ant-your-real-key-here
```

Save the file.

**3. Add your CV.**

Drop a PDF of your CV/resume into `resources/cv/` (create the folder if it's
not there). Exactly one PDF should be in that folder — the script picks it
up automatically.

```bash
cp ~/Downloads/my-cv.pdf resources/cv/
```

That's all you need for scoring — `matching-service` reads the PDF
directly. If you also want to *edit* your CV's wording later, or generate
a version tailored to a specific job posting, see
[Customizing your CV](#customizing-your-cv-optional) below — that needs
Claude Code and an extra one-time conversion step.

**4. Run everything with one command.**

```bash
./scripts/start.sh
```

This builds the extension, builds and starts the local scoring service, and
opens Chrome with the extension pre-loaded — in its own separate profile, so
it never touches your regular Chrome logins or history. The first run takes
a bit longer while it downloads dependencies. You'll see log lines scroll
by in the terminal; that's normal.

**Before you click Start the very first time**, check two things in that
new Chrome window — this is a one-time check, not something you repeat on
later runs:

- **The extension is actually loaded.** It doesn't get pinned to the
  toolbar automatically, so you may not see its icon at a glance. Open
  `chrome://extensions` in that window and confirm **"AI Job Analyzer"**
  (or similar) is listed and enabled. If it isn't there, it wasn't loaded
  automatically — click **Load unpacked** on that same page and select
  `extension/dist`.
- **"Developer mode" is turned on**, top-right toggle on that same
  `chrome://extensions` page. This project relies on the `chrome.debugger`
  API (real clicks/scrolls, see [How it works](#how-it-works-architecture)),
  which Chrome only allows for unpacked/developer-loaded extensions like
  this one — if Developer mode is off, `chrome.debugger` won't work and
  Start will silently fail to do anything.

Once both are confirmed, pin the extension's icon to the toolbar (puzzle-piece
icon → pin) so it's easy to click each time.

**5. Use it.**

1. In the Chrome window that just opened, go to LinkedIn, log in, and run
   whatever job search you want analyzed.
2. Click the extension's icon in the toolbar to open the popup, then click
   **Start**.
3. Watch it work — you'll see it genuinely clicking and scrolling through
   the results, and Chrome will show a banner saying "this extension is
   debugging this browser." That's expected; it's what lets you watch it
   live and confirm it's only reading, never applying.
4. Click **Stop** any time — nothing already scored is lost. Click **Start**
   again to resume where it left off.
5. Once you have results, export them as CSV or JSON from the popup, sorted
   highest score to lowest.

Stop everything by pressing `Ctrl+C` in the terminal, or by closing the
Chrome window `start.sh` opened.

### If something goes wrong

- **`yarn is not installed` / `go is not installed`** — revisit
  [What you need before you start](#what-you-need-before-you-start); the
  script checks for both before doing anything else.
- **`No CV found in resources/cv/`** — make sure there's exactly one `.pdf`
  file directly inside `resources/cv/` (not a subfolder). If you have more
  than one, either remove the extras or set `CV_PATH=/absolute/path/to/cv.pdf`
  explicitly before running the script.
- **`ANTHROPIC_API_KEY is not set`** — check that `.env` exists (not just
  `.env.example`) and has your real key on the `ANTHROPIC_API_KEY=` line.
- **Clicking Start does nothing, or there's no extension icon in the
  toolbar** — the extension likely isn't loaded, or Developer mode is off.
  Go to `chrome://extensions`, confirm the extension is listed and enabled,
  turn on "Developer mode" (top right) if it's off, and use "Load unpacked"
  → `extension/dist` if it's missing entirely. See the checklist in
  [Quick start](#quick-start) step 4.
- **Chrome doesn't open automatically** — the script still starts the
  scoring service; you'll just need to load the extension yourself: go to
  `chrome://extensions`, enable "Developer mode" (top right), click "Load
  unpacked", and select the `extension/dist` folder. If Chrome is installed
  somewhere non-standard, set `CHROME_BIN=/path/to/Chrome` before running
  the script.
- **Port 8787 already in use** — set `PORT=8788` (or any free port) before
  running the script.
- **Scores keep coming back empty/null** — this means the extension can't
  reach the scoring service. Check the terminal output for errors from
  `matching-service`; a missing or invalid `ANTHROPIC_API_KEY` is the most
  common cause.
- **`/setup-cv` or `/tailor-cv` don't do anything / aren't recognized** —
  these only work inside Claude Code, not in a regular terminal. See
  [Do you need Claude Code?](#do-you-need-claude-code).

All of the environment variables above (`CV_PATH`, `PORT`, `CHROME_BIN`,
`ANTHROPIC_MODEL`) can also be set permanently in your `.env` file instead
of prefixing the command each time — see `.env.example` for the full list.

## How it works (architecture)

```
┌──────────────────────────┐        fetch localhost         ┌────────────────────────┐
│  Extension (TS, MV3)     │ ─────────────────────────────▶ │  matching-service (Go) │
│                          │                                │                        │
│  popup:  Start / Stop /  │                                │  - reads your CV(PDF)  │
│          export CSV/JSON │                                │  - calls Claude API    │
│                          │ ◀───────────────────────────── │  - returns score 0-100 │
│  background: scoring     │      { score, reasoning }      └────────────────────────┘
│  loop, controlled via    │
│  chrome.storage.local    │
│         │                │
│         ▼                │
│  chrome.debugger (CDP)   │
│    REAL clicks/scrolls   │
│     on the active tab    │
└──────────────────────────┘
```

- **No synthetic events**: clicks and scrolls are fired with
  `Input.dispatchMouseEvent` over the CDP protocol (`chrome.debugger`), not
  with `element.click()` or `window.scrollTo()`. This is intentional: it lets
  you watch it act "as if it were you" with the mouse, so you can monitor it
  live while calibrating selectors/timings.
- **Adapter architecture**: each job board (LinkedIn, and others in the
  future) is a `SiteAdapter` object (`extension/src/adapters/`) with its own
  selectors and JS expressions. The loop in `background.ts` doesn't know
  anything about any specific site — it only calls the adapter interface.
- **Resumable**: progress (`currentIndex`, results already obtained) lives in
  `chrome.storage.local`. A "Stop" doesn't reprocess what's already done.
- **Communication with the Go service**: `fetch` to `http://localhost:8787`.
  If the service isn't running, the extension keeps working anyway (stores
  `score: null`) — useful for testing the click/scroll prototype without
  depending on Go yet.

## Repo structure

- `extension/` — Chrome MV3 extension in TypeScript (functional skeleton).
- `matching-service/` — Go scoring service (CV + Claude API), see
  `matching-service/README.md`.
- `resources/` — local, gitignored files you drop in yourself:
  `resources/cv/` (your CV — a PDF is all `matching-service` needs; a
  `.tex` source and its compiled PDF once you've run `/setup-cv`) and
  `resources/profile/` (used only by `/tailor-cv`); more subfolders may be
  added later as the project needs other personal inputs.
- `scripts/` — convenience scripts; `scripts/start.sh` runs everything with
  one command (see [Quick start](#quick-start) above).
- `.claude/commands/` — Claude Code slash commands (`/setup-cv`,
  `/tailor-cv`, `/add-portal`); only usable from inside Claude Code, see
  [Do you need Claude Code?](#do-you-need-claude-code).

## Running each half manually

Useful if you're developing on the extension or the Go service directly,
instead of going through `scripts/start.sh`.

### Extension

```bash
cd extension
yarn install
yarn build      # or `yarn watch` for automatic rebuild
```

Then in Chrome: `chrome://extensions` → enable "Developer mode" → "Load
unpacked" → select `extension/dist`.

Usage:
1. Manually go to `linkedin.com`, log in, and run your job search.
2. With that tab active, open the extension popup and click **Start**.
3. You'll see the extension clicking and scrolling through the results list
   as if it were a real mouse (Chrome shows a banner saying "this extension
   is debugging this browser" — that's expected, and it's exactly what lets
   you monitor it).
4. **Stop** at any time pauses without losing what's already been processed;
   **Start** again resumes from where it left off.
5. Export CSV/JSON with the results sorted from highest to lowest score.

#### Adding a new job board

Write a new `SiteAdapter` in `extension/src/adapters/` (selectors and timings
specific to that site) and register it in
`extension/src/adapters/registry.ts`. The loop in `background.ts` doesn't
need any changes. `/add-portal` (Claude Code, see
[Do you need Claude Code?](#do-you-need-claude-code)) can drive this for you
end to end from pasted HTML.

### matching-service

```bash
cd matching-service
export ANTHROPIC_API_KEY=sk-ant-...
export CV_PATH=/absolute/path/to/your-cv.pdf   # or drop it in resources/cv/ and use scripts/start.sh instead
go build -o bin/matching-service .
./bin/matching-service
```

See `matching-service/README.md` for the full API contract and optional env vars.

## Customizing your CV (optional)

> **Requires Claude Code and a LaTeX installation (`pdflatex`)** — see
> [Do you need Claude Code?](#do-you-need-claude-code) if you're not sure
> whether you have what's needed. If you don't want either, skip this
> whole section; the rest of the project works fine without it.

Both of these are Claude Code slash commands — typed in a Claude Code chat
session (not a terminal command), and both are entirely optional: the core
extension + scoring flow above works off your CV PDF alone and never needs
either of them.

**You need `pdflatex` installed to actually get a usable, tailored PDF out
of `/tailor-cv`.** Both commands will technically run without it and still
write out an edited `.tex` file, but they won't compile it — so without
`pdflatex` you're left with LaTeX source you'd have to compile yourself
before you could submit it anywhere. Check if you already have it:

```bash
which pdflatex
```

If that prints a path, you're set. If not, the simplest way to install it
on macOS is via Homebrew:

```bash
brew install --cask basictex
```

Open a **new** terminal window afterwards (so your `PATH` picks it up),
then confirm with `which pdflatex` again. No Homebrew? Download the
"BasicTeX" installer from [tug.org/mactex/morepackages.html](https://tug.org/mactex/morepackages.html)
instead.

### Step 1: make your CV editable (`/setup-cv`)

Your CV starts out as just a PDF, which isn't something Claude can reorder
or reword directly. `/setup-cv` is a one-time conversion: it transcribes
your PDF into a clean, editable LaTeX (`.tex`) CV — faithfully, never
adding or embellishing anything — and compiles it back to a PDF so
`matching-service` keeps working exactly as before. Run it once, inside a
Claude Code session, after step 3 of [Quick start](#quick-start) above:

```
/setup-cv
```

It reports back which sections it transcribed and flags anything it
couldn't read confidently, and your original PDF is archived (not
deleted) under `resources/cv/original/`. Skip this step entirely if you'd
rather hand-write your CV in LaTeX yourself — just drop a single `.tex`
file into `resources/cv/` and `/setup-cv` will recognize it's already done.

### Step 2: tailor it to a specific job offer (`/tailor-cv`)

Given a job posting URL or pasted text, `/tailor-cv` rewrites your CV to
better surface skills the posting asks for — reordering and rewording
*existing, true* content only, never inventing experience. It runs
entirely in your Claude Code session (no separate binary or API call to
debug blind), never touches your base CV, and writes a new tailored copy
per offer under `resources/cv/tailored/`. Requires the `.tex` CV from step
1 above.

```
/tailor-cv https://example.com/jobs/1234
```

(or paste the posting text directly instead of a URL). First run creates
`resources/profile/skills.md` for you to fill in with technical detail
that doesn't fit on a one-page CV (extra tools, quantifiable achievements,
certifications, domain knowledge) — this is the extra ground truth the
command draws on to surface real skills. See
`.claude/commands/tailor-cv.md` for the full flow.

## Status and roadmap

- [x] Extension skeleton (MV3 manifest + `debugger` permission).
- [x] Real click/scroll prototype via CDP + LinkedIn adapter (selectors to
      calibrate live).
- [x] Resumable loop, popup with Start/Stop, CSV/JSON export.
- [x] `matching-service` in Go: CV PDF (native document input) + Claude API
      call with structured JSON output.
- [ ] Live calibration of selectors/timings against real LinkedIn pages.
- [x] Second adapter (Welcome to the Jungle, `jobs-matches` grid) —
      selectors calibrated from pasted samples, not yet verified live.
- [ ] Adapters for other job boards (2-4h extra each).
- [x] `/tailor-cv`: Claude Code slash command that tailors the CV (LaTeX
      source) to a specific job posting URL or pasted text.
- [x] `/setup-cv`: Claude Code slash command that converts a PDF resume
      into an editable LaTeX CV, one time, so `/tailor-cv` has something
      to work with.

## License

[MIT](LICENSE) — see the [Legal notice](#legal-notice) above for the
separate, important caveat about automating job board sites.
