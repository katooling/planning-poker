#!/usr/bin/env bash
# Usage after rendering:
#   .agent-loops/runners/claude.sh
# Or explicitly:
#   .agent-loops/runners/claude.sh <repo_path> <role> [model]
#
# Managed agent sandboxes can edit workspace files but may not write .git.
# This wrapper keeps Claude-specific invocation here and delegates the shared
# guarded GitHub/Git workflow to guarded-role-runner-common.sh.
set -euo pipefail

run_nested_agent() {
  local _sandbox_mode="$1" prompt="$2" log="$3"
  if [ -n "${model:-}" ]; then
    wall claude -p --permission-mode bypassPermissions --add-dir "$repo" --model "$model" -- "$prompt" </dev/null >"$log" 2>&1
  else
    wall claude -p --permission-mode bypassPermissions --add-dir "$repo" -- "$prompt" </dev/null >"$log" 2>&1
  fi
}

runner_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$runner_dir/guarded-role-runner-common.sh"
