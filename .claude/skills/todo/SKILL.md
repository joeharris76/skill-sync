---
name: todo
description: This skill should be used when the user asks to "create a TODO", "manage TODOs", "show TODO items", "prioritize TODOs", "implement a TODO", "review TODOs", "complete a TODO", "cleanup TODOs", "create TODOs from spec", "initialize TODO system", "ideate on an idea", "refine an idea", "write a spec", or "create a specification".
version: 0.3.0
tools: Bash, Read, Edit, Write, Task
---

# TODO Workflow

Distributed YAML-based TODO management with auto-generated indexes, dependency graphs, and implementation guardrails.

## Path Resolution

1. `todo.config.yaml` at project root (explicit paths)
2. Convention: `_project/TODO` and `_project/DONE` relative to git root

```bash
TODO_CLI="uv run --project ~/.claude/tools/todo todo-cli"
TODO_VALIDATE="uv run --project ~/.claude/tools/todo todo-validate"
TODO_INDEX="uv run --project ~/.claude/tools/todo todo-index"
```

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `init` | "initialize TODOs", "setup TODO system" | Bootstrap TODO system in a project |
| `list` | "show TODOs", "list items" | Query and display TODO items |
| `create` | "create TODO", "add item" | Create new TODO item(s) |
| `prioritize` | "prioritize", "rebalance" | Adjust priority levels |
| `implement` | "implement TODO", "work on" | Implement a TODO item |
| `review` | "review TODO quality" | Adversarial quality review |
| `complete` | "mark complete", "finish TODO" | Move item to DONE |
| `cleanup` | "cleanup TODOs", "commit TODO changes" | Validate and commit changes |
| `from-spec` | "TODOs from spec", "parse requirements" | Create TODOs from spec file |
| `ideate` | "ideate", "refine idea", "brainstorm" | Structured divergent/convergent ideation |
| `spec` | "write spec", "create specification" | Spec-before-code with assumptions surfacing |

See `references/structure.md` for system layout and item format.

**IMPORTANT — Auto-commit rule:** After any write action (create, prioritize, implement, complete,
from-spec) completes and passes verification, ALWAYS run the Cleanup step, commit, and push before
returning to the user. Do not wait for the user to request a commit. This is mandatory, not optional.

---

## Init

**Input**: Empty (defaults), `--todo-dir=path`, `--done-dir=path`

1. Create `todo.config.yaml` with configured paths (default: `todo_dir: _project/TODO`, `done_dir: _project/DONE`)
2. Create directory structure: `{todo_dir}/_indexes/`, `{done_dir}/_indexes/`
3. Copy schema/template from `~/.claude/skills/todo/defaults/`
4. Generate empty indexes: `$TODO_INDEX`

---

## List

```bash
$TODO_CLI list
$TODO_CLI list --priority=high
$TODO_CLI list --status="in-progress"
$TODO_CLI stats
$TODO_CLI ready   # What to work on next (deps-aware)
```

---

## Create

**Input**: Title(s), "from conversation", or interactive

1. Parse input (title, comma-separated, or scan conversation)
2. Gather: title (5-200 chars), worktree, priority, category, description
3. Generate `id` (filename slug), `work[]` with dependency edges, `deferred[]` if applicable
4. If inter-item dependencies, add `deps.needs: [slug-ids]`
5. Guardrails (for code-change items):
   - `verification`: test command + expected result (always, unless pure docs/research)
   - `must_preserve`: specific functions/behaviors at risk (skip if greenfield)
   - `approach`: reference existing code patterns (skip if obvious)
   - `anti_patterns`, `scope_limit`: only when specific risks are known
   - Omit vague fields. Show generated guardrails for user review.
6. Location: `{todo_dir}/{worktree}/{phase}/{slug}.yaml`
7. Generate YAML from template, validate: `$TODO_VALIDATE {path}`, index: `$TODO_INDEX`

---

## Prioritize

**Input**: Empty (all), worktree, path, or "rebalance"

1. Load state: `$TODO_CLI stats`, read `{todo_dir}/_indexes/by-priority.yaml`
2. Ideal distribution: Critical 0-2, High 3-5, Medium-High 5-10
3. Evaluate: business impact, dependencies, effort, time sensitivity
4. Apply updates and regenerate indexes

**Priority Guide**:
| Priority | When |
|----------|------|
| Critical | Active incident, blocking release, security |
| High | Current sprint, high impact |
| Medium-High | Next sprint candidates |
| Medium | Backlog with value |
| Low | Nice-to-have |

---

## Implement

**Input**: Slug, path, or "list"

1. Check readiness: `$TODO_CLI ready` -- confirm deps satisfied
2. Get work units: `$TODO_CLI next <slug>`
3. Read TODO file, extract guardrails (must_preserve, approach, anti_patterns, verification, scope_limit)
4. Check scope_limit boundaries
5. **Research gate** (SHARED/research-framework.md): Read target files and callers. State understanding before editing.
   - Apply SHARED/slicing-framework.md: build changes in vertical slices (implement → test → verify → commit per slice). Respect scope discipline — touch only what the task requires.
6. Update status to "In Progress", move planning/ -> active/
7. For each ready work unit:
   a. Implement (follow approach, respect anti_patterns)
   b. **Post-edit verification** (SHARED/verify-framework.md): spot-check edits, run lint
   c. Test
   d. Mark done: `$TODO_CLI done <slug> <work-id>`
   e. **Commit and push** (SHARED/commit-framework.md): files modified in this work unit only, prefix by change type, run project lint+test
