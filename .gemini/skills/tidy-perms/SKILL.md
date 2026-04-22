---
name: tidy-perms
description: Consolidate accumulated permission grants across Claude Code, Codex, and Gemini — move trusted commands into project settings, clean up garbage entries, verify cross-agent consistency, commit project-level configs.
version: 2.0.0
tools: Bash, Read, Write, Edit
---

# Permissions Consolidation Skill

Triage Claude Code allow lists: move project-safe commands from `settings.local.json` → `settings.json` as wildcards, delete garbage, keep personal entries. Check trust and MCP parity across Claude, Codex, and Gemini.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `consolidate` | (default) | Full triage, rewrite files, cross-agent check, commit |
| `audit` | "audit permissions", "review permissions" | Report categories and cross-agent state, no changes |
| `help` | "help", "list actions" | Print available actions |

---

## Agent Permission Models

| Agent | Config | Permission model | Consolidation |
|-------|--------|-----------------|---------------|
| **Claude Code** | `.claude/settings.json` (project) + `.claude/settings.local.json` (personal, gitignored) | Per-command allowlist: `Bash(cmd:*)`, `mcp__server__tool`, `WebFetch(domain:...)`, `Skill(...)`, `Read(path)` | Full — categorize, wildcard-merge, rewrite |
| **Codex CLI** | `~/.codex/config.toml` (global only) | Sandbox (`read-only`, `workspace-write`, `danger-full-access`) + per-project `trust_level` via `[projects."/path"]` + approval policies (`untrusted`, `on-request`, `never`). **No per-command allowlist.** MCP in `[mcp_servers.*]` | Trust + MCP parity check only |
| **Gemini CLI** | `~/.gemini/settings.json` + `trustedFolders.json` (global only) | Folder trust + approval modes (`default`, `auto_edit`, `yolo`, `plan`) + policy engine (`--policy`). `--allowed-tools` deprecated in favor of policy engine; neither provides persistent per-command allowlist. MCP via `gemini mcp` or project config. | Trust + MCP parity check only |

---

## Consolidate

### Step 1 — Read Claude Code configs

Read `.claude/settings.json` and `.claude/settings.local.json`. If local doesn't exist, note "nothing to consolidate" but continue to cross-agent checks.

### Step 2 — Discover project context

Check these files (if present) to identify project CLIs for settings.json:
- `Makefile` → make targets | `.mcp.json` → `mcp__<name>__*` candidates | `package.json` → npm/npx/node | `pyproject.toml` / `requirements.txt` → uv/python | `CLAUDE.md` → mentioned CLI tools

### Step 2b — Read Codex and Gemini state

- **Codex**: `~/.codex/config.toml` → project trust level, sandbox mode and approval policy if set, `[mcp_servers.*]` entries
- **Gemini**: `~/.gemini/trustedFolders.json` → folder trust, `~/.gemini/settings.json`, project-level `.gemini/settings.json` if present

Record findings for the cross-agent consistency check in Step 8.

### Step 3 — Categorize `settings.local.json` entries

Skip if file doesn't exist. Assign each entry to one category:

**PROJECT-SAFE** → move to `settings.json`
- Git: any `Bash(git ...)` variant
- Runtimes/pkg managers: `uv`, `npm`, `npx`, `node`, `python`, `python3`, `cargo`, `go`, `make` (all `:*`)
- Shell utilities: `ls`, `cat`, `head`, `tail`, `grep`, `find`, `wc`, `echo`, `tree`, `du`, `env`, `printenv`, `test`, `xargs`, `bash`, `tee`, `sed`, `jq`, `curl`, `xxd`, `awk`, `sort`, `uniq`, `diff`, `file`, `which`, `date`, `printf`, `true`, `false`
- `gh:*`, project CLIs from Step 2, MCP tools from `.mcp.json`, `Skill(...)` for skills in `.claude/skills/`
- Build tools: `chmod:*`, `zstd:*`, `textutil:*`, `datafusion-cli:*`

**PERSONAL** → keep in `settings.local.json`
- `WebFetch(domain:...)`, `WebSearch`
- Filesystem mutations: `Bash(rm:*)`, `Bash(cp:*)`, `Bash(mv:*)`
- Package installs: `Bash(pip install:*)`, `Bash(pip3 install:*)`, `Bash(uv pip install:*)`
- AI tools: `Bash(codex:*)`, `Bash(claude:*)`
- Personal paths: `Read(//Users/...`, `Read(//home/...`
- If unclear, ask the user; default to PERSONAL

