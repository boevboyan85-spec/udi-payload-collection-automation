#!/usr/bin/env bash
# Run collection on Kasm/Ubuntu with git credentials and platform env loaded.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

GIT_PUSH_ENV="${HOME}/.config/bots-automation/git-push.env"
[[ -f "$GIT_PUSH_ENV" ]] && source "$GIT_PUSH_ENV"

export BOTS_PLATFORM="${BOTS_PLATFORM:-ubuntu}"
export BOTS_IN_CONTAINER="${BOTS_IN_CONTAINER:-1}"
export BOTS_NO_SANDBOX="${BOTS_NO_SANDBOX:-1}"

npm run collect "$@"
