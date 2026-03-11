# Validation and Trust (Archived)

> **Superseded by [docs/security.md](../security.md).**
> This was a pre-implementation design doc. The security doc reflects the actual implementation.

## Why This Matters

Shared skill distribution is not useful if teams cannot trust what gets
installed or understand why something broke.

The intended release-state product should include validation and trust behavior
as core features rather than cleanup work after the sync engine is built.

## Validation Scope

Validation should include:
- schema or manifest validation
- broken path and reference detection
- compatibility-target checks
- portability checks
- local-store consistency checks
- lockfile/state consistency checks

## Diagnostics

Validation output should be:
- actionable
- specific
- structured where needed

Examples of useful diagnostic categories:
- invalid manifest
- missing referenced file
- unsupported compatibility target
- non-portable absolute path
- drifted installed state
- untrusted source

Generic parse errors are not sufficient.

## Trust and Provenance

The product should surface:
- source identity
- resolved revision or version
- install origin
- trust policy outcomes

Teams should be able to restrict or warn on:
- unknown sources
- unapproved registries
- unexpected source changes
- executable helper scripts

## Script Safety

Skills can contain scripts or references to scripts. The system should make that
visible and policy-driven.

Expected release-state behavior:
- warn when a skill package includes executable components
- allow policy-based blocking or allowlisting
- expose this state in status and validation output

## CLI and MCP Consistency

Validation and trust state should be reflected consistently through:
- `skill-sync validate`
- `skill-sync doctor`
- `skill-sync status`
- MCP read surfaces that expose install health

## Release Readiness Expectations

Before the first serious release, the product should have:
- unit coverage for model, source, lockfile, and validation logic
- integration coverage for sync, portability, CLI, and MCP read flows
- fixture coverage for invalid manifests and unsafe-source cases
- release docs that define known limitations and trust assumptions
