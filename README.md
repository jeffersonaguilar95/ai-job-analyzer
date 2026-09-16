# AI Job Analyzer

A Chrome extension that walks through a job search you've already run
manually (LinkedIn today, more job boards over time), reads each posting,
and scores it from 0 to 100 against your CV using Claude. You get back a
ranked list you can export as CSV or JSON.

**It never applies to anything automatically.** It only reads postings and
scores them. It never starts on its own — you always click "Start" in the
popup yourself.

## ⚠️ Legal notice

This extension automates real clicks and scrolls (via Chrome's `chrome.debugger`
/ CDP API) on job board pages you're already logged into. **Automating
interactions on sites like LinkedIn may violate their Terms of Service** and
could get your account restricted or banned. This project is for personal,
educational use — use it at your own discretion and risk. It isn't affiliated
with LinkedIn, Welcome to the Jungle, or any other job board.

## What you need before you start

You'll install three things and get one API key. None of this requires prior
experience with Node.js or Go.

| Requirement | Why | How to check if you have it |
|---|---|---|
| **Node.js 18+** and **Yarn** | Builds the Chrome extension | `node -v` and `yarn -v` |
| **Go 1.24+** | Runs the local scoring service | `go version` |
| **Google Chrome** | Runs the extension | already installed, most likely |
| **An Anthropic API key** | Lets the scoring service call Claude | you'll create one below |
| **Your CV as a PDF** | What each job gets scored against | any PDF export works |

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

## Quick start

Five steps, from a fresh clone to a working extension.

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
[Customizing your CV](#customizing-your-cv-optional) below — that needs an
extra one-time conversion step.

**4. Run everything with one command.**

```bash
./scripts/start.sh
```

This builds the extension, builds and starts the local scoring service, and
opens Chrome with the extension pre-loaded — in its own separate profile, so
it never touches your regular Chrome logins or history. The first run takes
a bit longer while it downloads dependencies.

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

- **`yarn is not installed` / `go is not installed`** — revisit the
  Prerequisites section above; the script checks for both before doing
  anything else.
- **`No CV found in resources/cv/`** — make sure there's exactly one `.pdf`
  file directly inside `resources/cv/` (not a subfolder). If you have more
  than one, either remove the extras or set `CV_PATH=/absolute/path/to/cv.pdf`
  explicitly before running the script.
- **`ANTHROPIC_API_KEY is not set`** — check that `.env` exists (not just
  `.env.example`) and has your real key on the `ANTHROPIC_API_KEY=` line.
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

All of the environment variables above (`CV_PATH`, `PORT`, `CHROME_BIN`,
`ANTHROPIC_MODEL`) can also be set permanently in your `.env` file instead
of prefixing the command each time — see `.env.example` for the full list.

## How it works (architecture)

```
┌─────────────────────────┐        fetch localhost         ┌──────────────────────┐
│  Extension (TS, MV3)     │ ─────────────────────────────▶ │ matching-service (Go) │
│                          │                                 │                       │
│  popup:  Start / Stop /  │                                 │  - reads your CV(PDF) │
│          export CSV/JSON │                                 │  - calls Claude API   │
│                          │ ◀───────────────────────────── │  - returns score 0-100 │
│  background: scoring     │        { score, reasoning }     └──────────────────────┘
│  loop, controlled via    │
│  chrome.storage.local    │
│         │                │
│         ▼ chrome.debugger (CDP)
│  REAL clicks/scrolls    │
│  on the active tab       │
└─────────────────────────┘
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
  one command (see Quick start above).

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
need any changes.

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

Both of these are Claude Code slash commands — typed in a Claude Code chat
session (not a terminal command), and both are entirely optional: the core
extension + scoring flow above works off your CV PDF alone and never needs
either of them.

Both can produce a compiled PDF, which needs a LaTeX distribution providing
`pdflatex`. Check if you already have it:

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
instead. Neither command *requires* `pdflatex` — without it, you still get
the editable `.tex` file, just no freshly compiled PDF.

### Step 1: make your CV editable — `/setup-cv`

Your CV starts out as just a PDF, which isn't something Claude can reorder
or reword directly. `/setup-cv` is a one-time conversion: it transcribes
your PDF into a clean, editable LaTeX (`.tex`) CV — faithfully, never
adding or embellishing anything — and compiles it back to a PDF so
`matching-service` keeps working exactly as before. Run it once, in Claude
Code, after step 3 of Quick start above:

```
/setup-cv
```

It reports back which sections it transcribed and flags anything it
couldn't read confidently, and your original PDF is archived (not
deleted) under `resources/cv/original/`. Skip this step entirely if you'd
rather hand-write your CV in LaTeX yourself — just drop a single `.tex`
file into `resources/cv/` and `/setup-cv` will recognize it's already done.

### Step 2: tailor it to a specific job offer — `/tailor-cv`

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

## Status / roadmap

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
