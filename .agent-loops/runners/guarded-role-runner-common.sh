# Shared guarded role runner body.
#
# This file is sourced by codex.sh and claude.sh after they define
# run_nested_agent <sandbox_mode> <prompt> <log>. The shared body keeps
# GitHub/Git mutation, trust checks, proof, labels, PRs, and marker comments
# in one place so the two agent-specific wrappers cannot drift.
set -euo pipefail

repo="${1:-}"
role="${2:-}"
model="${3:-}"
[ -n "$repo" ] || repo="/Users/mkamar/Non_Work/Projects/planning-poker"
[ -n "$role" ] || role="implementer"
[ -n "$model" ] || model=""
mins="${GUARDED_TIMEOUT_MINUTES:-30}"
case "$mins" in ""|*"{{"*) mins=30 ;; esac
raw="${RAW_EVIDENCE:-${repo}/.agent-loops/evidence/prove-the-gate}"
mkdir -p "$raw/logs"

cd "$repo"

wall() {
  if command -v timeout >/dev/null 2>&1; then timeout "${mins}m" "$@"; return; fi
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "${mins}m" "$@"; return; fi
  ( "$@" ) & local pid=$!
  ( sleep "$((mins*60))" && kill -TERM "$pid" 2>/dev/null ) & local killer=$!
  wait "$pid"; local rc=$?; kill "$killer" 2>/dev/null || true; return $rc
}

cfg() {
  python3 - "$1" <<'PY'
import ast
import sys
from pathlib import Path

key = sys.argv[1]
lines = Path(".agent-loops/config.yaml").read_text().splitlines()

def scalar(name, default=""):
    for raw in lines:
        line = raw.strip()
        if line.startswith(name + ":"):
            return line.split(":", 1)[1].split("#", 1)[0].strip().strip('"\'')
    return default

def proof(name):
    in_proof = False
    for raw in lines:
        if raw.startswith("proof:"):
            in_proof = True
            continue
        if in_proof and raw and not raw.startswith((" ", "\t")):
            break
        if in_proof and raw.strip().startswith(name + ":"):
            return raw.split(":", 1)[1].split("#", 1)[0].strip().strip('"\'')
    return ""

def nested(section, name, default=""):
    in_section = False
    for raw in lines:
        if raw.startswith(section + ":"):
            in_section = True
            continue
        if in_section and raw and not raw.startswith((" ", "\t")):
            break
        if in_section and raw.strip().startswith(name + ":"):
            return raw.split(":", 1)[1].split("#", 1)[0].strip().strip('"\'')
    return default

def trusted():
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line.startswith("trusted_actors:"):
            continue
        value = line.split(":", 1)[1].split("#", 1)[0].strip()
        if value.startswith("["):
            print("\n".join(ast.literal_eval(value)))
            return
        if value == "":
            out = []
            for nxt in lines[i + 1:]:
                if nxt and not nxt.startswith((" ", "\t", "-")):
                    break
                item = nxt.strip()
                if item.startswith("-"):
                    out.append(item[1:].strip().strip('"\''))
            print("\n".join(out))
            return
    return

if key.startswith("proof."):
    print(proof(key.split(".", 1)[1]))
elif key == "trusted_actors":
    trusted()
elif key.startswith("labels."):
    print(nested("labels", key.split(".", 1)[1], key.split(".", 1)[1].replace("_", "-")))
elif key.startswith("budgets."):
    print(nested("budgets", key.split(".", 1)[1]))
else:
    print(scalar(key))
PY
}

label_ready="$(cfg labels.ready)"
label_in_progress="$(cfg labels.in_progress)"
label_needs_fix="$(cfg labels.needs_fix)"
label_ready_for_human="$(cfg labels.ready_for_human)"
label_unproven="$(cfg labels.unproven)"
label_did_not_converge="$(cfg labels.did_not_converge)"
label_stalled="$(cfg labels.stalled)"
trust_posture="$(cfg trust_posture)"
branch_prefix="$(cfg branch_prefix)"
branch_prefix="${branch_prefix:-loop/impl/issue-}"
max_cycles="$(cfg budgets.max_reviewer_fixer_cycles_per_change)"
max_cycles="${max_cycles:-2}"
kill_retries="$(cfg budgets.kill_retries)"
kill_retries="${kill_retries:-2}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

