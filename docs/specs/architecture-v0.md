# SkillSync Architecture Specification v0

This document defines the internal architecture of skillsync: the layered module
structure, source abstraction, installed-store model, and the boundaries between
the core library, CLI, and MCP server.

## Design Principles

1. **One core, two surfaces.** Business logic lives in the core library. The CLI
   and MCP server are thin adapters over the same operations.
2. **Plan, then apply.** Sync operations produce a plan (dry-run) before mutating
   files. This makes dry-run, diff, and rollback natural.
3. **Files are the source of truth.** The installed store is a directory of plain
   files. The lock file records expected state. There is no database.
4. **TypeScript throughout.** CLI, core library, and MCP server are all TypeScript
   running on Node.js. Distributed via npm.

---

## 1. Module Architecture

```
skillsync/
  src/
    index.ts              # Package entry point (exports core API)

    core/                 # Business logic - no CLI or MCP dependencies
      types.ts            # Shared type definitions
      manifest.ts         # Parse/validate skillsync.yaml
      lock.ts             # Read/write/diff skillsync.lock
      parser.ts           # Parse SKILL.md frontmatter and skillsync.meta.yaml
      resolver.ts         # Multi-source skill resolution
      syncer.ts           # Plan and apply sync operations
      materializer.ts     # Install/remove skills to target directories
      drift.ts            # Detect drift between installed state and lock file
      hasher.ts           # SHA256 file checksums
      validator.ts        # SKILL.md and package validation
      compatibility.ts    # Agent target compatibility checks
      config-generator.ts # Merge and validate project config overrides
      portability.ts      # Non-portable path detection
      trust.ts            # Source allowlist/blocklist policies
      security.ts         # Script safety and unsafe pattern detection

    sources/              # Source adapters (implement SkillSource interface)
      index.ts            # Source exports
      local.ts            # Local filesystem paths
      git.ts              # Git repository cloning and checkout
      # registry.ts       # Planned for v0.2+

    cli/                  # CLI layer - thin over core
      index.ts            # Entry point, command routing
      parse.ts            # Zero-dependency argument parser
      output.ts           # Human-readable and JSON output formatting
      types.ts            # CLI-specific type definitions
      source-factory.ts   # Create source instances from manifest config
      commands/
        sync.ts
        status.ts
        diff.ts           # Wraps sync --dry-run
        validate.ts
        doctor.ts
        pin.ts            # Also handles unpin
        prune.ts
        promote.ts        # Manual guidance in v0

    mcp/                  # MCP server layer - thin over core
      index.ts            # Stdio transport entry point
      server.ts           # MCP server setup, resources, tools, prompts

  tests/
    unit/
      core/               # Core logic unit tests
      cli/                # CLI unit tests
      mcp/                # MCP server unit tests
    contract/             # Public API contract tests
    integration/          # End-to-end workflow tests
    helpers/              # Shared test utilities
    fixtures/             # Test skill packages and manifests
```

### Layer Rules

| Layer | May import from | Must not import from |
|-------|----------------|---------------------|
| `core/` | `sources/`, stdlib, npm packages | `cli/`, `mcp/` |
| `sources/` | `core/types.ts`, stdlib, npm packages | `cli/`, `mcp/`, other `core/` modules |
| `cli/` | `core/`, `sources/` | `mcp/` |
| `mcp/` | `core/`, `sources/` | `cli/` |

The core library is independently importable. A downstream tool could use
`skillsync/core` without pulling in CLI or MCP dependencies.

---

## 2. Core Types

These are the canonical internal representations. They are vendor-neutral and
used by all layers.

