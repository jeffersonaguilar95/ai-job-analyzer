# matching-service (Go)

Local HTTP service that scores a job posting against your CV. Called by the
extension's `background.ts` at `POST http://localhost:8787/analyze`.

Uses the official [`anthropic-sdk-go`](https://github.com/anthropics/anthropic-sdk-go)
to send your CV (as a native PDF document block) plus the job posting text to
Claude, constrained to a structured `{score, reasoning}` JSON output via
`output_config.format` — no manual JSON parsing or prompt-based formatting
tricks. No persistence: the CV is read once into memory at startup and never
written to disk; job postings and responses aren't logged or stored anywhere.

## Setup

The easiest way to run this alongside the extension is `../scripts/start.sh`
(see the root README's Quick start) — drop your CV in `../resources/cv/` and
it resolves `CV_PATH` for you, loading vars from `../.env` if present. To run
just this service manually (the binary itself doesn't read `.env` — either
export the vars directly, or `set -a && source ../.env && set +a` first):

```bash
cd matching-service
export ANTHROPIC_API_KEY=sk-ant-...   # required
export CV_PATH=/absolute/path/to/your-cv.pdf   # required (or ../resources/cv/<file>.pdf)
# export PORT=8787                    # optional, defaults to 8787
# export ANTHROPIC_MODEL=claude-opus-5 # optional, defaults to claude-opus-5

go build -o bin/matching-service .
./bin/matching-service
```

The extension expects this service on port `8787` — if you change `PORT`, also
update `GO_SERVICE_URL` in `extension/src/background.ts` and the matching
`host_permissions` entry in `extension/public/manifest.json`.

## API

```
POST /analyze
{"title": "...", "company": "...", "text": "..."}

-> {"score": 0-100, "reasoning": "..."}
```

On a safety-classifier refusal (`stop_reason: "refusal"`), responds with
`score: null` and a `reasoning` string explaining the request was declined —
it does not error out the whole request.

If `matching-service` isn't running, `extension/src/background.ts` still
works: the `fetch` fails, is caught, and each result is stored with
`score: null` — useful for calibrating the click/scroll prototype without
this service up yet.