trusted_actor() {
  local actor="$1"
  if [ "$trust_posture" != "strict" ]; then
    return 0
  fi
  cfg trusted_actors | grep -Fxq "$actor"
}

stale_issue() {
  local repo_slug="$1" issue="$2" branch marker_ts
  branch="${branch_prefix}${issue}"
  if git ls-remote --heads origin "refs/heads/${branch}" | grep -q .; then
    return 1
  fi
  marker_ts="$(gh issue view "$issue" --repo "$repo_slug" --json comments --jq '.comments[].body | select(test("<!-- loop:implementer"))' | sed -n 's/.* ts=\([^ ]*\) -->.*/\1/p' | tail -1)"
  [ -n "$marker_ts" ] || return 1
  python3 - "$marker_ts" <<'PY'
from datetime import datetime, timezone, timedelta
import sys

raw = sys.argv[1].replace("Z", "+00:00")
try:
    ts = datetime.fromisoformat(raw)
except ValueError:
    sys.exit(1)
if ts.tzinfo is None:
    ts = ts.replace(tzinfo=timezone.utc)
sys.exit(0 if datetime.now(timezone.utc) - ts > timedelta(minutes=90) else 1)
PY
}

default_branch() {
  git remote show origin | sed -n '/HEAD branch/s/.*: //p'
}

run_proof() {
  local log="$1"
  : > "$log"
  local any=0
  local cmd
  for key in build lint test; do
    cmd="$(cfg "proof.${key}")"
    [ -n "$cmd" ] || continue
    any=1
    {
      printf '$ %s\n' "$cmd"
      PYTHONDONTWRITEBYTECODE=1 bash -lc "$cmd"
    } >>"$log" 2>&1 || return 1
  done
  [ "$any" = 1 ] || return 2
}

post_pr_marker() {
  local pr="$1" marker="$2" body="$3" file
  file="$(mktemp)"
  {
    printf '%s\n\n' "$marker"
    printf '%s\n' "$body"
  } > "$file"
  gh pr comment "$pr" --body-file "$file" >/dev/null
  rm -f "$file"
}

post_issue_marker() {
  local issue="$1" marker="$2" body="$3" file
  file="$(mktemp)"
  {
    printf '%s\n\n' "$marker"
    printf '%s\n' "$body"
  } > "$file"
  gh issue comment "$issue" --body-file "$file" >/dev/null
  rm -f "$file"
}

safe_issue_remove_label() {
  gh issue edit "$1" --repo "$2" --remove-label "$3" >/dev/null 2>&1 || true
}

safe_pr_remove_label() {
  gh pr edit "$1" --repo "$2" --remove-label "$3" >/dev/null 2>&1 || true
}

set_issue_state() {
  local issue="$1" repo_slug="$2" target="$3" label
  for label in "$label_ready" "$label_in_progress" "$label_needs_fix" "$label_ready_for_human" "$label_unproven" "$label_did_not_converge" "$label_stalled"; do
    [ "$label" = "$target" ] || safe_issue_remove_label "$issue" "$repo_slug" "$label"
  done
  gh issue edit "$issue" --repo "$repo_slug" --add-label "$target" >/dev/null
}

set_pr_state() {
  local pr="$1" repo_slug="$2" target="$3" label
  for label in "$label_in_progress" "$label_needs_fix" "$label_ready_for_human" "$label_unproven" "$label_did_not_converge" "$label_stalled"; do
    [ "$label" = "$target" ] || safe_pr_remove_label "$pr" "$repo_slug" "$label"
  done
  gh pr edit "$pr" --repo "$repo_slug" --add-label "$target" >/dev/null
}

pr_issue_number() {
  local pr="$1" repo_slug="$2" branch="${3:-}" issue
  issue="$(gh pr view "$pr" --repo "$repo_slug" --json closingIssuesReferences --jq '.closingIssuesReferences[0].number // empty')"
  if [ -z "$issue" ] && [ -n "$branch" ]; then
    issue="${branch#${branch_prefix}}"
  fi
  printf '%s\n' "$issue"
}

latest_cycle() {
  local pr="$1" repo_slug="$2"
  gh pr view "$pr" --repo "$repo_slug" --json comments --jq '.comments[].body' \
    | sed -n 's/.* cycle=\([0-9][0-9]*\) .*/\1/p' \
    | tail -1
}

