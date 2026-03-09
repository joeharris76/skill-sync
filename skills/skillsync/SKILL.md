---
name: skillsync
description: This skill should be used when the user asks to "sync skills", "set up skillsync", "check skill status", "validate skills", "preview skill changes", "diagnose skills", "pin a skill", "unpin a skill", "prune skills", or "promote skill changes".
version: 0.1.0
tools: Bash, Read, Write, Edit
---

# SkillSync Workflow

Manage AI agent skills across projects — sync, validate, and maintain shared skill libraries.

## Project Configuration

SkillSync uses `skillsync.yaml` at the project root as the manifest. Run `skillsync doctor` to check configuration health.

Key files:
- `skillsync.yaml` — manifest: sources, skills, targets, install mode, config overrides
- `skillsync.lock` — integrity checksums (auto-generated)
- `skill.yaml` — per-skill package descriptor (inside each skill directory)
- `skillsync.config.yaml` — merged runtime config (auto-generated in each target directory)

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `setup` | "set up skillsync", "bootstrap skills" | Detect install, scaffold manifest from existing skills |
| `sync` | "sync skills", "update skills" | Resolve, plan, and apply skill changes |
| `status` | "skill status", "check skills" | Report installed skill health and drift |
| `validate` | "validate skills", "check manifest" | Validate manifest, skills, config, compatibility |
| `diff` | "preview changes", "what would sync do" | Preview sync changes without applying |
| `doctor` | "diagnose skills", "skill health" | Run comprehensive health diagnostics |
| `pin` | "pin skill", "lock skill version" | Lock a skill to its current source revision |
| `unpin` | "unpin skill", "unlock skill" | Remove a revision pin, allow updates |
| `prune` | "prune skills", "remove unused skills" | Remove skills not declared in manifest |
| `promote` | "promote changes", "push skill changes" | Guide pushing local modifications upstream |

---

## Setup

**Input**: Empty (auto-detect), or project path

Bootstraps skillsync in a project that already has skills but no `skillsync.yaml`.

**Steps**:
1. Check for skillsync installation:
   ```bash
   skillsync --version
   ```
   If not found, instruct the user to install: `npm install -g skillsync`

2. Scan for existing skill directories:
   ```bash
   find .claude/skills -name "SKILL.md" -maxdepth 3 2>/dev/null
   find .codex/skills -name "SKILL.md" -maxdepth 3 2>/dev/null
   ```

3. Detect sources — check if skills were copied from a global store:
   ```bash
   ls ~/.claude/skills/ 2>/dev/null
   ```

4. Generate `skillsync.yaml` manifest with discovered skills, sources, and targets.
   Use `mirror` as the default install mode. Include all target directories found
   (`.claude/skills`, `.codex/skills`).

5. Run initial sync to establish the lock file:
   ```bash
   skillsync sync --dry-run --json
   ```
   Show the plan to the user. If approved:
   ```bash
   skillsync sync
   ```

6. Verify setup:
   ```bash
   skillsync doctor --json
   ```

---

## Sync

**Input**: Empty, `--dry-run`, `--force`, or `--json`

```bash
skillsync sync              # Resolve, plan, apply
skillsync sync --dry-run    # Preview without applying
skillsync sync --force      # Override conflict checks
skillsync sync --json       # Machine-readable output
```

Behavior:
- Resolves skills from sources in manifest order (first match wins)
- Follows transitive dependencies from `skill.yaml`
- Detects drift and reports conflicts before overwrite
- Materializes to all configured targets
- Updates `skillsync.lock` and generates `skillsync.config.yaml`

If conflicts are reported, explain the options:
1. `skillsync promote` — push local changes upstream first
2. `skillsync sync --force` — overwrite local modifications

---

## Status

**Input**: Empty or `--json`

```bash
skillsync status            # Human-readable report
skillsync status --json     # Structured output
```

Shows per-target: installed skills, install mode, lockfile alignment (clean, modified, missing, extra), file-level drift details.

---

## Validate

**Input**: Empty, `--exit-code`, or `--json`

```bash
skillsync validate                  # Check everything
skillsync validate --exit-code      # Exit 1 on errors (for CI)
skillsync validate --json           # Structured output
```

Checks: manifest structure, source definitions, SKILL.md presence and frontmatter, portability constraints, compatibility declarations, config override validity.

---

## Diff

**Input**: Empty or `--json`

```bash
skillsync diff              # Preview what sync would change
skillsync diff --json       # Structured output
```

Equivalent to `skillsync sync --dry-run`. Shows installs, updates, removals, and conflicts without applying.

---

## Doctor

**Input**: Empty or `--json`

```bash
skillsync doctor            # Comprehensive diagnostics
skillsync doctor --json     # Structured output
```

Checks: manifest validity, lock file presence, source availability, target directory existence, drift detection, portability validation.

---

## Pin

**Input**: Skill name (required)

```bash
skillsync pin <skill-name>
```

Locks a skill to its current git revision. Only works for git sources. Records the commit SHA in `skillsync.yaml` overrides so future syncs use that exact revision.

---

## Unpin

**Input**: Skill name (required)

```bash
skillsync unpin <skill-name>
```

Removes a revision pin, allowing the skill to float and receive updates on future syncs.

---

## Prune

**Input**: Empty, `--dry-run`, or `--json`

```bash
skillsync prune             # Remove undeclared skills
skillsync prune --dry-run   # Preview what would be removed
```

Removes installed skills not declared in the manifest, including untracked directories in targets that are not in the lock file.

---

## Promote

**Input**: Empty or `--json`

```bash
skillsync promote           # Show promotion guidance
skillsync promote --json    # Structured output
```

In v0, promotion is a manual workflow:
1. `skillsync status` — identify modified skills
2. `skillsync diff` — review changes
3. Copy modified files from target directory back to source
4. `skillsync sync` — confirm source and target are in sync

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
## SkillSync {Action}

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