8. Run each verification command, confirm must_preserve items still work
9. On completion: add `completed_date`, move to DONE, `$TODO_INDEX`

**Requirements**:
- Work until complete, test after every change
- Commit incrementally (one per work unit, not batched)
- Only commit files modified by the completed work unit
- Always execute `git add` and `git commit` in a single command step
- Production quality only (no stubs/TODOs in code)
- Respect scope_limit boundaries
- Report guardrail compliance (verification results, must_preserve confirmation)

---

## Review

**Input**: Path, worktree, "all", or "high-priority"

**Score (0-3 each)**:
- **Clarity**: 3=specific title+why, 0=unclear
- **Completeness**: 3=all fields+deps, 0=stub
- **Actionability**: 3=clear first step, 0=no path
- **Freshness**: 3=recent+accurate, 0=abandoned
- **Guardrails**: 3=runnable verification commands, specific must_preserve, "DO NOT X -- because Y -- do Z" anti_patterns; 2=present+specific but incomplete; 1=present but vague; 0=missing on implementation item; N/A for docs/research items (exclude from total)
- **Work Breakdown**: 3=flat work[] with clear needs edges and well-sized units (1-4 hours each); 2=work[] present but units too large or missing edges; 1=legacy tasks.phases format; 0=no breakdown

**Grades**: 16-18 Excellent, 13-15 Good, 9-12 Needs Work, 0-8 Poor

**Red flags**: must_preserve says "don't break things"; verification has no command; anti_patterns missing "because Y" rationale; scope_limit lists entire directories.

---

## Complete

**Input**: Path, slug, or comma-separated list

1. Verify all `work[].status == done`, no blockers
2. Update: `status: "Completed"`, `completed_date: "YYYY-MM-DD"`
3. Move to DONE: `mkdir -p {done_dir}/{worktree}/{phase} && git mv {source} {destination}`
4. Regenerate indexes: `$TODO_INDEX`

---

## Cleanup

Uses SHARED/commit-framework.md with:
- **file_scope**: `git status --porcelain {todo_dir} {done_dir}`
- **prefix**: `chore(todo)`
- **verify_cmd**: `$TODO_VALIDATE --all && $TODO_CLI check-graph`

1. Validate: `$TODO_CLI check-graph`
2. Run: `$TODO_CLI cleanup`
3. Fix common errors: `status: 'Done'` -> `'Completed'`, commits format
4. Regenerate indexes: `$TODO_INDEX`

---

## From-Spec

**Input**: Spec path (md/yaml/txt), --worktree, --priority, --dry-run

**Parsing**:
| Format | Mapping |
|--------|---------|
| Markdown | H2/H3 -> titles, bullets -> work units |
| YAML | Top keys -> items, nested -> work units |
| Text | Bullets -> items, keywords trigger items |

1. Read and parse spec, extract items with metadata
2. Generate YAML per item with `id`, `deps.needs`, `work[]`, `deferred[]`
3. If --dry-run, show preview
4. Write to `{todo_dir}/{worktree}/planning/`, validate and index

---

## Ideate

**Input**: Idea description, problem statement, "help me think about X", or empty (interactive)

Structured divergent/convergent ideation. Be honest, not supportive — push back on weak ideas.

1. **Expand** — restate as "How Might We", ask 3-5 sharpening questions (who/success/constraints/prior art/why now), generate 5-8 variations via lenses (inversion, constraint removal, audience shift, simplification, 10x). If in a codebase, ground in existing architecture.
2. **Converge** — cluster into 2-3 directions, stress-test each (user value, feasibility, differentiation), surface hidden assumptions (what you're betting, what could kill it, what you're ignoring)
3. **Output** — markdown one-pager: Problem Statement (HMW), Recommended Direction, Key Assumptions to Validate, MVP Scope, Not Doing (and Why), Open Questions

Save to `docs/ideas/{name}.md` (after user confirmation).

---

## Spec

**Input**: Feature name, project name, "spec for X", or empty (interactive)

Spec-before-code. Surface misunderstandings before code gets written.

1. **Surface assumptions** — list numbered assumptions explicitly ("I'm assuming X, Y, Z — correct me now"). Don't silently fill in ambiguous requirements.
2. **Write spec** covering six areas: Objective (what/why/who/success), Commands (full executable), Project Structure (source/test locations), Code Style (one real snippet), Testing Strategy (framework/location/levels), Boundaries (always do / ask first / never do)
3. **Reframe vague requirements** as testable success criteria (e.g., "make it faster" becomes "< 500ms at scale 0.1, no regression")
4. **Human review gate** — present for approval. Do NOT proceed to implementation until approved.

Save to `SPEC.md` or `docs/specs/{feature}.md` (after user confirmation).

---

## Common Commands

```bash
$TODO_CLI list                    # List items
$TODO_CLI list --priority=high    # Filter by priority
$TODO_CLI stats                   # Statistics
$TODO_CLI ready                   # Ready queue (deps-aware)
$TODO_CLI next <slug>             # Work units for item
$TODO_CLI done <slug> <work-id>   # Mark work unit done
$TODO_CLI check-graph             # Validate graphs
$TODO_VALIDATE {path}             # Validate schema
$TODO_INDEX                       # Regenerate indexes
```