latest_review_verdict_for_head() {
  local pr="$1" repo_slug="$2" head="$3"
  gh pr view "$pr" --repo "$repo_slug" --json comments --jq '.comments[].body' \
    | sed -n "s/.*loop:reviewer.*reviewed_sha=${head}.*verdict=\\([^ ]*\\).*/\\1/p" \
    | tail -1
}

issue_timeout_count() {
  local issue="$1" repo_slug="$2"
  gh issue view "$issue" --repo "$repo_slug" --json comments --jq '.comments[].body' \
    | grep -c 'verdict=timeout' || true
}

pr_timeout_count() {
  local pr="$1" repo_slug="$2"
  gh pr view "$pr" --repo "$repo_slug" --json comments --jq '.comments[].body' \
    | grep -c 'verdict=timeout' || true
}

handle_issue_timeout() {
  local issue="$1" repo_slug="$2" branch="$3" role="$4" count
  count="$(issue_timeout_count "$issue" "$repo_slug")"
  count=$((count + 1))
  if [ "$count" -gt "$kill_retries" ]; then
    post_issue_marker "$issue" "<!-- loop:${role} v=1 reviewed_sha=timeout verdict=stalled cycle=0 ts=$(ts) -->" "Guarded ${role} exceeded the external wall ${count} times. Routing to stalled."
    set_issue_state "$issue" "$repo_slug" "$label_stalled"
  else
    post_issue_marker "$issue" "<!-- loop:${role} v=1 reviewed_sha=timeout verdict=timeout cycle=0 ts=$(ts) -->" "Guarded ${role} exceeded the external wall on ${branch}. The next tick will reconstruct state and retry."
    set_issue_state "$issue" "$repo_slug" "$label_in_progress"
  fi
}

handle_pr_timeout() {
  local pr="$1" repo_slug="$2" branch="$3" role="$4" cycle="$5" issue count
  count="$(pr_timeout_count "$pr" "$repo_slug")"
  count=$((count + 1))
  if [ "$count" -gt "$kill_retries" ]; then
    post_pr_marker "$pr" "<!-- loop:${role} v=1 reviewed_sha=timeout verdict=stalled cycle=${cycle} ts=$(ts) -->" "Guarded ${role} exceeded the external wall ${count} times. Routing to stalled."
    set_pr_state "$pr" "$repo_slug" "$label_stalled"
    issue="$(pr_issue_number "$pr" "$repo_slug" "$branch")"
    [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_stalled"
  else
    post_pr_marker "$pr" "<!-- loop:${role} v=1 reviewed_sha=timeout verdict=timeout cycle=${cycle} ts=$(ts) -->" "Guarded ${role} exceeded the external wall. The next tick will reconstruct state and retry."
  fi
}

open_or_update_pr() {
  local issue="$1" branch="$2" title="$3" body_file="$4"
  local pr
  pr="$(gh pr list --repo "$(gh repo view --json nameWithOwner --jq .nameWithOwner)" --head "$branch" --json number --jq '.[0].number // empty')"
  if [ -n "$pr" ]; then
    gh pr edit "$pr" --body-file "$body_file" >/dev/null
    printf '%s\n' "$pr"
    return
  fi
  gh pr create --base "$(default_branch)" --head "$branch" --title "$title" --body-file "$body_file" | sed 's#.*/pull/##'
}

stage_non_generated() {
  python3 - <<'PY' | while IFS= read -r path; do git add "$path"; done
import subprocess
skip = ("/__pycache__/", "__pycache__/", ".pyc")
skip_prefixes = (".agent-loops/",)
out = subprocess.check_output(["git", "status", "--porcelain"], text=True)
for line in out.splitlines():
    if not line:
        continue
    path = line[3:]
    if path.startswith(skip_prefixes):
        continue
    if any(s in path for s in skip) or path.endswith(".pyc"):
        continue
    print(path)
PY
}

claim_review_lock() {
  local pr="$1" head="$2" lock_ref
  lock_ref="refs/heads/loop/review/pr-${pr}-${head}"
  git push origin "${head}:${lock_ref}" >/dev/null 2>&1
}

context_pack() {
  local root default f found
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  default="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
  [ -n "$default" ] || default="$(git branch --show-current 2>/dev/null || true)"
  {
    printf 'Repository root: %s\n' "$root"
    printf 'Runner working directory: %s\n' "$PWD"
    printf 'Default branch: %s\n' "$default"
    printf '\n.agent-loops/context.md:\n'
    if [ -f ".agent-loops/context.md" ]; then
      sed -n '1,220p' .agent-loops/context.md
    else
      printf 'Missing .agent-loops/context.md. Use .agent-loops/config.yaml, host state, and nearby repo docs only.\n'
    fi
    printf '\nRepo instruction files present:\n'
    found=0
    for f in AGENTS.md CLAUDE.md README.md CONTRIBUTING.md docs/CONTRIBUTING.md .github/copilot-instructions.md; do
      if [ -f "$f" ]; then
        printf '%s\n' "- $f"
        found=1
      fi
    done
    [ "$found" = 1 ] || printf '%s\n' "- none found at repo root"
  }
}

run_nested_review() {
  local pr="$1" repo_slug="$2" head="$3" proof_log="$4" review_log="$5" proof_rc="$6" issue body diff prompt prompt_log verdict
  issue="$(pr_issue_number "$pr" "$repo_slug" "")"
  body=""
  if [ -n "$issue" ]; then
    body="$(gh issue view "$issue" --repo "$repo_slug" --json title,body --jq '"Title: " + .title + "\n\n" + (.body // "")')"
  fi
  diff="$(git diff "$(git merge-base HEAD "origin/$(default_branch)")"..HEAD -- . | sed -n '1,240p')"
  prompt="You are reviewing PR #${pr} at head ${head}.

Issue context:
${body}

Proof log:
$(tail -80 "$proof_log" 2>/dev/null || true)

Diff:
${diff}

Review adversarially. Do not run git. Do not run gh. Do not edit files. Decide whether the current head has blocking defects relative to the issue and proof.

Repository context:
$(context_pack)

Return exactly one first line:
VERDICT: clean
or
VERDICT: blocking

After that, provide concise findings. Use blocking only for defects that should route to fixer."
  prompt_log="${review_log%.log}-prompt.log"
  printf '%s\n' "$prompt" >"$prompt_log"
  set +e
  run_nested_agent read-only "$prompt" "$review_log"
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    return "$rc"
  fi
  verdict="$(sed -nE 's/^VERDICT:[[:space:]]*(clean|blocking)[[:space:]]*$/\1/Ip' "$review_log" | tail -1 | tr '[:upper:]' '[:lower:]')"
  case "$verdict" in
    clean) return 0 ;;
    blocking) return 10 ;;
    *) return 11 ;;
  esac
}

