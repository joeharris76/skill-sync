---
name: tidy-perms
description: Consolidate accumulated Claude Code permission grants — move trusted commands from settings.local.json into wildcard rules in settings.json, clean up garbage entries, commit project-level settings.
version: 1.0.0
tools: Bash, Read, Write, Edit
---

# Permissions Consolidation Skill

Triage the allow lists in `.claude/settings.json` and `.claude/settings.local.json`.
Move trusted, team-relevant commands into `settings.json` as clean wildcard rules.
Strip `settings.local.json` to personal-only entries. Delete garbage.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `consolidate` | (default) | Full triage, rewrite both files, commit |
| `audit` | "audit permissions", "review permissions" | Report categories without making changes |

---

## Consolidate

### Step 1 — Read both files in full

```
.claude/settings.json
.claude/settings.local.json
```

If `settings.local.json` does not exist, report "nothing to consolidate" and exit.

### Step 2 — Discover project context

To know which project CLIs belong in settings.json:
- Read `Makefile` (if present) — note make targets used as commands
- Read `.mcp.json` (if present) — extract all server names as `mcp__<name>__*` candidates
- Read `package.json` (if present) — note scripts and detect npm/npx/node usage
- Read `pyproject.toml` or `requirements.txt` (if present) — detect uv/python usage
- Read `CLAUDE.md` — note any CLI tools mentioned

### Step 3 — Categorize every entry in `settings.local.json`

Assign each entry to exactly one category:

**PROJECT-SAFE** → move to `settings.json`
- Git operations: any `Bash(git ...)` variant
- Language runtimes and package managers: `uv:*`, `npm:*`, `npx:*`, `node:*`, `python:*`, `python3:*`, `cargo:*`, `go:*`, `make:*`
- Shell utilities: `ls`, `cat`, `head`, `tail`, `grep`, `find`, `wc`, `echo`, `tree`, `du`, `env`, `printenv`, `test`, `xargs`, `bash`, `tee`, `sed`, `jq`, `curl`, `xxd`, `awk`, `sort`, `uniq`, `diff`, `file`, `which`, `date`, `printf`, `true`, `false`
- GitHub CLI: `gh:*`
- Project-specific CLIs detected in Step 2
- MCP tools found in `.mcp.json` (`mcp__<server>__<tool>`)
- `Skill(...)` entries for skills present in `.claude/skills/`
- `chmod:*`, `zstd:*`, `textutil:*`, `datafusion-cli:*` and other project build tools

**PERSONAL** → keep in `settings.local.json`
- `WebFetch(domain:...)` — all of them
- `WebSearch`
- `Bash(rm:*)`, `Bash(cp:*)`, `Bash(mv:*)` — filesystem mutations
- `Bash(pip install:*)`, `Bash(pip3 install:*)`, `Bash(uv pip install:*)` — package installs
- `Bash(codex:*)`, `Bash(claude:*)` — personal AI tools
- `Read(//Users/...` or `Read(//home/...` — personal directory read access
- Any tool the user has kept explicitly personal (ask if unclear)

**GARBAGE** → delete entirely
- Shell loop fragments saved as permissions: `Bash(for ...)`, `Bash(do)`, `Bash(done)`, `Bash(do ...:*)`, `Bash(if ...)`, `Bash(fi)`
- Commit message fragments: entries containing `\nCo-Authored-By:`, `EOF`, or `\\)\"` mid-string
- Entries that are clearly prose or partial sentences (e.g. `Bash(of slowing\"...)`)
- Entries that are exact duplicates of another entry in either file
- One-time-use specific commands now superseded by a wildcard (e.g. a specific `git log --oneline -5` once `git log:*` is present)

### Step 4 — Consolidate PROJECT-SAFE rules

Group PROJECT-SAFE entries into wildcard rules. Prefer the broadest safe pattern:
- Many `Bash(git status ...)`, `Bash(git log ...)`, `Bash(git add ...)` → one `Bash(git:*)` if all git operations were granted; otherwise individual `Bash(git status:*)` etc.
- Many `Bash(git -C /specific/path ...)` → `Bash(git -C:*)`
- `Bash(uv run ...)`, `Bash(uv sync)`, `Bash(uv pip show:*)` → `Bash(uv:*)`
- Multiple specific `.venv/bin/python` paths → `Bash(python:*)` + `Bash(python3:*)`
- All `mcp__benchbox__*` tools → list each explicitly (MCP tools don't support wildcards)

Do not consolidate into a wildcard if doing so would cover operations that were never granted (e.g. don't use `Bash(git:*)` if `git push` was never in the allow list).

### Step 5 — Merge into `settings.json`

Add or update the `permissions.allow` array in `settings.json`. **Preserve all existing keys** (hooks, other settings). Never replace the whole file.

```json
{
  "permissions": {
    "allow": [
      // consolidated PROJECT-SAFE rules
    ]
  },
  "hooks": { ... }  // unchanged
}
```

If `permissions.allow` already exists in `settings.json`, merge — deduplicate against existing entries.

### Step 6 — Rewrite `settings.local.json`

Replace the file with only PERSONAL entries, cleanly formatted. Verify it is valid JSON.

### Step 7 — Validate

```bash
jq -e '.permissions.allow | length' .claude/settings.json
jq -e '.permissions.allow | length' .claude/settings.local.json
```

Both must exit 0. Fix any JSON errors before proceeding.

### Step 8 — Commit `settings.json` only

`settings.local.json` is gitignored — never stage it.

Commit message format:
```
chore(claude): consolidate permissions into project settings

Add N trusted rules to settings.json: {brief summary of rule groups}.
Removed ~N entries from settings.local.json (garbage + now-covered rules).
```

---

## Audit

Read both files. Categorize every entry (PROJECT-SAFE / PERSONAL / GARBAGE).
Output a table — do not write any files.

```markdown
## Permissions Audit

### PROJECT-SAFE (N) — would move to settings.json
| Entry | Consolidated as |
|-------|----------------|
| ...   | ...             |

### PERSONAL (N) — stays in settings.local.json
- ...

### GARBAGE (N) — would delete
| Entry | Reason |
|-------|--------|
| ...   | ...    |

### Recommendation
Run `/permissions consolidate` to apply.
```

---

## Rules

- Never use `git add -A` — stage `settings.json` by explicit path only
- Never commit `settings.local.json`
- Never remove hooks or non-permission keys from `settings.json`
- Do not add rules for: `git push --force`, `git reset --hard`, `git clean -f`, `rm -rf` — these should keep prompting
- If `settings.local.json` does not exist or has no allow list, report and exit cleanly
- If unsure whether an entry is PERSONAL or PROJECT-SAFE, keep it in PERSONAL
