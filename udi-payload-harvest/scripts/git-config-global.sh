#!/usr/bin/env bash
# Option C: set global git user.name and user.email (run once per KASM user).
# Usage:
#   export GIT_USER_EMAIL="you@example.com"
#   export GIT_USER_NAME="Your Name"
#   bash scripts/git-config-global.sh
set -euo pipefail
: "${GIT_USER_EMAIL:?Set GIT_USER_EMAIL (e.g. export GIT_USER_EMAIL=you@example.com)}"
: "${GIT_USER_NAME:?Set GIT_USER_NAME (e.g. export GIT_USER_NAME='Your Name')}"

git config --global user.email "$GIT_USER_EMAIL"
git config --global user.name "$GIT_USER_NAME"

echo "Global git identity set:"
git config --global --get user.name
git config --global --get user.email
