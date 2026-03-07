# skillsync

`skillsync` is a local-first skill distribution system for AI agents.

It provides:
- a CLI for syncing, validating, and inspecting shared skills
- an MCP server for discovering and consuming locally installed skills
- a portable local store that keeps shared skills usable across projects, CI, and web-based agent contexts

The goal is simple: make skills easy to share between projects without making
them dependent on one developer's home-directory setup.

Additional documentation:
- [Documentation Index](docs/index.md)
- [Architecture Specification](docs/specs/architecture-v0.md)
- [Manifest Specification](docs/specs/manifest-v0.md)
- [Sync Model and Lockfile](docs/sync-model.md)
- [CLI Reference](docs/cli.md)
- [MCP Server](docs/mcp.md)
- [Portability and Overrides](docs/portability.md)
- [Security and Trust](docs/security.md)

## Problem

Shared skills are useful, but the current ecosystem is fragile:
- some skills live in machine-global directories and break in web or CI contexts
- projects often fork shared skills just to change local paths or config
- sync behavior is frequently ad hoc, with no lockfile, provenance, or drift reporting
- CLI and MCP access are usually separate integrations over the same underlying files

`skillsync` solves those issues with one consistent model.

## What It Does

`skillsync` lets a project declare one or more skill sources, materialize them
locally, and expose the resulting skill set through both a CLI and MCP server.

Core capabilities:
- shared skills have a canonical package model with metadata, compatibility data, and provenance
- installs are deterministic and recorded in a lockfile
- projects can choose install modes: `copy`, `symlink`, or `mirror`
- local project configuration can customize shared skills without forcing a full fork
- portable installs do not require runtime access to `~/.claude`, `~/.codex`, or similar machine-local roots
- the MCP server and CLI both operate on the same installed local store
- validation, trust checks, and diagnostics are built in rather than bolted on later

## What A Skill Looks Like

`skillsync` manages skill packages that contain:
- a primary `SKILL.md`
- package metadata and compatibility declarations
- references, assets, helper scripts, and examples
- source and revision information
- optional local override layers or project-specific configuration inputs

Internally, the library uses a canonical skill model so that one skill can
be adapted to multiple environments without treating one vendor format as the
system's source of truth.

## Sync Model

The sync engine pulls skills from multiple source types and installs them into
a local managed store.

Supported sources:
- local filesystem paths
- git repositories
- curated registries (planned for v0.2)

Sync behavior:
- dry-run before apply
- explicit lockfile with source, revision, install mode, and content digest
- drift detection between upstream, installed, and locally modified state
- conflict reporting before overwrite
- plan-then-apply model with lock file updated after successful materialization
- promotion workflows for moving project-local refinements back to a shared source

## Portability And Overrides

Portability is a first-class requirement.

`skillsync` supports:
- repo-local materialization for web-safe and CI-safe use
- compatibility mapping across Claude-style, Codex-style, and generic MCP-facing skill consumers
- project-local config injection for paths, commands, fixtures, modules, or other environment-specific values
- narrow override layers so projects do not need to duplicate the entire upstream skill package

The design target is "shared source of truth, local usable result."

## CLI

The CLI is the main operational surface for developers and projects.

Commands:
- `skillsync sync` — resolve, plan, and apply skill installation
- `skillsync status` — report drift, lockfile alignment, and validation state
- `skillsync validate` — check manifests, paths, portability, and compatibility
- `skillsync diff` — preview changes without applying (dry-run)
- `skillsync doctor` — comprehensive health diagnostics
- `skillsync pin <skill>` — lock a skill to its current revision
- `skillsync unpin <skill>` — allow a pinned skill to float for updates
- `skillsync prune` — remove skills not declared in the manifest
- `skillsync promote` — guidance for promoting local changes back upstream (manual in v0)

All commands support `--json` for machine-readable output and `--project`/`-p`
to specify the project root.

## MCP Server

The MCP server exposes the local `skillsync` store so agent clients can
discover and consume installed skills without filesystem-specific glue code.

The v0 server is read-only and provides:
- **Resources:** `skill://list`, `skill://{name}`, `skill://{name}/{+path}`
- **Tools:** `search-skills`, `skill-status`, `validate-skills`
- **Prompts:** `use-skill`

Mutation tools are planned for v0.2+ after the trust and conflict model is
stable.

## Validation And Trust

`skillsync` includes validation and trust controls covering:
- manifest/schema validation
- broken reference and path checks
- compatibility validation for requested targets
- provenance reporting for installed skills
- trust policies and source allowlists
- warnings or policy gates around executable scripts and unsafe operations
- actionable diagnostics instead of generic parse failures

## Architecture

The implementation has three layers:
- a shared **core library** (`src/core/`) for skill models, sources, sync logic, lockfiles, and validation
- a thin **CLI layer** (`src/cli/`) over the core library
- a thin **MCP adapter** (`src/mcp/`) exposing the same installed state and operations

The CLI and MCP server share one implementation — neither invents its own
business logic over the same files.

## Current Status

v0 implementation is **feature-complete**:
- 137 tests passing across 25 test files (unit, contract, integration)
- All 9 CLI commands implemented
- MCP server with read-only resources, tools, and prompts
- Local and git source adapters
- Multi-target materialization (Claude, Codex, generic MCP)

Known limitations are documented in [docs/release-v0.md](docs/release-v0.md).
