# CLI Reference

## Role of the CLI

The CLI is the interactive operator interface for `skill-sync`. It makes the
local/shared state of skills easy to inspect and safe to manipulate. The
[MCP server](mcp.md) provides the same capabilities to agent clients.

The CLI supports both:
- human-readable interactive usage
- machine-readable output for CI and editor integrations (`--json`)

## Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | `-j` | Machine-readable JSON output |
| `--project <path>` | `-p` | Project root directory (default: current directory) |
| `--help` | `-h` | Show help text |
| `--version` | | Show version number |

## Commands

### `skill-sync sync`

Resolve all skills from configured sources, plan changes, and apply them to
all configured targets.

| Flag | Short | Description |
|------|-------|-------------|
| `--dry-run` | `-n` | Show plan without applying changes |
| `--force` | `-f` | Override conflict checks and apply even if local drift is detected |

Behavior:
- Resolves skills from sources in manifest order (first match wins)
- Follows transitive dependencies from `skill.yaml`
- Detects drift and reports conflicts before overwrite
- Materializes skills to all configured target directories
- Updates `skill-sync.lock` after successful apply
- Generates `skill-sync.config.yaml` in each target directory

### `skill-sync status`

Report the current health of the installed skill store per target.

Shows:
- Installed skills and their install mode
- Tracked-snapshot alignment (clean, modified, missing, ignored, extra)
- Local materialization readiness, reported separately from snapshot integrity
- Instruction readiness for every discovered or configured agent surface
- File-level drift details

JSON output is additive and versioned with `schemaVersion: 2`. Existing
`locked`, `targets`, and `instructions` fields remain available; `readiness`
names the independent `trackedSnapshots`, `localMaterialization`, and
`instructions` dimensions. A skill excluded by a tracked target's `ignore`
policy has `state: "ignored"` and a separate `materializationState`, so an
intentionally absent snapshot is not mislabeled as tracked drift.

### `skill-sync validate`

Validate manifest, installed skills, config overrides, and compatibility.

| Flag | Description |
|------|-------------|
| `--exit-code` | Exit with code 1 if any errors are found |

Checks:
- Manifest structure and source definitions
- Installed skill packages (SKILL.md presence, frontmatter)
- Portability constraints (non-portable paths)
- Compatibility declarations against configured targets
- Config override validity

### `skill-sync diff`

Preview what `sync` would change without applying. Equivalent to
`skill-sync sync --dry-run`.

### `skill-sync doctor`

Run comprehensive health diagnostics.

Checks:
1. Manifest validity
2. Lock file presence and structure
3. Target directory existence
4. Tracked-snapshot drift and local materialization readiness across all targets
5. Portability validation
6. Instruction file audit, including shared `AGENTS.md` discovery for Copilot

`healthy` remains the compatibility signal for absence of hard configuration
errors. Consult the separate `readiness` object before claiming that local
mirrors or instruction surfaces are complete.

### `skill-sync pin <skill>`

Lock a skill to its current source revision by writing a revision override to
`skill-sync.yaml`.

For git sources, records the current commit SHA so future syncs use that exact
revision instead of the branch HEAD. Only works for git sources with a
resolved revision; local sources cannot be pinned.

### `skill-sync unpin <skill>`

Remove a revision pin from `skill-sync.yaml`, allowing the skill to float and
receive updates on future syncs. Succeeds silently if the skill is not
currently pinned.

### `skill-sync prune`

Remove installed skills that are not declared in the project manifest,
including untracked skills (directories in a target that are not in the
lock file).

| Flag | Short | Description |
|------|-------|-------------|
| `--dry-run` | `-n` | Show what would be removed without removing |

### `skill-sync promote`

Display guidance for manually promoting local skill modifications back to their
canonical source.

In v0, promotion is a documented manual workflow:
1. Run `skill-sync status` to identify modified skills
2. Run `skill-sync diff` to review changes
3. Copy modified files from the target directory back to the source
4. Run `skill-sync sync` to confirm source and target are in sync

Automated promotion is planned for v0.2+.

### `skill-sync agent-config`

Capture and validate the six supported Markdown instruction files, or restore a
previously captured local snapshot.

```bash
skill-sync agent-config capture [--dry-run] [--json]
skill-sync agent-config validate [--json]
skill-sync agent-config restore [--dry-run] [--force] [--json]
```

The allowlist is deliberately exact:

| Scope | Files |
|-------|-------|
| Global | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md` |
| Project root | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` |

The local snapshot lives at `.skill-sync/agent-config/`. Its `snapshot.json`
metadata records the six stable IDs, scope, source path, snapshot payload path,
presence state, byte size, and SHA-256 digest. Present files are copied byte for
byte into the snapshot; missing files are recorded as missing and have no
payload. A local `.gitignore` excludes the raw payloads while retaining the
metadata and guard itself; existing custom guard text is retained and the
protective rules are appended. Payloads are exact, unredacted instruction-file
content, so operators must not capture credentials or other secrets. The
snapshot is separate from `skill-sync.lock` and is not a remote or
general-purpose backup store.

Agent-config operations serialize through the transient
`.skill-sync/agent-config.lock`; it is removed after completion and is not part
of the snapshot format. Lock ownership is token-bound and fail-closed: commands
never delete a pre-existing lock based only on a recorded PID. If a process
terminates without releasing its lock, confirm that no operation is still
running before moving the lock aside manually and retrying.

Capture reads the live files and replaces the local snapshot only when it is
run without `--dry-run`; dry-run reports the planned six-file capture without
writing. Validate compares the live files with the snapshot and exits 0 only
when all six states and hashes match. A missing snapshot is an error. Restore
uses the snapshot payloads: it creates missing destinations, leaves unchanged
files alone, and refuses to replace modified destinations unless `--force` is
explicit. `--dry-run` reports the restore plan without writing. Files that were
missing at capture are never deleted by restore, even with `--force`.

Restore stages every payload before changing any destination. It uses a durable
local journal, same-directory no-overwrite installation, and recovery copies;
staged and installed payloads are hash-checked against the snapshot. An
EXDEV-specific exclusive-copy fallback is available for unusual filesystems,
but that fallback is not crash-atomic. An unexpected process interruption is
rolled back by the next non-dry-run agent-config command. A live destination
change is never silently overwritten: the operation either refuses it,
preserves the concurrent file during rollback, or leaves the journal for
manual conflict resolution. The journal provides recoverable failure behavior,
not a filesystem-level multi-file transaction across power loss. A conflict or
failed restore returns a non-zero exit code.

This MVP does not capture settings, permissions, hooks, trusted-folder state,
MCP configuration, nested instruction hierarchies, arbitrary rule files,
remote state, cross-agent translations, or Markdown semantics.

## Output Principles

CLI output:
- Distinguishes clean, drifted, conflicted, and invalid states clearly
- Supports JSON output for structured automation
- Makes dangerous mutations explicit
- Explains why an operation is blocked and what the operator should do next

## Example Workflow

```bash
skill-sync validate          # Check manifest and installed state
skill-sync sync --dry-run    # Preview changes
skill-sync sync              # Apply changes
skill-sync status            # Confirm clean state
skill-sync pin my-skill      # Lock to current revision
```

## Non-Goals

The CLI should not become:
- a separate business-logic implementation from the core library
- a replacement for the managed local store model
- a collection of commands with inconsistent state semantics
