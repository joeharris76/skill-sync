---
name: test
description: This skill should be used when the user asks to "run tests", "create tests", "fix failing test", "add test coverage", "fix slow tests", or "commit test changes".
version: 0.1.0
tools: Bash, Read, Write, Edit, Task
---

# Test Workflow

Unified workflow for test development, execution, and maintenance.

## Project Configuration

Read `.claude/skills/skill-sync.config.yaml` → `test` section at project root. Provides:
- `runner` — test framework (pytest, jest, vitest, go, cargo)
- `test_dir` — test root directory
- `coverage_package` — package name for coverage reporting
- `commands` — named commands (fast, unit, integration, single, topic, coverage, collect, plus project-specific)
- `path_mapping` — source→test location rules
- `fixtures` — available test fixtures/helpers with descriptions
- `markers` — test markers/tags with descriptions
- `test_pattern` — canonical test structure example

If missing, discover from `pyproject.toml`, `jest.config.*`, `Makefile`, `package.json`, CLAUDE.md, or common conventions. Prefer project-defined commands over raw runner invocations.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `run` | "run tests", "test X" | Execute tests |
| `create` | "create test", "add tests for" | Create new tests |
| `fix` | "fix failing test" | Debug and fix test failures |
| `coverage` | "add coverage", "coverage gaps" | Add test coverage |
| `perf` | "slow tests", "optimize tests" | Fix slow tests |
| `cleanup` | "commit test changes" | Commit modified test files |
| `help` | "help", "list actions" | Print available actions |

**IMPORTANT — Auto-commit rule:** After any write action (create, fix, coverage, perf) completes
and passes verification, ALWAYS run the Cleanup step, commit, and push before returning to the user.
Do not wait for the user to request a commit. This is mandatory, not optional.

---

## Run

**Input**: Marker/tag, path, topic, "all", "ci", or empty (fast/default)

Resolve input to a runner command via config `commands`:

| Input | Strategy |
|-------|----------|
| Named target | Config `commands.{name}` (e.g., `commands.unit`, `commands.tpch`) |
| Path | Config `commands.single` with `{path}` substitution |
| Topic/keyword | Config `commands.topic` with `{topic}` substitution |
| Empty | Config `commands.fast` (default suite) |

**Report**: Pass/fail counts, failure patterns, slow tests, next steps.

---

## Create

**Input**: Goal, module path, feature, or ticket

**Steps**:
1. Analyze goal, identify modules/classes under test
2. Research existing tests: config `commands.collect` filtered by topic
3. Determine test location: config `path_mapping` rules (source pattern → test path)
4. Identify available fixtures: config `fixtures` list with descriptions
5. Design: happy path, edge cases, errors, parametrized/table-driven
6. Apply markers/tags: config `markers` list
7. Write tests following config `test_pattern` and existing project style
8. Verify: config `commands.single` with new test path
9. Check coverage: config `commands.coverage`

**Research Gate** (SHARED/research-framework.md): Read the code under test and at least one existing test in the same area before writing. See `references/testing-patterns.md` for test pyramid, mocking boundaries, and naming conventions.

---

## Fix

**Input**: Test path, "last", marker, or empty

Uses SHARED/debug-framework.md for systematic triage and SHARED/context-guide.md (trust levels for error output, confusion protocol). See `references/testing-patterns.md` for common patterns.

**Steps**:
1. Reproduce with verbose/long-trace output
2. Localize: determine if test or code is wrong
3. Categorize: test bug (update test), code bug (fix source), environment (fix setup/fixtures), flaky (fix race/timing/shared state)
4. Fix root cause, guard with regression test
5. **Post-edit verification** (SHARED/verify-framework.md)
6. Verify: run original test + related tests

---

## Coverage

**Input**: Module path, topic, "gaps", "report"

**Steps**:
1. Run coverage: config `commands.coverage` (uses `coverage_package` for scope)
2. Identify gaps: uncovered functions (High), error paths (High), edge cases (Medium)
3. Design tests following existing patterns and config `test_pattern`
4. Write to location per config `path_mapping`
5. Verify coverage improved

---

## Perf (Slow Tests)

**Input**: Path, marker, threshold, "all", "report"

**Steps**:
1. Find slow tests using duration reporting
2. Categorize: setup overhead, I/O, database, external calls, data generation
3. Profile and analyze root cause
4. Apply optimizations:
   | Issue | Fix |
   |-------|-----|
   | Repeated setup | Widen fixture/setup scope |
   | Real external dep | Mock or in-memory substitute |
   | Large test data | Reduce to minimum needed |
   | External process | Mock subprocess/network |
5. Update markers/tags to reflect actual speed
6. Verify timing improved and coverage maintained

See `references/perf.md` for detailed strategies.

---

## Cleanup

Uses SHARED/commit-framework.md with:
- **file_scope**: `git status --porcelain` filtered to config `test_dir`
- **prefix**: `test`
- **verify_cmd**: config `commands.fast`

**Examples**: `test: add coverage for cloud storage integration`, `test: fix failing platform adapter tests`, `test: add performance baseline tests`, `test: update snapshot for new API response format`

**Output**: List files committed, commit hash, and message. Note coverage impact if applicable.

---

## Help

**Input**: Empty

Print the Actions table from this skill — action names, triggers, and descriptions.
