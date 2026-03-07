# `skillsync` Documentation

## Reading Order

- [Product Overview](../README.md)
- [Architecture Specification](specs/architecture-v0.md)
- [Manifest Specification](specs/manifest-v0.md)
- [Sync Model and Lockfile](sync-model.md)
- [CLI Reference](cli.md)
- [MCP Server](mcp.md)
- [Portability and Overrides](portability.md)
- [Promotion Workflow](specs/promotion-v0.md)
- [Compatibility Specification](specs/compatibility-v0.md)
- [Security and Trust](security.md)
- [Release Criteria](release-v0.md)
- [Competitive Analysis](competitive-analysis.md)

## Product Goal

`skillsync` is a local-first skill lifecycle manager for AI agents. It lets
projects consume shared skills from external sources, materialize them locally
in a portable way, customize them safely for local needs, and expose them
through both a CLI and an MCP server.

## Core Product Commitments

- Deterministic sync from shared sources into a local managed store
- A canonical skill model that is not tied to one agent vendor
- Portable installs that work outside machine-global skill directories
- Project-local config injection and layered overrides without full forks
- Validation, provenance, and trust controls
- One shared implementation core behind the CLI and MCP surfaces

## Scope Boundaries

`skillsync` is not intended to be:
- a generic prompt marketplace
- a consumer-facing hosted registry
- only an MCP skill browser
- only a Claude-style installer

The product is justified only if it owns the lifecycle and portability layer
that existing tools do not clearly cover.

## Archived Design Docs

Pre-implementation design documents are preserved in [`docs/archive/`](archive/)
for historical reference. They have been superseded by the specifications above.