```typescript
// core/types.ts

/** A resolved skill package in the canonical internal model. */
interface SkillPackage {
  name: string;
  description: string;
  path: string;                    // Absolute path to skill directory
  skillMd: SkillMdMetadata;        // Parsed SKILL.md frontmatter
  meta: SkillSyncMeta | null;      // Parsed skillsync.meta.yaml, if present
  files: SkillFile[];              // All files in the package
}

/** Parsed SKILL.md frontmatter (read-only, never modified). */
interface SkillMdMetadata {
  name: string;
  description: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, unknown>;
  compatibility?: Record<string, unknown>;
}

/** Parsed skillsync.meta.yaml sidecar. */
interface SkillSyncMeta {
  tags: string[];
  category?: string;
  depends: string[];               // e.g. ["SHARED/commit-framework"]
  configInputs: ConfigInput[];
  targets: Record<string, boolean>;
  source?: SourceProvenance;       // Set by sync engine
}

interface ConfigInput {
  key: string;                     // e.g. "test.runner"
  type: "string" | "number" | "boolean";
  description: string;
  default?: string | number | boolean;
}

/** Provenance of an installed skill. */
interface SourceProvenance {
  type: "local" | "git" | "registry";
  name: string;                    // Source name from manifest
  path?: string;                   // For local sources
  url?: string;                    // For git/registry sources
  ref?: string;                    // Git ref (branch, tag, SHA)
  revision?: string;               // Resolved git SHA
  fetchedAt: string;               // ISO 8601 timestamp
}

/** A file within a skill package. */
interface SkillFile {
  relativePath: string;            // e.g. "SKILL.md", "references/compare.md"
  size: number;
  sha256: string;
}

/** Project manifest (parsed skillsync.yaml). */
interface Manifest {
  version: number;
  sources: SourceConfig[];
  skills: string[];
  profile?: string;
  targets: Record<string, string>; // agent -> path
  installMode: InstallMode;
  config: Record<string, Record<string, unknown>>;
  overrides: Record<string, { installMode?: InstallMode }>;
}

type InstallMode = "copy" | "symlink" | "mirror";

interface SourceConfig {
  name: string;
  type: "local" | "git" | "registry";
  path?: string;
  url?: string;
  ref?: string;
  registry?: string;
}

/** Lock file state. */
interface LockFile {
  version: number;
  lockedAt: string;
  skills: Record<string, LockedSkill>;
}

interface LockedSkill {
  source: SourceProvenance;
  installMode: InstallMode;
  files: Record<string, { sha256: string; size: number }>;
}
```

---

## 3. Source Abstraction

All skill sources implement a common interface:

```typescript
// sources/interface.ts

interface SkillSource {
  /** Source name from the manifest. */
  readonly name: string;

  /** Source type identifier. */
  readonly type: "local" | "git" | "registry";

  /**
   * Check if this source contains a skill with the given name.
   * Returns the resolved path/location or null if not found.
   */
  resolve(skillName: string): Promise<ResolvedSkill | null>;

  /**
   * Fetch a skill package from this source.
   * Returns a temporary directory with the skill contents.
   * For local sources, this may return the original path directly.
   */
  fetch(resolved: ResolvedSkill): Promise<FetchedSkill>;

  /** Get provenance metadata for a resolved skill. */
  provenance(resolved: ResolvedSkill): SourceProvenance;
}

interface ResolvedSkill {
  name: string;
  source: SkillSource;
  location: string;   // Path, URL, or registry identifier
}

interface FetchedSkill {
  name: string;
  path: string;        // Local directory containing the skill
  isTemporary: boolean; // True if path should be cleaned up after install
}
```

### Source Implementations

**LocalSource:** Reads skills from a filesystem path (e.g., `~/.claude/skills`).
Resolves by checking for `{basePath}/{skillName}/SKILL.md`. No fetching needed;
returns the original path. The simplest and most common source for personal skills.

**GitSource:** Clones a git repository (or uses a cached shallow clone) and
resolves skills within it. Supports ref pinning (branch, tag, SHA). Fetch
produces a temporary checkout of the specific skill directory.

**RegistrySource:** (Future, v0.2+) Queries a skills registry API to resolve
and download skill packages. Not implemented in v0.

### Resolution Order

The resolver iterates sources in manifest order, calling `resolve()` on each.
The first source that returns a non-null result wins. This gives predictable
shadowing: personal sources override team sources, team sources override
community sources.

```typescript
// core/resolver.ts (simplified)

async function resolveSkill(
  skillName: string,
  sources: SkillSource[]
): Promise<ResolvedSkill> {
  for (const source of sources) {
    const resolved = await source.resolve(skillName);
    if (resolved) return resolved;
  }
  throw new SkillNotFoundError(skillName, sources.map(s => s.name));
}
```

---

## 4. Installed Store Model

The installed store is a directory tree under each configured target path.
It is fully materialized — no symlinks in mirror/copy mode, no references to
external paths.

### Store Layout

