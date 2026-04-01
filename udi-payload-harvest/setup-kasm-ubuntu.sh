#!/usr/bin/env bash
#
# One-shot Ubuntu prep for KASM / udi-payload-harvest (Node 20, Playwright browsers).
# Run from any directory, e.g.:  bash setup-kasm-ubuntu.sh
#
# WARNING: This file contains a GitHub PAT below. Do not push this file to any public
# or shared repo; anyone with the token can use your GitHub access. Override with
#   export GITHUB_TOKEN='...'
# before running if you prefer not to use the embedded value.
#
# PLAYWRIGHT_IGNORE_HTTPS_ERRORS=1 (default below): Playwright Firefox ignores TLS chain errors
# (e.g. SEC_ERROR_UNKNOWN_ISSUER with corporate TLS inspection). Set 0 to enforce strict TLS.
# PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX=1 (default): MOZ_DISABLE_CONTENT_SANDBOX for Firefox/Tor in Kasm (EPERM).
# TOR_WARMUP_MS=10000 (default below): ms to wait after Marionette before navigation (collect.mjs); override if needed.
# BRAVE_PATH / TOR_BROWSER_PATH: exported when brave exists or ~/tor-browser has Browser/firefox-bin (Gecko; not the firefox wrapper script).
# UDIBROWSERS default: chrome,chromium,firefox,brave,tor (matches collect.mjs / run-kasm.sh).
#
# Installs Brave from the official APT repo (for UDIBROWSERS=brave). Set SKIP_BRAVE_APT=1 to skip.
#
# Installs Tor Browser: official tarball on amd64 (UDIBROWSERS=tor → TOR_BROWSER_PATH). Set SKIP_TOR_BROWSER=1
# to skip. Override version: TOR_BROWSER_VERSION=15.0.8
# If downloads get HTTP 403, curl uses a browser User-Agent (override: TOR_CURL_USER_AGENT).
#
set -euo pipefail

GIT_USER_NAME="Boyan Boev"
GIT_USER_EMAIL="boev.boyan85@gmail.com"
GITHUB_USERNAME="${GITHUB_USERNAME:-boyan.boev85-spec}"
# Embedded for local/test VM use only; env GITHUB_TOKEN wins if set.
GITHUB_TOKEN="${GITHUB_TOKEN:-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}"
REPO_SLUG="boevboyan85-spec/udi-payload-collection-automation"
HARVEST_DIR_NAME="udi-payload-harvest"

git config --global user.email "$GIT_USER_EMAIL"
git config --global user.name "$GIT_USER_NAME"

export GITHUB_USERNAME
export GITHUB_TOKEN

PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-1}"
export PLAYWRIGHT_IGNORE_HTTPS_ERRORS
PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX="${PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX:-1}"
export PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX

# Tor + Selenium: wait after Marionette before driver.get (milliseconds; 10000 ≈ 10s).
TOR_WARMUP_MS="${TOR_WARMUP_MS:-10000}"
export TOR_WARMUP_MS

UDIBROWSERS="${UDIBROWSERS:-chrome,chromium,firefox,brave,tor}"
export UDIBROWSERS

mkdir -p "$HOME/Documents/git"
cd "$HOME/Documents/git"

REPO_DIR="udi-payload-collection-automation"
if [[ -d "$REPO_DIR/.git" ]]; then
  echo "Repository exists at $PWD/$REPO_DIR — pulling develop..."
  AUTH_URL="https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git"
  git -C "$REPO_DIR" pull "$AUTH_URL" develop || git -C "$REPO_DIR" pull "$AUTH_URL"
else
  git clone "https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git"
  git -C "$REPO_DIR" remote set-url origin "https://github.com/${REPO_SLUG}.git"
fi

cd "$REPO_DIR/$HARVEST_DIR_NAME"

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg apt-transport-https xz-utils

if [[ "${SKIP_BRAVE_APT:-}" != "1" ]]; then
  echo "Installing Brave Browser (official APT repository)..."
  sudo curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg \
    https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
  ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg arch=${ARCH}] https://brave-browser-apt-release.s3.brave.com/ stable main" \
    | sudo tee /etc/apt/sources.list.d/brave-browser-release.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y brave-browser
  if [[ -x /usr/bin/brave-browser ]]; then
    BRAVE_PATH="${BRAVE_PATH:-/usr/bin/brave-browser}"
    export BRAVE_PATH
  fi
else
  echo "Skipping Brave APT install (SKIP_BRAVE_APT=1)."
fi

# Selenium/GeckoDriver needs the real ELF (firefox-bin). Browser/firefox is often a #! wrapper script.
tor_browser_gecko_exe() {
  local tb_home="$1"
  local b="${tb_home}/Browser"
  if [[ -x "$b/firefox-bin" ]]; then echo "$b/firefox-bin"; return 0; fi
  if [[ -x "$b/firefox" ]]; then
    local h
    h=$(head -c2 "$b/firefox" 2>/dev/null || printf '')
    if [[ "$h" != '#!' ]]; then echo "$b/firefox"; return 0; fi
  fi
  return 1
}

