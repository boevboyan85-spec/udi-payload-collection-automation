#!/usr/bin/env bash
#
# One-shot Ubuntu / Kasm prep for bots-automation (Node 20, system browsers, Playwright).
# Run from any directory, e.g.:  bash setup-kasm-ubuntu.sh
#
# This file contains a GitHub PAT for the test environment. Override with
#   export GITHUB_TOKEN='...'
# before running if needed.
#
set -euo pipefail

GIT_USER_NAME="Boyan Boev"
GIT_USER_EMAIL="boev.boyan85@gmail.com"
GITHUB_USERNAME="${GITHUB_USERNAME:-boyan.boev85-spec}"
# Embedded for local/test VM use only; env GITHUB_TOKEN wins if set.
GITHUB_TOKEN="${GITHUB_TOKEN:-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}"
REPO_SLUG="boevboyan85-spec/udi-payload-collection-automation"
BOTS_DIR_NAME="bots-automation"

git config --global user.email "$GIT_USER_EMAIL"
git config --global user.name "$GIT_USER_NAME"

export GITHUB_USERNAME
export GITHUB_TOKEN

export BOTS_PLATFORM="${BOTS_PLATFORM:-ubuntu}"
export BOTS_IN_CONTAINER="${BOTS_IN_CONTAINER:-1}"
export BOTS_NO_SANDBOX="${BOTS_NO_SANDBOX:-1}"

mkdir -p "$HOME/Documents/git"
cd "$HOME/Documents/git"

REPO_DIR="udi-payload-collection-automation"
# Optional: copy bots-automation-develop.bundle from your Mac and set GIT_BUNDLE_PATH.
GIT_BUNDLE_PATH="${GIT_BUNDLE_PATH:-}"

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "Repository exists at $PWD/$REPO_DIR — pulling develop..."
  AUTH_URL="https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git"
  if curl -sf -H "Authorization: token ${GITHUB_TOKEN}" https://api.github.com/user >/dev/null; then
    git -C "$REPO_DIR" pull "$AUTH_URL" develop || git -C "$REPO_DIR" pull "$AUTH_URL"
  else
    echo "[warn] GitHub token invalid — skip pull. Use GIT_BUNDLE_PATH to clone, or: git pull after fixing token."
  fi
elif [[ -n "$GIT_BUNDLE_PATH" && -f "$GIT_BUNDLE_PATH" ]]; then
  echo "Cloning from bundle: $GIT_BUNDLE_PATH"
  git clone "$GIT_BUNDLE_PATH" -b develop "$REPO_DIR"
elif curl -sf -H "Authorization: token ${GITHUB_TOKEN}" https://api.github.com/user >/dev/null; then
  git clone "https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git"
  git -C "$REPO_DIR" checkout develop 2>/dev/null || true
  git -C "$REPO_DIR" remote set-url origin "https://github.com/${REPO_SLUG}.git"
else
  echo "No valid GitHub token and no GIT_BUNDLE_PATH. On your Mac run:" >&2
  echo "  cd ~/Documents/GitHub/udi-payload-collection-automation && git bundle create ~/bots-automation-develop.bundle develop" >&2
  echo "  scp ~/bots-automation-develop.bundle kasm:~/ && export GIT_BUNDLE_PATH=~/bots-automation-develop.bundle" >&2
  exit 1
fi

cd "$REPO_DIR/$BOTS_DIR_NAME"

# --- Node.js 20 + npm (Ubuntu apt "nodejs" on Kasm is often v12 and omits npm) ---
node_toolchain_ok() {
  command -v node >/dev/null 2>&1 &&
    command -v npm >/dev/null 2>&1 &&
    [[ "$(node -p 'parseInt(process.versions.node.split(".")[0],10)')" -ge 18 ]]
}

