#!/usr/bin/env bash
# Install Chrome, Chromium, Firefox, and Microsoft Edge on Ubuntu/Debian (Kasm-friendly).
# Requires apt and (usually) root. Idempotent — skips what is already installed.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "$@"
  fi
  echo "This script needs root to install apt packages." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq

install_firefox() {
  if command -v firefox >/dev/null 2>&1; then
    echo "firefox: already installed ($(command -v firefox))"
    return 0
  fi
  echo "firefox: installing …"
  apt-get install -y -qq firefox || apt-get install -y -qq firefox-esr
}

chromium_runs() {
  local bin="$1"
  [[ -x "$bin" ]] || return 1
  if head -n 5 "$bin" 2>/dev/null | grep -qi 'requires the chromium snap'; then
    return 1
  fi
  "$bin" --version >/dev/null 2>&1
}

install_chromium() {
  if command -v chromium >/dev/null 2>&1 && chromium_runs "$(command -v chromium)"; then
    echo "chromium: already installed ($(command -v chromium))"
    return 0
  fi
  if command -v chromium-browser >/dev/null 2>&1 && chromium_runs "$(command -v chromium-browser)"; then
    echo "chromium: already installed ($(command -v chromium-browser))"
    return 0
  fi
  echo "chromium: installing (apt chromium, not snap stub) …"
  apt-get install -y -qq chromium 2>/dev/null || true
  if command -v chromium >/dev/null 2>&1 && chromium_runs "$(command -v chromium)"; then
    return 0
  fi
  echo "chromium: no native apt binary (Ubuntu may only offer snap). Use Playwright Chromium: npm run install:browsers" >&2
}

install_google_chrome() {
  if command -v google-chrome-stable >/dev/null 2>&1; then
    echo "google-chrome: already installed"
    return 0
  fi
  echo "google-chrome: installing …"
  if ! dpkg -s wget ca-certificates gnupg >/dev/null 2>&1; then
    apt-get install -y -qq wget ca-certificates gnupg
  fi
  tmp="$(mktemp -d)"
  arch="$(dpkg --print-architecture)"
  case "$arch" in
    amd64) deb="google-chrome-stable_current_amd64.deb" ;;
    arm64) deb="google-chrome-stable_current_arm64.deb" ;;
    *)
      echo "google-chrome: unsupported architecture $arch (skip)" >&2
      rm -rf "$tmp"
      return 0
      ;;
  esac
  wget -q -O "$tmp/chrome.deb" "https://dl.google.com/linux/direct/${deb}" || {
    echo "google-chrome: download failed (skip)" >&2
    rm -rf "$tmp"
    return 0
  }
  apt-get install -y -qq "$tmp/chrome.deb" || apt-get install -y -qq -f
  rm -rf "$tmp"
}

install_microsoft_edge() {
  if command -v microsoft-edge-stable >/dev/null 2>&1; then
    echo "microsoft-edge: already installed"
    return 0
  fi
  echo "microsoft-edge: installing …"
  if ! command -v curl >/dev/null 2>&1; then
    apt-get install -y -qq curl
  fi
  curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-edge.gpg 2>/dev/null || true
  if [[ "$(dpkg --print-architecture)" == "arm64" ]]; then
    echo "deb [arch=arm64 signed-by=/usr/share/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main" \
      > /etc/apt/sources.list.d/microsoft-edge.list
  else
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main" \
      > /etc/apt/sources.list.d/microsoft-edge.list
  fi
  apt-get update -qq
  apt-get install -y -qq microsoft-edge-stable 2>/dev/null || {
    echo "microsoft-edge: install failed (optional — skip)" >&2
    rm -f /etc/apt/sources.list.d/microsoft-edge.list
    return 0
  }
}

install_firefox
install_chromium
install_google_chrome
install_microsoft_edge

link_microsoft_edge_alias() {
  if command -v microsoft-edge-stable >/dev/null 2>&1 && ! command -v microsoft-edge >/dev/null 2>&1; then
    local target
    target="$(command -v microsoft-edge-stable)"
    if ln -sf "$target" /usr/local/bin/microsoft-edge 2>/dev/null; then
      echo "microsoft-edge: linked /usr/local/bin/microsoft-edge -> $target"
    fi
  fi
}

link_microsoft_edge_alias

echo ""
echo "Installed (or present):"
command -v google-chrome-stable 2>/dev/null && google-chrome-stable --version || true
command -v chromium-browser 2>/dev/null && chromium-browser --version || command -v chromium 2>/dev/null && chromium --version || true
command -v firefox 2>/dev/null && firefox --version || true
command -v microsoft-edge-stable 2>/dev/null && microsoft-edge-stable --version || true