implementer() {
  local repo_slug issue actor branch base title body claim_sha proof_log pr_body pr head_sha proof_rc log prompt_log timeout_count existing_pr
  repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

  local active_block=0
  while IFS=$'\t' read -r issue actor title; do
    [ -n "$issue" ] || continue
    trusted_actor "$actor" || continue
    branch="${branch_prefix}${issue}"
    timeout_count="$(issue_timeout_count "$issue" "$repo_slug")"
    if [ "${timeout_count:-0}" -gt "$kill_retries" ]; then
      post_issue_marker "$issue" "<!-- loop:implementer v=1 reviewed_sha=timeout verdict=stalled cycle=0 ts=$(ts) -->" "Timed-out implementer claim exceeded kill_retries=${kill_retries}; routing to stalled for human recovery."
      set_issue_state "$issue" "$repo_slug" "$label_stalled"
    elif [ "${timeout_count:-0}" -gt 0 ]; then
      existing_pr="$(gh pr list --repo "$repo_slug" --state open --head "$branch" --json number --jq '.[0].number // empty')"
      if [ -z "$existing_pr" ]; then
        post_issue_marker "$issue" "<!-- loop:implementer v=1 reviewed_sha=timeout verdict=retry cycle=0 ts=$(ts) -->" "Recovering timed-out implementer claim retry ${timeout_count}/${kill_retries}; no PR exists for ${branch}."
        gh issue edit "$issue" --repo "$repo_slug" --remove-label "$label_in_progress" --add-label "$label_ready" >/dev/null
      else
        active_block=1
      fi
    elif stale_issue "$repo_slug" "$issue"; then
      gh issue comment "$issue" --repo "$repo_slug" --body "<!-- loop:implementer v=1 reviewed_sha=stale verdict=no-op cycle=0 ts=$(ts) -->

Stale in-progress claim detected with no claim branch. Releasing the advisory label so the guarded runner can reclaim through the normal trust and branch-ref path." >/dev/null
      gh issue edit "$issue" --repo "$repo_slug" --remove-label "$label_in_progress" --add-label "$label_ready" >/dev/null
    else
      active_block=1
    fi
  done < <(gh issue list --repo "$repo_slug" --state open --label "$label_in_progress" --json number,title,author --jq '.[] | [.number, .author.login, .title] | @tsv')

  if [ "$active_block" = 1 ]; then
    echo "implementer budget full: active in-progress issue exists"
    return 0
  fi

  while IFS=$'\t' read -r issue actor title; do
    [ -n "$issue" ] || continue
    trusted_actor "$actor" || continue

    branch="${branch_prefix}${issue}"
    existing_pr="$(gh pr list --repo "$repo_slug" --state open --head "$branch" --json number --jq '.[0].number // empty')"
    if git ls-remote --heads origin "refs/heads/${branch}" | grep -q .; then
      if [ -n "$existing_pr" ]; then
        echo "claim already has PR for issue #${issue}: ${branch}"
        return 0
      fi
      git fetch origin "$branch"
      git switch -C "$branch" "origin/$branch"
      claim_sha="$(git rev-parse HEAD)"
      gh issue edit "$issue" --repo "$repo_slug" --remove-label "$label_ready" --add-label "$label_in_progress" >/dev/null
    else
      git fetch origin
      base="$(default_branch)"
      git switch -c "$branch" "origin/$base"
      git commit --allow-empty -m "Claim issue #${issue}"
      claim_sha="$(git rev-parse HEAD)"
      if ! git push origin "HEAD:refs/heads/${branch}"; then
        echo "lost claim race for issue #${issue}"
        return 0
      fi
      gh issue edit "$issue" --repo "$repo_slug" --remove-label "$label_ready" --add-label "$label_in_progress" >/dev/null
    fi

    body="$(gh issue view "$issue" --repo "$repo_slug" --json body --jq .body)"
    log="$raw/logs/guarded-implementer-$(date -u +%Y%m%d-%H%M%S)-issue-${issue}.log"
    local prompt="You are implementing already-claimed GitHub issue #${issue} on branch ${branch}.

Repository context:
$(context_pack)

Issue title: ${title}
Issue body:
${body}

Before editing, use targeted file reads or rg from the repository root to inspect the relevant source, tests, and repo instruction files listed above. Do not load unrelated large directory trees.

Edit the working tree only. Do not run git. Do not run gh. Do not run proof commands. Do not create commits, branches, PRs, labels, or marker comments. Do not edit .agent-loops unless the issue explicitly requires it. Implement the smallest complete change and exit."
    prompt_log="${log%.log}-prompt.log"
    printf '%s\n' "$prompt" >"$prompt_log"
    set +e
    run_nested_agent workspace-write "$prompt" "$log"
    local codex_rc=$?
    set -e
    if [ "$codex_rc" -ne 0 ]; then
      handle_issue_timeout "$issue" "$repo_slug" "$branch" implementer
      echo "guarded implementer failed or timed out for issue #${issue}; rc=${codex_rc}; see ${log}"
      return "$codex_rc"
    fi

    proof_log="$raw/logs/guarded-proof-$(date -u +%Y%m%d-%H%M%S)-issue-${issue}.log"
    set +e
    run_proof "$proof_log"
    proof_rc=$?
    set -e

    stage_non_generated
    if git diff --cached --quiet; then
      echo "no implementation diff for issue #${issue}; leaving claim for human inspection"
      return 1
    fi
    git commit -m "Implement issue #${issue}"
    head_sha="$(git rev-parse HEAD)"
    git push origin "HEAD:refs/heads/${branch}"

    pr_body="$(mktemp)"
    {
      printf 'Closes #%s.\n\n' "$issue"
      printf 'Proof:\n'
      if [ "$proof_rc" = 0 ]; then
        tail -20 "$proof_log" | sed 's/^/- /'
      elif [ "$proof_rc" = 2 ]; then
        printf -- '- no configured proof command; routing to unproven\n'
      else
        tail -40 "$proof_log" | sed 's/^/- /'
      fi
    } > "$pr_body"
    pr="$(open_or_update_pr "$issue" "$branch" "$title" "$pr_body")"
    rm -f "$pr_body"

    if [ "$proof_rc" = 0 ]; then
      post_pr_marker "$pr" "<!-- loop:implementer v=1 reviewed_sha=${head_sha} verdict=proof-passed cycle=0 ts=$(ts) -->" "Guarded implementer committed and pushed issue #${issue}. Prompt: ${prompt_log}. Proof passed; see ${proof_log}."
    elif [ "$proof_rc" = 2 ]; then
      post_pr_marker "$pr" "<!-- loop:implementer v=1 reviewed_sha=${head_sha} verdict=unproven cycle=0 ts=$(ts) -->" "Guarded implementer committed and pushed issue #${issue}, but no proof command is configured. Prompt: ${prompt_log}."
      set_issue_state "$issue" "$repo_slug" "$label_unproven"
      set_pr_state "$pr" "$repo_slug" "$label_unproven"
    else
      post_pr_marker "$pr" "<!-- loop:implementer v=1 reviewed_sha=${head_sha} verdict=proof-failed cycle=0 ts=$(ts) -->" "Guarded implementer committed and pushed issue #${issue}, but proof failed. Prompt: ${prompt_log}. Proof: ${proof_log}."
      set_issue_state "$issue" "$repo_slug" "$label_needs_fix"
      set_pr_state "$pr" "$repo_slug" "$label_needs_fix"
    fi
    return 0
  done < <(gh issue list --repo "$repo_slug" --state open --label "$label_ready" --json number,title,author --jq '.[] | [.number, .author.login, .title] | @tsv')

  echo "no trusted ready work"
}

