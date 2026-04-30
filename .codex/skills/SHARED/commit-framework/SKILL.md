---
name: commit-framework
description: Unified identify-verify-stage-commit workflow for skill-driven commits.
---

# Commit Framework

Identify, verify, stage, commit, and push for skill-driven changes.

## Parameters (from calling skill)

| Parameter | Description |
|-----------|-------------|
| **file_scope** | File discovery rule |
| **prefix** | Commit type (`feat`/`fix`/`refactor`/`docs`/`test`/`chore`) |
| **verify_cmd** | Pre-commit verification command(s) |

## Steps

1. **Discover**: Find files matching file_scope
2. **Guard**: No files → exit: "No files to commit."
3. **Check**: `git status --porcelain {files}`
4. **Context**: `git diff {files}`, `git log --oneline -5`
5. **Analyze**: Determine change type/scope from diff
6. **Verify** (SHARED/verify-framework.md): Run verify_cmd; fix failures before proceeding
7. **Stage+Commit** in single command:
   ```bash
   git add {files} && git commit -m "$(cat <<'EOF'
   prefix(scope): message

   EOF
   )"
   ```
8. **Push**: `git push` immediately after commit succeeds. If no upstream is set, use `git push -u origin {branch}`.

## Rules

- **NEVER** `git add -A` — only commit discovered files
- **ALWAYS** `git add` and `git commit` in one shell command
- **ALWAYS** `git push` after a successful commit — local-only commits risk data loss
- Conventional Commits format
- If verification fails and can't auto-fix, report and do NOT commit
