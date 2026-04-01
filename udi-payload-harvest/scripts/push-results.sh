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
git push origin develop
