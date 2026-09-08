# Migrating from the TypeScript implementation

v1.0.0 replaces the TypeScript/Node CLI with a POSIX shell wrapper around `git`
and `rsync`. The old implementation is preserved at the tag
`archive/typescript-v0.1.0` — see [ARCHIVE.md](ARCHIVE.md).

Nothing migrates itself. Unsupported commands fail with a pointer here rather
than appearing to succeed.

## Commands

| Old | New | Notes |
|---|---|---|
| `skill-sync sync` | `skill-sync apply` | No `--force`. Refusals are resolved, not overridden. |
| `skill-sync sync --dry-run`, `diff` | `skill-sync preview` | |
| `skill-sync status` | `skill-sync preview` | Reports pending changes rather than installed state. |
| `skill-sync validate` | `skill-sync preview` | A malformed config is a hard error on every command. |
| `skill-sync verify` | **Not replaced.** | See "Retired without a replacement". |
| `skill-sync doctor` | `skill-sync preview` | |
| `skill-sync pin`, `unpin` | Edit `rev` in `skill-sync.conf` | Every source is pinned by construction. |
| `skill-sync prune` | Remove the `skill` line, then `apply` | The receipt proves ownership before deletion. |
| `skill-sync promote` | `git commit` and `git push` in the catalog checkout | |
| `skill-sync settings generate` | Maintain `<target>/skill-sync.config.yaml` by hand | |
| `skill-sync align-agents` | **Not replaced.** | |
| `skill-sync agent-config …` | **Not replaced.** | |
| MCP server (`skill-sync/mcp`) | **Not replaced.** | Agents run the CLI. |
| `import { … } from "skill-sync/core"` | **Not replaced.** | There is no library surface. |

New: `skill-sync check` prints the `preview` report and exits 3 when a sync is
pending. It needs the catalog checkout, so it is a local pre-commit check, not a
CI job on a machine without the catalog.

## Manifest

`skill-sync.yaml` and `skill-sync.lock` are replaced by `skill-sync.conf`.
Delete both once the project is migrated; the new CLI ignores them.

| `skill-sync.yaml` | `skill-sync.conf` |
|---|---|
| `sources[].type: git` + `url` + `ref` | `source = <local checkout>` + `rev = <commit>` — clone the catalog once, locally; skill-sync never fetches. |
| `sources[].type: local` + `path` | `source = .` + `dir = <path>` |
| `sources[].subdir` | `dir` |
| `skills:` | one `skill = <name>` line per skill, inside the group that provides it |
| `overrides.<skill>.source_name` | Put the `skill` line in that source's group. Each skill may appear once. |
| `targets.<key>.dir` | `target = <dir>` |
| `targets.<key>.tracked` | Drop it. Commit a target or gitignore it; Git decides. |
| `targets.<key>.ignore` | A `.gitignore` entry in the project. |
| `install_mode: mirror` / `copy` | The only mode. Payloads are always real files. |
| `install_mode: symlink` | Removed. Symlinked package content is rejected. |
| `config:` | Move the values into `<target>/skill-sync.config.yaml` and maintain them by hand. skill-sync no longer generates that file, and no longer overwrites it. |
| `projects:` | Removed. Run `skill-sync apply -C <project>` per project. |
| `skill-sync.lock` | Replaced by `<target>/skill-sync.receipt`, which records repository identity, commit, and selection — but no file hashes. |

Skill names must now be a single path segment: the old nested form
`SHARED/change-framework` is `shared-change-framework`.

## Retired without a replacement

Per capability, what is gone and what stands in its place:

- **`verify` — offline snapshot integrity.** The old gate re-hashed every
  committed file against the lock and byte-compared the generated config, with
  no access to the source. The receipt does not do this: it records what was
  copied, not that the files still match. The standing controls are review of
  the payload's Git diff in the pull request, and `skill-sync check` on a
  machine that has the catalog. A project that needs a hash-based gate in CI
  should keep pinning the archived implementation until it has one.
