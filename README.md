# AI Job Analyzer

Chrome extension that walks the results of a job search you already ran
manually (login and search included), and scores each posting from 0 to 100
against your CV, using a local Go service that calls the Claude API for the
match reasoning.

**It never applies to anything automatically.** It only reads, extracts text,
and shows a ranking. You click "Start" from the popup; it never starts on
its own.

## ⚠️ Legal notice

This extension automates real clicks and scrolls (via `chrome.debugger` / CDP)
on LinkedIn pages already authenticated with your session. **Automating
interactions on LinkedIn may violate its Terms of Service** and expose you to
account restriction or a ban. This project is for personal/educational use;
use it at your own discretion and risk. It is not affiliated with LinkedIn or
any other job board.

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
- `resources/` — local, gitignored files you drop in yourself. Today just
  `resources/cv/` (your CV PDF); more subfolders may be added later as the
  project needs other personal inputs.
- `scripts/` — convenience scripts; `scripts/start.sh` runs everything with
  one command (see Quick start below).

## Quick start (one command)

```bash
cp .env.example .env   # then edit .env and set your ANTHROPIC_API_KEY
cp /path/to/your-cv.pdf resources/cv/
./scripts/start.sh
```

`scripts/start.sh` loads `.env` automatically (see `.env.example` for all
supported variables) — anything already exported in your shell takes
precedence, so `ANTHROPIC_API_KEY=... ./scripts/start.sh` still works without
a `.env` file. `.env` is gitignored; only `.env.example` is committed.

This builds the extension, builds and starts `matching-service`, and (if
Chrome is installed at the usual macOS path) opens it with the extension
already loaded, in a dedicated profile that never touches your regular
Chrome session or its logins. Stop everything with `Ctrl+C`, or by closing
that Chrome window.

`resources/cv/` must contain exactly one PDF (the script errors out if it's
empty or has more than one — set `CV_PATH` explicitly to disambiguate). If
Chrome isn't found automatically, the script still starts
`matching-service` and tells you to load `extension/dist` manually via
`chrome://extensions`. Override the Chrome binary with `CHROME_BIN=...` or
the port with `PORT=...` if needed.

The sections below cover running each half manually, and are what
`scripts/start.sh` does under the hood.

## Extension: running it locally

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

### Adding a new job board

Write a new `SiteAdapter` in `extension/src/adapters/` (selectors and timings
specific to that site) and register it in
`extension/src/adapters/registry.ts`. The loop in `background.ts` doesn't
need any changes.

## matching-service: running it locally

```bash
cd matching-service
export ANTHROPIC_API_KEY=sk-ant-...
export CV_PATH=/absolute/path/to/your-cv.pdf   # or drop it in resources/cv/ and use scripts/start.sh instead
go build -o bin/matching-service .
./bin/matching-service
```

See `matching-service/README.md` for the full API contract and optional env vars.

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
