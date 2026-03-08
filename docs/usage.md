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

**CLI:**
```bash
skillsync sync
skillsync status
```

**Via agent** (with the MCP server configured):

> "What skills do I have installed?"

> "Are any of my skills out of sync?"

Claude Code automatically discovers skills from `.claude/skills/` -- no
additional configuration required.

### Using the MCP Server with Claude Code

The skillsync MCP server gives Claude the same capabilities as the CLI —
syncing, validating, pinning, pruning, and discovering skills — without
leaving the conversation. Add it to your Claude Code MCP configuration:

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

Once configured, ask your agent directly:

> "What skills do I have installed?"

> "Find skills related to testing."

> "Show me the instructions for the code skill."

> "Are any of my skills out of sync or have portability issues?"

> "Use the commit skill to help me write this commit message."

### Checking Drift After Editing Skills

If you modify an installed skill locally (e.g., tweaking instructions), check
what changed:

**CLI:**
```bash
skillsync status
```

```
Target: claude (.claude/skills)
  code         modified (SKILL.md changed)
  test         clean
  docs         clean
```

**Via agent** (with the MCP server configured):

> "Which of my skills have been modified locally?"

> "Show me the drift status for all my installed skills."

To preview what sync would overwrite:

**CLI:**
```bash
skillsync diff
```

**Via agent:**

> "What would change if I synced my skills right now?"

To sync and overwrite local changes, or promote them back to the source:

**CLI:**
```bash
skillsync sync --force
skillsync promote
```

**Via agent:**

> "Sync my skills and overwrite any local modifications."

> "How do I promote my local changes to the code skill back upstream?"

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

The same checks are available via agent prompts for MCP-integrated pipelines:

> "Validate all installed skills and tell me if anything fails."

> "Check whether any skills have portability issues or compatibility warnings."

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

**CLI:**
```bash
skillsync sync
```

**Via agent** (with the MCP server configured):

> "Sync my skills."

> "What skills do I have installed?"

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

**CLI:**
```bash
skillsync validate
```

**Via agent:**

> "Validate my skills and check for any compatibility issues between Claude and Codex."

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
    skill.yaml
    references/
      compare.md
  test/
    SKILL.md
    skill.yaml
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

**CLI:**
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

**Via agent:**

> "Sync my skills to pick up the latest changes."

> "Which of my skills have drifted from their source?"

> "Do any of my installed skills have portability or compatibility problems?"

> "Pin the code skill to the version I have now."

> "Remove any skills that aren't in my manifest anymore."

> "Find me a skill that helps with code review."

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
