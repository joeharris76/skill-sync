# Sync Model and Lockfile

## Sync Philosophy

`skill-sync` should behave like a package manager for skills, while keeping the
result locally materialized and inspectable.

The sync process should be explicit, deterministic, and safe:
- resolve sources
- read canonical package state
- compare against installed state
- produce a plan
- optionally apply the plan
- update lock and state metadata

## Source Types

Expected source support:
- local filesystem paths
- git repositories
- curated registries
- GitHub-style remote repositories

Each source should expose enough metadata to support provenance and lock-state.

## Install Modes

The product should support multiple install modes because users have different
needs during development, CI, and web/remote execution.

Modes:
- `copy`: materialize copied files locally
- `symlink`: local development convenience (not portable, cannot be committed)
- `mirror`: managed local mirror of upstream content (default)

Install mode controls *how bytes land on disk*. It is orthogonal to whether
those bytes are committed to git — that is the per-target `tracked` flag (see
"Git tracking" below). What was previously sketched as a separate "vendored
snapshot" mode is, in practice, `mirror` + `tracked: true`: pinning a revision
is already handled by `overrides[skill].revision` + the lock, so the genuinely
new axis is git-visibility, not a fourth byte-layout.

## Git Tracking (committed snapshots)

By default, materialized skills are a regenerated mirror that the consumer
gitignores — only `skill-sync.yaml` + `skill-sync.lock` are committed. That
keeps a single source of truth, but the skills never reach environments that
clone only the consumer repo (cloud/web agents, CI, a fresh machine).

A consumer can opt a target into committing its materialized skills + injected
config by making the target an object with `tracked: true`:

```yaml
targets:
  claude:
    dir: .claude/skills
    tracked: true
    ignore: [blog, substack]   # keep these skills gitignored within the target
  codex: .codex/skills          # bare string = untracked (today's behavior)
```

When a target is tracked, skill-sync:
- emits NO `.gitignore` entry for its dir (so the committed snapshot is visible),
  and an anchored ignore for each excluded skill (no negation patterns);
- manages a `.gitattributes` `-text` block over the tracked tree so committed
  bytes survive EOL normalization (the integrity gate hashes committed bytes);
- writes the injected `skill-sync.config.yaml` exclusion-aware and deterministic,
  so a fresh clone regenerates a byte-identical file;
- keeps machine-specific home paths out of the committed lock (provenance paths
  are stored `~`-relative).

skill-sync stays hands-off for repos that never opt in: it manages `.gitignore`
only once a target is tracked (or a managed block already exists). It never runs
git — committing the snapshot is the user's explicit step.

### Loader-owned namespace

The exact top-level `.system/` namespace belongs to the agent loader. Skill-sync
does not inventory, attest, warn about, manage, or prune that tree. Tracked
targets receive an anchored `.system/` ignore entry. All other target paths and
all files inside managed skill packages retain exact drift and integrity checks.

### Two-tier integrity

- `skill-sync verify` — OFFLINE gate (no source access): proves every tracked
  target's committed snapshot matches the lock + regenerated config. Catches
  hand-edits, extra/missing files, stray paths, and stale config. Exits non-zero
  on any issue, so it is the canonical cloud/CI check.
- `skill-sync sync --dry-run` (a.k.a. `diff`) — freshness vs the source. Runs
  only where the (possibly private) source is reachable.

## Lockfile

The lockfile should make installs reproducible.

Expected lockfile contents:
- source identity
- resolved revision/version
- install mode
- local content digest
- compatibility target
- resolution timestamp
- validation/trust metadata needed for replay

The exact format is undecided, but it should be stable, human-inspectable, and
safe to commit.

## Local agent-instruction snapshot

Agent instruction content has a separate local snapshot model. It must not be
added to `skill-sync.lock`, whose schema and reproducibility guarantees are for
skills. The MVP snapshot is project-local at
`.skill-sync/agent-config/snapshot.json`, with raw payloads beside it under
`global/` and `project/`.

