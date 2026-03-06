# `skillsync` Documentation

This documentation set describes the expected end state of `skillsync` at its
first serious release. The repository is still in planning mode, so these docs
describe the target system rather than implemented behavior.

## Reading Order

- [Product Overview](/Users/joe/Developer/skillsync/README.md)
- [Architecture](/Users/joe/Developer/skillsync/docs/architecture.md)
- [Manifest and Local Store](/Users/joe/Developer/skillsync/docs/manifest-and-store.md)
- [Sync Model and Lockfile](/Users/joe/Developer/skillsync/docs/sync-model.md)
- [CLI Reference](/Users/joe/Developer/skillsync/docs/cli.md)
- [MCP Server](/Users/joe/Developer/skillsync/docs/mcp.md)
- [Portability and Overrides](/Users/joe/Developer/skillsync/docs/portability.md)
- [Validation and Trust](/Users/joe/Developer/skillsync/docs/validation-and-trust.md)
- [Competitive Analysis](/Users/joe/Developer/skillsync/docs/competitive-analysis.md)

## Product Goal

`skillsync` is intended to be a local-first skill lifecycle manager for AI
agents. It should let projects consume shared skills from external sources,
materialize them locally in a portable way, customize them safely for local
needs, and expose them through both a CLI and an MCP server.

## Core Product Commitments

The expected release-state product must provide:
- deterministic sync from shared sources into a local managed store
- a canonical skill model that is not tied to one agent vendor
- portable installs that work outside machine-global skill directories
- project-local config injection and layered overrides without full forks
- validation, provenance, and trust controls
- one shared implementation core behind the CLI and MCP surfaces

## Scope Boundaries

`skillsync` is not intended to be:
- a generic prompt marketplace
- a consumer-facing hosted registry
- only an MCP skill browser
- only a Claude-style installer

The product is justified only if it owns the lifecycle and portability layer
that existing tools do not clearly cover.
