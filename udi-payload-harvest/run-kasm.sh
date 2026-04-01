#!/usr/bin/env bash
# Ubuntu / KASM: install Playwright deps and run multi-browser payload collection.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install with your distro (e.g. apt install nodejs) or nvm."
  exit 1
fi

echo "Installing npm dependencies..."
npm install

if command -v sudo >/dev/null 2>&1; then
  echo "Installing Playwright system dependencies (sudo)..."
  sudo npx playwright install-deps || true
else
  echo "sudo not found; run as root or install deps manually: npx playwright install-deps"
fi

echo "Installing browser binaries for Playwright (chromium, firefox, webkit)..."
npx playwright install chromium firefox webkit

: "${UDIBROWSERS:=chrome,firefox,chromium}"
export UDIBROWSERS
# Corp TLS inspection: Playwright Firefox does not use the OS CA store by default.
: "${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:=1}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS
# Firefox/Tor: user-namespace sandbox EPERM in Docker/Kasm — Mozilla env disables content sandbox.
: "${PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX:=1}"
export PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX
if [[ -z "${TOR_BROWSER_PATH:-}" && -x "${HOME}/tor-browser/Browser/firefox" ]]; then
  export TOR_BROWSER_PATH="${HOME}/tor-browser/Browser/firefox"
fi
echo "UDIBROWSERS=$UDIBROWSERS"
echo "Running collector (headed unless HEADLESS=1)..."
npm run collect
