# CLI Reference

## Role of the CLI

The CLI is the interactive operator interface for `skillsync`. It makes the
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

### `skillsync sync`

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
- Updates `skillsync.lock` after successful apply
- Generates `skillsync.config.yaml` in each target directory

### `skillsync status`

Report the current health of the installed skill store per target.

Shows:
- Installed skills and their install mode
- Lockfile alignment (clean, modified, missing, extra)
- File-level drift details

### `skillsync validate`

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

### `skillsync diff`

Preview what `sync` would change without applying. Equivalent to
`skillsync sync --dry-run`.

### `skillsync doctor`

Run comprehensive health diagnostics.

Checks:
1. Manifest validity
2. Lock file presence and structure
3. Target directory existence
4. Drift detection across all targets
5. Portability validation

### `skillsync pin <skill>`

Lock a skill to its current source revision by writing a revision override to
`skillsync.yaml`.

For git sources, records the current commit SHA so future syncs use that exact
revision instead of the branch HEAD. Only works for git sources with a
resolved revision; local sources cannot be pinned.

### `skillsync unpin <skill>`

Remove a revision pin from `skillsync.yaml`, allowing the skill to float and
receive updates on future syncs. Succeeds silently if the skill is not
currently pinned.

### `skillsync prune`

Remove installed skills that are not declared in the project manifest,
including untracked skills (directories in a target that are not in the
lock file).

| Flag | Short | Description |
|------|-------|-------------|
| `--dry-run` | `-n` | Show what would be removed without removing |

### `skillsync promote`

Display guidance for manually promoting local skill modifications back to their
canonical source.

In v0, promotion is a documented manual workflow:
1. Run `skillsync status` to identify modified skills
2. Run `skillsync diff` to review changes
3. Copy modified files from the target directory back to the source
4. Run `skillsync sync` to confirm source and target are in sync

Automated promotion is planned for v0.2+.

## Output Principles

CLI output:
- Distinguishes clean, drifted, conflicted, and invalid states clearly
- Supports JSON output for structured automation
- Makes dangerous mutations explicit
- Explains why an operation is blocked and what the operator should do next

## Example Workflow

```bash
skillsync validate          # Check manifest and installed state
skillsync sync --dry-run    # Preview changes
skillsync sync              # Apply changes
skillsync status            # Confirm clean state
skillsync pin my-skill      # Lock to current revision
```

## Non-Goals

The CLI should not become:
- a separate business-logic implementation from the core library
- a replacement for the managed local store model
- a collection of commands with inconsistent state semantics
