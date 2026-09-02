# Common Usage

Practical examples of using skill-sync with Claude Code and the interoperable
`.agents/skills` mirror (Codex, Gemini, Antigravity) in day-to-day workflows.

## Claude Code

### Setting Up a Project

The quickest path is the [skill wrapper](getting-started.md#quick-start-the-skill-wrapper) —
copy `skills/skill-sync/SKILL.md` into `.claude/skills/skill-sync/` and ask
your agent to "set up skill-sync." It will generate the manifest below
automatically.

For manual setup, create `skill-sync.yaml` at your project root:

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
skill-sync sync
skill-sync status
```

**Via agent** (with the MCP server configured):

> "What skills do I have installed?"

> "Are any of my skills out of sync?"

Claude Code automatically discovers skills from `.claude/skills/` -- no
additional configuration required.

### Using the MCP Server with Claude Code

The skill-sync MCP server gives Claude the same capabilities as the CLI —
syncing, validating, pinning, pruning, and discovering skills — without
leaving the conversation. Add it to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "skill-sync": {
      "command": "node",
      "args": ["node_modules/skill-sync/dist/mcp/index.js", "."]
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
skill-sync status
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
skill-sync diff
```

**Via agent:**

> "What would change if I synced my skills right now?"

To sync and overwrite local changes, or promote them back to the source:

**CLI:**
```bash
skill-sync sync --force
skill-sync promote
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
    npx skill-sync validate --exit-code
    npx skill-sync status --json
```

Use `mirror` install mode (the default) for CI -- `symlink` mode is not
portable across machines.

The same checks are available via agent prompts for MCP-integrated pipelines:

> "Validate all installed skills and tell me if anything fails."

> "Check whether any skills have portability issues or compatibility warnings."

---

## Codex / Gemini / Antigravity (interoperable mirror)

### Setting Up a Project

Codex, Gemini CLI, and Antigravity all discover skills from the single
interoperable workspace root `.agents/skills/`. Configure skill-sync to target
that directory (via symlink or workspace mapping each runtime resolves it):

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

targets:
  agents: .agents/skills

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
skill-sync sync
```

**Via agent** (with the MCP server configured):

> "Sync my skills."

> "What skills do I have installed?"

After sync, Codex discovers skills in `.agents/skills/` following its
standard `AGENTS.md` discovery mechanism, and Gemini/Antigravity resolve the
same directory via their workspace mapping. Legacy paths `.codex/skills` and
`.gemini/skills` are still recognized for backward compatibility but are
superseded by the single `agents: .agents/skills` mirror — use `.agents/skills`
instead of maintaining three separate copies.

### Dual-Agent Setup (Claude Code + Agents)

For projects where team members use different agents, target both the tracked
Claude snapshot and the untracked interoperable mirror:

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
  claude:
    dir: .claude/skills
    tracked: true
  agents: .agents/skills

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

Running `skill-sync sync` materializes skills into both directories. The same
skill content is written to both targets -- only the destination path differs.
`claude` is the tracked snapshot (bare object form with `tracked: true`);
`agents` is the untracked bare-string mirror (gitignored) shared by
Codex/Gemini/Antigravity.

Check compatibility for both targets:

**CLI:**
```bash
skill-sync validate
```

**Via agent:**

> "Validate my skills and check for any compatibility issues between Claude and Codex."

If a skill uses features one target doesn't support (e.g., `allowed-tools`
in Claude Code that Codex ignores), skill-sync reports a diagnostic warning
but still materializes the skill. Legacy `codex: .codex/skills` and
`gemini: .gemini/skills` entries remain valid but now map to the same
`.agents/skills` interoperable root.

---

## Gemini CLI (via .agents/skills)

### Setting Up a Project

Gemini CLI now discovers skills from the shared `.agents/skills/` mirror
(same directory Codex and Antigravity use). Configure skill-sync with the
canonical `agents` target:

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
  agents: .agents/skills

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
skill-sync sync
```

**Via agent** (with the MCP server configured):

> "Sync my skills."

> "What skills do I have installed?"

Gemini CLI reads skills from `.agents/skills/` (legacy `.gemini/skills/` is
still recognized but superseded) and uses a `GEMINI.md` file at the project
root (or `.gemini/GEMINI.md`) for project-level instructions. Use
`skill-sync status` to check whether your `GEMINI.md` is present and whether
it duplicates your global `~/.gemini/GEMINI.md`.

Gemini CLI scans only one skill-directory level. Do not send namespaced skills
such as `SHARED/commit-framework` to an `agents` target; validation reports these
undiscoverable paths as errors (same shallow-discovery constraint that applied
to the legacy `gemini: .gemini/skills` target).

### Multi-Agent Setup (Claude Code + Agents)

To support Claude Code alongside the shared Codex/Gemini/Antigravity mirror
from a single manifest:

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

targets:
  claude:
    dir: .claude/skills
    tracked: true
  agents: .agents/skills

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

Running `skill-sync sync` materializes the same skill content into the
tracked Claude snapshot and the untracked `.agents/skills` mirror. Validate
across both targets:

```bash
skill-sync validate
```

Skills that use `allowed-tools` (a Claude Code feature) will produce a
diagnostic warning for the `agents` target but still be materialized.
Namespaced skills are different: the interoperable `agents` target enforces
the same 1-level discovery as the legacy Gemini path, so validation reports an
error for `SHARED/*` skills. Legacy `codex: .codex/skills` and
`gemini: .gemini/skills` entries remain accepted and internally resolve to the
same strict profile as `agents: .agents/skills`.

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
    subdir: skills  # optional repository-relative package root
```

`subdir` is optional. Use it when skill directories live below the repository
root. Absolute paths, backslashes, and `..` traversal segments are rejected;
the normalized subdirectory is recorded in lock-file provenance.

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
skill-sync sync

# Work: modify a skill locally if needed
# ...edit .claude/skills/code/SKILL.md...

# Check: see what drifted
skill-sync status

# Validate: ensure portability
skill-sync validate

# Lock: freeze a skill before a release
skill-sync pin code

# Clean up: remove skills dropped from manifest
skill-sync prune --dry-run
skill-sync prune
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
skill-sync status --json | jq '.targets[] | {target, readiness}'
skill-sync status --json | jq '.targets[].skills[] | select(.state != "clean")'
```

`status` and `doctor` deliberately report three independent readiness
dimensions. A clean tracked snapshot proves committed bytes match policy; it
does not prove every untracked local mirror is materialized. Likewise,
`verify` remains the offline committed-snapshot gate and does not claim
whole-project local readiness.

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
