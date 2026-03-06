# CLI Reference

## Role of the CLI

The CLI is the primary operator interface for `skillsync`. It should make the
local/shared state of skills easy to inspect and safe to manipulate.

The CLI should support both:
- human-readable interactive usage
- machine-readable output for CI and editor integrations

## Planned Commands

### `skillsync install`

Install one or more skills from configured sources into the managed local store.

Expected uses:
- bootstrap a project from shared sources
- install a specific skill or set of skills
- select compatibility targets and install mode

### `skillsync sync`

Reconcile the local store with declared source state and update installed
skills.

Expected behavior:
- supports dry-run
- reports changes before apply
- updates lockfile and installed-state metadata

### `skillsync status`

Report current health of the local store:
- installed revisions
- lockfile alignment
- drift/conflict state
- validation/trust state
- override presence

### `skillsync diff`

Show meaningful change views across:
- source vs installed
- installed vs local modifications
- override layer vs upstream

### `skillsync validate`

Validate:
- manifests
- paths and references
- compatibility declarations
- portability constraints

### `skillsync doctor`

Provide higher-level diagnostics for:
- invalid installed state
- broken sources
- trust-policy violations
- non-portable configuration

### `skillsync pin` / `skillsync unpin`

Manage source or package pinning so projects can opt into stable revisions or
resume normal upgrade flow.

### `skillsync prune`

Remove stale or unmanaged installed content safely.

### `skillsync promote`

Represent the workflow for turning accepted local refinements into an upstream
change path. Whether this is fully automated in v0 is still open, but it is a
planned product capability.

## Output Principles

CLI output should:
- distinguish clean, drifted, conflicted, and invalid states clearly
- support JSON output where structured automation matters
- make dangerous mutations explicit
- explain why an operation is blocked and what the operator should do next

## Example Release-State Flow

```bash
skillsync install
skillsync status
skillsync diff --json
skillsync validate
skillsync sync --dry-run
skillsync sync
```

## Non-Goals

The CLI should not become:
- a separate business-logic implementation from the core library
- a replacement for the managed local store model
- a collection of commands with inconsistent state semantics
