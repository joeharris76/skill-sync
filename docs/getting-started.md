# Getting Started

This guide walks through installing skill-sync, configuring a project, and
syncing skills into your AI agent workflow.

## Prerequisites

- Node.js 20 or later
- A project where you use Claude Code and/or OpenAI Codex
- Skills you want to share (local directories or a git repository)

## Install

```bash
npm install skill-sync
```

This makes the `skill-sync` CLI available via `npx skill-sync` (or directly if
installed globally with `npm install -g skill-sync`).

## Quick Start: The Skill Wrapper

The fastest way to get started is with the bundled **skill-sync skill**. Copy
it into your agent's skill directory and let your agent handle the rest:

```bash
# Copy the skill into your project
mkdir -p .claude/skills/skill-sync
cp node_modules/skill-sync/skills/skill-sync/SKILL.md .claude/skills/skill-sync/
```

Then ask your agent:

> "Set up skill-sync for this project."

The agent will scan your existing skills, generate a `skill-sync.yaml`
manifest, and run the first sync — no manual YAML authoring required.

The skill wrapper exposes all CLI commands as natural language actions:
sync, status, validate, diff, doctor, pin, unpin, prune, and promote.

If you prefer manual setup, continue below.

## Create a Project Manifest

Add a `skill-sync.yaml` file to your project root:

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

This tells skill-sync to pull the `code` and `test` skills from your local
`~/.claude/skills` directory and materialize them into `.claude/skills/` in
your project.

## Sync Skills

**CLI:**
```bash
# Preview what will change
skill-sync sync --dry-run

# Apply the sync
skill-sync sync
```

**Via agent** (with the MCP server configured):

> "Preview what would change if I synced my skills."

> "Sync my skills."

After sync, your project tree looks like:

```
my-project/
  skill-sync.yaml
  skill-sync.lock
  .claude/skills/
    code/
      SKILL.md
      skill.yaml
    test/
      SKILL.md
      skill.yaml
    skill-sync.config.yaml
```

The lock file records exact file checksums and source provenance so future
syncs are deterministic.

## Verify the Install

**CLI:**
```bash
# Check manifest, portability, and installed state
skill-sync validate

# Full health diagnostics
skill-sync doctor
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

Running `skill-sync sync` now materializes the same skills into both
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

skill-sync generates a `skill-sync.config.yaml` in each target directory with
these values merged over skill defaults. Skills read this file at runtime --
no skill files are modified.

## Pin a Skill to a Specific Revision

For git sources, lock a skill to its current commit so future syncs don't
pick up upstream changes:

**CLI:**
```bash
skill-sync pin code
```

**Via agent:**

> "Pin the code skill to the version I have installed right now."

Unpin when you want to receive updates again:

**CLI:**
```bash
skill-sync unpin code
```

**Via agent:**

> "Unpin the code skill so it can receive upstream updates."

## Next Steps

- [Common Usage](usage.md) -- real-world examples with Claude Code and Codex
- [CLI Reference](cli.md) -- full command documentation
- [MCP Server](mcp.md) -- expose skills to MCP-aware agents
- [Sync Model](sync-model.md) -- how plan-then-apply works
- [Security](security.md) -- trust policies and validation
