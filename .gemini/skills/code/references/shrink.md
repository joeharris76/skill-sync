# Code Shrink Reference

**Goal**: Behavioral equivalence >= 0.95. Target ~30% reduction.

## File Type Validation

**ALLOWED**: `.py`, `.js`, `.ts`, `.tsx`, `.jsx`, `.go`, `.rs`, `.java`, `.rb`, `.sql`

**FORBIDDEN**: `__init__.py` (export-only), `conftest.py`, `*_test.py`/`test_*.py`, `.json`/`.yaml`/`.toml`/`.md`, generated/vendored/migration files

## Behavioral Equivalence

Same inputs -> same outputs, side effects, error handling.

**Preserve ALL**: Public API signatures, type contracts, side effects (I/O, state, external calls), error handling (exception types/messages/validation), control flow, dependencies (imports/calls/inheritance), assertions/invariants, critical comments (TODO/FIXME/HACK/why-comments)

**Safe to Remove**: Dead/unreachable code, redundant implementations, verbose -> concise patterns, unnecessary intermediates, code-repeating comments, impossible-condition guards, over-abstraction, unused imports

## Compression Techniques

**Python**: Comprehensions, `any()`/`all()`, walrus `:=`, `dict.get()`, unpacking, f-strings, `pathlib`, context managers
**JS/TS**: Arrow functions, destructuring, `?.`/`??`, array methods, template literals, object shorthand, spread
**General**: Early returns/guard clauses, remove else-after-return, combine/inline single-use functions

## Anti-Patterns

DO NOT: Remove error handling | Change public signatures | Remove API type hints | Delete TODO/FIXME | Combine unrelated functions | Remove input validation | Change exception types | Remove logging | Prioritize cleverness over readability

## Validation Loop

```
1. Save baseline: /tmp/original-{filename}
2. Compress -> /tmp/compressed-{filename}-v{N}.{ext}
3. Static analysis: ruff check, ty check
4. Validate: /code compare baseline compressed
5. Score >= 0.95: run tests -> approve/reject
   Score < 0.95: iterate with feedback (max 3)
```

## Iteration Prompt

```
**Revision {N}** | Previous Score: {score}/0.95
Issues: {warnings} | Breaking Changes: {changes}
Task: Restore equivalence while maintaining compression.
Original: /tmp/original-{filename} | Previous: /tmp/compressed-{filename}-v{N}.{ext}
```

## Edge Cases

| Case | Handling |
|------|----------|
| Public API changes | STOP, ask user |
| Test dependencies | Preserve or update tests |
| Score plateau | After 3 attempts, report best |
| Large files (>500 LOC) | Consider sections |
| Already minimal | Report "minimal opportunities" |