if [[ "${SKIP_TOR_BROWSER:-}" != "1" ]]; then
  TB_VER="${TOR_BROWSER_VERSION:-15.0.8}"
  TB_HOME="${TOR_BROWSER_HOME:-$HOME/tor-browser}"
  DPKG_ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

  if [[ "$DPKG_ARCH" == "amd64" ]]; then
    if TB_GECKO=$(tor_browser_gecko_exe "$TB_HOME"); then
      echo "Tor Browser already present at $TB_HOME (skip download)."
    else
      echo "Installing Tor Browser ${TB_VER} (official tarball, x86_64)..."
      TB_FILE="tor-browser-linux-x86_64-${TB_VER}.tar.xz"
      # dist.torproject.org often returns 403 to curl's default User-Agent; use a normal browser string.
      TOR_CURL_UA="${TOR_CURL_USER_AGENT:-Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0}"
      TB_URLS=(
        "https://www.torproject.org/dist/torbrowser/${TB_VER}/${TB_FILE}"
        "https://dist.torproject.org/torbrowser/${TB_VER}/${TB_FILE}"
        "https://archive.torproject.org/tor-package-archive/torbrowser/${TB_VER}/${TB_FILE}"
      )
      TMP_TB="$(mktemp -d)"
      trap 'rm -rf "$TMP_TB"' EXIT
      TB_DOWNLOADED=0
      for TB_URL_TRY in "${TB_URLS[@]}"; do
        echo "Downloading: $TB_URL_TRY"
        if curl -fSL --connect-timeout 60 --retry 2 --retry-delay 3 \
          -A "$TOR_CURL_UA" "$TB_URL_TRY" -o "$TMP_TB/$TB_FILE"; then
          TB_DOWNLOADED=1
          break
        fi
        echo "Mirror failed, trying next..."
      done
      if [[ "$TB_DOWNLOADED" != "1" ]]; then
        echo "Warning: Tor Browser download failed (403/firewall/proxy). Install Tor manually or set SKIP_TOR_BROWSER=1. Continuing setup."
        rm -rf "$TMP_TB"
        trap - EXIT
      else
        PARENT="$(dirname "$TB_HOME")"
        mkdir -p "$PARENT"
        rm -rf "$TB_HOME"
        tar -xJf "$TMP_TB/$TB_FILE" -C "$PARENT"
        rm -rf "$TMP_TB"
        trap - EXIT
        if ! TB_GECKO=$(tor_browser_gecko_exe "$TB_HOME"); then
          echo "Warning: no Gecko binary (Browser/firefox-bin or non-script Browser/firefox) under $TB_HOME after extract; check TOR_BROWSER_VERSION / tarball layout."
        fi
      fi
    fi
    if TB_GECKO=$(tor_browser_gecko_exe "$TB_HOME"); then
      export TOR_BROWSER_PATH="$TB_GECKO"
    fi
  else
    echo "Tor Browser: no official Linux ${DPKG_ARCH} tarball in this script; installing torbrowser-launcher."
    echo "Run it once from the desktop to download Tor, then set TOR_BROWSER_PATH to .../Browser/firefox-bin (or unset — collect.mjs auto-detects under ~/.local/share/torbrowser/tbb)"
    sudo apt-get install -y torbrowser-launcher || true
  fi
else
  echo "Skipping Tor Browser install (SKIP_TOR_BROWSER=1)."
fi

# If installs were skipped or paths were never exported, set when binaries exist.
if [[ -z "${BRAVE_PATH:-}" ]] && [[ -x /usr/bin/brave-browser ]]; then
  export BRAVE_PATH="/usr/bin/brave-browser"
fi
if [[ -z "${TOR_BROWSER_PATH:-}" ]]; then
  if _tb_gecko=$(tor_browser_gecko_exe "$HOME/tor-browser"); then
    export TOR_BROWSER_PATH="$_tb_gecko"
  fi
fi

if [[ -f /etc/apt/sources.list.d/sublime-text.list ]]; then
  echo "Commenting first line of /etc/apt/sources.list.d/sublime-text.list"
  sudo sed -i '1s/^/# /' /etc/apt/sources.list.d/sublime-text.list
fi

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Selenium / Tor: collector uses GeckoDriver + Marionette (Tor has no Playwright Juggler).
echo "Installing GeckoDriver for Tor (Selenium)…"
sudo apt-get install -y firefox-geckodriver 2>/dev/null || sudo apt-get install -y geckodriver 2>/dev/null || {
  echo "Warning: no geckodriver APT package — install manually or rely on Selenium Manager; set GECKODRIVER_PATH if needed."
}

npm config set strict-ssl false
npm install
sudo npx playwright install-deps

export NODE_TLS_REJECT_UNAUTHORIZED=0
npx playwright install chromium firefox webkit
unset NODE_TLS_REJECT_UNAUTHORIZED

echo "Done. Harvest project directory: $(pwd)"
echo "Add to ~/.bashrc (or export in your session) to persist for npm run collect:"
echo "  export UDIBROWSERS=${UDIBROWSERS}  # default matches collect.mjs"
echo "  export TOR_WARMUP_MS=${TOR_WARMUP_MS}  # ms after Marionette before navigation (~10s)"
[[ -n "${BRAVE_PATH:-}" ]] && echo "  export BRAVE_PATH=\"$BRAVE_PATH\""
[[ -n "${TOR_BROWSER_PATH:-}" ]] && echo "  export TOR_BROWSER_PATH=\"$TOR_BROWSER_PATH\"  # Selenium + Tor Browser"
