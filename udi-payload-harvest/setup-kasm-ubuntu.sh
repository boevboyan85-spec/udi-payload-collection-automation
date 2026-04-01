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
sudo apt-get install -y ca-certificates curl gnupg

if [[ -f /etc/apt/sources.list.d/sublime-text.list ]]; then
  echo "Commenting first line of /etc/apt/sources.list.d/sublime-text.list"
  sudo sed -i '1s/^/# /' /etc/apt/sources.list.d/sublime-text.list
fi

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

npm config set strict-ssl false
npm install
sudo npx playwright install-deps

export NODE_TLS_REJECT_UNAUTHORIZED=0
npx playwright install chromium firefox webkit
unset NODE_TLS_REJECT_UNAUTHORIZED

echo "Done. Harvest project directory: $(pwd)"
