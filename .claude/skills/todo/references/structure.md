# TODO System Structure

## Project Configuration

Optional `todo.config.yaml` at project root:

```yaml
todo_dir: _project/TODO      # Default: _project/TODO
done_dir: _project/DONE      # Default: _project/DONE
schema: path/to/schema.yaml  # Default: auto-discover or global default
template: path/to/template.yaml  # Default: auto-discover or global default
```

Config resolution order:
1. `--root` CLI flag or `TODO_ROOT` env var
2. `todo.config.yaml` in project root
3. Convention: `_project/TODO` relative to git root

## Directory Layout

```
{todo_root}/
├── _indexes/           # Auto-generated indexes (do NOT edit manually)
│   ├── master.yaml
│   ├── by-category.yaml
│   ├── by-priority.yaml
│   └── by-status.yaml
└── {worktree}/
    ├── planning/       # Not Started, Identified
    └── active/         # In Progress, Blocked

{done_root}/            # Completed items (mirror structure)
├── _indexes/
└── {worktree}/
    └── planning/
```

## Item Format

```yaml
id: "my-item-slug"  # Must match filename (without .yaml)
title: "Descriptive title"
worktree: "git-branch-name"
priority: "Critical|High|Medium-High|Medium|Low"
status: "Not Started|In Progress|Completed"
description: |
  Multi-line explanation

category: "Core Functionality"

# Flat work breakdown with dependency edges
work:
  - id: w1
    summary: "First work unit"
    status: done

  - id: w2
    summary: "Second unit, depends on w1"
    needs: [w1]
    status: in_progress

  - id: w3
    summary: "Third unit, depends on w1 and w2"
    needs: [w1, w2]
    status: pending
    notes: "Optional implementation notes"

# Items known but explicitly out of scope
deferred:
  - summary: "Deferred work item"
    reason: "Why it's deferred"

# Inter-item dependencies (stable IDs, not file paths)
deps:
  needs: ["other-item-slug"]

metadata:
  owners: ["username"]
  estimated_effort: "2-3 days"

# Implementation guardrails (optional -- for items involving code changes)
must_preserve:
  - "DataLoader.load() handles both CSV and Parquet inputs"

approach: |
  Follow pattern in platforms/duckdb.py:load_data().
  Reuse CompressionHelper from utils/compression.py.

verification:
  - description: "Existing platform tests pass"
    command: "pytest tests/unit/platforms/ -v"
    expected_output: "all tests pass, 0 failures"
```

## Work Unit Status

| Status | Meaning |
|--------|---------|
| `pending` | Not yet started, waiting for `needs` to be satisfied |
| `in_progress` | Currently being worked on |
| `done` | Completed |

A work unit is **ready** when `status` is `pending` and all `needs` are `done`.

## CLI Commands

All commands accept `--root <project-root>` for explicit path resolution.

```bash
# List items
todo-cli list
todo-cli list --priority=high
todo-cli list --status="in-progress"

# Show specific item
todo-cli show {path}

# Statistics
todo-cli stats

# Ready queue -- what to work on next
todo-cli ready

# Next work units for a specific item
todo-cli next {slug}

# Mark a work unit done
todo-cli done {slug} {work-id}

# Validate dependency graphs
todo-cli check-graph

# Validate schema
todo-validate {path}

# Regenerate indexes (ALWAYS after changes)
todo-index
```

## Notes

- YAML: 2-space indentation. Use `TODO_ENTRY_TEMPLATE.yaml` as reference.
- Never edit indexes manually; schema validation ensures integrity.
- Guardrails: template defines all 5 fields (must_preserve, approach, anti_patterns, verification, scope_limit).
- Work units should be completable in a single Claude Code session (1-4 hours).
- `deps.needs`: inter-item dependencies (stable IDs). `work[].needs`: intra-item ordering.
