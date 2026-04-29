---
name: code
description: This skill should be used when the user asks to "commit code", "review code", "fix lint/type error", "improve performance", "compare code", "shrink code", "generate spec from code", "investigate code", "debug an error", "triage a bug", "iterate to green", or "create handoff prompt".
version: 0.2.0
tools: Bash, Read, Write, Edit, Task
---

# Code Workflow

Unified code development lifecycle operations.

## Project Configuration

Read `.claude/skills/skill-sync.config.yaml` → `code` section. Provides: `lint`, `lint_fix`, `format`, `typecheck`, `verify` (shell commands), `line_length`, `review_checklist`, `perf_targets`. Fallback: `Makefile`, `package.json`, CLAUDE.md.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `commit` | "commit changes", "commit code" | Commit session-modified files |
| `review` | "review code", "code review" | Five-axis adversarial code review |
| `fix` | "fix lint", "fix type error" | Fix code errors |
| `debug` | "debug error", "triage bug", "why is this failing" | Systematic root-cause debugging |
| `iterate` | "iterate to green", "drive tests to green", "drive command to green", "rerun until passing" | Loop command → debug failures → fix → re-run, until green, blocked, or capped |
| `perf` | "improve performance", "profile" | Investigate/improve performance |
| `research` | "investigate code", "understand this" | Research code path before changes |
| `compare` | "compare code", "diff modules" | Semantic code comparison |
| `shrink` | "compress code", "shrink file" | Validation-driven compression |
| `to-spec` | "generate spec", "document API" | Generate spec from code |
| `handoff` | "create handoff", "session summary" | Generate continuation prompt |
| `help` | "help", "list actions" | Print available actions |

**IMPORTANT — Auto-commit rule:** After any write action (fix, debug, perf, review `--chain`, shrink)
completes and passes verification, ALWAYS run the Commit step, commit, and push before returning
to the user. Do not wait for the user to request a commit. This is mandatory, not optional.

---

## Commit

Uses SHARED/commit-framework.md. Input: optional scope hint.
- **file_scope**: Files modified by Claude this session (Write, Edit, Bash)
- **prefix**: Determined by change analysis (feat/fix/refactor/test/docs/chore)
- **verify_cmd**: config `verify` (default: `make lint && make typecheck && make test-fast`)

**CRITICAL**: Only commit session-modified files. Never `git add -A`.

---

## Review

**Input**: Path, directory, "staged" (git diff --cached), "recent" (HEAD~5), "pr" (main...HEAD), topic, or empty

Five-axis evaluation (Correctness, Readability, Architecture, Security, Performance; see `references/five-axis-review.md`). Classify: Critical, Required, Nit, Consider. Use config `review_checklist` or defaults. **Output**: severity table, five-axis scores, "What's Done Well", action items.

**Blind Spot Audit (L2)**: After producing the severity table, apply SHARED/plan-deepening-framework.md L2 — name what class of issue the five-axis framework fails to catch for *this specific type of change* and add any gaps to action items.

**`--chain`**: research → implement → smoke-verify → full verify → commit per issue group (bugs, security, error handling, performance; skip style). Output: changes made vs deferred.

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

## Debug

**Input**: Error message, stack trace, "why is X failing", test path, or empty

Uses SHARED/debug-framework.md, SHARED/context-guide.md (trust levels, confusion protocol), and SHARED/slicing-framework.md (scope discipline for multi-file fixes). Follow Stop-the-Line rule and full triage checklist (Reproduce → Localize → Reduce → Root-cause fix → Guard → Verify). Also enforces: measurement over recall, fix hierarchy (operation/session → engine/config → preprocessing → code), narrow over broad, and the hard-blocker definition.

---

## Iterate

**Input**: Command to drive to green (e.g., `uv run -- python -m pytest tests/integration/`, `make test-all`).

Loop: run → parse failures → cluster by signature (same error class + unit type) → per cluster: `/code debug` + fix + narrow re-verify + `/code review` + `/code commit` → re-run. Terminate: green, all-remaining-failures hard-blocked, or `--max-iterations` cap.

**Flags**: `--max-iterations N` (default 20), `--narrow "<cmd>"` (minimal repro), `--dry-run`. See `references/iterate.md` for advanced flags.

**Artifacts**: `_project/iterate/<slug>/run<N>.log`, `status.md`, `blockers.md`. **Commit behavior**: one per cluster, no final aggregate unless new changes exist. Push all commits on termination.

---

## Perf

**Input**: Path, "profile {cmd}", "benchmark {test}", "hotspots"

Baseline (time.perf_counter, tracemalloc) → Profile (uv run -- python -m cProfile) → Identify bottlenecks (CPU, I/O, memory, DB) → Optimize → Measure. Use config `perf_targets` if present.

---

## Research

**Input**: Path, error message, "trace {func}", module, or empty.

Scope → Read target + callers/tests → Trace data/control flow → Output: behavior, dependencies, test coverage, risk. Auto-invoked by Fix, Review (`--chain`), Perf. See SHARED/research-framework.md, SHARED/context-guide.md.

---

## Compare

**Input**: `{file_a} {file_b}`. Extract contracts + dependencies (parallel) → Compare → Behavioral equivalence score (contract 40%, dependency 40%, flow 20%).

| Score | Interpretation |
|-------|---|
| ≥0.95 | Safe refactor |
| 0.85–0.94 | Review carefully |
| <0.70 | Breaking change |

---

## Shrink

**Input**: File path. Validate type → Save baseline → Compress → Compare (≥0.95 & tests pass = approve; <0.95 = iterate max 3). See SHARED/shrink-framework.md.

---

## To-Spec

**Input**: File path, module, class, "api", "architecture".

Parse structure, extract docstrings → Identify public/private APIs → Map dependencies. Output: Markdown spec (interface, behavior, dependencies, config, examples).

---

## Handoff

**Input**: Optional scope, `--task`, `--compact`, or empty.

Review session → Identify incomplete work, known issues, next steps. **Output**: files modified, decisions, current state (works/broken/blocked), next steps, verification cmds, gotchas. **Flags**: `--task` creates Task, `--compact` gives <300-word summary.

---

## Help

**Input**: Empty

Print the Actions table from this skill — action names, triggers, and descriptions.
