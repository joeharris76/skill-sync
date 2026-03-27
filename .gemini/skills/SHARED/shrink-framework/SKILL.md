---
name: shrink-framework
description: Validation-driven compression workflow that requires semantic comparison before approval.
---

# Validation-Driven Compression Framework

Every compression MUST be validated via compare framework. No manual checks.

## Workflow

1. **Validate Type** - Check artifact is allowed
2. **Save Baseline** - Store original (once, reuse across iterations)
3. **Compress** - Invoke compression agent
4. **Validate** - Compare compressed vs baseline
5. **Decision** - Score meets threshold? Approve. Otherwise iterate.

## Type Validation

**ALLOWED**: Application source code, Claude-facing docs, config files
**FORBIDDEN**: Tests, generated files, vendored code, migrations, changelogs, READMEs (unless explicit)

## Compression Agent Template

Use Task tool with `subagent_type: "general-purpose"`:

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
Read file, compress, USE WRITE TOOL to save compressed version.
CRITICAL: Actually write the file.
```

## Validation Loop

```
1. Save baseline (if not exists)
2. Compress -> save as v{N}
3. Compare: baseline vs v{N}
4. Score >= threshold:
   - Run tests (if applicable) -> pass: APPROVE, overwrite original, clean up
5. Score < threshold:
   - Generate iteration prompt with feedback -> step 2 (max 3 iterations)
```

## Decision Logic

| Condition | Action |
|-----------|--------|
| Score >= threshold AND tests pass | APPROVE - overwrite original |
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
Focus: restore contracts, fix dependencies, maintain error handling.
CRITICAL: USE WRITE TOOL to save revised version.
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
| Original | {lines} | - | N/A | Baseline |
| V1 | {lines} | {%} | {score} | {status} |

### Removed/Simplified
- {item}

### Validation: Primary {score}, Relationship {score}, Structure {score}

### Recommendation: {APPROVED|ITERATE|MANUAL_REVIEW}
```

## Cleanup

**On success**: `rm /tmp/compressed-{filename}-v*.{ext}` (keep baseline for future iterations)
**On user done**: `rm /tmp/original-{filename} /tmp/shrink-{filename}-version.txt`

## Edge Cases

| Case | Handling |
|------|----------|
| Public API changes | STOP and ask user |
| Test dependencies | Preserve or update tests |
| Score plateau | After 3 attempts, report best |
| Large files | Consider section-by-section |
| Already minimal | Report "minimal opportunities" |
