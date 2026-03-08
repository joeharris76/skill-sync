# Getting Started

This guide walks through installing skillsync, configuring a project, and
syncing skills into your AI agent workflow.

## Prerequisites

- Node.js 20 or later
- A project where you use Claude Code and/or OpenAI Codex
- Skills you want to share (local directories or a git repository)

## Install

```bash
npm install skillsync
```

This makes the `skillsync` CLI available via `npx skillsync` (or directly if
installed globally with `npm install -g skillsync`).

## Create a Project Manifest

Add a `skillsync.yaml` file to your project root:

```yaml
version: 1

sources:
  - name: personal
    type: local
    path: ~/.claude/skills

skills:
  - code
  - test

targets:
  claude: .claude/skills

install_mode: mirror
```

This tells skillsync to pull the `code` and `test` skills from your local
`~/.claude/skills` directory and materialize them into `.claude/skills/` in
your project.

## Sync Skills

**CLI:**
```bash
# Preview what will change
skillsync sync --dry-run

# Apply the sync
skillsync sync
```

**Via agent** (with the MCP server configured):

> "Preview what would change if I synced my skills."

> "Sync my skills."

After sync, your project tree looks like:

```
my-project/
  skillsync.yaml
  skillsync.lock
  .claude/skills/
    code/
      SKILL.md
      skill.yaml
    test/
      SKILL.md
      skill.yaml
    skillsync.config.yaml
```

The lock file records exact file checksums and source provenance so future
syncs are deterministic.

## Verify the Install

**CLI:**
```bash
# Check manifest, portability, and installed state
skillsync validate

# Full health diagnostics
skillsync doctor
```

**Via agent** (when the MCP server is configured, ask your agent directly):

> "Validate my installed skills and report any issues."

> "Run a full health check on my skills setup."

> "Are any of my skills out of sync or missing files?"

See [MCP Server](mcp.md) for setup instructions.

## Multi-Target Setup (Claude Code + Codex)

To materialize skills for both Claude Code and OpenAI Codex, add multiple
targets:

```yaml
version: 1

sources:
  - name: team
    type: git
    url: git@github.com:myorg/team-skills.git
    ref: main

skills:
  - code
  - test
  - todo
  - SHARED/commit-framework

targets:
  claude: .claude/skills
  codex: .codex/skills

install_mode: mirror
```

Running `skillsync sync` now materializes the same skills into both
`.claude/skills/` and `.codex/skills/`. Each agent reads from its own
directory.

## Add Project-Specific Config

Skills can declare configuration inputs (test runner, lint command, etc.)
that your project overrides without forking the skill:

```yaml
version: 1

sources:
  - name: personal
    type: local
    path: ~/.claude/skills

skills:
  - code
  - test

targets:
  claude: .claude/skills

install_mode: mirror

config:
  test:
    runner: "npm test"
    test_dir: tests/
  code:
    lint: "npx eslint ."
    format: "npx prettier --write ."
```

Skillsync generates a `skillsync.config.yaml` in each target directory with
these values merged over skill defaults. Skills read this file at runtime --
no skill files are modified.

## Pin a Skill to a Specific Revision

For git sources, lock a skill to its current commit so future syncs don't
pick up upstream changes:

**CLI:**
```bash
skillsync pin code
```

**Via agent:**

> "Pin the code skill to the version I have installed right now."

Unpin when you want to receive updates again:

**CLI:**
```bash
skillsync unpin code
```

**Via agent:**

> "Unpin the code skill so it can receive upstream updates."

## Next Steps

- [Common Usage](usage.md) -- real-world examples with Claude Code and Codex
- [CLI Reference](cli.md) -- full command documentation
- [MCP Server](mcp.md) -- expose skills to MCP-aware agents
- [Sync Model](sync-model.md) -- how plan-then-apply works
- [Security](security.md) -- trust policies and validation
