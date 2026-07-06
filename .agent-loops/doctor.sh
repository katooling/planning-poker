#!/usr/bin/env bash
# Preflight checks for autonomous-work-loops in a target repo.
# This script reports setup blockers only. It does not mutate GitHub or local git state.
set -euo pipefail

repo="${1:-$PWD}"
cd "$repo"

failures=0
warnings=0

ok() {
  printf 'ok: %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf 'warn: %s\n' "$1"
}

fail() {
  failures=$((failures + 1))
  printf 'fail: %s\n' "$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

config=".agent-loops/config.yaml"

if [ -d .git ]; then
  ok "git repo found"
else
  fail "run from the target repo root, or pass the repo path as the first argument"
fi

if [ -f "$config" ]; then
  ok "$config found"
else
  fail "missing $config; run /autonomous-work-loops in this repo first"
fi

if have gh; then
  ok "gh CLI found"
  if gh auth status >/dev/null 2>&1; then
    ok "gh auth status passed"
  else
    fail "gh is not authenticated; run: gh auth login"
  fi
else
  fail "missing gh CLI; install it with: brew install gh"
fi

if have python3; then
  ok "python3 found"
else
  fail "missing python3; doctor needs it to parse .agent-loops/config.yaml"
fi

if git remote get-url origin >/dev/null 2>&1; then
  origin_url="$(git remote get-url origin)"
  case "$origin_url" in
    *github.com*) ok "origin remote looks like GitHub" ;;
    *) fail "origin remote is not GitHub; V1 supports GitHub only: $origin_url" ;;
  esac
else
  fail "missing origin remote"
fi

if have gh && gh auth status >/dev/null 2>&1; then
  if gh repo view --json nameWithOwner,hasIssuesEnabled >/dev/null 2>&1; then
    ok "gh can read this repository"
    if [ "$(gh repo view --json hasIssuesEnabled --jq '.hasIssuesEnabled')" = "true" ]; then
      ok "GitHub issues are enabled"
    else
      fail "GitHub issues are disabled for this repo"
    fi
  else
    fail "gh cannot read this repository; check auth, remote, and permissions"
  fi
fi

if [ -f "$config" ] && have python3; then
  proof_count=0
  while IFS= read -r proof_line; do
    proof_count=$((proof_count + 1))
    ok "proof command configured: $proof_line"
  done < <(python3 - "$config" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
current = None
for raw in path.read_text().splitlines():
    line = raw.split("#", 1)[0].rstrip()
    if not line.strip():
        continue
    if not line.startswith((" ", "\t")):
        current = line[:-1].strip() if line.endswith(":") else None
        continue
    if current == "proof" and ":" in line:
        key, value = line.strip().split(":", 1)
        value = value.strip().strip('"').strip("'")
        if value:
            print(f"{key}={value}")
PY
  )
  if [ "$proof_count" -eq 0 ]; then
    fail "no proof command configured in $config; set proof.test, proof.build, or proof.lint"
  fi

  current_user=""
  if have gh && gh auth status >/dev/null 2>&1; then
    current_user="$(gh api user --jq .login 2>/dev/null || true)"
  fi
  if [ -n "$current_user" ]; then
    trust_result=""
    while IFS= read -r trust_line; do
      trust_result="$trust_line"
      break
    done < <(python3 - "$config" "$current_user" <<'PY'
import ast
import sys
from pathlib import Path

path = Path(sys.argv[1])
actor = sys.argv[2]
trusted = []
trust_posture = ""
lines = path.read_text().splitlines()
quote_chars = chr(34) + chr(39)

def clean(value):
    return value.split("#", 1)[0].strip().strip(quote_chars)

for i, raw in enumerate(lines):
    stripped = raw.strip()
    if stripped.startswith("trust_posture:"):
        trust_posture = clean(stripped.split(":", 1)[1])
        continue
    if not stripped.startswith("trusted_actors:"):
        continue
    value = stripped.split(":", 1)[1].split("#", 1)[0].strip()
    if value.startswith("["):
        try:
            trusted = ast.literal_eval(value)
        except (SyntaxError, ValueError):
            trusted = [clean(item) for item in value.strip("[]").split(",") if clean(item)]
    elif value:
        trusted = [clean(value)]
    else:
        for nxt in lines[i + 1:]:
            if nxt and not nxt.startswith((" ", "\t", "-")):
                break
            item = nxt.split("#", 1)[0].strip()
            if item.startswith("-"):
                trusted.append(clean(item[1:]))
if actor in trusted:
    print("trusted")
elif trust_posture == "strict":
    print("strict-untrusted")
else:
    print("permissive-untrusted")
PY
    )
    if [ "$trust_result" = "trusted" ]; then
      ok "authenticated gh user is trusted: $current_user"
    elif [ "$trust_result" = "strict-untrusted" ]; then
      fail "authenticated gh user is not in trusted_actors under strict trust_posture: $current_user"
    else
      warn "authenticated gh user is not in trusted_actors: $current_user"
    fi
  fi
fi

if [ -x .agent-loops/setup-labels.sh ]; then
  ok ".agent-loops/setup-labels.sh is executable"
else
  fail "missing executable .agent-loops/setup-labels.sh"
fi

if have gh && gh auth status >/dev/null 2>&1 && gh repo view --json nameWithOwner >/dev/null 2>&1; then
  required_labels="ready in-progress needs-fix ready-for-human unproven did-not-converge stalled"
  for label in $required_labels; do
    if gh label list --json name --jq '.[].name' | grep -Fx "$label" >/dev/null 2>&1; then
      ok "label exists: $label"
    else
      fail "missing label: $label; run .agent-loops/setup-labels.sh"
    fi
  done
fi

if [ -x .agent-loops/runners/local-supervisor.sh ]; then
  ok "local supervisor is executable"
else
  fail "missing executable .agent-loops/runners/local-supervisor.sh"
fi

if [ -x .agent-loops/runners/codex.sh ] && have codex; then
  ok "Codex role runner is available"
elif [ -x .agent-loops/runners/claude.sh ] && have claude; then
  ok "Claude role runner is available"
else
  fail "no usable role runner found; install Codex CLI or Claude Code"
fi

if have timeout; then
  ok "timeout command found"
elif have gtimeout; then
  ok "gtimeout command found"
else
  warn "no timeout/gtimeout command found; install coreutils on macOS for stronger runtime walls"
fi

printf '\nsummary: %s failure(s), %s warning(s)\n' "$failures" "$warnings"
[ "$failures" -eq 0 ]