Operations use the transient `.skill-sync/agent-config.lock` for local
serialization; it is separate from `skill-sync.lock` and the snapshot metadata.
The lock is owner-token-bound and fail-closed. Operations do not automatically
delete a pre-existing lock from a PID check because pathname-based stale-lock
removal can race with a new owner.

The model has an exact six-file allowlist:

- global: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, and
  `~/.gemini/GEMINI.md`;
- project root: `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`.

Capture is explicit and read-only with respect to the live files. It records
presence, byte size, exact payload, and SHA-256 for each present file; missing
files are recorded as missing. The live files remain authoritative for capture
and validation. The snapshot is authoritative only during an explicit restore.
No content is translated between agents, and no settings, hooks, permissions,
trusted-folder state, MCP data, nested files, arbitrary rules, or remote data
are included.

Validation reports unchanged, modified, missing, and newly-present drift for
each allowlisted path. An unchanged missing file is clean because that state was
captured intentionally. Restore does not delete paths that were absent in the
snapshot. It restores missing payloads, skips unchanged files, and blocks
modified destinations unless the operator passes `--force`.

Capture and restore support `--dry-run`; JSON output is available with
`--json`. The snapshot directory has a local `.gitignore` for raw payloads;
payloads remain exact and unredacted, so credentials and other secrets must not
be captured. Restore stages all payloads before applying any file, records a
durable recovery journal, and installs each replacement with a same-directory
no-overwrite operation. Staged and installed payloads are hash-checked against
the snapshot. An EXDEV-specific exclusive-copy fallback handles unusual
filesystems, but that fallback is not crash-atomic. A later non-dry-run command
recovers an interrupted operation. Concurrent changes are preserved rather than
silently overwritten; unresolvable recovery conflicts leave the journal for
manual resolution. This is recoverable failure behavior rather than a
filesystem-level multi-file transaction across power loss. The snapshot is not
a general-purpose backup manager and is not synchronized outside the project.

## Planned Sync Operations

### Install

Add new shared skills into the managed local store from declared sources.

### Sync

Reconcile declared source state with local installed state and update the store
to the target revision.

### Status

Report:
- current source revision
- installed revision
- lockfile status
- local drift
- pending conflicts
- validation/trust health

### Diff

Show:
- upstream vs installed differences
- installed vs locally modified differences
- override-layer effects where relevant

### Promote

Turn accepted local refinements into an intentional upstream-facing change path.
This may remain workflow-oriented rather than fully automated in the earliest
version, but the capability is part of the intended product model.

## Drift and Conflict Semantics

The system should distinguish:
- clean installs
- upstream updates available
- local override state
- accidental local drift
- explicit conflicts that block safe apply

Conflicts should be surfaced before overwrite. Silent destructive sync is out of
scope.

Generated target directories are mirrors, not canonical source. Local edits in a
generated mirror must either be promoted back to the configured source or
explicitly overwritten with `--force`; ordinary sync must not silently replace
locked drift or untracked pre-existing skill directories.

## Apply Semantics

The apply phase should strive for:
- atomic writes where practical
- rollback-friendly updates
- stable metadata updates only after successful materialization
- clear error reporting on partial failure

## Dry Run

Dry-run output should be first-class. Users should be able to see:
- which packages will be added
- which will change
- which will be removed
- where conflicts exist
- how lock/state files will change

Dry-run should still resolve manifests and sources. Missing source skills,
malformed manifests, parse errors, drift errors, and permission errors are hard
failures in dry-run; only a missing manifest is a no-op.

## Project-Local Hooks

Projects can configure `hooks.before_sync` to run repository-specific checks
before non-dry-run mutation. This is intentionally local configuration: policies
such as worktree write preflights should live in the project that needs them,
not in shared/global agent instructions or generic skill behavior.

## Why This Is Different

The differentiator for `skill-sync` is not just pulling files from somewhere.
It is the lifecycle model around:
- deterministic state
- explicit drift visibility
- reproducible installs
- project-local customization without losing upstream alignment
