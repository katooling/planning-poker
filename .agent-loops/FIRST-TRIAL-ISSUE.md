# First Trial Issue

Use this issue to prove the loop works before you trust it with real work.

## Title

Add one tiny tested change to prove autonomous-work-loops is wired correctly

## Body

Make the smallest safe change that proves this repository can be changed by
autonomous-work-loops.

Acceptance criteria:

- Add or update one small test, fixture, or documentation check.
- Run the configured proof command.
- Open exactly one PR from a `loop/impl/issue-<number>` branch.
- Do not include `.agent-loops/evidence/` logs in the PR diff.

Notes:

- Keep the change intentionally small.
- If there is no good tiny code change, improve one README sentence and run the configured proof command.
- Stop with `unproven` if no proof command is configured.
