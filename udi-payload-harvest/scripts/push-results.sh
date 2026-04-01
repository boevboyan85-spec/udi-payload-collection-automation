#!/usr/bin/env bash
# Commit and push results/txids.jsonl to origin develop.
# Works when this folder is the repo root or a subfolder (e.g. udi-payload-collection-automation/udi-payload-harvest).
set -euo pipefail
HARVEST="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HARVEST"

if [[ ! -f results/txids.jsonl ]]; then
  echo "No results/txids.jsonl yet. Run npm run collect first."
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository — skipping push."
  exit 0
fi

git add results/txids.jsonl

if git diff --cached --quiet; then
  echo "Nothing new to commit for results/txids.jsonl"
  exit 0
fi

MSG="${1:-chore(results): append txId capture records}"

# KASM / headless clones often have no git user — use env (or git config) for author + committer.
if [[ -n "${GIT_AUTHOR_NAME:-}" && -n "${GIT_AUTHOR_EMAIL:-}" ]]; then
  export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$GIT_AUTHOR_NAME}"
  export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$GIT_AUTHOR_EMAIL}"
fi

git commit -m "$MSG"

# Optional: non-interactive HTTPS push (GITHUB_USERNAME + GITHUB_TOKEN; never commit the token).
# GITHUB_TOKEN_FILE: path to a file containing the PAT only (newline trimmed) if GITHUB_TOKEN is unset.
# Revoke any token that was ever pasted into chat or committed.
if [[ -z "${GITHUB_TOKEN:-}" && -n "${GITHUB_TOKEN_FILE:-}" && -f "${GITHUB_TOKEN_FILE}" ]]; then
  GITHUB_TOKEN="$(tr -d '\n\r' <"${GITHUB_TOKEN_FILE}")"
  export GITHUB_TOKEN
fi

ORIGIN=$(git remote get-url origin)
REPO_PATH=""
if [[ "$ORIGIN" =~ github\.com[:/]+(.+)$ ]]; then
  REPO_PATH="${BASH_REMATCH[1]}"
  REPO_PATH="${REPO_PATH%.git}"
fi

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  if [[ -z "$REPO_PATH" || "$REPO_PATH" == "$ORIGIN" ]]; then
    echo "Could not parse owner/repo from remote: $ORIGIN" >&2
    exit 1
  fi
  U="${GITHUB_USERNAME:-${GIT_USERNAME:-git}}"
  export GIT_TERMINAL_PROMPT=0
  git push "https://${U}:${GITHUB_TOKEN}@github.com/${REPO_PATH}.git" HEAD:develop
else
  export GIT_TERMINAL_PROMPT=0
  git push origin develop
fi
