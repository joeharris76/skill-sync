---
name: research-framework
description: Pre-edit investigation workflow for understanding code and behavior before changes.
---

# Research Framework

Mandatory pre-edit investigation.

## When Required

- Before any code fix (runtime, lint, type)
- Before implementing review findings (`--chain`)
- Before performance changes
- Standalone via `/code research`

## Steps

1. **Scope**: Identify affected code path from error/request
2. **Read**: Target file(s) AND at least one caller or test
3. **Trace**: Follow data/control flow through affected path
4. **Understand**: State current behavior in 2-3 sentences
5. **Hypothesis**: Propose what's wrong with `file:line` evidence
6. **Validate**: Check hypothesis against tests/runtime before editing

## Rules

- Do NOT edit files during research
- If no tests exist, say so explicitly
- If path spans >3 files, list all before diving in
- Output stays in conversation context, not written to files

## Standalone Output

```markdown
## Research: {scope}
Files: {file:line — role}
Behavior: {2-3 sentences}
Dependencies: {upstream/downstream}
Coverage: {tests + gaps}
Risks: {what could break}
```
