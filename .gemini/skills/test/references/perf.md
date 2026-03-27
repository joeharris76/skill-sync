# Test Performance Reference

Strategies for identifying and fixing slow tests. Examples use pytest but principles apply to any runner.

## Identifying Slow Tests

```bash
# pytest: find tests exceeding duration threshold
pytest --durations=0 --durations-min=1.0 -q --tb=no

# jest: use --verbose for timing
jest --verbose

# go: use -v flag for per-test timing
go test -v ./...
```

## Slowness Categories

| Category | Symptoms | Typical Duration |
|----------|----------|------------------|
| Setup overhead | Slow fixture, DB creation | 1-5s |
| I/O bound | File reads/writes | 0.5-2s |
| Database | Connection, queries | 1-10s |
| External calls | Network, subprocess | 2-30s |
| Data generation | Large datasets | 1-10s |
| Sleep/waits | Explicit delays | Variable |

## Root Cause Patterns

| Pattern | Indicator | Location |
|---------|-----------|----------|
| Fixture overhead | Same delay across class/suite | Setup/conftest/beforeAll |
| Redundant setup | Each test recreates data | Test class/describe block |
| Real DB vs mock | Connection overhead | Integration tests |
| Large test data | Excessive data volumes | Test parameters/factories |
| Missing speed tags | Fast test in slow suite | Missing markers/tags |

## Optimization Strategies

### Widen Setup Scope

```python
# Before: runs for every test
@pytest.fixture
def database():
    return create_database()

# After: runs once per class
@pytest.fixture(scope="class")
def database():
    return create_database()
```

Scope hierarchy (most expensive first):
- `session`/`beforeAll(global)` - Once per run
- `module`/`beforeAll` - Once per file
- `class`/`beforeEach(describe)` - Once per group
- `function`/`beforeEach` - Once per test (default)

### Mock External Dependencies

```python
@patch("subprocess.run")
def test_binary_wrapper(self, mock_run):
    mock_run.return_value = Mock(returncode=0, stdout="output")
    # Test doesn't spawn real process
```

### Reduce Test Data

```python
# Before: large test data
@pytest.mark.parametrize("scale", [0.1, 1.0, 10.0])

# After: minimal test data
@pytest.mark.parametrize("scale", [0.001, 0.01])
```

### In-Memory I/O

```python
# Before: disk I/O
path = temp_dir / "data.csv"
write_data(path)

# After: memory buffer
buffer = io.StringIO()
write_data(buffer)
```

## When NOT to Optimize

- Integration tests that need real dependencies
- Performance/benchmark tests measuring actual execution
- Tests intentionally marked slow/stress

## Verification

After optimization, confirm:
1. Timing improved (re-run with duration reporting)
2. Coverage maintained (re-run with coverage)
3. Tests still catch real bugs (no false passes)
