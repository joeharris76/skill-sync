# Archived TypeScript implementation

Before v1.0.0, skill-sync was a TypeScript/Node CLI (about 9,800 source lines
across 50 files, plus 53 test files) with a source resolver, lockfile,
transactional materializer, config generator, MCP server, and instruction
capture/restore. v1.0.0 replaced it with a POSIX shell wrapper around `git` and
`rsync`.

The old implementation is preserved, not deleted.

## Where it is

| | |
|---|---|
| Commit | `2d61d97dcb0951ef533df75e99af2b2ba6cdfd63` |
| Tag | `archive/typescript-v0.1.0` (pushed to `origin`) |
| Bundle | `/Users/joe/Developer/skill-sync-archive/skill-sync-typescript-v0.1.0-2d61d97.bundle` |

The tag is an annotated tag on the last commit of the TypeScript implementation.
The bundle is a standalone copy of the whole repository — every branch, tag, and
the complete history — held outside any working checkout, so it survives loss of
both this repository and its GitHub remote.

## Restore from the tag

```bash
git fetch origin --tags
git checkout -b restore-typescript archive/typescript-v0.1.0
npm ci && npm run build
node dist/cli/index.js --help
```

## Restore from the bundle

```bash
git bundle verify /Users/joe/Developer/skill-sync-archive/skill-sync-typescript-v0.1.0-2d61d97.bundle
git clone /Users/joe/Developer/skill-sync-archive/skill-sync-typescript-v0.1.0-2d61d97.bundle skill-sync-old
cd skill-sync-old
git checkout -b restore-typescript archive/typescript-v0.1.0
npm ci && npm run build
```

Both paths were exercised on 2026-09-08: the bundle verified as a complete
history, cloned cleanly, built, and produced a working `skill-sync --help`.

## Retained installation

A built copy is kept at `/Users/joe/Developer/skill-sync-archive/typescript`
(detached at `archive/typescript-v0.1.0`, `npm ci --ignore-scripts && npm run
build`), so local callers of the old CLI have a stable path that does not depend
on this repository's working checkout:

```
SKILL_SYNC=/Users/joe/Developer/skill-sync-archive/typescript/dist/cli/index.js
```

## Consumers still pinned to it

`BenchBox`, `todo-db`, and `Oxbow` each pin this repository at an older commit
for their bundled `skill-sync` operator skill. That pin covers the operator
instructions only — it does not pin the CLI they execute, which several of them
resolve inside this repository's checkout. They need the retained installation
above until they are migrated deliberately.

BenchBox's integrity verifier is separately pinned to
`6d09682dabe2ff0d68f400d60f8ba8b87f8c02aa` and clones it from the remote on every
run; that revision is preserved on `origin` and in the bundle. See
[MIGRATION.md](MIGRATION.md).
