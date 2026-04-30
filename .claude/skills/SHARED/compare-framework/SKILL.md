---
name: compare-framework
description: Compare two artifacts for semantic and behavioral equivalence.
---

# Semantic Comparison Framework

Compare artifacts for behavioral/execution equivalence.

## Workflow

1. Extract semantics from Artifact A (IN PARALLEL)
2. Extract semantics from Artifact B (IN PARALLEL)
3. Compare extracted data (after both complete)
4. Calculate equivalence score
5. Generate report with shared/unique items, warnings

**Critical:** Run steps 1-2 in parallel. Extract independently; never prime with expected changes or "items to verify."

## Comparison Rules

1. **Exact Match**: Identical normalized form -> shared
2. **Semantic Equivalence**: Different form, identical meaning -> shared
3. **Type Mismatch**: Same concept, different structure -> flag
4. **Unique**: In only one artifact

## Scoring Thresholds

| Score | Interpretation |
|-------|----------------|
| >=0.95 | Equivalent - safe to proceed |
| 0.85-0.94 | Mostly equivalent - review carefully |
| 0.70-0.84 | Significant differences |
| <0.70 | BREAKING - not equivalent |

Score = `primary 40% + relationship 40% + structure 20%`; breaking change = 0.5x, critical relationship loss = 0.7x.

## Warning Severities

| Type | Severity | Trigger |
|------|----------|---------|
| Breaking change | CRITICAL | Core contract changed |
| Relationship loss | HIGH | Dependency removed |
| Structural change | MEDIUM | Organization differs |
| Minor difference | LOW | Cosmetic changes |

## Extraction Agent Template

Task template:

```
**SEMANTIC EXTRACTION**
**Artifact**: {{path}} | **Type**: {{code|document|config}}

Extract ALL {{type-specific items}}; normalize forms, include line numbers, note confidence.
Output (JSON): { "items": [...], "relationships": [...], "metadata": {...} }
```

## Limitations

- Cannot execute to verify runtime behavior — structural analysis only
- Dynamic/implicit behavior (reflection, monkey-patching, runtime registration) may be missed
- External references (URLs, file paths, env vars) not followed
- Confidence decreases with indirection depth

## Rules

- Execute both extractions in a single message with TWO Task calls
- See per-skill `references/compare.md` for templates and domain extraction categories
