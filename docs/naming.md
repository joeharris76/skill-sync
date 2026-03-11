# Why `skill-sync` (not `skillsync`)

This project was originally named `skillsync`. During pre-release testing, we
discovered that `skillsync` was already taken on npm by
[jinzheio/skillsync](https://github.com/jinzheio/skillsync) (v1.3.8, published
January 2026). This page documents the name collision, the architectural
differences, and why contributing back was not practical.

## The existing `skillsync` package

`skillsync` by jinzheio is a TypeScript CLI tool for copying AI agent skill
files from git repositories and local directories into agent skill directories
(`~/.claude/skills/`, `~/.cursor/skills/`, etc.). It was published between
January 17 and February 7, 2026 across 17 releases.

Its workflow is:

1. `skillsync fetch` -- shallow-clone repos or copy local dirs into
   `.skillsync/` store
2. `skillsync push` -- copy all stored skills to all enabled target directories
3. `skillsync status` -- show what is synced where

The `sync` command exists as a deprecated alias for `push`.

## Architectural comparison

Both projects solve the same high-level problem -- distributing AI agent skills
across projects and agent targets -- but take fundamentally different approaches.

### Data model

| Concept | jinzheio/skillsync | skill-sync |
|---------|-------------------|------------|
| Skill identity | Directory name (string) | `SkillPackage` with metadata, file list, checksums |
| Skill metadata | Optional SKILL.md frontmatter (display only) | SKILL.md + `skill.yaml` sidecar (dependencies, config inputs, targets) |
| Project config | `.skillsync/config.json` (bare JSON, no schema) | `skill-sync.yaml` manifest with typed schema |
| Lock/integrity | None | `skill-sync.lock` with SHA256 per file |
| Source model | Inline if/else (git vs local) | `SkillSource` interface (local, git, registry planned) |

### Sync model

| Behavior | jinzheio/skillsync | skill-sync |
|----------|-------------------|------------|
| Fetch | Delete and re-clone every time | Resolve from sources, hash, compare |
| Push/sync | Delete target directory, copy everything | Plan-then-apply with dry-run preview |
| Conflict detection | Local fetch only (MD5); push destroys targets silently | Lock vs disk vs source comparison, per-file |
| Incremental updates | None (full overwrite) | Only changed files, with skip-if-identical |
| Install modes | Copy only | Copy, symlink, mirror |

### Feature coverage

| Feature | jinzheio | skill-sync |
|---------|:--------:|:----------:|
| Lock file with checksums | -- | Yes |
| Drift detection | -- | Yes |
| Conflict resolution | -- | Yes |
| Transitive dependencies | -- | Yes |
| Config injection per project | -- | Yes |
| Agent compatibility checks | -- | Yes |
| Portability validation | -- | Yes |
| Trust/security policy | -- | Yes |
| MCP server | -- | Yes |
| Validation suite | -- | Yes |
| Doctor diagnostics | -- | Yes |
| Pin/unpin versions | -- | Yes |
| Prune untracked skills | -- | Yes |
| Promote local changes | -- | Yes |
| JSON output on all commands | -- | Yes |
| Source/target enable/disable | Yes | -- |
| Interactive conflict prompts | Yes | -- |

### Code quality

| Metric | jinzheio/skillsync | skill-sync |
|--------|-------------------|------------|
| Implementation LOC | ~800 | ~3,000+ |
| Test count | ~27 (mostly smoke) | 166 contract + unit |
| Runtime dependencies | Zero | 2 (`@modelcontextprotocol/sdk`, `yaml`) |
| Architecture layers | Commands + lib (no boundaries) | Core / sources / CLI / MCP (strict layer rules) |
| Source abstraction | None (inline branching) | Formal interface with pluggable adapters |

## Why contributing back was not practical

We evaluated whether it would be feasible to contribute skill-sync's features
into jinzheio/skillsync rather than maintaining a separate project. The
conclusion was that it would require rewriting ~90% of their codebase, at which
point the contribution would be a takeover rather than a collaboration.

### Fundamental model incompatibility

The destructive overwrite sync model (`push` deletes the target directory and
copies everything fresh) is architecturally incompatible with plan-then-apply
sync, lockfiles, or drift detection. Adding any of these features requires
replacing the push implementation entirely, not extending it.

### No abstraction boundaries to build on

There is no `SkillSource` interface -- source handling is an inline if/else in
`fetch.ts`. There is no skill identity model -- skills are directory path
strings. There is no sync engine -- fetch clones, push copies. Every significant
feature in skill-sync (lockfile, drift, resolver, materializer, compatibility,
validation, trust) depends on abstractions that do not exist in their codebase
and cannot be added incrementally.

### No shared core to extend

Their commands directly call git and filesystem operations. There is no core
library layer. Adding one means restructuring every existing command, which
breaks every existing test and changes every existing behavior.

### What could be contributed easily

A few isolated features could be added without architectural conflict:

- New target definitions (add to their `KNOWN_TARGETS` dictionary)
- `--json` output flag (wrap existing console output)
- Improved SKILL.md parsing (replace their hand-rolled YAML parser)

But none of these address the lifecycle, integrity, or governance gaps that
motivated skill-sync in the first place.

## Resolution

We renamed the npm package from `skillsync` to `skill-sync` (hyphenated). This
is consistent with npm conventions (`lint-staged`, `cross-env`, `ts-node`,
`node-fetch`).

| Artifact | Name |
|----------|------|
| npm package | `skill-sync` |
| CLI binary | `skill-sync` |
| Project manifest | `skill-sync.yaml` |
| Lock file | `skill-sync.lock` |
| Generated config | `skill-sync.config.yaml` |
| Code identifiers | `SkillSync` / `skillSync` (standard PascalCase/camelCase) |
