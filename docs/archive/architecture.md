# Architecture (Archived)

> **Superseded by [docs/specs/architecture-v0.md](../specs/architecture-v0.md).**
> This was a pre-implementation design doc. The spec reflects the actual implementation.

## Overview

The intended architecture has three layers:

1. Core library
2. CLI adapter
3. MCP adapter

The core library is the product. The CLI and MCP server should both delegate to
the same core abstractions for skill parsing, source loading, sync planning,
lockfile management, validation, and local-store inspection.

## Design Goals

- One canonical skill model across all surfaces
- Local-first installed state that remains inspectable on disk
- Deterministic sync behavior with explicit state transitions
- Clear separation between read-only and mutating operations
- Extensible source and compatibility adapters

## Core Subsystems

### Skill Model

Represents the normalized internal view of a skill package:
- identity
- display metadata
- triggers and tags
- compatibility targets
- references, assets, scripts, examples
- source metadata
- local override/config inputs

This model should be independent of any single vendor wrapper format.

### Source Layer

Responsible for reading skills from:
- local paths
- git repositories
- curated registries
- GitHub-style remote sources

The source layer should return canonical package data plus provenance metadata,
not pre-materialized target-specific files.

### Sync Engine

Responsible for:
- planning installs and updates
- reconciling source state with installed local state
- producing dry-run output
- applying updates atomically
- detecting drift and conflicts
- writing lockfile and sync metadata

### Local Store

The local store is the managed on-disk representation of installed skills. It
must be:
- portable
- inspectable
- stable enough for CLI and MCP consumers
- explicit about provenance and override state

### Validation and Trust

Responsible for:
- schema validation
- broken path/reference checks
- compatibility validation
- trust policies for sources
- warnings or gates for executable scripts

### Compatibility Adapters

Transforms canonical skill packages into consumer-specific forms for:
- Claude-style consumers
- Codex-style consumers
- generic MCP-facing access
- future agent targets

## CLI Layer

The CLI should remain thin. It should:
- parse user intent
- invoke core plan/apply/status operations
- render human-readable and machine-readable output

The CLI must not contain sync-only business logic that the MCP server cannot
share.

## MCP Layer

The MCP layer should expose the same local store and status that the CLI uses.
Initial scope should be read-first:
- list installed skills
- search installed skills
- fetch skill metadata
- fetch materialized content
- expose validation or status summaries where safe

Mutation via MCP should only be added when sync, trust, and conflict semantics
are already stable.

## Suggested Package Layout

```text
src/skillsync/
  models/
  sources/
  sync/
  lockfile/
  store/
  adapters/
  validation/
  security/
  cli/
  mcp/
```

## Architectural Invariants

- The local store is the source of truth for runtime consumption.
- The lockfile is the source of truth for deterministic source resolution.
- CLI and MCP must report the same installed state.
- Overrides must be explicit layered state, not silent local mutation.
- Validation must run before unsafe materialization is exposed as healthy state.
