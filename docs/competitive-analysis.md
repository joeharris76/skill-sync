# Competitive Analysis: `skillsync` vs `SkillPort` vs `OpenSkills`

This document compares the planned release state of `skillsync` against the two
closest verified public competitors:

- [SkillPort](https://github.com/gotalab/skillport)
- [OpenSkills](https://github.com/numman-ali/openskills)

These are the right primary comparators because both already address real parts
of the problem space:

- installing and sharing skills across projects and agents
- exposing skills through an operational interface
- keeping skills compatible with existing `SKILL.md` conventions

`skillsync` is only worth building if it solves the lifecycle gaps these tools
do not clearly own today.

## Source Basis

This comparison is grounded in:

- the planned release state in [README.md](/Users/joe/Developer/skillsync/README.md)
- the current planning TODOs under [_project/TODO/main/planning](/Users/joe/Developer/skillsync/_project/TODO/main/planning)
- the public READMEs for:
  - [gotalab/skillport](https://github.com/gotalab/skillport)
  - [numman-ali/openskills](https://github.com/numman-ali/openskills)

Important constraint:
- the `skillsync` column reflects intended capabilities, not implemented ones
- competitor capabilities below are limited to what is public and verifiable

## Executive Summary

`SkillPort` is the closest architectural competitor.

It already offers:
- CLI and MCP delivery modes
- skill validation
- multi-source add/update/remove flows
- metadata management
- AGENTS.md generation for agent discovery
- search-first loading for large skill sets

`OpenSkills` is the closest "universal installer/syncer" competitor.

It already offers:
- installation from GitHub, local paths, and private git repos
- sync into `AGENTS.md`
- Claude-compatible `SKILL.md` handling
- symlink support for local development
- universal installation patterns for multiple agents

Neither appears to clearly own the full lifecycle problem that drove this
project:
- deterministic sync state
- lockfiles and provenance
- drift/conflict detection
- project-local config injection into shared skills
- layered overrides without full forks
- portability as a first-class design goal

That remains the strongest justification for `skillsync`.

## Feature Comparison

| Capability | `skillsync` planned release | SkillPort | OpenSkills |
| --- | --- | --- | --- |
| Primary value proposition | Local-first skill distribution, sync, portability, validation, CLI, and MCP over one core | Validate, manage, and deliver skills via CLI or MCP | Universal Claude-style skills loader and sync tool across agents |
| Implementation status | Planned | Public project, active, but still evolving | Public project, active |
| Primary interface | CLI + MCP server | CLI + MCP | CLI |
| Canonical internal cross-agent model | Planned | Agent Skills spec-oriented | Claude-compatible skills model |
| Skill validation | Planned, broad validation and diagnostics | Yes: `skillport validate` with CI-friendly JSON | No strong validation story visible in README |
| Multi-source install | Planned: local, git, curated registry, GitHub-style sources | Yes: GitHub, local path, zip | Yes: GitHub, local paths, private git repos |
| Update existing installs | Planned | Yes: `skillport update` | Implicitly install/sync/manage oriented; not presented as full lifecycle update engine |
| Managed install modes | Planned: copy, symlink, mirror, vendored snapshot | Add/manage skills, but no clear lock-aware install-mode matrix in README | Supports local dev symlinks and install flows |
| Lockfile / deterministic resolution | Planned, first-class | No clear evidence in README | No clear evidence in README |
| Provenance / source revision tracking | Planned, first-class | Source-aware add/update, but no clear provenance policy surfaced | Source-based installs, but no clear provenance policy surfaced |
| Drift detection | Planned | No clear evidence | No clear evidence |
| Conflict reporting before overwrite | Planned | No clear evidence | Some conflict warnings around Anthropic marketplace overlaps, but not a general sync-conflict model |
| Atomic sync plan/apply behavior | Planned | No clear evidence | No clear evidence |
| Bidirectional promote flow back upstream | Planned | No clear evidence | No clear evidence |
| Project-local override layering | Planned | No clear evidence | No clear evidence |
| Project-specific config injection | Planned, first-class | No clear evidence | No clear evidence |
| Portable repo-local materialization | Planned, first-class | Project/agent delivery supported, but portability is not the main product framing | Yes, partially, through project install + AGENTS.md + universal mode |
| Multi-agent support | Planned: Claude, Codex, MCP-facing, generic adapters | Yes: Cursor, Copilot, Windsurf, Cline, Codex, Claude via CLI/MCP | Yes: Claude Code, Cursor, Windsurf, Aider, and universal agent mode |
| AGENTS.md generation/sync | Not yet explicitly planned as a core feature | Yes: `skillport doc` | Yes: `openskills sync` |
| MCP delivery | Yes, planned | Yes, first-class | No first-class MCP server in README |
| MCP search-first loading | Yes, planned read-first surface | Yes: `search_skills` then `load_skill` | N/A |
| Metadata editing without manual file edits | Not currently planned | Yes: `meta get/set/unset` | No clear evidence |
| Per-client filtering / categories | Potential future feature, not yet committed | Yes: categories/tags and per-client filtering via env vars | No clear evidence of comparable filtering model |
| Always-on/core skill concept | Not currently planned | Yes: `alwaysApply: true` metadata pattern | No clear evidence |
| Best fit today | Teams that need governed lifecycle management and portability | Teams that want a mature operational toolkit right now | Teams that want broad Claude-style skill installation and AGENTS sync with minimal overhead |

## Where SkillPort Is Stronger Than The Earlier Analysis Suggested

SkillPort is not just an MCP server. Its verified README shows a broader product:

- validation against the Agent Skills specification
- add/update/remove lifecycle management
- metadata management via CLI
- CLI mode and MCP mode
- AGENTS.md generation
- search-first loading to reduce context pressure
- per-client filtering through categories and tags

That makes it much closer to `skillsync` than MCP Skill Hub.

## Where OpenSkills Is Stronger Than The Earlier Analysis Suggested

OpenSkills is simpler than `SkillPort`, but it is still important because it
already solves a large part of the "share skills across agents" problem:

- same `SKILL.md` format and progressive disclosure pattern as Claude Code
- install from multiple sources
- sync into `AGENTS.md`
- symlink for local development
- universal mode for multiple agents

If the problem is mostly "get Claude-style skills into more places," OpenSkills
already covers a lot of ground.

## What `skillsync` Would Need To Be Better At

To justify a new project, `skillsync` needs to be clearly better at the parts
the other tools do not visibly solve:

1. Deterministic sync state
   - explicit lockfile
   - stable source revision capture
   - reproducible installs across machines

2. Lifecycle visibility
   - drift detection
   - conflict reporting
   - clear status and diff views

3. Structured project customization
   - project-local config injection
   - override layering without copying entire upstream skill trees

4. Portability
   - repo-local materialization that works without `~/.claude` or `~/.codex`
   - CI-safe and web-safe installs as a first-class goal

5. Shared implementation core
   - CLI and MCP backed by the same store and sync engine
   - no duplicated business logic between delivery surfaces

6. Trust and diagnostics
   - provenance policy
   - actionable validation
   - explicit handling for unsafe scripts or incompatible targets

## Recommendation

Recommendation: pursue `skillsync`, but only with a narrow differentiated scope.

Do not build `skillsync` as:
- another generic skill installer
- another MCP skill browser
- another AGENTS.md generator

Those problems already have credible solutions.

Build `skillsync` only as:
- a package-management-style sync layer for skills
- a portability layer for locally materialized shared skills
- a lifecycle/governance layer for shared-source, project-local skill usage

## Build vs Adopt

Use `SkillPort` instead if your main need is:
- validate skills
- manage them from common sources
- expose them via CLI or MCP
- search/load skills effectively today

Use `OpenSkills` instead if your main need is:
- install Claude-style skills from GitHub/local/private repos
- sync them into `AGENTS.md`
- share skills across multiple agents with minimal ceremony

Build `skillsync` if your actual need is:
- deterministic sync with lock-state
- drift/conflict visibility over time
- project-local configuration of shared generic skills
- portable repo-local materialization
- structured promote/override workflows

## Practical Recommendation

The best strategic path is:

1. Treat `SkillPort` as the closest product benchmark.
2. Treat `OpenSkills` as the strongest baseline for installer ergonomics and
   agent compatibility.
3. Keep `skillsync` focused on the lifecycle layer neither clearly owns.

That means v0 should emphasize:
- manifest and local-store design
- lockfile and sync semantics
- status/diff/validate/doctor workflows
- config injection and override layering
- a thin read-first MCP surface over the same local store

It should not spend early effort competing on:
- generic MCP browsing polish
- metadata editing UX
- broad marketplace/community features
- installer parity for every source type on day one

## Final Verdict

`skillsync` is worth pursuing only if it remains a lifecycle and portability
product.

If the scope narrows to "install skills" or "serve skills over MCP," you should
adopt an existing project instead, most likely `SkillPort` or `OpenSkills`
depending on which side of the problem matters more.

## Sources

- [SkillPort README](https://github.com/gotalab/skillport)
- [OpenSkills README](https://github.com/numman-ali/openskills)
- [OpenSkills releases/README excerpt](https://github.com/numman-ali/openskills/releases)
