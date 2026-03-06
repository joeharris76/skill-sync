# skillsync

`skillsync` is a local-first skill distribution system for AI agents.

At release, it will provide:
- a CLI for installing, syncing, validating, and inspecting shared skills
- an MCP server for discovering and consuming those locally installed skills
- a portable local store that keeps shared skills usable across projects, CI, and web-based agent contexts

The goal is simple: make skills easy to share between projects without making
them dependent on one developer's home-directory setup.

Additional documentation:
- [Documentation Index](/Users/joe/Developer/skillsync/docs/index.md)
- [Architecture](/Users/joe/Developer/skillsync/docs/architecture.md)
- [Manifest and Local Store](/Users/joe/Developer/skillsync/docs/manifest-and-store.md)
- [Sync Model and Lockfile](/Users/joe/Developer/skillsync/docs/sync-model.md)
- [CLI Reference](/Users/joe/Developer/skillsync/docs/cli.md)
- [MCP Server](/Users/joe/Developer/skillsync/docs/mcp.md)
- [Portability and Overrides](/Users/joe/Developer/skillsync/docs/portability.md)
- [Validation and Trust](/Users/joe/Developer/skillsync/docs/validation-and-trust.md)

## Problem

Shared skills are useful, but the current ecosystem is fragile:
- some skills live in machine-global directories and break in web or CI contexts
- projects often fork shared skills just to change local paths or config
- sync behavior is frequently ad hoc, with no lockfile, provenance, or drift reporting
- CLI and MCP access are usually separate integrations over the same underlying files

`skillsync` is intended to solve those issues with one consistent model.

## Intended Release State

At release, `skillsync` will let a project declare one or more skill sources,
materialize them locally, and expose the resulting skill set through both a CLI
and MCP server.

Core expectations:
- shared skills have a canonical package model with metadata, compatibility data, and provenance
- installs are deterministic and recorded in a lockfile
- projects can choose install modes such as `copy`, `symlink`, `mirror`, or vendored snapshot
- local project configuration can customize shared skills without forcing a full fork
- portable installs do not require runtime access to `~/.claude`, `~/.codex`, or similar machine-local roots
- the MCP server and CLI both operate on the same installed local store
- validation, trust checks, and diagnostics are built in rather than bolted on later

## What A Skill Looks Like

`skillsync` is expected to manage skill packages that may contain:
- a primary `SKILL.md`
- package metadata and compatibility declarations
- references, assets, helper scripts, and examples
- source and revision information
- optional local override layers or project-specific configuration inputs

Internally, the library will use a canonical skill model so that one skill can
be adapted to multiple environments without treating one vendor format as the
system's source of truth.

## Sync Model

The release target is a sync engine that can pull skills from multiple source
types and install them into a local managed store.

Planned source support:
- local filesystem paths
- git repositories
- curated registries
- GitHub-style shared sources where appropriate

Planned sync behavior:
- dry-run before apply
- explicit lockfile with source, revision, install mode, and content digest
- drift detection between upstream, installed, and locally modified state
- conflict reporting before overwrite
- atomic updates and rollback-friendly apply behavior
- promotion workflows for moving project-local refinements back to a shared source

## Portability And Overrides

Portability is a first-class requirement for this project.

At release, `skillsync` should support:
- repo-local materialization for web-safe and CI-safe use
- compatibility mapping across Claude-style, Codex-style, and generic MCP-facing skill consumers
- project-local config injection for paths, commands, fixtures, modules, or other environment-specific values
- narrow override layers so projects do not need to duplicate the entire upstream skill package

The design target is "shared source of truth, local usable result."

## CLI

The planned CLI is the main operational surface for developers and projects.

Expected commands include:
- `skillsync install`
- `skillsync sync`
- `skillsync status`
- `skillsync diff`
- `skillsync validate`
- `skillsync doctor`
- `skillsync pin`
- `skillsync unpin`
- `skillsync prune`
- `skillsync promote`

The CLI should make sync state legible, support machine-readable output, and
keep dangerous operations explicit.

## MCP Server

The planned MCP server will expose the local `skillsync` store so other agent
clients can discover and consume installed skills without filesystem-specific
glue code.

Expected capabilities include:
- list installed skills
- search by name, tags, triggers, or compatibility
- fetch skill metadata and source details
- fetch the materialized skill content that a client should use
- optionally expose carefully gated mutation tools after the trust and conflict model is solid

The default release stance is read-first: reliable discovery and retrieval
before broad remote mutation.

## Validation And Trust

The release target includes strong validation and trust controls.

This should cover:
- manifest/schema validation
- broken reference and path checks
- compatibility validation for requested targets
- provenance reporting for installed skills
- trust policies and source allowlists
- warnings or policy gates around executable scripts and unsafe operations
- actionable diagnostics instead of generic parse failures

## Architecture Direction

The intended implementation shape is:
- a shared core library for canonical skill models, sources, sync logic, lockfiles, and validation
- a CLI layer that stays thin over the core library
- an MCP adapter that exposes the same installed state and operations

That separation is important. The CLI and MCP server should not each invent
their own behavior over the same files.

## Release Criteria

`skillsync` should be considered ready for an initial release when it can:
- install and sync skills from at least the core source types with a stable lockfile
- materialize a portable local skill store that works without machine-global directories
- support project-local configuration and override layering without full skill forks
- expose the installed store consistently through both CLI and MCP
- detect and report drift, conflicts, and invalid skills clearly
- enforce basic trust/provenance policy for supported sources
- ship with integration tests covering sync, portability, CLI, MCP, and invalid-skill cases

## Current Status

This repository is currently in planning mode.

The present roadmap is tracked in the TODO system under:
- [_project/TODO/main/planning/foundation-architecture-and-manifest-model.yaml](/Users/joe/Developer/skillsync/_project/TODO/main/planning/foundation-architecture-and-manifest-model.yaml)
- [_project/TODO/main/planning/sync-engine-lockfile-and-source-management.yaml](/Users/joe/Developer/skillsync/_project/TODO/main/planning/sync-engine-lockfile-and-source-management.yaml)
- [_project/TODO/main/planning/portability-compatibility-and-project-overrides.yaml](/Users/joe/Developer/skillsync/_project/TODO/main/planning/portability-compatibility-and-project-overrides.yaml)
- [_project/TODO/main/planning/cli-surface-ux-and-operational-workflows.yaml](/Users/joe/Developer/skillsync/_project/TODO/main/planning/cli-surface-ux-and-operational-workflows.yaml)
- [_project/TODO/main/planning/mcp-server-resource-and-tool-surface.yaml](/Users/joe/Developer/skillsync/_project/TODO/main/planning/mcp-server-resource-and-tool-surface.yaml)
- [_project/TODO/main/planning/validation-trust-security-and-release-readiness.yaml](/Users/joe/Developer/skillsync/_project/TODO/main/planning/validation-trust-security-and-release-readiness.yaml)

These items define the expected end state for the first serious release.
