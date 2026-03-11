# Portability and Overrides

## Why Portability Matters

The project exists because shared skills often become dependent on one
developer's workstation layout. That breaks in:
- CI
- remote execution
- web-based agent environments
- other contributors' machines

`skill-sync` should treat portability as a first-class design target rather than
an afterthought.

## Portability Goals

At release, the system should support:
- repo-local materialization
- operation without runtime dependency on `~/.claude`, `~/.codex`, or similar
- compatibility mapping across multiple agent ecosystems
- project-local config injection without forking upstream skill trees

## Portable vs Non-Portable Install Modes

Portable installs should:
- place required content inside the project or another explicit managed path
- avoid hidden machine-local assumptions
- make dependencies and provenance visible

Non-portable modes such as symlink-based local development can still exist, but
they should be clearly identified as convenience modes rather than the default
portability story.

## Override Layering

Projects need to adapt generic shared skills without fully copying them.

The intended release-state model is:
- upstream shared source remains canonical
- project-local config provides structured local values
- explicit override layers handle small local differences
- materialization adapters combine these into the final local form

This should reduce duplication and make local divergence legible.

## Config Injection

Examples of project-local values that may need injection:
- test commands
- lint/typecheck commands
- fixture directories
- module/package names
- project-specific documentation paths

The product should support these values as structured inputs, not brittle text
rewrites.

## Compatibility Adapters

`skill-sync` should be able to materialize compatible local outputs for:
- Claude-style skill directories
- Codex-style skill directories
- generic MCP consumers

Unsupported features should be surfaced explicitly as validation or compatibility
warnings.

## Desired Outcome

The release-state experience should be:
- one shared skill source of truth
- one local managed store
- multiple compatible materialization targets
- minimal duplication
- explicit visibility into what is portable and what is not
