# Document Shrink Reference

Validation-driven compression using SHARED/shrink-framework.md.

**Goal**: Execution equivalence score = 1.0 (perfect). Target ~50% reduction.

## File Validation

**ALLOWED**: `.claude/` (agents/, commands/, hooks/, settings.json), `CLAUDE.md`, project instructions, `docs/project/`, `docs/code-style/*-claude.md`

**FORBIDDEN**: `README.md`, `changelog.md`, `docs/studies/`, `docs/decisions/`, `todo.md`

## Execution Equivalence

Reader achieves same results following compressed version.

**Preserve ALL**:
- **YAML frontmatter** (between `---`) - REQUIRED for slash commands
- Decision-affecting: claims, requirements, constraints
- Relationship structure: temporal ordering, conditionals, prerequisites, exclusions
- Control flow: sequences, blocking checkpoints (STOP, WAIT), branching
- Executable details: commands, paths, thresholds, values

**Safe to Remove**: Redundancy, verbose explanations, meta-commentary (NOT structural metadata), non-essential examples, extended justifications

## Compression Approach

- Keep explicit statements, preserve temporal ordering (A->B), maintain conditional logic (IF-THEN-ELSE), retain constraints
- Remove verbose sections, combine related claims, use principles vs exhaustive lists

## Validation Loop

```
1. Save baseline: /tmp/original-{filename}
2. Compress -> /tmp/compressed-{filename}-v{N}.md
3. Verify YAML: head -5 | grep "^---$"
4. Validate: /docs compare baseline compressed
5. Score = 1.0: APPROVE | Score < 1.0: ITERATE (max 3)
```

**Required**: Score = 1.0 (exact execution equivalence). Any score below 1.0 triggers iteration (0.97, 0.99 -> ITERATE).

## Iteration Prompt

```
**Revision {N}**

Previous Score: {score}/1.0 (threshold: 1.0)

Issues: {warnings from /docs compare}

Lost Relationships:
- **{type}**: {from} → {to} | Fix: {recommendation}

Task: Restore lost relationships while maintaining compression.

Original: /tmp/original-{filename}
Previous: /tmp/compressed-{filename}-v{N}.md
```

## Edge Cases

| Case | Handling |
|------|----------|
| Abstraction vs enumeration | System iterates to restore explicit relationships |
| Score plateau | After 3 attempts, report best to user |
| Large documents (>10KB) | Consider section-by-section |

## Anti-Patterns

**DO NOT**:
- Manual checklist: "Estimated Score: 0.97"
- Estimation without /docs compare
- Custom Task with "verify improvements"

**MANDATORY**: /docs compare for EVERY version