```
{target}/                        # e.g. .claude/skills/
  code/
    SKILL.md
    skillsync.meta.yaml          # Includes source provenance
    references/
      compare.md
      ...
  test/
    SKILL.md
    skillsync.meta.yaml
    references/
      ...
  SHARED/
    commit-framework/
      SKILL.md
      skillsync.meta.yaml
    ...
  project-config.yaml            # Generated from manifest config section
```

### Store Rules

1. **Mirror mode** (default): Files are copied and tracked in the lock file.
   `skillsync check` verifies SHA256 digests. Drift is detectable.

2. **Copy mode**: Files are copied but not tracked in the lock file beyond
   source provenance. Lighter weight; no integrity checking.

3. **Symlink mode**: Target directory contains symlinks to the source path.
   Only works with local sources. Not portable. Intended for active skill
   development where you want edits to be visible immediately.

4. **project-config.yaml** is generated during sync from the manifest's
   `config` section. It is overwritten on every sync. It is not locked.

### Store Operations

Store operations are distributed across core modules rather than centralized in
a single store abstraction:

```typescript
// core/drift.ts — detect drift between installed files and lock state
function detectDrift(targetRoot: string, lockFile: LockFile): Promise<DriftReport>;

// core/parser.ts — load skill packages from disk
function loadSkillPackage(skillDir: string): Promise<SkillPackage>;

// core/materializer.ts — install/remove skills to target directories
function materialize(options: MaterializeOptions): Promise<void>;
function dematerialize(targetRoot: string, skillName: string): Promise<void>;
```

```typescript
interface DriftReport {
  clean: string[];                 // Skills matching lock state
  modified: DriftEntry[];          // Files changed since install
  missing: string[];               // Skills in lock but not on disk
  extra: string[];                 // Skills on disk but not in lock
}

interface DriftEntry {
  skill: string;
  file: string;
  expected: string;                // SHA256 from lock
  actual: string;                  // SHA256 from disk
}
```

---

## 5. Sync Engine

Sync follows a **plan-then-apply** model:

```
manifest + sources + lock → plan → (user review) → apply → updated lock
```

### Sync Plan

```typescript
// core/syncer.ts

interface SyncPlan {
  /** Skills to install (not currently in the store). */
  install: PlannedInstall[];

  /** Skills to update (source has changed since lock). */
  update: PlannedUpdate[];

  /** Skills to remove (in store but not in manifest). */
  remove: string[];

  /** Skills with local modifications (drift detected). */
  conflicts: ConflictEntry[];

  /** Skills that are up to date. */
  unchanged: string[];

  /** Dependency resolution warnings. */
  warnings: string[];
}

interface PlannedInstall {
  name: string;
  source: SourceProvenance;
  installMode: InstallMode;
  files: SkillFile[];
}

interface PlannedUpdate {
  name: string;
  source: SourceProvenance;
  installMode: InstallMode;
  changedFiles: Array<{
    path: string;
    oldSha256: string;
    newSha256: string;
  }>;
}

interface ConflictEntry {
  name: string;
  localChanges: DriftEntry[];
  upstreamChanges: SkillFile[];
}
```

### Apply Behavior

1. **Install:** Copy/symlink files into all target directories. Write provenance
   to `skillsync.meta.yaml`. Update lock file.

2. **Update:** Overwrite changed files. If local drift exists, report conflict
   and halt unless `--force` is passed. Update lock file.

3. **Remove:** Delete skill directory from all targets. Remove from lock file.

4. **Config generation:** After all skill operations, regenerate
   `project-config.yaml` in each target directory from the manifest's `config`
   section.

5. **Lock file update:** Written atomically after all file operations succeed.

---

## 6. CLI Surface

The CLI is a thin adapter over the core library. It handles argument parsing,
output formatting, and user interaction (confirmation prompts, progress).

### Command → Core Mapping

| CLI Command | Core Operation |
|-------------|---------------|
| `skillsync sync` | `resolver.resolveSkill()` → `syncer.planSync()` → `materializer.materialize()` |
| `skillsync sync --dry-run` | `resolver.resolveSkill()` → `syncer.planSync()` → format plan |
| `skillsync status` | `drift.detectDrift()` against lock file, per target |
| `skillsync diff` | Wraps `sync --dry-run` |
| `skillsync validate` | `validator.validateSkillPackage()` + `validator.validateManifest()` |
| `skillsync doctor` | Manifest check + lock file + targets + drift + portability |
| `skillsync pin <skill>` | Write revision override to `skillsync.yaml` |
| `skillsync unpin <skill>` | Remove revision override from `skillsync.yaml` |
| `skillsync prune` | Remove installed skills not in manifest |
| `skillsync promote` | Print manual promotion guidance (automated in v0.2+) |

