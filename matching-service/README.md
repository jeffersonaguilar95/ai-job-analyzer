# matching-service (Go) — next phase, not implemented yet

Local service that will receive `{ title, company, text }` from the extension
(`POST http://localhost:8787/analyze`) and return `{ score, reasoning }`.

Plan:
- Parse the CV from a PDF (once, when the service starts).
- Compare the CV against each posting using the Claude API with structured
  JSON output (score 0-100 + short reasoning).
- No persistence beyond the process — doesn't store or log posting content
  or the CV to disk unless explicitly asked to.

Until this service exists, `extension/src/background.ts` still calls it,
fails silently (try/catch), and stores `score: null` with a note — so the
click/scroll prototype can be calibrated live without depending on Go yet.
