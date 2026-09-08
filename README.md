# skill-sync

Copy selected skill packages from Git-managed catalogs into a project, as
ordinary committable files.

rsync copies the payload; Git supplies history, review, and rollback. There is
no registry, resolver, lockfile, dependency solver, or daemon — the config names
every skill and the exact commit it comes from, and the result is a Git diff you
review like any other change.

## Requirements

- POSIX `sh`, `git`, `rsync`, `tar`, `awk`, `sed`, `find`.
- A local checkout of each catalog you sync from. skill-sync never fetches.

Supported and tested on macOS (Apple's `openrsync`, rsync 2.6.9 compatible) and
Linux (GNU rsync); CI runs the suite on both. Windows is not supported natively:
run it under WSL, or in any environment that provides `rsync` and a POSIX shell.

## Install

`bin/skill-sync` is a single self-contained script. Copy it onto `PATH`, or call
it by path:

```bash
install -m 0755 bin/skill-sync /usr/local/bin/skill-sync
```

## Configure

Create `skill-sync.conf` at the project root:

```
# Every target receives the same selection.
target = .claude/skills
target = .agents/skills

source = ~/Developer/skill-sync-skills
rev    = d22ea7fab6b7b9608e54a3910ab4dfa9bb407d42
dir    = skills
skill  = code
skill  = test
skill  = shared-review-protocol

# A second group: skills this project authors itself.
source = .
rev    = HEAD
skill  = my-project-skill
```

| Key | Meaning |
|---|---|
| `target` | Project-relative directory that receives the skills. Must precede the first `source`. |
| `source` | Path to a local Git checkout. `~` expands; relative paths resolve against the project root. |
| `rev` | Required. Any commit-ish present in that checkout. |
| `dir` | Subdirectory holding skill packages. Default `skills`. |
| `skill` | One skill package. Each skill may appear once in the whole file. |

There is no dependency resolution: list shared prerequisites explicitly.

## Use

```bash
skill-sync preview   # what would change; touches nothing
skill-sync check     # same report, exit 3 if changes are pending
skill-sync apply     # copy the payload, then review and commit the diff
skill-sync verify    # offline gate: is the committed payload what was written?
```

All four accept `-C DIR` (project root, default `.`) and `-f FILE` (config file,
default `PROJECT/skill-sync.conf`).

`preview`, `check`, and `apply` need the catalog checkout. `verify` does not: it
reads only what is committed in the project, so it runs in CI with no catalog,
no network, and no rsync.

`preview` output is one line per changed path:

```
A .claude/skills/code/references/analysis.md
M .claude/skills/code/SKILL.md
D .claude/skills/code/references/retired.md
R .claude/skills/blog
```

`R` marks a skill directory that the receipt records but the config no longer
selects; `apply` removes it.

## What it guarantees

- **Bytes match the recorded commit.** Payloads come from `git archive` of the
  resolved commit, so a modified or untracked catalog working tree is never
  labelled with a clean commit SHA, and the catalog's `.git` is never copied.
- **Real files.** Symlinked or special package content is rejected rather than
  copied, so a fresh clone works without the catalog or your home directory.
- **It stays inside the project.** Every path component of every destination is
  checked before anything is read or written. A target reached through a
  symlinked ancestor is rejected, so `--delete` can never run outside the
  project.
- **Scoped deletion.** `--delete` runs against one skill directory at a time.
  Project-owned skills, `skill-sync.config.yaml`, and loader-owned `.system/`
  are never in range.
- **Idempotence.** Re-applying the same revision and selection produces no Git
  diff. The receipt carries no timestamp.
- **No surprise overwrites.** `apply` refuses when it would rewrite or delete a
  file the receipt does not record it writing, when the destination has drifted
  from the revision the receipt already records, when a file it would rewrite
  has uncommitted changes in Git, or when a skill directory exists that no
  receipt claims and whose content differs from the source. Ownership comes from
  the receipt rather than from `git status`, so ignored files are protected too.
  There is no force flag.
- **Modes are content.** Git tracks the executable bit, so a permission
  difference appears in the plan and is protected like any other change.
- **Honest failure.** A failed run exits nonzero and leaves the previous receipt
  in place rather than recording a sync that did not finish. A failing `rsync`
  or `git` is reported, never mistaken for an empty plan.
- **An offline gate.** `verify` proves the committed payload is exactly what
  `apply` wrote: every recorded file present with matching bytes and executable
  bit, nothing extra inside a managed skill directory, no symlinks, and a
  receipt and manifest that agree. It is fail-closed and needs nothing but the
  repository.

## Provenance receipt

Each target gets a `skill-sync.receipt`:

```
# Generated by skill-sync. Records what was copied into this directory
# and which files skill-sync owns. Provenance and ownership only: it
# carries no hashes and attests nothing about the current contents.

source = https://github.com/joeharris76/skill-sync-skills.git
rev = d22ea7fab6b7b9608e54a3910ab4dfa9bb407d42
dir = skills
skill = code
skill = test

file = code/SKILL.md
file = code/skill.yaml
file = test/SKILL.md
```

Alongside it, `skill-sync.manifest` records a SHA-256 and mode for each of those
files. The split is deliberate: the receipt says where the payload came from and
what skill-sync owns, and the manifest is the only thing that makes a claim about
bytes. `verify` reads the manifest; the guards read the receipt.

The `file` lines are what makes overwrite protection work where Git cannot help:
anything under a skill directory that is not listed is somebody else's, and
`apply` refuses to overwrite or delete it. The receipt carries no hashes and does
not attest that the listed files still match the source — that is what reviewing
the Git diff is for.

## Project settings

Skills read `<target>/skill-sync.config.yaml` for project-specific values such
as lint and test commands. skill-sync neither generates nor overwrites it:
maintain it by hand, next to the payload it configures.

## Deliberate limits

- One local checkout per source. No cloning, fetching, caching, or registries.
- One selection shared by every target. Per-target selection is a `.gitignore`
  entry, not a feature.
- No dependency resolution, version solving, pinning commands, or lockfile.
- `verify` proves the payload is what `apply` wrote; it cannot prove the
  recorded revision is the one you meant, because that claim lives in the
  receipt and nothing offline can check it. `check`, against the catalog, is
  what ties the payload to a revision.
- Overwrite protection for a gitignored target is bounded by what can be known
  without hashes. A local edit to a generated file is caught while the recorded
  revision still stands, because the payload should still match. Once the
  catalog moves on, a changed file is indistinguishable from an updated one, and
  Git holds no baseline to fall back on. Commit the target, or treat it as
  disposable.
- `rev` is a plain commit-ish, so `rev = HEAD` against the project's own
  checkout re-records the project's commit on every sync and leaves `check`
  reporting a pending receipt update after every commit. Pin a fixed revision
  for a self-source unless that churn is acceptable.

## Development

```bash
sh tests/run.sh                              # integration tests
shellcheck -s sh bin/skill-sync tests/run.sh # lint
```

Tests build throwaway Git repositories under a temporary directory; no real
catalog or consumer project is touched.

## History

Before v1.0.0 skill-sync was a TypeScript/Node CLI with a resolver, lockfile,
config generator, and MCP server. That implementation is preserved — see
[ARCHIVE.md](ARCHIVE.md) — and [MIGRATION.md](MIGRATION.md) maps every old
command to its replacement.
