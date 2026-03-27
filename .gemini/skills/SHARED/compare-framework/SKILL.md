---
name: compare-framework
description: Semantic comparison workflow for validating equivalence between artifacts.
---

# Semantic Comparison Framework

Compare two artifacts (code, documents, configs) for behavioral/execution equivalence.

## Workflow

1. Extract semantics from Artifact A (IN PARALLEL)
2. Extract semantics from Artifact B (IN PARALLEL)
3. Compare extracted data (after both complete)
4. Calculate equivalence score
5. Generate report with shared/unique items, warnings

**CRITICAL**: Steps 1-2 MUST run in parallel (single message, two Task calls). Extract independently — NEVER pre-populate with "items to verify" or prime with change knowledge. Targeted validation inflates scores.

## Extraction Agent Template

Use Task tool with `subagent_type: "general-purpose"`, `model: "sonnet"`:

```
**SEMANTIC EXTRACTION**
**Artifact**: {{path}} | **Type**: {{code|document|config}}

Extract ALL {{type-specific items}} from this artifact.

Rules: Extract ALL items (not just obvious), normalize to standard forms, include line numbers, note confidence level.

Output Format (JSON):
{ "items": [...], "relationships": [...], "metadata": {...} }
```

**Execute**: Single message with TWO Task calls.

## Comparison Rules

1. **Exact Match**: Identical normalized form -> shared
2. **Semantic Equivalence**: Different form, identical meaning -> shared
3. **Type Mismatch**: Same concept, different structure -> flag
4. **Unique**: In only one artifact

## Equivalence Scoring

```python
def calculate_equivalence(primary_comp, relationship_comp, structure_comp):
    weights = {"primary": 0.4, "relationship": 0.4, "structure": 0.2}
    base_score = sum(weights[k] * scores[k] for k in weights)
    if breaking_changes > 0:
        base_score *= 0.5
    if critical_relationships_broken > 0:
        base_score *= 0.7
    return base_score
```

| Score | Interpretation |
|-------|----------------|
| >=0.95 | Equivalent - safe to proceed |
| 0.85-0.94 | Mostly equivalent - review carefully |
| 0.70-0.84 | Significant differences |
| <0.70 | BREAKING - not equivalent |

## Warning Types

| Type | Severity | Trigger |
|------|----------|---------|
| Breaking change | CRITICAL | Core contract changed |
| Relationship loss | HIGH | Dependency removed |
| Structural change | MEDIUM | Organization differs |
| Minor difference | LOW | Cosmetic changes |

## Report Template

```markdown
## Comparison: {{A}} vs {{B}}

### Equivalence Summary
- **Score**: {score}/1.0 ({interpretation})
- **Primary Preservation**: {score}/1.0
- **Relationship Preservation**: {score}/1.0
- **Structure**: {score}/1.0

### Warnings ({count})
**{severity}**: {description}

### Shared ({count})
- {item} - Match: {type}

### Unique to A ({count})
- {item}

### Unique to B ({count})
- {item}

### Recommendation
{SAFE|REVIEW|BREAKING}
```

## Limitations

1. Cannot execute to verify runtime behavior
2. Dynamic/implicit behavior may be missed
3. External references not followed
4. Structural analysis only
