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
echo "UDIBROWSERS=$UDIBROWSERS"
echo "Running collector (headed unless HEADLESS=1)..."
npm run collect
