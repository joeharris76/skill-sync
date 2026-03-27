# Code Compare Reference

Compare two code files/modules for behavioral equivalence and dependency preservation.

## Extraction (parallel Task calls for both files)

### Contract Types

1. **Function/Method**: signature, params, return type, exceptions, docstring promises
2. **Class**: public attrs, methods, inheritance, protocols
3. **Module**: exports (__all__), public functions/classes, constants
4. **Type**: TypedDicts, Protocols, Generic constraints
5. **Invariant**: assertions, pre/postconditions
6. **Side Effect**: I/O, state mutations, external calls

### Dependency Types

1. **Import**: External packages, internal modules
2. **Call**: Functions/methods called within functions
3. **Inheritance**: Parent classes, mixins, protocols
4. **Composition**: Objects instantiated, attrs accessed
5. **Data Flow**: Parameters passed, return value usage
6. **Control Flow**: Conditional calls, loop-dependent execution

### Control Flow Elements
Branch points | Loop structures | Exception handling | Early returns | Error paths

## Comparison Rules

| Match Type | Criteria |
|------------|----------|
| Exact | Identical signature, types, exceptions |
| Semantic | Different implementation, identical contract |
| Signature Change | Same name, different params/return (BREAKING) |
| Behavioral Change | Same signature, different behavior (FLAG) |

| Dependency Status | Criteria |
|--------|----------|
| Preserved | Same type, same from/to |
| Broken | In A, not in B |
| Added | In B, not in A |
| Changed | Same endpoints, different type |

## Scoring

```python
weights = {"contract_preservation": 0.4, "dependency_preservation": 0.4, "flow_preservation": 0.2}
base_score = sum(weights[k] * scores[k] for k in weights)
if breaking_changes > 0: base_score *= 0.5
if critical_deps_broken > 0: base_score *= 0.7
```

## Warning Types

| Type | Severity | Trigger |
|------|----------|---------|
| API Break | CRITICAL | Public function signature changed |
| Type Change | HIGH | Return/parameter type changed |
| Dependency Removed | HIGH | Import/call removed |
| Side Effect Change | HIGH | New/removed I/O |
| Exception Change | MEDIUM | Different exceptions |
| Control Flow Change | MEDIUM | Branch logic altered |

## Report Format

```markdown
## Code Comparison: {A} vs {B}

### Behavioral Equivalence
- **Score**: {score}/1.0 ({interpretation})
- **Contract**: {score}/1.0 ({shared}/{total})
- **Dependency**: {score}/1.0 ({preserved}/{total})
- **Flow**: {score}/1.0

### Breaking Changes ({count})
**{severity}**: `{name}` - {change}
- Before: `{signature_a}` / After: `{signature_b}`

### Warnings ({count})
**{severity}**: {description} - Affected: {contracts}

### Shared Contracts ({count})
- `{name}` - Match: {type}

### Unique to A / B
...

### Recommendation
{SAFE_REFACTOR | REVIEW_REQUIRED | BREAKING_CHANGE}
```
