---
name: shrink-framework
description: Validation-driven compression workflow that requires semantic comparison before approval.
---

# Validation-Driven Compression Framework

Every compression must be validated by compare framework.

## Workflow

1. **Validate Type** — allowed/forbidden per skill
2. **Save Baseline** — once, reuse across iterations
3. **Compress** — invoke compression agent
4. **Validate** — compare compressed vs baseline
5. **Decide** — approve if score meets threshold; otherwise iterate

## Type Validation

**ALLOWED**: Application source code, Claude-facing docs, config files
**FORBIDDEN**: Tests, generated files, vendored code, migrations, changelogs, READMEs (unless explicit)

## Compression Agent Template

Task template:

```
**COMPRESSION TASK**

**File**: {{path}}
**Goal**: {{threshold}} equivalence score. Target ~{{target}}% reduction.

## Equivalence Definition
Same inputs -> same outputs, same side effects, same error handling.

## Preserve ALL
- Public API / interface
- Type contracts
- Side effects, error handling, control flow
- Dependencies
- Critical comments (TODO, FIXME, why-comments)

## Safe to Remove
- Dead code, redundant implementations
- Verbose patterns -> concise equivalents
- Unnecessary intermediate variables
- Comments repeating code
- Defensive code for impossible conditions

## Output
Read file, compress, and save the compressed version.
```

## Validation Loop

```
1. Save baseline (if not exists): /tmp/original-{filename}
2. Compress -> /tmp/compressed-{filename}-v{N}.{ext}
3. Compare: baseline vs v{N}
4. Score >= threshold: run tests -> pass: APPROVE, overwrite, clean up
5. Score < threshold: iterate with feedback (max 3)
```

## Decision Logic

| Condition | Action |
|-----------|--------|
| Score >= threshold AND tests pass | APPROVE — overwrite original |
| Score >= threshold AND tests fail | FIX tests or revert |
| Score < threshold AND iterations < 3 | ITERATE with feedback |
| Score < threshold AND iterations >= 3 | Report best version, ask guidance |

## Iteration Prompt Template

```
**COMPRESSION REVISION {N}**
**Previous Score**: {score}/{threshold}
**Issues**: {warnings from comparison}
**Task**: Restore equivalence while maintaining compression.
**Original**: {baseline_path}
**Previous**: {version_path}
Focus: restore contracts/dependencies/error handling and save the revision.
```

## Versioning

```bash
BASELINE="/tmp/original-{filename}"
VERSION_FILE="/tmp/shrink-{filename}-version.txt"
VERSION=$(($(cat "$VERSION_FILE" 2>/dev/null || echo 0) + 1))
echo "$VERSION" > "$VERSION_FILE"
COMPRESSED="/tmp/compressed-{filename}-v${VERSION}.{ext}"
```

## Report Format

```markdown
## Compression Results
| Version | Size | Reduction | Score | Status |
|---------|------|-----------|-------|--------|
| Original | {lines} | — | N/A | Baseline |
| v{N} | {lines} | {%} | {score} | {status} |

### Removed/Simplified
- {item}

### Validation: Primary {score}, Relationship {score}, Structure {score}

### Recommendation: {APPROVED|ITERATE|MANUAL_REVIEW}
```

## Cleanup

**On success**: remove compressed temp versions; keep baseline for future iterations.
**On user done**: remove baseline and version temp files.

## Edge Cases

| Case | Handling |
|------|----------|
| Public API changes | STOP and ask user |
| Test dependencies | Preserve or update tests |
| Score plateau | After 3 attempts, report best |
| Large files | Consider section-by-section |
| Already minimal | Report "minimal opportunities" |

## Rules

- Use Task tool with `subagent_type: "general-purpose"` for compression
- See per-skill `references/shrink.md` for type-specific allowed/forbidden lists, preserve/remove rules, compression techniques, and edge cases
