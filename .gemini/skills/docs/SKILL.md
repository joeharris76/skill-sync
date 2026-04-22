---
name: docs
description: This skill should be used when the user asks to "create documentation", "build docs", "review docs", "compare documents", "compress docs", "adversarial review docs", or "commit docs".
version: 0.1.0
tools: Bash, Read, Write, Edit, Task
---

# Docs Workflow

## Project Configuration

Read `.claude/skills/skill-sync.config.yaml` → `docs` section at project root. Provides:
- `builder` — doc system (sphinx, mkdocs, docusaurus, etc.)
- `source_dir` — docs root directory
- `commands` — build, clean, serve, linkcheck, validate
- `markup` — format (rst, md) and `heading_styles`
- `types` — doc type→location mapping
- `personas` — adversarial review personas with goals

If missing, discover from `Makefile`, `docs/conf.py`, `mkdocs.yml`, or `docusaurus.config.js`.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `create` | "create docs", "add documentation" | Create new doc page |
| `build` | "build docs", "validate docs" | Build Sphinx docs |
| `review` | "review docs", "check docs" | Review for quality |
| `compare` | "compare documents" | Semantic comparison |
| `shrink` | "compress docs", "shrink doc" | Validation-driven compression |
| `adversarial` | "adversarial review", "user perspective" | Review from user's POV |
| `commit` | "commit docs", "commit documentation" | Commit modified doc files |
| `help` | "help", "list actions" | Print available actions |

**IMPORTANT — Auto-commit rule:** After any write action (create, shrink, adversarial `--fix`)
completes and passes verification, ALWAYS run the Commit step, commit, and push before returning
to the user. Do not wait for the user to request a commit. This is mandatory, not optional.

---

## Create

**Input**: Topic/title, --type={guide|reference|tutorial|concept}, --location={path}

Use config `types` for type→location mapping. Defaults:

| Type | Location |
|------|----------|
| guide | `docs/guides/` |
| reference | `docs/reference/` |
| tutorial | `docs/tutorials/` |
| concept | `docs/concepts/` |

**Steps**: Determine type/location from config → Create doc using config `markup` format and `heading_styles` → Add to toctree → Validate: config `commands.build`

---

## Build

| Input | Command |
|-------|---------|
| (empty) | config `commands.build` |
| clean | config `commands.clean` |
| serve | config `commands.serve` |
| linkcheck | config `commands.linkcheck` |
| validate | config `commands.validate` |

**Output**: Status, warnings by type, errors, artifacts location.

---

## Review

**Input**: Doc path, topic, "all", "recent", or empty (high-traffic)

**Analyze**: Accuracy (examples work, CLI matches --help, paths exist), Completeness (all features, examples, prerequisites, troubleshooting), Quality (writing, organization, formatting, cross-refs).

**Verify**: Run CLI commands (dry-run), check syntax, test URLs.

---

## Compare

**Input**: `{doc_a} {doc_b}` -- Uses SHARED/compare-framework.md

**Steps**: Extract claims + relationships from BOTH (PARALLEL Task calls) -> Compare claim sets AND relationship graphs -> Calculate execution equivalence (claim 40% + relationship 40% + graph 20%) -> Report shared/unique claims, lost relationships, warnings

| Score | Interpretation |
|-------|----------------|
| >=0.95 | Execution equivalent |
| 0.85-0.94 | Review relationship changes |
| <0.50 | Critical - execution will differ |

See `references/compare.md` for full methodology.

---

## Shrink

**Input**: File path -- Uses SHARED/shrink-framework.md

**ALLOWED**: `.claude/` files, `CLAUDE.md`, project instructions, `docs/project/`
**FORBIDDEN**: `README.md`, `changelog.md`, `docs/studies/`, `docs/decisions/`

**Goal**: Execution equivalence score = 1.0. Target ~50% reduction.

**Preserve**: YAML frontmatter (REQUIRED for slash commands), decision-affecting claims/requirements/constraints, relationship structure/control flow, executable details (commands, paths, thresholds).

**Steps**: Validate doc type -> Save baseline -> Invoke compression agent -> Validate via `/docs compare original compressed` -> If score = 1.0 approve; else iterate (max 3)

See `references/shrink.md` for full methodology.

---

## Adversarial

**Input**: Path, topic, "user-journey:{persona}", or empty

Use config `personas` if present. Defaults:

| Persona | Goal |
|---------|------|
| `new-user` | Install, run first example |
| `developer` | Build a feature |
| `ops` | Debug a production issue |
| `contributor` | Understand codebase and contribute |

**Process**: Define perspective (persona, goal, pages) -> Challenge assumptions (prerequisites? examples work?) -> Test journeys (follow steps exactly) -> Identify gaps (edge cases, errors, implicit knowledge) -> Verify claims (test commands) -> Assess friction (where would user give up?)

See `references/adversarial.md` for detailed questions.

---

## Commit

**Input**: Optional scope hint, or empty

Uses SHARED/commit-framework.md with: **file_scope**: `git status --porcelain` config `source_dir`, **prefix**: `docs`, **verify_cmd**: config `commands.build`

---

## Help

**Input**: Empty

Print the Actions table from this skill — action names, triggers, and descriptions.
