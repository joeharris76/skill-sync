# SkillSync Manifest Specification v0

This document defines the canonical skill package model, the project manifest
(`skillsync.yaml`), and the sidecar metadata file (`skillsync.meta.yaml`) used
by skillsync to manage, sync, and distribute skills.

## Design Principles

1. **Standard SKILL.md is untouched.** SkillSync never modifies or extends the
   industry-standard SKILL.md frontmatter. Sync metadata lives in sidecar files.
2. **Skills are directories, not files.** A skill is always a directory containing
   at least a SKILL.md. Everything else is optional.
3. **The internal model is vendor-neutral.** SkillSync uses a canonical
   representation internally, with adapters for Claude Code, Codex, and MCP output.
4. **Installed skills are plain files.** No database, no opaque cache. A human can
   inspect and understand the installed store with `ls` and `cat`.

---

## 1. Canonical Skill Package

A skill package is a directory with this layout:

```
my-skill/
  SKILL.md              # Required. YAML frontmatter + markdown instructions.
  skillsync.meta.yaml   # Optional. SkillSync-specific metadata (sidecar).
  references/           # Optional. Supporting documentation.
  scripts/              # Optional. Executable helpers.
  assets/               # Optional. Templates, images, data files.
```

### 1.1 SKILL.md

Follows the Agent Skills specification shared by Anthropic and OpenAI.

**Required frontmatter fields:**
- `name` — lowercase, hyphens, digits only (`^[a-z0-9]+(-[a-z0-9]+)*$`), max 64 chars
- `description` — max 1024 chars, non-empty

**Optional frontmatter fields:**
- `license` — SPDX identifier
- `allowed-tools` — tool restrictions when the skill is active
- `metadata` — arbitrary key-value pairs
- `compatibility` — agent compatibility hints

**Markdown body:** Free-form instructions, examples, and guidelines for the agent.

SkillSync reads but never writes to SKILL.md frontmatter.

### 1.2 skillsync.meta.yaml (Sidecar)

SkillSync-specific metadata that lives alongside SKILL.md. This file is optional
for consumed skills but is generated during sync operations.

```yaml
# skillsync.meta.yaml

# Authoring metadata (set by skill author)
tags: [python, backend, testing]
category: development
depends:
  - SHARED/commit-framework
  - SHARED/verify-framework

# Config inputs this skill accepts from project-level config
config_inputs:
  - key: test.runner
    type: string
    description: "Test runner command"
    default: "pytest"
  - key: test.test_dir
    type: string
    description: "Test directory path"
    default: "tests/"

# Compatibility declarations
targets:
  claude: true       # Compatible with Claude Code
  codex: true        # Compatible with OpenAI Codex
  generic-mcp: true  # Usable via MCP by any client

# Source provenance (set by sync engine, not author)
source:
  type: local         # local | git | registry
  path: ~/.claude/skills/test
  revision: null      # git SHA, tag, or null for local
  fetched_at: "2026-03-06T10:00:00Z"
```

**Author-controlled fields:** `tags`, `category`, `depends`, `config_inputs`, `targets`

**Sync-engine-controlled fields:** `source` (written during install/sync, never hand-edited)

### 1.3 References, Scripts, Assets

These directories follow the Agent Skills convention:

- `references/` — Markdown documentation loaded on demand. Skill instructions
  reference these by relative path (e.g., "See `references/compare.md`").
- `scripts/` — Executable helpers invoked by the skill. SkillSync tracks but does
  not execute these automatically. Trust policy applies.
- `assets/` — Templates, images, data files. Passthrough; not interpreted by
  skillsync.

All paths within a skill package must be relative to the skill root directory.
Absolute paths or paths referencing `~/` are a validation error.

---

## 2. Shared Frameworks

Shared frameworks are skill-like packages that other skills depend on but are not
independently invocable. They follow the same directory layout but use a
conventional `SHARED/` namespace:

