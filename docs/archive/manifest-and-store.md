# Manifest and Local Store (Archived)

> **Superseded by [docs/specs/manifest-v0.md](../specs/manifest-v0.md).**
> This was a pre-implementation design doc. The spec reflects the actual implementation.

## Canonical Skill Package

At release, `skill-sync` should manage a canonical skill package model with
enough structure to support sync, portability, validation, and adaptation.

A skill package may include:
- `SKILL.md`
- metadata and compatibility declarations
- references and examples
- helper scripts
- assets and templates
- source and revision metadata
- override/config inputs

## Manifest Requirements

The canonical manifest should capture:
- stable package identity
- display name and description
- tags and triggers
- compatibility targets
- package contents and paths
- source metadata
- install constraints
- trust/provenance information

The implementation can support one or both of:
- frontmatter embedded in `SKILL.md`
- a sibling manifest file

The key requirement is that the internal model is stable even if packaging
formats evolve.

## Compatibility Metadata

Compatibility data should explicitly describe which environments a skill can be
materialized for, such as:
- Claude-style local skill directories
- Codex-style local skill directories
- generic MCP consumption

Unsupported features should be surfaced explicitly rather than dropped
silently.

## Local Store Goals

The managed store should:
- live inside the project or another explicit path
- remain inspectable in normal filesystem tools
- preserve provenance and sync-state metadata
- support portable and non-portable install modes
- support layered overrides and project-local config

## Example Store Shape

```text
.skill-sync/
  store/
    skills/
      code/
        SKILL.md
        manifest.yaml
        references/
        assets/
        scripts/
    metadata/
      installed-state.json
      compatibility-index.json
      source-index.json
  overrides/
  cache/
```

This exact layout is not fixed yet, but the release-state product should expose
the same concepts.

## Override Model

`skill-sync` should support narrow local customization without requiring a full
copy of upstream skills.

The expected override mechanisms are:
- project-local config injection
- explicit override layers
- controlled materialization adapters

The system should avoid turning local edits into silent drift where possible.

## Stored Metadata

Installed state should record:
- source identifier
- source revision or version
- install mode
- local content digest
- compatibility target
- install timestamp
- validation status
- override presence

## Non-Goals

The local store should not become:
- an opaque internal-only cache
- a hidden database with no on-disk representation
- an uncontrolled pile of manual copies with no provenance
