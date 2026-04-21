# Testing Patterns Reference

## Test Pyramid

```
        /  E2E  \        ~5%   full user flows, real systems
       / Integr. \      ~15%   component interactions, boundaries
      /   Unit    \     ~80%   pure logic, isolated, fast
```

## When to Mock

| Scenario | Real | Mock |
|----------|------|------|
| Database | Integration tests | Unit tests (mock repository) |
| External APIs | Never | Always (use stubs/fixtures) |
| File system | Integration (tmp dirs) | Unit tests |
| Internal modules | Always | Only at architectural boundaries |

**Rule:** Mock at boundaries, not internals. Mocking internal functions = coupled to implementation.

## DAMP Over DRY

Tests should be **Descriptive And Meaningful Phrases**. Some duplication is acceptable for clarity. Prefer self-contained tests over parametrize-heavy abstractions where intent becomes unclear.

## Test Naming

Describe behavior, not implementation:
- Good: `test_creates_task_with_default_pending_status`
- Bad: `test_create_task`

## Regression Tests

When fixing a bug: write a test that reproduces the exact scenario, FAILS without the fix, PASSES with it, and covers the specific edge case (not a general happy-path test). Include issue reference in docstring.

## Structure: Arrange-Act-Assert

```python
def test_example():
    user = create_user(name="Alice")      # Arrange
    result = user.update_name("Bob")       # Act
    assert result.name == "Bob"            # Assert
```

## Anti-Patterns

| Anti-Pattern | Fix |
|---|---|
| Testing implementation | Test behavior and outputs |
| Shared mutable state | Fresh fixtures per test |
| Assert on everything | Assert on meaningful outcomes |
| No assertion | Every test must assert something |
| Mocking internals | Mock at boundaries only |
| Giant test fixtures | Minimal fixtures per test |
