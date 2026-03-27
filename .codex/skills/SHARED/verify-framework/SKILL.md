---
name: verify-framework
description: Post-edit verification workflow for lint, typecheck, tests, and spot checks.
---

# Post-Edit Verification Framework

Run BEFORE staging/committing. Hooks handle per-edit lint; this handles full-suite verification.

## Checks

| Check | Command | On Failure |
|-------|---------|------------|
| Lint | `make lint` or project lint cmd | Fix errors |
| Type | `make typecheck` (if available) | Fix type errors |
| Test | `make test-fast` or project test cmd | Fix or flag |

## Post-Edit Spot Check

After every Edit, read back edited region (+5 lines context) to confirm:
- No mixed indentation
- Correct nesting level
- No orphaned lines from partial edits
- Imports consistent (no stale/missing)

## Rules

1. Never skip verification. If no commands exist, note in output.
2. If ANY check fails, fix before proceeding.
3. Report results:

```markdown
### Verification
| Check | Result |
|-------|--------|
| Lint | PASS/FAIL |
| Type | PASS/FAIL/SKIPPED |
| Test | PASS/FAIL |
```
