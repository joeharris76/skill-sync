# SkillSync Promotion & Upstream Sync Specification v0

This document describes how project-local skill changes are promoted back to
a shared canonical source.

## Problem

When you refine a skill in-project (fixing a bug, adding a reference, tuning
instructions), that change lives only in the project's installed store. Without
promotion, the canonical source gets stale and other projects never benefit.

## v0 Approach: Documented Workflow, Not Automation

For v0, promotion is a **documented manual workflow** built on top of
`skillsync status` and `skillsync diff` output. Full automated promotion
(with conflict resolution and multi-project propagation) is deferred to v0.2.

### Rationale

- Promotion is inherently a review-gated action (you don't want every local
  tweak pushed upstream automatically).
- The sync engine already detects drift, which gives users the data they need.
- Building safe automated promotion requires trust policy, conflict resolution,
  and multi-project awareness that aren't in v0 scope.

## Workflow

### 1. Detect Drift

```bash
skillsync status
```

Output shows which skills have local modifications:

```
Skills:
  code          mirror   clean
  test          mirror   modified (2 files changed)
  SHARED/commit mirror   clean
```

### 2. Inspect Changes

```bash
skillsync diff test
```

Output shows file-level diffs between installed state and lock file:

```
test/references/cleanup.md
  - locked:    sha256:abc123 (1832 bytes)
  + installed: sha256:def456 (1890 bytes)

test/SKILL.md
  - locked:    sha256:111222 (4210 bytes)
  + installed: sha256:333444 (4280 bytes)
```

### 3. Copy Changes to Canonical Source

Manually copy the modified files back to the canonical source:

```bash
# Example: promoting test skill changes back to personal skills
cp .claude/skills/test/references/cleanup.md ~/.claude/skills/test/references/cleanup.md
cp .claude/skills/test/SKILL.md ~/.claude/skills/test/SKILL.md
```

### 4. Re-sync to Update Lock

```bash
skillsync sync
```

This re-syncs from the now-updated canonical source, updating the lock file
to reflect the promoted changes. The drift disappears.

### 5. Propagate to Other Projects

In other projects that use the same canonical source:

```bash
skillsync sync
```

This pulls the promoted changes into each project.

## Future: `skillsync promote` (v0.2+)

The planned `promote` command will automate the workflow above:

```bash
skillsync promote test
```

Expected behavior:
1. Detect which files in `test` have drifted from the lock.
2. Identify the canonical source for `test` (from the lock's provenance).
3. Show a diff of local changes vs canonical source.
4. On confirmation, copy changed files back to the canonical source.
5. Re-sync to update the lock.
6. Optionally list other projects that use this source and suggest `sync`.

### Open Design Questions for v0.2

- **Partial promotion**: Should you be able to promote individual files within
  a skill, or only the whole skill?
- **Git integration**: If the canonical source is a git repo, should `promote`
  create a commit or branch?
- **Multi-project awareness**: Should `~/.skillsync/` track which projects use
  which sources to enable "promote and propagate everywhere"?
- **Conflict handling**: If the canonical source has also changed since the
  last sync, how should conflicts be presented?

## Relationship to Other Features

| Feature | Role in Promotion |
|---------|------------------|
| `skillsync status` | Detects which skills have drifted |
| `skillsync diff` | Shows file-level changes |
| `skillsync.lock` | Records expected state for drift detection |
| `skillsync sync` | Re-syncs after manual promotion |
| Lock file provenance | Identifies which source to promote back to |
