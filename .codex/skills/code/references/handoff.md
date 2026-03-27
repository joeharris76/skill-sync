# Handoff Reference

Templates for generating continuation prompts.

## Handoff Types

### Bug Fix Continuation
```markdown
## Handoff: {bug description}

### Root Cause Analysis
- **Symptom**: {what user reported}
- **Root cause**: {what's wrong, file:line}
- **Tried**: {approaches attempted, why they failed/succeeded}

### Current State
- **Fixed**: {fixes applied}
- **Remaining**: {what still needs work}
- **Reproduction**: `{command to reproduce}`

### Next Steps
1. {specific fix with file:line}
2. Add test for {scenario}
3. Run `{verification command}`

### Warnings
- {unhandled edge cases}
```

### Feature Development
```markdown
## Handoff: {feature name}

### Design Decisions
- {decision}: {rationale}
- {alternative rejected}: {why}

### Implementation Status
| Component | Status | File |
|-----------|--------|------|
| {component} | Done/Partial/TODO | {path} |

### Test Status
- **Passing**: {count} ({coverage})
- **Missing**: {untested scenarios}

### Next Steps
1. Implement {component} in {file}
2. Add tests for {scenario}
3. Update docs in {file}

### Warnings
- {assumptions to validate}
```

### Review Follow-up
```markdown
## Handoff: Review follow-up for {scope}

### Findings
| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | {issue} | HIGH/MED/LOW | Fixed/Deferred |

### Changes Made
- {file}: {what and why}

### Deferred Items
- {issue}: {why deferred, suggested approach}

### Verification
```bash
{commands to verify}
```
```

## Good vs Bad Handoffs

**Bad**: "Fixed some bugs in the parser. Still needs work."
**Good**: "Fixed off-by-one in `parser.py:142` where `range(len(tokens))` should be `range(len(tokens) - 1)` because the last token is always EOF. Added test in `test_parser.py:89`. Still need to handle empty input -- `parse("")` raises `IndexError` at `parser.py:98`. Run `pytest tests/test_parser.py -v` to verify."

## Key Principles

1. **Include verification commands** -- next agent must confirm state
2. **Include gotchas** -- things that look right but aren't
3. **Be specific** -- file:line references, not vague descriptions
4. **State what's broken** -- not just what was done, what remains
5. **Include branch info** -- where to start
