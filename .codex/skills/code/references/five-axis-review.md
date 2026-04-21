# Five-Axis Code Review Reference

Every review evaluates five dimensions with severity classification.

## The Five Axes

### 1. Correctness
- Matches spec/task requirements?
- Edge cases handled (null, empty, boundary)?
- Error paths handled (not just happy path)?
- Tests adequate and testing the right things?
- Off-by-one, race conditions, state inconsistencies?

### 2. Readability & Simplicity
- Names descriptive, consistent with project conventions?
- Control flow straightforward (no nested ternaries, deep callbacks)?
- Abstractions earning their complexity?
- Dead code removed (`_unused` vars, compat shims, stale comments)?

### 3. Architecture
- Follows existing patterns or introduces justified new one?
- Clean module boundaries, no circular deps?
- Code duplication that should be shared?
- Abstraction level appropriate (not over-engineered, not too coupled)?

### 4. Security
- User input validated/sanitized at boundaries?
- Secrets out of code, logs, version control?
- SQL parameterized (no string concatenation)?
- External data treated as untrusted?

### 5. Performance
- N+1 query patterns?
- Unbounded loops or unconstrained data fetching?
- Large objects in hot paths?
- Sync operations that should be async?

## Severity Classification

| Prefix | Meaning | Author Action |
|--------|---------|---------------|
| **Critical** | Blocks merge -- security, data loss, broken functionality | Must fix |
| *(none)* | Required change | Must address |
| **Nit** | Minor, optional | May ignore |
| **Consider** | Suggestion worth evaluating | Not required |

## Change Sizing

- ~100 lines: Good (reviewable in one sitting)
- ~300 lines: Acceptable (single logical change)
- ~1000 lines: Too large (split it)

## Rules

- Every review must include "What's Done Well" -- criticism-only reviews are incomplete
- Separate refactoring from feature work
- Approve when change definitely improves code health, even if imperfect
- No rubber-stamps -- "LGTM" without evidence helps no one
