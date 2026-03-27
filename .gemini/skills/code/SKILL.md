---
name: code
description: This skill should be used when the user asks to "commit code", "review code", "fix lint/type error", "improve performance", "compare code", "shrink code", "generate spec from code", "investigate code", or "create handoff prompt".
version: 0.1.0
tools: Bash, Read, Write, Edit, Task
---

# Code Workflow

Unified code development lifecycle operations.

## Project Configuration

Read `.claude/project-config.yaml` → `code` section at project root. Provides:
- `lint`, `lint_fix`, `format`, `typecheck`, `fast_test`, `verify` — shell commands
- `line_length` — max line length for review
- `review_checklist` — project-specific review items
- `perf_targets` — scale/target pairs for performance benchmarks

If missing, discover from `Makefile`, `package.json`, CLAUDE.md, or common conventions.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `commit` | "commit changes", "commit code" | Commit session-modified files |
| `review` | "review code", "code review" | Adversarial code review |
| `fix` | "fix lint", "fix type error" | Fix code errors |
| `perf` | "improve performance", "profile" | Investigate/improve performance |
| `research` | "investigate code", "understand this" | Research code path before changes |
| `compare` | "compare code", "diff modules" | Semantic code comparison |
| `shrink` | "compress code", "shrink file" | Validation-driven compression |
| `to-spec` | "generate spec", "document API" | Generate spec from code |
| `handoff` | "create handoff", "session summary" | Generate continuation prompt |

> **Commit rule**: After any write action completes successfully, always run the
> Commit step before returning to the user. Do not wait for the user to request
> a commit.

---

## Commit

Uses SHARED/commit-framework.md. Input: optional scope hint.
- **file_scope**: Files modified by Claude this session (Write, Edit, Bash)
- **prefix**: Determined by change analysis (feat/fix/refactor/test/docs/chore)
- **verify_cmd**: config `verify` (default: `make lint && make typecheck && make test-fast`)

**CRITICAL**: Only commit session-modified files. Never `git add -A`.

---

## Review

**Input**: Path, directory, "staged", "recent", "pr", topic, or empty

| Input | Command |
|-------|---------|
| `staged` | `git diff --cached` |
| `recent` | `git diff HEAD~5` |
| `pr` | `git diff main...HEAD` |

**Checklist**: Use config `review_checklist` if present. Defaults: Architecture (inheritance, module structure), Quality (type hints, docstrings, error handling, line length <= config `line_length`), Security (no credentials, parameterized queries, safe file ops), Performance (no O(n²), appropriate data structures, no N+1).

**Output**: Issue table, pattern compliance, security checks, quality score, action items.

**`--chain`**: After reporting, fix each actionable issue (bugs, security, error handling, performance -- skip style/opinion):
1. Apply SHARED/research-framework.md per issue group
2. Implement fixes, verify each edit
3. Run SHARED/verify-framework.md
4. If all pass, commit via SHARED/commit-framework.md
5. Output: changes made vs issues deferred

---

## Fix

**Input**: Error message, file:line, "lint", "type", "format", or empty

| Type | Action |
|------|--------|
| Lint | config `lint` → config `lint_fix` |
| Type | config `typecheck` → add annotations |
| Format | config `format` |
| Runtime | Apply SHARED/research-framework.md, then minimal fix |

**Research Gate**: All fix types invoke SHARED/research-framework.md before edits. Read code you intend to change and at least one caller or test before proposing changes.

**Verify**: config `verify`

---

## Perf

**Input**: Path, "profile {cmd}", "benchmark {test}", "hotspots"

Steps: Baseline (`time.perf_counter()`, tracemalloc) → Profile (`uv run -- python -m cProfile -s cumulative {script}`) → Identify bottlenecks (CPU, I/O, memory, database) → Optimize (algorithm, caching, parallelization) → Measure improvement, verify correctness.

Use config `perf_targets` for scale/target thresholds if present.

---

## Research

**Input**: Path, error message, "trace {function}", module name, or empty. Uses SHARED/research-framework.md.

Steps: Scope investigation → Read target files + callers/tests → Trace data/control flow → Output: current behavior, dependencies, test coverage, risk assessment.

Auto-invoked as prerequisite by Fix, Review (`--chain`), and Perf.

---

## Compare

**Input**: `{file_a} {file_b}`. Uses SHARED/compare-framework.md.

Steps: Extract contracts + dependencies from BOTH files (PARALLEL Task calls) → Compare contract sets AND dependency graphs → Calculate behavioral equivalence (contract 40% + dependency 40% + flow 20%).

| Score | Interpretation |
|-------|----------------|
| ≥0.95 | Safe refactor |
| 0.85-0.94 | Review carefully |
| <0.70 | Breaking change |

See `references/compare.md` for full details.

---

## Shrink

**Input**: File path. Uses SHARED/shrink-framework.md.

**Allowed**: `.py`, `.js`, `.ts`, `.tsx`, `.jsx`, `.go`, `.rs`, `.java`, `.rb`, `.sql`
**Forbidden**: `__init__.py`, `conftest.py`, `*test*.py`, configs, generated

Steps: Validate file type → Save baseline (once) → Invoke compression agent → Validate via `/code compare original compressed` → If score ≥ 0.95 AND tests pass, approve; if < 0.95, iterate (max 3).

See `references/shrink.md` for full details.

---

## To-Spec

**Input**: File path, module, class, "api", "architecture"

Steps: Parse structure, extract docstrings → Identify public vs private APIs → Map dependencies.

**Extract**: Classes (hierarchy, attributes, methods), Functions (signature, parameters, return, exceptions), Modules (exports, constants).

**Output**: Markdown spec with interface, behavior, dependencies, config, examples. See `references/to-spec.md` for template.

---

## Handoff

**Input**: Optional scope, `--task`, `--compact`, or empty

Steps: Review session (files modified, decisions, problems, tests) → Identify incomplete work, known issues, next steps.

**Output**: Branch + files modified (with change descriptions), key decisions/rationale, current state (works/broken/blocked), next steps (priority order), verification commands, warnings/gotchas.

**Flags**: `--task` creates a Task with handoff content. `--compact` gives single-paragraph summary (<300 words).

See `references/handoff.md` for templates.

---

## Output Format

```markdown
## Code {Action}: {scope}

### Summary
{what was done}

### Details
{action-specific content}

### Verification
| Check | Result |
|-------|--------|
| {check} | PASS/FAIL |

### Next Steps
- {recommendation}
```
