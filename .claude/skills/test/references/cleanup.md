# Test Cleanup Reference

Commit modified test files using SHARED/commit-framework.md.

## Parameters

- **file_scope**: `git status --porcelain` filtered to test directories
- **prefix**: `test`
- **verify_cmd**: Project's fast/default test command

## Commit Message Examples

- `test: add coverage for cloud storage integration`
- `test: fix failing platform adapter tests`
- `test: add performance baseline tests`
- `test: update mocking strategy for database adapter`

## Output Format

```markdown
## Test Cleanup Complete

**Committed N files:**
- `tests/path/to/test_file.py` (new/modified)
- ...

**Commit:** `abc1234` test: <message>
```