```
SHARED/
  commit-framework/
    SKILL.md
  verify-framework/
    SKILL.md
  research-framework/
    SKILL.md
```

Frameworks are resolved through the `depends` field in `skillsync.meta.yaml`.
When a skill declares a dependency on `SHARED/commit-framework`, skillsync
ensures that framework is present in the installed store before the dependent
skill is considered complete.

---

## 3. Project Manifest: skillsync.yaml

Lives at the project root. Declares what the project needs from skillsync.

```yaml
# skillsync.yaml
version: 1

# Where to look for skills, in priority order.
# First match wins when the same skill name appears in multiple sources.
sources:
  - name: personal
    type: local
    path: ~/.claude/skills

  - name: team
    type: git
    url: git@github.com:myorg/team-skills.git
    ref: main

  - name: community
    type: registry
    registry: skills.sh     # future: marketplace integration

# Which skills to install. Names resolve against sources in order.
skills:
  - code
  - test
  - todo
  - SHARED/commit-framework
  - SHARED/verify-framework
  - SHARED/research-framework

# Optional: apply a named profile instead of listing skills individually.
# Profiles are defined in ~/.skillsync/profiles/.
# profile: python-backend

# Where to materialize skills in this project.
# Supports multiple targets for multi-agent setups.
targets:
  claude: .claude/skills       # Claude Code reads from here
  codex: .codex/skills         # OpenAI Codex reads from here
  # generic: .agent/skills     # Generic agent path

# Default install mode for this project.
# Per-skill overrides are possible via the overrides section.
install_mode: mirror   # copy | symlink | mirror

# Project-specific config values injected into skill config_inputs.
# Keys correspond to config_input keys declared in skillsync.meta.yaml.
config:
  test:
    runner: "uv run pytest"
    test_dir: tests/
    coverage_package: mypackage
  code:
    lint: "uv run ruff check ."
    lint_fix: "uv run ruff check --fix ."
    format: "uv run ruff format ."
    typecheck: "uv run ty check"
    verify: "make lint && make typecheck && make test-fast"

# Per-skill overrides
overrides:
  todo:
    install_mode: copy    # Override default for this skill
  # Symlink for active development of a skill:
  # code:
  #   install_mode: symlink
```

### 3.1 Source Resolution

Sources are checked in declared order. The first source containing a requested
skill name wins. This allows personal skills to shadow team skills, and team
skills to shadow community skills.

### 3.2 Target Materialization

Each target entry maps an agent identifier to a local directory path. During
`skillsync sync`, skills are materialized into each configured target directory.
The same skill content is written to all targets; only the destination path
differs.

### 3.3 Config Injection

The `config` section provides values for `config_inputs` declared in each skill's
`skillsync.meta.yaml`. These values are written to a generated
`project-config.yaml` in each target directory, making them available to skills
at runtime without modifying the skill body.

---

## 4. Lock File: skillsync.lock

JSON file at the project root recording the exact installed state.

```json
{
  "version": 1,
  "locked_at": "2026-03-06T10:30:00Z",
  "skills": {
    "code": {
      "source": {
        "name": "personal",
        "type": "local",
        "path": "~/.claude/skills/code",
        "revision": null
      },
      "install_mode": "mirror",
      "files": {
        "SKILL.md": {
          "sha256": "a1b2c3d4...",
          "size": 4210
        },
        "skillsync.meta.yaml": {
          "sha256": "e5f6a7b8...",
          "size": 312
        },
        "references/compare.md": {
          "sha256": "c9d0e1f2...",
          "size": 1832
        }
      }
    },
    "SHARED/commit-framework": {
      "source": {
        "name": "personal",
        "type": "local",
        "path": "~/.claude/skills/SHARED/commit-framework"
      },
      "install_mode": "mirror",
      "files": {
        "SKILL.md": {
          "sha256": "f3a4b5c6...",
          "size": 2100
        }
      }
    }
  }
}
```

