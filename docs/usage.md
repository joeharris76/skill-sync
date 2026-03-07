# Common Usage

Practical examples of using skillsync with Claude Code and OpenAI Codex in
day-to-day workflows.

## Claude Code

### Setting Up a Project

Create `skillsync.yaml` at your project root:

```yaml
version: 1

sources:
  - name: personal
    type: local
    path: ~/.claude/skills

skills:
  - code
  - test
  - docs
  - todo
  - SHARED/commit-framework
  - SHARED/verify-framework

targets:
  claude: .claude/skills

install_mode: mirror

config:
  test:
    runner: "npm test"
    test_dir: tests/
  code:
    lint: "npx eslint ."
    typecheck: "npx tsc --noEmit"
    verify: "npm run lint && npm run typecheck && npm test"
```

Sync and verify:

```bash
skillsync sync
skillsync status
```

Claude Code automatically discovers skills from `.claude/skills/` -- no
additional configuration required.

### Using the MCP Server with Claude Code

The skillsync MCP server lets Claude discover and inspect skills
programmatically. Add it to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "skillsync": {
      "command": "node",
      "args": ["node_modules/skillsync/dist/mcp/index.js", "."]
    }
  }
}
```

This exposes:

| Surface | Example | Description |
|---------|---------|-------------|
| Resource | `skill://list` | List all installed skills |
| Resource | `skill://code` | Read a skill's SKILL.md |
| Tool | `search-skills` | Search skills by keyword |
| Tool | `skill-status` | Check install health and drift |
| Prompt | `use-skill` | Load a skill's instructions |

### Checking Drift After Editing Skills

If you modify an installed skill locally (e.g., tweaking instructions), check
what changed:

```bash
skillsync status
```

```
Target: claude (.claude/skills)
  code         modified (SKILL.md changed)
  test         clean
  docs         clean
```

To preview what sync would overwrite:

```bash
skillsync diff
```

To promote your local changes back to the shared source:

```bash
skillsync promote
```

This displays step-by-step guidance for the manual promotion workflow.

### CI Integration

In CI, ensure skills are portable and intact:

```yaml
# .github/workflows/check.yml
- name: Validate skills
  run: |
    npx skillsync validate --exit-code
    npx skillsync status --json
```

Use `mirror` install mode (the default) for CI -- `symlink` mode is not
portable across machines.

---

## OpenAI Codex

### Setting Up a Project

Codex reads skills from `.codex/skills/`. Configure skillsync to target
that directory:

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
  - SHARED/commit-framework

targets:
  codex: .codex/skills

install_mode: mirror

config:
  test:
    runner: "pytest"
    test_dir: tests/
  code:
    lint: "ruff check ."
    format: "ruff format ."
```

```bash
skillsync sync
```

After sync, Codex discovers skills in `.codex/skills/` following its
standard AGENTS.md discovery mechanism.

### Dual-Agent Setup (Claude Code + Codex)

For projects where team members use different agents, target both:

```yaml
version: 1

sources:
  - name: team
    type: git
    url: git@github.com:myorg/team-skills.git
    ref: main

  - name: personal
    type: local
    path: ~/.claude/skills

skills:
  - code
  - test
  - todo
  - SHARED/commit-framework
  - SHARED/verify-framework

targets:
  claude: .claude/skills
  codex: .codex/skills

install_mode: mirror

config:
  test:
    runner: "uv run pytest"
    test_dir: tests/
  code:
    lint: "uv run ruff check ."
    format: "uv run ruff format ."
    typecheck: "uv run ty check"
```

Running `skillsync sync` materializes skills into both directories. The same
skill content is written to both targets -- only the destination path differs.

Check compatibility for both targets:

```bash
skillsync validate
```

If a skill uses features one target doesn't support (e.g., `allowed-tools`
in Claude Code that Codex ignores), skillsync reports a diagnostic warning
but still materializes the skill.

---

## Shared Team Skills via Git

### Repository Layout

A team skills repository follows the standard skill package layout:

```
team-skills/
  code/
    SKILL.md
    skillsync.meta.yaml
    references/
      compare.md
  test/
    SKILL.md
    skillsync.meta.yaml
  SHARED/
    commit-framework/
      SKILL.md
    verify-framework/
      SKILL.md
```

Each directory is a self-contained skill package with at least a `SKILL.md`.

### Consuming Team Skills

Reference the repository as a git source in your project manifest:

```yaml
sources:
  - name: team
    type: git
    url: git@github.com:myorg/team-skills.git
    ref: main
```

### Source Priority

When the same skill name exists in multiple sources, the first match wins.
Put personal sources first to shadow team skills during development:

```yaml
sources:
  - name: personal      # Checked first
    type: local
    path: ~/.claude/skills

  - name: team           # Fallback
    type: git
    url: git@github.com:myorg/team-skills.git
    ref: main
```

This lets you iterate on a skill locally, then promote changes back to the
team repo when ready.

---

## Managing Skill Lifecycle

### Day-to-Day Workflow

```bash
# Morning: pull latest team skills
skillsync sync

# Work: modify a skill locally if needed
# ...edit .claude/skills/code/SKILL.md...

# Check: see what drifted
skillsync status

# Validate: ensure portability
skillsync validate

# Lock: freeze a skill before a release
skillsync pin code

# Clean up: remove skills dropped from manifest
skillsync prune --dry-run
skillsync prune
```

### JSON Output for Scripting

All commands support `--json` for machine-readable output:

```bash
skillsync status --json | jq '.targets.claude.skills[] | select(.state != "clean")'
```

### Per-Skill Install Mode Overrides

Use symlink mode for skills under active development, mirror for everything
else:

```yaml
install_mode: mirror

overrides:
  code:
    install_mode: symlink   # Edit in source, see changes immediately
```

Note: symlink mode is not portable -- don't commit symlinked skills to a
shared repository or use them in CI.
