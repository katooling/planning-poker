#!/usr/bin/env bash
# Usage after rendering:
#   .agent-loops/runners/codex.sh
# Or explicitly:
#   .agent-loops/runners/codex.sh <repo_path> <role> [model]
#
# Managed Codex sandboxes can edit workspace files but may not write .git.
# This wrapper keeps Codex-specific invocation here and delegates the shared
# guarded GitHub/Git workflow to guarded-role-runner-common.sh.
set -euo pipefail

run_nested_agent() {
  local sandbox_mode="$1" prompt="$2" log="$3"
  if [ -n "${model:-}" ]; then
    wall codex exec --cd "$repo" -s "$sandbox_mode" -c approval_policy='"never"' -c sandbox_workspace_write.network_access=true -c "model=\"$model\"" "$prompt" </dev/null >"$log" 2>&1
  else
    wall codex exec --cd "$repo" -s "$sandbox_mode" -c approval_policy='"never"' -c sandbox_workspace_write.network_access=true "$prompt" </dev/null >"$log" 2>&1
  fi
}

runner_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$runner_dir/guarded-role-runner-common.sh"