reviewer() {
  local repo_slug pr branch head proof_log proof_rc labels review_log review_rc cycle issue prior_verdict body_tail
  repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  while IFS=$'\t' read -r pr branch labels; do
    [ -n "$pr" ] || continue
    case "$branch" in
      "$branch_prefix"*) ;;
      *) continue ;;
    esac
    case ",$labels," in
      *",$label_ready_for_human,"*|*",$label_needs_fix,"*|*",$label_unproven,"*) continue ;;
    esac
    git fetch origin "$branch"
    git switch -C "$branch" "origin/$branch"
    head="$(git rev-parse HEAD)"
    prior_verdict="$(latest_review_verdict_for_head "$pr" "$repo_slug" "$head")"
    if [ "$prior_verdict" = "ready-for-human" ] || [ "$prior_verdict" = "unproven" ] || [ "$prior_verdict" = "did-not-converge" ]; then
      echo "reviewer no-op: PR #${pr} head ${head} already reviewed with verdict=${prior_verdict}"
      return 0
    fi
    if ! claim_review_lock "$pr" "$head"; then
      echo "reviewer no-op: PR #${pr} head ${head} already has an active review lock"
      return 0
    fi
    cycle="$(latest_cycle "$pr" "$repo_slug")"
    cycle="${cycle:-0}"
    proof_log="$raw/logs/guarded-review-proof-$(date -u +%Y%m%d-%H%M%S)-pr-${pr}.log"
    set +e
    run_proof "$proof_log"
    proof_rc=$?
    set -e
    if [ "$proof_rc" = 0 ]; then
      review_log="$raw/logs/guarded-review-$(date -u +%Y%m%d-%H%M%S)-pr-${pr}.log"
      set +e
      run_nested_review "$pr" "$repo_slug" "$head" "$proof_log" "$review_log" "$proof_rc"
      review_rc=$?
      set -e
      issue="$(pr_issue_number "$pr" "$repo_slug" "$branch")"
      if [ "$review_rc" = 0 ]; then
        post_pr_marker "$pr" "<!-- loop:reviewer v=1 reviewed_sha=${head} verdict=ready-for-human cycle=${cycle} ts=$(ts) -->" "Guarded reviewer reran proof and adversarial review found no blocking defects. Prompt: ${review_log%.log}-prompt.log. Proof: ${proof_log}. Review: ${review_log}."
        set_pr_state "$pr" "$repo_slug" "$label_ready_for_human"
        [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_ready_for_human"
      elif [ "$review_rc" = 10 ]; then
        body_tail="$(tail -40 "$review_log" | sed 's/^/- /')"
        if [ "$cycle" -ge "$max_cycles" ]; then
          post_pr_marker "$pr" "<!-- loop:reviewer v=1 reviewed_sha=${head} verdict=did-not-converge cycle=${cycle} ts=$(ts) -->" "Blocking defects remain at the cycle cap. Prompt: ${review_log%.log}-prompt.log. Review: ${review_log}.\n${body_tail}"
          set_pr_state "$pr" "$repo_slug" "$label_did_not_converge"
          [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_did_not_converge"
        else
          cycle=$((cycle + 1))
          post_pr_marker "$pr" "<!-- loop:reviewer v=1 reviewed_sha=${head} verdict=needs-fix cycle=${cycle} ts=$(ts) -->" "Guarded reviewer found blocking defects. Prompt: ${review_log%.log}-prompt.log. Proof: ${proof_log}. Review: ${review_log}.\n${body_tail}"
          set_pr_state "$pr" "$repo_slug" "$label_needs_fix"
          [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_needs_fix"
        fi
      else
        body_tail="$(tail -40 "$review_log" | sed 's/^/- /')"
        cycle=$((cycle + 1))
        post_pr_marker "$pr" "<!-- loop:reviewer v=1 reviewed_sha=${head} verdict=needs-fix cycle=${cycle} ts=$(ts) -->" "Guarded reviewer could not parse a clean review verdict, so it is routing to fixer instead of approving. Prompt: ${review_log%.log}-prompt.log. Review: ${review_log}.\n${body_tail}"
        set_pr_state "$pr" "$repo_slug" "$label_needs_fix"
        [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_needs_fix"
      fi
    elif [ "$proof_rc" = 2 ]; then
      post_pr_marker "$pr" "<!-- loop:reviewer v=1 reviewed_sha=${head} verdict=unproven cycle=0 ts=$(ts) -->" "Guarded reviewer found no configured proof command."
      set_pr_state "$pr" "$repo_slug" "$label_unproven"
      issue="$(pr_issue_number "$pr" "$repo_slug" "$branch")"
      [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_unproven"
    else
      if [ "$cycle" -ge "$max_cycles" ]; then
        post_pr_marker "$pr" "<!-- loop:reviewer v=1 reviewed_sha=${head} verdict=did-not-converge cycle=${cycle} ts=$(ts) -->" "Proof still fails at the cycle cap; see ${proof_log}."
        set_pr_state "$pr" "$repo_slug" "$label_did_not_converge"
        issue="$(pr_issue_number "$pr" "$repo_slug" "$branch")"
        [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_did_not_converge"
      else
        cycle=$((cycle + 1))
        post_pr_marker "$pr" "<!-- loop:reviewer v=1 reviewed_sha=${head} verdict=needs-fix cycle=${cycle} ts=$(ts) -->" "Guarded reviewer reran proof and it failed; see ${proof_log}."
        set_pr_state "$pr" "$repo_slug" "$label_needs_fix"
        issue="$(pr_issue_number "$pr" "$repo_slug" "$branch")"
        [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_needs_fix"
      fi
    fi
    return 0
  done < <(gh pr list --repo "$repo_slug" --state open --json number,headRefName,labels --jq '.[] | [.number, .headRefName, ([.labels[].name] | join(","))] | @tsv')
  echo "no reviewable loop PR"
}

fixer() {
  local repo_slug pr branch head proof_log proof_rc labels cycle prior_verdict issue log prompt base body feedback body_tail
  repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  while IFS=$'\t' read -r pr branch labels; do
    [ -n "$pr" ] || continue
    case "$branch" in
      "$branch_prefix"*) ;;
      *) continue ;;
    esac
    case ",$labels," in
      *",$label_needs_fix,"*) ;;
      *) continue ;;
    esac
    git fetch origin "$branch"
    git switch -C "$branch" "origin/$branch"
    head="$(git rev-parse HEAD)"
    prior_verdict="$(gh pr view "$pr" --repo "$repo_slug" --json comments --jq '.comments[].body' \
      | sed -n "s/.*loop:fixer.*reviewed_sha=${head}.*verdict=\\([^ ]*\\).*/\\1/p" \
      | tail -1)"
    if [ "$prior_verdict" = "fixed" ] || [ "$prior_verdict" = "unproven" ] || [ "$prior_verdict" = "did-not-converge" ] || [ "$prior_verdict" = "stalled" ]; then
      echo "fixer no-op: PR #${pr} head ${head} already fixed with verdict=${prior_verdict}"
      return 0
    fi
    cycle="$(latest_cycle "$pr" "$repo_slug")"
    cycle="${cycle:-1}"
    issue="$(pr_issue_number "$pr" "$repo_slug" "$branch")"
    body=""
    if [ -n "$issue" ]; then
      body="$(gh issue view "$issue" --repo "$repo_slug" --json title,body --jq '"Title: " + .title + "\n\n" + (.body // "")')"
    fi
    feedback="$(gh pr view "$pr" --repo "$repo_slug" --json comments --jq '.comments[].body' | tail -200)"
    log="$raw/logs/guarded-fixer-$(date -u +%Y%m%d-%H%M%S)-pr-${pr}.log"
    prompt="You are fixing PR #${pr} on branch ${branch}.

Repository context:
$(context_pack)

Issue context:
${body}

Latest review/proof feedback:
${feedback}

Before editing, use targeted file reads or rg from the repository root to inspect the relevant source, tests, and repo instruction files listed above. Do not load unrelated large directory trees.

Edit the working tree only. Do not run git. Do not run gh. Do not run proof commands. Do not create commits, branches, PRs, labels, or marker comments. Fix the blocking defects needed for this cycle and exit."
    prompt_log="${log%.log}-prompt.log"
    printf '%s\n' "$prompt" >"$prompt_log"
    set +e
    run_nested_agent workspace-write "$prompt" "$log"
    local codex_rc=$?
    set -e
    if [ "$codex_rc" -ne 0 ]; then
      handle_pr_timeout "$pr" "$repo_slug" "$branch" fixer "$cycle"
      echo "guarded fixer failed or timed out for PR #${pr}; rc=${codex_rc}; see ${log}"
      return "$codex_rc"
    fi

    proof_log="$raw/logs/guarded-fixer-proof-$(date -u +%Y%m%d-%H%M%S)-pr-${pr}.log"
    set +e
    run_proof "$proof_log"
    proof_rc=$?
    set -e

    stage_non_generated
    if ! git diff --cached --quiet; then
      git commit -m "Fix PR #${pr}"
      head="$(git rev-parse HEAD)"
      git push origin "HEAD:refs/heads/${branch}"
    fi

    if [ "$proof_rc" = 0 ]; then
      post_pr_marker "$pr" "<!-- loop:fixer v=1 reviewed_sha=${head} verdict=fixed cycle=${cycle} ts=$(ts) -->" "Guarded fixer addressed PR #${pr}; proof passed. Prompt: ${prompt_log}. Fix log: ${log}. Proof: ${proof_log}."
      set_pr_state "$pr" "$repo_slug" "$label_in_progress"
      [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_in_progress"
    elif [ "$proof_rc" = 2 ]; then
      post_pr_marker "$pr" "<!-- loop:fixer v=1 reviewed_sha=${head} verdict=unproven cycle=${cycle} ts=$(ts) -->" "Guarded fixer found no configured proof command."
      set_pr_state "$pr" "$repo_slug" "$label_unproven"
      [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_unproven"
    else
      body_tail="$(tail -40 "$proof_log" | sed 's/^/- /')"
      if [ "$cycle" -ge "$max_cycles" ]; then
        post_pr_marker "$pr" "<!-- loop:fixer v=1 reviewed_sha=${head} verdict=did-not-converge cycle=${cycle} ts=$(ts) -->" "Guarded fixer proof still failed at the cycle cap; see ${proof_log}.\n${body_tail}"
        set_pr_state "$pr" "$repo_slug" "$label_did_not_converge"
        [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_did_not_converge"
      else
        cycle=$((cycle + 1))
        post_pr_marker "$pr" "<!-- loop:fixer v=1 reviewed_sha=${head} verdict=proof-failed cycle=${cycle} ts=$(ts) -->" "Guarded fixer ran proof and it still failed; see ${proof_log}.\n${body_tail}"
        set_pr_state "$pr" "$repo_slug" "$label_needs_fix"
        [ -n "$issue" ] && set_issue_state "$issue" "$repo_slug" "$label_needs_fix"
      fi
    fi
    return 0
  done < <(gh pr list --repo "$repo_slug" --state open --json number,headRefName,labels --jq '.[] | [.number, .headRefName, ([.labels[].name] | join(","))] | @tsv')
  echo "no fixable loop PR"
}

case "$role" in
  implementer) implementer ;;
  reviewer) reviewer ;;
  fixer) fixer ;;
  *) echo "unknown role: $role" >&2; exit 2 ;;
esac