**GARBAGE** → delete
- Shell fragments: `Bash(for ...)`, `Bash(do)`, `Bash(done)`, `Bash(do ...:*)`, `Bash(if ...)`, `Bash(fi)`
- Commit fragments: entries with `\nCo-Authored-By:`, `EOF`, `\\)\"` mid-string
- Prose/partial sentences, exact duplicates, specifics superseded by existing wildcards

### Step 4 — Consolidate into wildcards

Group PROJECT-SAFE entries into broadest safe pattern:
- Multiple `Bash(git status/log/add ...)` → `Bash(git:*)` if all git ops granted; else individual `Bash(git status:*)` etc.
- Multiple `Bash(git -C /specific/path ...)` → `Bash(git -C:*)`
- `Bash(uv run ...)`, `Bash(uv sync)`, `Bash(uv pip show:*)` → `Bash(uv:*)`
- Multiple `.venv/bin/python` paths → `Bash(python:*)` + `Bash(python3:*)`
- MCP tools → list each explicitly (no wildcard support)
- Don't wildcard beyond what was granted (e.g. no `Bash(git:*)` if `git push` never allowed)

### Step 5 — Merge into `settings.json`

Update `permissions.allow` array. **Preserve all other keys** (hooks, etc.). Deduplicate against existing entries.

### Step 6 — Rewrite `settings.local.json`

Replace with PERSONAL entries only. Verify valid JSON.

### Step 7 — Validate

```bash
jq -e '.permissions.allow | length' .claude/settings.json
jq -e '.permissions.allow | length' .claude/settings.local.json
```

Both must exit 0. Fix any JSON errors before proceeding.

### Step 8 — Cross-agent consistency check

#### 8a — Project trust parity

| Agent | Check | Expected |
|-------|-------|----------|
| Claude | `.claude/settings.json` has `permissions.allow` | Present |
| Codex | `~/.codex/config.toml` → `[projects."{cwd}"]` | `trust_level = "trusted"` |
| Gemini | `~/.gemini/trustedFolders.json` → `"{cwd}"` | `"TRUST_FOLDER"` |

#### 8b — MCP server parity

Compare MCP servers across agents. Filter to servers relevant to this project (commands referencing project virtualenv or paths):
- Claude: `.mcp.json` | Codex: `config.toml [mcp_servers.*]` | Gemini: `gemini mcp list` (skip if CLI absent)

Report servers present in one but missing from another.

#### 8c — Output summary

```markdown
### Cross-Agent Consistency
| Check | Claude | Codex | Gemini | Status |
|-------|--------|-------|--------|--------|
| Project trusted | ✓/✗ | ✓/✗ | ✓/✗ | OK/GAP |
| MCP: {server} | ✓/✗ | ✓/✗ | ✓/✗ | OK/GAP |
```

Command-level allowlist parity is not checked — Codex/Gemini use sandbox/approval models instead.

### Step 9 — Commit

Stage `.claude/settings.json` only (if changed). Never commit: `settings.local.json` (gitignored), `~/.codex/config.toml`, `~/.gemini/*.json` (all personal/global).

```
chore(claude): consolidate permissions into project settings

Add N trusted rules to settings.json: {brief summary}.
Removed ~N entries from settings.local.json (garbage + now-covered).
Cross-agent: {consistency findings}.
```

---

## Audit

Read all config files. Categorize Claude entries. Report cross-agent state. Output tables, no file changes.

```markdown
## Permissions Audit

### Claude Code — settings.local.json
#### PROJECT-SAFE (N) — would move to settings.json
| Entry | Consolidated as |
|-------|----------------|

#### PERSONAL (N) — stays in settings.local.json

#### GARBAGE (N) — would delete
| Entry | Reason |
|-------|--------|

### Claude Code — settings.json
- N rules, {summary of groups}

### Codex
- Trust: {trusted/untrusted/not configured} | Sandbox: {mode} | MCP: {list}

### Gemini
- Trust: {TRUST_FOLDER/not configured} | Approval mode: {mode} | MCP: {list}

### Cross-Agent Consistency
| Check | Claude | Codex | Gemini | Status |
|-------|--------|-------|--------|--------|

### Recommendation
Run `/tidy-perms consolidate` to apply.
```

---

## Help

**Input**: Empty

Print the Actions table from this skill — action names, triggers, and descriptions.

---

## Rules

- Never `git add -A` — stage by explicit path only
- Never commit `settings.local.json`
- Never remove hooks or non-permission keys from `settings.json`
- Never add: `git push --force`, `git reset --hard`, `git clean -f`, `rm -rf` — must keep prompting
- No `settings.local.json` → report and exit (still run cross-agent checks)
- Uncertain category → ask user; default to PERSONAL
- Never modify `~/.codex/config.toml` or `~/.gemini/*.json` — read-only for audit/consistency