### Output Modes

All commands support `--json` for machine-readable output. Default output is
human-readable with color (when stdout is a TTY).

---

## 7. MCP Server Surface

The MCP server exposes the installed store for agent clients. It uses the
`@modelcontextprotocol/sdk` TypeScript SDK with stdio transport for Claude Code
integration.

### MCP Resources

| URI Pattern | Description |
|-------------|-------------|
| `skill://list` | Catalog of all installed skills (name, description, file count) |
| `skill://{name}` | Read a skill's SKILL.md content |
| `skill://{name}/{+path}` | Read a specific file within a skill package (path traversal protected) |

### MCP Tools (v0, read-only)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `search-skills` | `query: string` | Search skills by name, description, or tag |
| `skill-status` | — | Show installation status and drift for all skills per target |
| `validate-skills` | — | Run portability and compatibility validation |

### MCP Prompts

| Prompt | Parameters | Description |
|--------|-----------|-------------|
| `use-skill` | `name: string` | Generate a prompt incorporating a skill's SKILL.md instructions |

### Future (v0.2+)

Mutation tools will be added after the trust and conflict model is stable.

### Implementation

The MCP server imports from `core/` modules directly (manifest, lock, drift,
parser, portability, compatibility, config-generator). It discovers installed
skills by scanning target directories for `SKILL.md` files.

```typescript
// mcp/server.ts (simplified)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function createServer(projectRoot: string): McpServer {
  const server = new McpServer({ name: "skillsync", version: "0.0.1" });

  server.resource("skills-list", "skill://list", ...);
  server.resource("skill", new ResourceTemplate("skill://{name}", ...), ...);
  server.tool("search-skills", ..., async ({ query }) => { ... });

  return server;
}
```

---

## 8. Dependency Resolution

Skills can depend on SHARED frameworks. Resolution is simple:

1. Collect all `depends` entries from requested skills' `skillsync.meta.yaml`.
2. Add them to the skill list if not already present.
3. Repeat until no new dependencies are found (transitive closure).
4. Detect cycles and report as errors.

There is no version resolution. Dependencies are name-based, resolved against
the same source priority order as regular skills. If a dependency cannot be
found in any source, sync fails with an actionable error.

---

## 9. Config Injection

Project-specific config is injected at sync time, not at skill runtime:

1. The manifest's `config` section maps skill names to key-value pairs.
2. During sync, skillsync generates `project-config.yaml` in each target
   directory.
3. Skills read `project-config.yaml` at runtime (same as the existing
   `.claude/project-config.yaml` convention).

This avoids modifying skill bodies and keeps config changes visible as a single
generated file.

```yaml
# Generated: .claude/skills/project-config.yaml
# Do not edit manually. Regenerated by skillsync sync.
code:
  lint: "uv run ruff check ."
  typecheck: "uv run ty check"
  verify: "make lint && make typecheck && make test-fast"
test:
  runner: "uv run pytest"
  test_dir: tests/
  coverage_package: mypackage
```

---

## 10. Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | MCP SDK alignment, ecosystem fit, iteration speed |
| Runtime | Node.js 20+ | LTS, native ESM, stable |
| Package manager | npm | Standard distribution, `npx skillsync` zero-install |
| MCP SDK | `@modelcontextprotocol/sdk` | Official TypeScript SDK |
| CLI framework | Manual zero-dependency parser | No external dependencies, full control |
| YAML parsing | `yaml` (npm) | YAML 1.2 compliant |
| Hashing | Node.js `crypto` | Built-in, no external dependency |
| Git operations | `simple-git` | Widely used, async API |
| Testing | Vitest | Fast, TypeScript-native, ESM support |
| Build | `tsup` | Fast bundling for CLI distribution |

---

## 11. Distribution

```json
{
  "name": "skillsync",
  "bin": {
    "skillsync": "./dist/cli/index.js"
  }
}
```

- `npm install -g skillsync` — global install
- `npx skillsync` — zero-install execution

MCP server configuration for Claude Code:
```json
{
  "mcpServers": {
    "skillsync": {
      "command": "node",
      "args": ["dist/mcp/index.js", "/path/to/project"]
    }
  }
}
```
