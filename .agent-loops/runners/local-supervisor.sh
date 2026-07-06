#!/usr/bin/env bash
# Local foreground supervisor for autonomous-work-loops.
# Start this once in a terminal and leave it running. It is not a daemon and it
# does not install cron, launchd, or other persistent scheduler entries.
set -euo pipefail

repo="${1:-}"
[ -n "$repo" ] || repo="/Users/mkamar/Non_Work/Projects/planning-poker"
interval_seconds="${AWL_SUPERVISOR_INTERVAL_SECONDS:-}"
[ -n "$interval_seconds" ] || interval_seconds="600"
case "$interval_seconds" in ""|*"{{"*) interval_seconds=600 ;; esac

runner="${AWL_ROLE_RUNNER:-}"
if [ -z "$runner" ]; then
  if command -v codex >/dev/null 2>&1 && [ -x "${repo}/.agent-loops/runners/codex.sh" ]; then
    runner="${repo}/.agent-loops/runners/codex.sh"
  elif command -v claude >/dev/null 2>&1 && [ -x "${repo}/.agent-loops/runners/claude.sh" ]; then
    runner="${repo}/.agent-loops/runners/claude.sh"
  else
    echo "No guarded role runner found." >&2
    echo "Install Codex CLI or Claude Code, or set AWL_ROLE_RUNNER to a guarded role runner path." >&2
    exit 1
  fi
fi

if [ ! -x "$runner" ]; then
  echo "Missing executable guarded role runner: $runner" >&2
  exit 1
fi

while true; do
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "[$ts] autonomous-work-loops supervisor tick"

  "$runner" "$repo" implementer || true
  "$runner" "$repo" reviewer || true
  "$runner" "$repo" fixer || true

  sleep "$interval_seconds"
done
