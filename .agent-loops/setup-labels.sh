#!/usr/bin/env bash
# Create or update the GitHub labels required by autonomous-work-loops.
set -euo pipefail

repo="${1:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Missing GitHub CLI: install gh and run gh auth login first." >&2
  exit 1
fi

gh auth status >/dev/null

create_label() {
  name="$1"
  color="$2"
  description="$3"
  if [ -n "$repo" ]; then
    gh label create "$name" --color "$color" --description "$description" --force --repo "$repo"
  else
    gh label create "$name" --color "$color" --description "$description" --force
  fi
}

create_label ready 0E8A16 "Trusted work ready for autonomous-work-loops intake"
create_label in-progress FBCA04 "Autonomous-work-loops has claimed this work"
create_label needs-fix D93F0B "Reviewer found blocking defects or proof failed"
create_label ready-for-human 5319E7 "Proof passed and autonomous review converged"
create_label unproven BFDADC "No accepted proof command is configured or available"
create_label did-not-converge B60205 "Review/fix cycle cap reached with blockers remaining"
create_label stalled 000000 "Runner exceeded retry or runtime wall and needs a human"

echo "autonomous-work-loops labels are ready."
