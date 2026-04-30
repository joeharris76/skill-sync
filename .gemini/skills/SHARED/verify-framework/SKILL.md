---
name: verify-framework
description: Post-edit verification workflow for lint, typecheck, tests, and spot checks.
---

# Post-Edit Verification Framework

Run before staging/committing. Hooks handle per-edit lint; this handles full-suite verification.

## Checks

| Check | Command | On Failure |
|-------|---------|------------|
| Lint | `make lint` or project lint cmd | Fix errors |
| Type | `make typecheck` (if available) | Fix type errors |
| Test | `make test-fast` or project test cmd | Fix or flag |

## Post-Edit Spot Check

After every edit, read back edited region (+5 lines) to confirm:
- No mixed indentation
- Correct nesting level
- No orphaned lines from partial edits
- Imports consistent (no stale/missing)

## Rules

1. Never skip verification; if no commands exist, note it.
2. If any check fails, fix before proceeding.
3. Report:

```markdown
### Verification
| Check | Result |
|-------|--------|
| Lint | PASS/FAIL |
| Type | PASS/FAIL/SKIPPED |
| Test | PASS/FAIL |
```
