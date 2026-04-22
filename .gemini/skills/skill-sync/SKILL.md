---
name: skill-sync
description: This skill should be used when the user asks to "sync skills", "set up skill-sync", "check skill status", "validate skills", "preview skill changes", "diagnose skills", "pin a skill", "unpin a skill", "prune skills", or "promote skill changes".
version: 0.1.0
tools: Bash, Read, Write, Edit
---

# skill-sync Workflow

Manage AI agent skills across projects — sync, validate, and maintain shared skill libraries.

## Project Configuration

skill-sync uses `skill-sync.yaml` at the project root as the manifest. Run `skill-sync doctor` to check configuration health.

Key files:
- `skill-sync.yaml` — manifest: sources, skills, targets, install mode, config overrides
- `skill-sync.lock` — integrity checksums (auto-generated)
- `skill.yaml` — per-skill package descriptor (inside each skill directory)
- `skill-sync.config.yaml` — merged runtime config (auto-generated in each target directory)

## Repo Hygiene

Treat synced skill directories and generated sync artifacts as repository content unless they are explicitly ignored by `.gitignore`.

- Before `skill-sync sync` begins, check `git status --short`.
- If skill directories, `skill-sync.yaml`, `skill-sync.lock`, or generated `skill-sync.config.yaml` files have uncommitted changes and those paths are not ignored by `.gitignore`, stop and get them committed before syncing.
- After `skill-sync sync` ends, review the tracked changes it produced and commit them before moving on to unrelated work.
- If a skill path should stay local-only, add it to `.gitignore` before syncing rather than leaving it dirty.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `setup` | "set up skill-sync", "bootstrap skills" | Detect install, scaffold manifest from existing skills |
| `sync` | "sync skills", "update skills" | Resolve, plan, and apply skill changes |
| `status` | "skill status", "check skills" | Report installed skill health and drift |
| `validate` | "validate skills", "check manifest" | Validate manifest, skills, config, compatibility |
| `diff` | "preview changes", "what would sync do" | Preview sync changes without applying |
| `doctor` | "diagnose skills", "skill health" | Run comprehensive health diagnostics |
| `pin` | "pin skill", "lock skill version" | Lock a skill to its current source revision |
| `unpin` | "unpin skill", "unlock skill" | Remove a revision pin, allow updates |
| `prune` | "prune skills", "remove unused skills" | Remove skills not declared in manifest |
| `promote` | "promote changes", "push skill changes" | Guide pushing local modifications upstream |
| `help` | "help", "list actions" | Print available actions |

---

## Setup

**Input**: Empty (auto-detect), or project path

Bootstraps skill-sync in a project that already has skills but no `skill-sync.yaml`.

**Steps**:
1. Check for skill-sync installation:
   ```bash
   skill-sync --version
   ```
   If not found, instruct the user to install: `npm install -g skill-sync`

2. Scan for existing skill directories:
   ```bash
   find .claude/skills -name "SKILL.md" -maxdepth 3 2>/dev/null
   find .codex/skills -name "SKILL.md" -maxdepth 3 2>/dev/null
   ```

3. Detect sources without assuming a machine-global path:
   - inspect the discovered project-local skill directories first
   - if an existing `skill-sync.yaml` or other project config is present, reuse its declared sources
   - if the upstream source cannot be inferred from the repo itself, ask the user which shared directory or repository should back the generated manifest

4. Generate `skill-sync.yaml` manifest with discovered skills, sources, and targets.
   Use `mirror` as the default install mode. Include all target directories found
   (`.claude/skills`, `.codex/skills`).

5. Run initial sync to establish the lock file:
   ```bash
   skill-sync sync --dry-run --json
   ```
   Show the plan to the user. If approved:
   ```bash
   skill-sync sync
   ```

6. Verify setup:
   ```bash
   skill-sync doctor --json
   ```

---

## Sync

**Input**: Empty, `--dry-run`, `--force`, or `--json`

```bash
skill-sync sync              # Resolve, plan, apply
skill-sync sync --dry-run    # Preview without applying
skill-sync sync --force      # Override conflict checks
skill-sync sync --json       # Machine-readable output
```

Behavior:
- Resolves skills from sources in manifest order (first match wins)
- Follows transitive dependencies from `skill.yaml`
- Detects drift and reports conflicts before overwrite
- Materializes to all configured targets
- Updates `skill-sync.lock` and generates `skill-sync.config.yaml`
- Requires commit hygiene: unless managed skill paths are ignored by `.gitignore`, commit pending skill changes before sync and commit resulting tracked changes after sync

If conflicts are reported, explain the options:
1. `skill-sync promote` — push local changes upstream first
2. `skill-sync sync --force` — overwrite local modifications

---

## Status

**Input**: Empty or `--json`

```bash
skill-sync status            # Human-readable report
skill-sync status --json     # Structured output
```

Shows per-target: installed skills, install mode, lockfile alignment (clean, modified, missing, extra), file-level drift details.

---

## Validate

**Input**: Empty, `--exit-code`, or `--json`

```bash
skill-sync validate                  # Check everything
skill-sync validate --exit-code      # Exit 1 on errors (for CI)
skill-sync validate --json           # Structured output
```

Checks: manifest structure, source definitions, SKILL.md presence and frontmatter, portability constraints, compatibility declarations, config override validity.

---

## Diff

**Input**: Empty or `--json`

```bash
skill-sync diff              # Preview what sync would change
skill-sync diff --json       # Structured output
```

Equivalent to `skill-sync sync --dry-run`. Shows installs, updates, removals, and conflicts without applying.

---

## Doctor

**Input**: Empty or `--json`

```bash
skill-sync doctor            # Comprehensive diagnostics
skill-sync doctor --json     # Structured output
```

Checks: manifest validity, lock file presence, source availability, target directory existence, drift detection, portability validation.

---

## Pin

**Input**: Skill name (required)

```bash
skill-sync pin <skill-name>
```

Locks a skill to its current git revision. Only works for git sources. Records the commit SHA in `skill-sync.yaml` overrides so future syncs use that exact revision.

---

## Unpin

**Input**: Skill name (required)

```bash
skill-sync unpin <skill-name>
```

Removes a revision pin, allowing the skill to float and receive updates on future syncs.

---

## Prune

**Input**: Empty, `--dry-run`, or `--json`

```bash
skill-sync prune             # Remove undeclared skills
skill-sync prune --dry-run   # Preview what would be removed
```

Removes installed skills not declared in the manifest, including untracked directories in targets that are not in the lock file.

---

## Promote

**Input**: Empty or `--json`

```bash
skill-sync promote           # Show promotion guidance
skill-sync promote --json    # Structured output
```

In v0, promotion is a manual workflow:
1. `skill-sync status` — identify modified skills
2. `skill-sync diff` — review changes
3. Copy modified files from target directory back to source
4. `skill-sync sync` — confirm source and target are in sync

---

## Help

**Input**: Empty

Print the Actions table from this skill — action names, triggers, and descriptions.

---

## Global Flags

All commands support:

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | `-j` | Machine-readable JSON output |
| `--project <path>` | `-p` | Project root (default: current directory) |
| `--help` | `-h` | Show help text |

---

## Output Format

```markdown
## skill-sync {Action}

### Summary
{what was done}

### Details
{action-specific content — plan, diagnostics, validation results}

### Status
- Installed: X skills
- Updated: Y skills
- Conflicts: Z (if any)

### Next Steps
- {recommendation}
```