disable_broken_apt_sources() {
  # Kasm images often ship Sublime apt entries that fail behind corporate proxy (breaks apt update).
  for f in /etc/apt/sources.list.d/*sublime* /etc/apt/sources.list.d/*Sublime*; do
    [[ -f "$f" ]] || continue
    if grep -qE '^[[:space:]]*deb ' "$f" 2>/dev/null; then
      echo "[apt] Disabling broken source: $f"
      sudo sed -i.bak -E 's/^([[:space:]]*deb )/# \1/' "$f"
    fi
  done
}

install_node_via_nodesource() {
  echo "Node.js: trying NodeSource 20.x …"
  if ! curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -; then
    echo "[warn] NodeSource setup script failed."
    return 1
  fi
  sudo apt-get install -y nodejs
  node_toolchain_ok
}

install_node_via_nvm() {
  echo "Node.js: installing Node 20 via nvm (user-local) …"
  export NVM_DIR="${HOME}/.nvm"
  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"
  nvm install 20
  nvm alias default 20
  node_toolchain_ok
}

ensure_node_toolchain() {
  disable_broken_apt_sources
  sudo apt-get update -qq || sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg apt-transport-https xz-utils

  if node_toolchain_ok; then
    echo "Node $(node -v), npm $(npm -v) — OK"
    return 0
  fi

  # Remove Ubuntu universe nodejs 12 (no npm / too old) before NodeSource.
  if command -v node >/dev/null 2>&1; then
    echo "Removing old node: $(node -v 2>/dev/null || echo missing)"
    sudo apt-get remove -y nodejs npm 2>/dev/null || true
    sudo apt-get autoremove -y 2>/dev/null || true
  fi

  install_node_via_nodesource || true
  if node_toolchain_ok; then
    echo "Node $(node -v), npm $(npm -v) — OK (NodeSource)"
    return 0
  fi

  install_node_via_nvm || true
  if node_toolchain_ok; then
    echo "Node $(node -v), npm $(npm -v) — OK (nvm)"
    NVM_MARK="bots-automation nvm"
    touch "$HOME/.bashrc"
    if ! grep -qF "$NVM_MARK" "$HOME/.bashrc" 2>/dev/null; then
      {
        echo ""
        echo "# ${NVM_MARK}"
        echo 'export NVM_DIR="$HOME/.nvm"'
        echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
      } >>"$HOME/.bashrc"
    fi
    return 0
  fi

  echo "ERROR: Could not install Node 18+ with npm. Try manually:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  echo "  # or: install nvm and run: nvm install 20" >&2
  exit 1
}

ensure_node_toolchain

# Corporate TLS / skip Puppeteer Chrome download on Kasm
export NODE_TLS_REJECT_UNAUTHORIZED="${NODE_TLS_REJECT_UNAUTHORIZED:-0}"
export PUPPETEER_SKIP_DOWNLOAD="${PUPPETEER_SKIP_DOWNLOAD:-1}"

npm install
npm run install:browsers

GIT_ENV_DIR="${HOME}/.config/bots-automation"
GIT_ENV_FILE="${GIT_ENV_DIR}/git-push.env"
mkdir -p "$GIT_ENV_DIR"
umask 077
{
  echo '# Generated by setup-kasm-ubuntu.sh — chmod 600.'
  printf 'export GITHUB_USERNAME=%q\n' "$GITHUB_USERNAME"
  printf 'export GITHUB_TOKEN=%q\n' "$GITHUB_TOKEN"
} >"${GIT_ENV_FILE}.new"
mv "${GIT_ENV_FILE}.new" "$GIT_ENV_FILE"
chmod 600 "$GIT_ENV_FILE" 2>/dev/null || true
echo "Wrote ${GIT_ENV_FILE} for scripts/push-to-github.sh"

BASHRC_MARK="bots-automation git-push.env"
touch "$HOME/.bashrc"
if ! grep -qF "$BASHRC_MARK" "$HOME/.bashrc" 2>/dev/null; then
  {
    echo ""
    echo "# ${BASHRC_MARK}"
    echo '[[ -f "$HOME/.config/bots-automation/git-push.env" ]] && source "$HOME/.config/bots-automation/git-push.env"'
  } >>"$HOME/.bashrc"
fi

echo "Done. bots-automation directory: $(pwd)"
echo "  cp .env.example .env"
echo "  npm run collect"
