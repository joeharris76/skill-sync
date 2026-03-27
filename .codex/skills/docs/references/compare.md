# Document Compare Reference

Semantic comparison using SHARED/compare-framework.md. Tests execution equivalence: whether a reader achieves same results following either version.

## Claim Types

1. **Simple**: requirement, instruction, constraint, fact, configuration
2. **Conjunctions**: ALL of {X, Y, Z} (markers: "ALL", "both X AND Y")
3. **Conditionals**: IF condition THEN consequence ELSE alternative
4. **Consequences**: Actions from conditions (markers: "results in", "causes")
5. **Negations**: Prohibition with scope (markers: "NEVER", "prohibited")

## Relationship Types

1. **Temporal**: A -> B ("before", "after", "then")
2. **Prerequisite**: Condition -> Action ("required before")
3. **Hierarchical Conjunctions**: ALL of X ("both...AND...")
4. **Conditional**: IF-THEN-ELSE
5. **Exclusion**: A and B CANNOT co-occur ("mutually exclusive")
6. **Escalation**: State A -> State B under trigger
7. **Cross-Document**: References to other sections/documents

## Extraction Rules

- Extract ALL claims including implicit
- Normalize: present tense, imperative/declarative
- Normalize synonyms: must/required → "must", prohibited/forbidden → "prohibited"
- Note confidence level per claim

## Claim Matching

| Match Type | Criteria |
|------------|----------|
| Exact | Identical normalized text |
| Semantic | Different wording, same meaning |
| Type Mismatch | Same concept, different structure (FLAG) |
| Unique | In only one document |

## Relationship Preservation

```python
def calculate_relationship_preservation(a_rels, b_rels, shared_claims):
    a_valid = [r for r in a_rels if r.from in shared_claims and r.to in shared_claims]
    b_valid = [r for r in b_rels if r.from in shared_claims and r.to in shared_claims]
    preserved = count_matching_relationships(a_valid, b_valid)
    return preserved / len(a_valid) if a_valid else 1.0
```

## Scoring

```python
weights = {"claim_preservation": 0.4, "relationship_preservation": 0.4, "graph_structure": 0.2}
base_score = sum(weights[k] * scores[k] for k in weights)

if relationship_preservation < 0.9:
    base_score *= 0.7  # Penalty for critical loss
```

## Thresholds

| Score | Decision | Characteristics |
|-------|----------|-----------------|
| ≥0.95 | APPROVE | Execution equivalent, minor cosmetic |
| 0.85-0.94 | REVIEW | Functional but abstraction risks |
| 0.50-0.74 | REJECT | Significant differences |
| <0.50 | CRITICAL | Execution will fail |

## Warning Types

Relationship loss, structural changes (conjunction split), conditional logic loss, cross-reference breaks, exclusion constraint loss.

## Report Format

```markdown
## Comparison: {A} vs {B}

### Execution Equivalence
- **Score**: {score}/1.0
- **Claims**: {score}/1.0 ({shared}/{total})
- **Relationships**: {score}/1.0 ({preserved}/{total})

### Warnings ({count})
**{severity}**: {description}

### Lost Relationships ({count})
- **{type}**: {from} → {to} | Risk: {level}

### Shared Claims ({count})
- {claim} - Match: {type}

### Recommendation
{APPROVE | REVIEW | REJECT}
```
