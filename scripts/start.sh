#!/usr/bin/env bash
#
# Single entry point to run the whole project locally:
#   1. builds the extension (extension/dist)
#   2. builds and starts matching-service
#   3. launches Chrome with the extension pre-loaded, in a dedicated profile
#      that never touches your regular Chrome session
#
# Stop everything with Ctrl+C, or by closing the Chrome window this script
# opened.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT_DIR/extension"
MATCHING_SERVICE_DIR="$ROOT_DIR/matching-service"
CV_DIR="$ROOT_DIR/resources/cv"
CHROME_PROFILE_DIR="$ROOT_DIR/.chrome-profile"

log()  { printf '\033[1;34m[start]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[start]\033[0m %s\n' "$*" >&2; exit 1; }

# Loads KEY=VALUE lines from .env, without overriding anything already
# exported in the calling shell (a real `export FOO=...` always wins).
load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  local key value
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

load_env_file "$ROOT_DIR/.env"

command -v yarn >/dev/null 2>&1 || fail "yarn is not installed (needed to build the extension)."
command -v go   >/dev/null 2>&1 || fail "go is not installed (needed to build matching-service)."
[[ -n "${ANTHROPIC_API_KEY:-}" ]] || fail "ANTHROPIC_API_KEY is not set. Export it before running this script."
export ANTHROPIC_API_KEY

if [[ -z "${CV_PATH:-}" ]]; then
  cv_candidates=()
  while IFS= read -r -d '' f; do
    cv_candidates+=("$f")
  done < <(find "$CV_DIR" -maxdepth 1 -type f -iname '*.pdf' -print0 2>/dev/null)

  case "${#cv_candidates[@]}" in
    0) fail "No CV found in resources/cv/. Drop your CV PDF there, or set CV_PATH explicitly." ;;
    1) export CV_PATH="${cv_candidates[0]}" ;;
    *) fail "Multiple PDFs found in resources/cv/ — set CV_PATH explicitly to pick one." ;;
  esac
else
  export CV_PATH
fi
log "Using CV: $CV_PATH"

log "Building extension..."
[[ -d "$EXTENSION_DIR/node_modules" ]] || (cd "$EXTENSION_DIR" && yarn install)
(cd "$EXTENSION_DIR" && yarn build)

log "Building matching-service..."
(cd "$MATCHING_SERVICE_DIR" && go build -o bin/matching-service .)

export PORT="${PORT:-8787}"
log "Starting matching-service on :$PORT..."
(cd "$MATCHING_SERVICE_DIR" && exec ./bin/matching-service) &
MATCHING_PID=$!

cleanup() {
  log "Stopping matching-service..."
  kill "$MATCHING_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1
kill -0 "$MATCHING_PID" 2>/dev/null || fail "matching-service failed to start — see output above."

CHROME_BIN="${CHROME_BIN:-}"
if [[ -n "$CHROME_BIN" && ! -x "$CHROME_BIN" ]]; then
  fail "CHROME_BIN is set but not executable: $CHROME_BIN"
fi
if [[ -z "$CHROME_BIN" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    [[ -x "$candidate" ]] && CHROME_BIN="$candidate" && break
  done
fi

if [[ -n "$CHROME_BIN" ]]; then
  log "Launching Chrome with the extension pre-loaded (dedicated profile — your regular Chrome is untouched)..."
  "$CHROME_BIN" \
    --user-data-dir="$CHROME_PROFILE_DIR" \
    --load-extension="$EXTENSION_DIR/dist" &
  wait $!
else
  log "Chrome not found automatically — load extension/dist manually via chrome://extensions."
  log "matching-service is running on :$PORT. Press Ctrl+C to stop."
  wait "$MATCHING_PID"
fi
