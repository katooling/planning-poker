# Autonomous Work Loops Context Contract

This file is the durable context contract for every Implementer, Reviewer, and
Fixer tick in this repo. Keep it short and update it in the same PR that changes
repo architecture, proof commands, generated paths, or ownership boundaries.

## Startup Context

Every tick must start from the repository root and reconstruct state from:

1. `.agent-loops/config.yaml`
2. `.agent-loops/context.md`
3. host state: GitHub issue, PR, labels, branch head, and marker comments
4. repo instruction files when present: `AGENTS.md`, `CLAUDE.md`, `README.md`,
   `CONTRIBUTING.md`, `.github/copilot-instructions.md`, or path-local docs
5. only the source, tests, and docs relevant to the current issue or PR diff

Do not rely on memory from earlier ticks. Do not load the whole repository tree
when targeted `rg`, file reads, and proof logs can answer the question.

## Working Directory

Runners must invoke role ticks from the repository root. Nested agents may edit
workspace files only. The guarded runner owns Git, GitHub labels, branch refs,
commits, PRs, proof execution, and marker comments.

## Generated Paths

Treat these paths as generated loop infrastructure unless the issue explicitly
requires changing them:

- `.agent-loops/evidence/`
- `.agent-loops/runners/`
- `.agent-loops/playbooks/`

Implementation PRs should not include generated evidence logs.

Useful setup helpers:

- `.agent-loops/doctor.sh` checks local setup before the supervisor runs.
- `.agent-loops/FIRST-TRIAL-ISSUE.md` is a safe smoke-test issue body.

## Role Context

Implementer:
- read the trusted issue and nearby code/tests before editing
- make the smallest complete change
- add or update tests when the configured proof can run them

Reviewer:
- review the actual diff, changed files, proof output, and issue requirements
- treat passing proof as necessary but not sufficient
- separate blocking findings from non-blocking notes

Fixer:
- read the latest reviewer marker and PR comments
- fix only the blocking items for the current cycle unless adjacent cleanup is tiny
- return the PR to reviewer after proof

## Human Gates

Route to a human-gated label rather than guessing when:

- proof is missing or the proof command itself changed
- browser/device/credential proof cannot run on the current runner surface
- the change exceeds the configured file or cycle budget
- repo instructions conflict with the issue request