- **`align-agents` and `agent-config`.** Harness version checks and global
  instruction capture/restore were never about distributing skills. Nothing here
  replaces them; the archived implementation still performs them.
- **MCP server and the `skill-sync/core` library.** Both are gone. Agents drive
  the CLI, whose output is line-oriented and stable.
- **`.gitignore` management.** The old tool wrote and maintained a
  `# >>> skill-sync managed` block. Maintain those entries by hand.
- **npm packaging.** There is no `package.json`, no `dist/`, and no `bin` entry
  to install from a registry. Copy `bin/skill-sync` onto `PATH`, or vendor it.

## Environment support

The old implementation ran anywhere Node 20+ ran, and its CI covered Ubuntu and
Windows. The new one needs `rsync` and a POSIX shell, so **native Windows is no
longer supported**; use WSL, or any environment providing `rsync`. CI now runs
the suite on Ubuntu (GNU rsync) and macOS (Apple's `openrsync`) instead of
Ubuntu and Windows. That is a deliberate reduction in coverage, not parity.

## Consumers not migrated by this change

None of the projects below were touched. Each keeps working against the archived
implementation, which they already pin. Bump a project's `product` source ref to
v1.0.0 only in the same change that migrates its tooling — otherwise it installs
an operator skill describing a CLI it does not have.

### BenchBox (`~/Developer/BenchBox`)

| Current | Proposed |
|---|---|
| `skill-sync.yaml` (3 git sources: catalog, todo-db, product) + `skill-sync.lock` | `skill-sync.conf` with three `source` groups pointing at local checkouts of each repository |
| `targets.claude.ignore: [blog]` | `.gitignore` entry for `.claude/skills/blog/` |
| `config.code.*`, `config.test.*` in the manifest | Move verbatim into `.claude/skills/skill-sync.config.yaml` and `.agents/skills/skill-sync.config.yaml` |
| `Makefile: node $(SKILL_SYNC) sync` | `skill-sync apply` (repoint `SKILL_SYNC` at `bin/skill-sync`) |
| `Makefile: node $(SKILL_SYNC) doctor` (`skill-sync-check`) | `skill-sync check` |
| `Makefile: skill-integrity-check` — clones a pinned verifier, `npm ci && npm run build`, runs `verify --project` under an empty `HOME` | No equivalent. Either keep pinning `archive/typescript-v0.1.0` for this job, or drop the job and rely on PR review of the payload diff plus `scripts/check_untracked_skill_mirrors.sh`. This is the one capability whose loss is material to BenchBox. |
| `scripts/skill_sync_ci_policy.py` (`validate --manifest`, `VERIFIER_REF`) | Rework or retire alongside the job above |

### todo-db (`~/Developer/todo-db`)

| Current | Proposed |
|---|---|
| `skill-sync.yaml`: `project` (local `skills`), `product`, `catalog` sources | `skill-sync.conf`: `source = .` with `dir = skills` for `todo-db`, plus one group per remote checkout |
| Three tracked targets (`.claude`, `.codex`, `.gemini`) | Three `target` lines; drop `tracked:` and commit them as usual |

### Oxbow (`~/Developer/Oxbow`)

| Current | Proposed |
|---|---|
| `skills: SHARED/change-framework`, `SHARED/investigation-framework`, `SHARED/review-protocol` | `shared-change-framework`, `shared-investigation-framework`, `shared-review-protocol` |
| `targets` as bare strings, untracked | `target` lines; gitignore them if they should stay untracked |
| `config.code.*`, `config.todo.cli` | Move into each target's `skill-sync.config.yaml` |

### Global agent directories

`~/.claude/skills` and `~/.codex/skills` are symlinks into
`~/.skill-sync-deployment/releases/<sha>/store/skills`, produced by the archived
implementation; `~/.agents/skills` holds plain directories. This change does not
repoint any loader or touch the deployment store. Migrating them means treating
a home directory as an ordinary project with its own `skill-sync.conf` and real
directories instead of a release-store symlink — deliberately, in its own
change, since a broken symlink there disables skills for every agent at once.
