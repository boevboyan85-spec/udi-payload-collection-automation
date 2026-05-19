#!/usr/bin/env bash
# Commit and push bots-automation (and repo root) changes to origin develop.
# Works from bots-automation/ inside udi-payload-collection-automation monorepo.
set -euo pipefail

BOTS="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$BOTS/.." && pwd)"

# Test env defaults (same as setup-kasm-ubuntu.sh); git-push.env overrides when present.
GITHUB_USERNAME="${GITHUB_USERNAME:-boyan.boev85-spec}"
GITHUB_TOKEN="${GITHUB_TOKEN:-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}"

GIT_PUSH_ENV="${HOME}/.config/bots-automation/git-push.env"
if [[ -f "$GIT_PUSH_ENV" ]]; then
  # shellcheck source=/dev/null
  source "$GIT_PUSH_ENV"
fi

if [[ -z "${GITHUB_TOKEN:-}" && -n "${GITHUB_TOKEN_FILE:-}" && -f "${GITHUB_TOKEN_FILE}" ]]; then
  GITHUB_TOKEN="$(tr -d '\n\r' <"${GITHUB_TOKEN_FILE}")"
  export GITHUB_TOKEN
fi

cd "$REPO_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository — skipping push." >&2
  exit 1
fi

git add bots-automation

if git diff --cached --quiet && git diff --quiet bots-automation; then
  echo "Nothing to commit under bots-automation/"
  exit 0
fi

MSG="${1:-chore(bots-automation): update collection automation}"

if [[ -n "${GIT_AUTHOR_NAME:-}" && -n "${GIT_AUTHOR_EMAIL:-}" ]]; then
  export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$GIT_AUTHOR_NAME}"
  export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$GIT_AUTHOR_EMAIL}"
fi

git commit -m "$MSG"

REPO_PATH="boevboyan85-spec/udi-payload-collection-automation"
U="${GITHUB_USERNAME:-git}"
export GIT_TERMINAL_PROMPT=0
git push "https://${U}:${GITHUB_TOKEN}@github.com/${REPO_PATH}.git" HEAD:develop
