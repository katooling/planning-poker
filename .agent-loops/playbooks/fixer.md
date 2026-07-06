# Fixer Playbook

Use the installed `autonomous-work-loops` skill in tick mode with role `fixer`.

Default path:

1. Read `.agent-loops/context.md`, latest reviewer feedback, and markers.
2. No-op if this head was already fixed.
3. Address blocking defects for the current cycle.
4. Run configured proof.
5. Return to reviewer or route to `unproven` / `stalled`.
6. Append evidence for repeated failure themes.
7. Exit after one PR.
