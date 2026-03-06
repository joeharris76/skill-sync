# Sync Model and Lockfile

## Sync Philosophy

`skillsync` should behave like a package manager for skills, while keeping the
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

Planned modes:
- `copy`: materialize copied files locally
- `symlink`: local development convenience
- `mirror`: managed local mirror of upstream content
- vendored snapshot: pinned content stored locally for reproducibility

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

## Why This Is Different

The differentiator for `skillsync` is not just pulling files from somewhere.
It is the lifecycle model around:
- deterministic state
- explicit drift visibility
- reproducible installs
- project-local customization without losing upstream alignment