**Lock file guarantees:**
- Every file in every installed skill has a SHA256 digest and byte size.
- Source provenance (name, type, path/url, revision) is recorded per skill.
- Install mode is recorded per skill.
- `skillsync check` compares materialized files against lock digests and reports
  drift, missing files, or extra files.
- `skillsync sync` updates the lock file atomically after successful
  materialization.

---

## 5. Profiles

Named skill sets stored at `~/.skillsync/profiles/`:

```yaml
# ~/.skillsync/profiles/python-backend.yaml
name: python-backend
description: Standard skills for Python backend projects
skills:
  - code
  - test
  - todo
  - SHARED/commit-framework
  - SHARED/verify-framework
  - SHARED/research-framework
config:
  code:
    lint: "uv run ruff check ."
    format: "uv run ruff format ."
```

When a project manifest uses `profile: python-backend`, the profile's skills and
config are merged with the manifest's explicit declarations. Explicit manifest
entries take precedence over profile entries.

---

## 6. Directory Layout: Installed Store

After `skillsync sync`, a project's target directory looks like:

```
.claude/skills/               # Target directory (Claude Code)
  code/
    SKILL.md
    skillsync.meta.yaml
    references/
      compare.md
      handoff.md
      shrink.md
      to-spec.md
  test/
    SKILL.md
    skillsync.meta.yaml
    references/
      cleanup.md
      perf.md
  SHARED/
    commit-framework/
      SKILL.md
    verify-framework/
      SKILL.md
  project-config.yaml         # Generated from manifest config section
```

The `project-config.yaml` is generated by skillsync during sync, merging the
manifest's `config` section into a format that skills can read at runtime. It is
**not** committed to the lock file because it is derived from the manifest.

---

## 7. Validation Rules

SkillSync validates installed skills against these rules:

| Rule | Severity | Status | Description |
|------|----------|--------|-------------|
| `skill-md-required` | Error | Enforced | Skill directory must contain SKILL.md |
| `frontmatter-valid` | Error | Enforced | YAML frontmatter parses without error |
| `description-required` | Error | Enforced | Non-empty description in frontmatter |
| `no-absolute-paths` | Error | Enforced | No absolute paths or `~/` in SKILL.md body (via portability checker) |
| `empty-package` | Error | Enforced | Skill package must contain at least one file |
| `name-format` | Error | Planned | Name matches `^[a-z0-9]+(-[a-z0-9]+)*$`, max 64 chars |
| `description-length` | Warning | Planned | Description exceeds 1024 chars |
| `references-exist` | Error | Planned | All referenced files in `references/` exist |
| `scripts-exist` | Warning | Planned | All referenced scripts in `scripts/` exist |
| `depends-resolvable` | Error | At sync | Checked by resolver during sync, not by standalone validation |
| `config-inputs-typed` | Warning | Planned | Config inputs have type and description |
| `no-reserved-names` | Error | Planned | Skill name is not a reserved word |

Additionally, `validateManifest()` enforces:

| Rule | Severity | Description |
|------|----------|-------------|
| `manifest-read-error` | Error | Manifest file must be readable |
| `manifest-parse-error` | Error | Manifest YAML must parse with required fields |
| `no-sources` | Warning | At least one source should be defined |
| `no-skills` | Warning | At least one skill should be listed |
| `no-targets` | Error | At least one target must be defined |
| `non-portable-install-mode` | Warning | Default install mode should be portable (copy or mirror) |

---

## 8. Open Questions (Resolved)

**Q: Should the canonical manifest live inside SKILL.md frontmatter, in a sibling
file, or support both?**

A: Sibling file (`skillsync.meta.yaml`). SKILL.md frontmatter follows the
industry standard and is never modified by skillsync. Sync metadata,
dependencies, and config inputs live in the sidecar.

**Q: How opinionated should the core model be about scripts, assets, and
references versus opaque passthrough?**

A: References are validated (existence checks). Scripts are tracked and subject to
trust policy. Assets are passthrough. This gives meaningful validation without
over-constraining skill authors.
