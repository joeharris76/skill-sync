/* v8 ignore file */
// Core type definitions for skill-sync.
// These are vendor-neutral canonical representations used by all layers.

// ---------------------------------------------------------------------------
// Skill Package
// ---------------------------------------------------------------------------

/** A resolved skill package in the canonical internal model. */
export interface SkillPackage {
  name: string;
  description: string;
  /** Absolute path to skill directory on disk. */
  path: string;
  /** Parsed SKILL.md frontmatter (read-only, never modified by skill-sync). */
  skillMd: SkillMdMetadata;
  /** Parsed skill.yaml sidecar, or null if absent. */
  meta: SkillSyncMeta | null;
  /** All files in the package with checksums. */
  files: SkillFile[];
}

/** Parsed SKILL.md YAML frontmatter. */
export interface SkillMdMetadata {
  name: string;
  description: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, unknown>;
  compatibility?: Record<string, unknown>;
}

/** Parsed skill.yaml sidecar. */
export interface SkillSyncMeta {
  tags: string[];
  category?: string;
  /** Skill dependencies, e.g. ["SHARED/commit-framework"]. */
  depends: string[];
  /** Config inputs this skill accepts from the project manifest. */
  configInputs: ConfigInput[];
  /** Agent compatibility declarations. */
  targets: Record<string, boolean>;
  /** Per-agent runtime settings requirements declared by the skill author. */
  settingsRequirements?: SettingsRequirements;
  /** Source provenance (set by sync engine, not the skill author). */
  source?: SourceProvenance;
}

/**
 * Per-agent settings requirements declared in skill.yaml.
 * Keys match agent identifiers used in `targets` (e.g. "claude", "codex").
 */
export interface SettingsRequirements {
  [agent: string]: AgentSettingsRequirement;
}

export interface AgentSettingsRequirement {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

export interface ConfigInput {
  /** Dotted key path, e.g. "test.runner". */
  key: string;
  type: "string" | "number" | "boolean";
  description: string;
  default?: string | number | boolean;
}

// ---------------------------------------------------------------------------
// Source Provenance
// ---------------------------------------------------------------------------

export type SourceType = "local" | "git" | "registry";

/** Records where an installed skill came from. */
export interface SourceProvenance {
  type: SourceType;
  /** Source name from the project manifest. */
  name: string;
  /** Filesystem path (local sources). */
  path?: string;
  /** Repository URL (git sources). */
  url?: string;
  /** Git ref used for resolution (branch, tag). */
  ref?: string;
  /** Resolved git commit SHA. */
  revision?: string;
  /** ISO 8601 timestamp of last fetch. */
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** A file within a skill package. */
export interface SkillFile {
  /** Relative path within the skill directory, e.g. "references/compare.md". */
  relativePath: string;
  size: number;
  sha256: string;
}

// ---------------------------------------------------------------------------
// Project Manifest (skill-sync.yaml)
// ---------------------------------------------------------------------------

export type InstallMode = "copy" | "symlink" | "mirror";

export interface Manifest {
  version: number;
  sources: SourceConfig[];
  skills: string[];
  profile?: string;
  /** Agent identifier → local directory path. */
  targets: Record<string, string>;
  installMode: InstallMode;
  /** Project-specific config values keyed by skill name. */
  config: Record<string, Record<string, unknown>>;
  /** Per-skill install mode overrides. */
  overrides: Record<string, SkillOverride>;
  /** Downstream projects that consume this manifest as a skill source. */
  projects?: string[];
}

export interface SourceConfig {
  name: string;
  type: SourceType;
  path?: string;
  url?: string;
  ref?: string;
  registry?: string;
}

export interface SkillOverride {
  installMode?: InstallMode;
  sourceName?: string;
  revision?: string;
}

// ---------------------------------------------------------------------------
// Lock File (skill-sync.lock)
// ---------------------------------------------------------------------------

export interface LockFile {
  version: number;
  lockedAt: string;
  skills: Record<string, LockedSkill>;
}

export interface LockedSkill {
  source: SourceProvenance;
  installMode: InstallMode;
  files: Record<string, LockedFile>;
}

export interface LockedFile {
  sha256: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Sync Plan
// ---------------------------------------------------------------------------

export interface SyncPlan {
  install: PlannedInstall[];
  update: PlannedUpdate[];
  remove: string[];
  conflicts: ConflictEntry[];
  unchanged: string[];
  skipped: SkippedEntry[];
  warnings: string[];
}

export interface SkippedEntry {
  name: string;
  reason: "disk-matches-source";
}

export interface PlannedInstall {
  name: string;
  source: SourceProvenance;
  installMode: InstallMode;
  files: SkillFile[];
}

export interface PlannedUpdate {
  name: string;
  source: SourceProvenance;
  installMode: InstallMode;
  changedFiles: FileChange[];
}

export interface FileChange {
  path: string;
  oldSha256: string;
  newSha256: string;
}

export interface ConflictEntry {
  name: string;
  localChanges: DriftEntry[];
  upstreamChanges: SkillFile[];
}

// ---------------------------------------------------------------------------
// Store State
// ---------------------------------------------------------------------------

export interface InstalledSkill {
  name: string;
  package: SkillPackage;
  installMode: InstallMode;
  provenance: SourceProvenance;
}

export interface DriftReport {
  /** Skills matching lock state exactly. */
  clean: string[];
  /** Skills with files modified since install. */
  modified: DriftEntry[];
  /** Skills in lock but not on disk. */
  missing: string[];
  /** Skills on disk but not in lock. */
  extra: string[];
}

export interface DriftEntry {
  skill: string;
  file: string;
  /** SHA256 from lock file. */
  expected: string;
  /** SHA256 from disk. */
  actual: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationSeverity = "error" | "warning";

export interface ValidationResult {
  valid: boolean;
  diagnostics: ValidationDiagnostic[];
}

export interface ValidationDiagnostic {
  rule: string;
  severity: ValidationSeverity;
  message: string;
  skill?: string;
  file?: string;
  line?: number;
}

// ---------------------------------------------------------------------------
// Source Interface
// ---------------------------------------------------------------------------

export interface ResolvedSkill {
  name: string;
  sourceName: string;
  sourceType: SourceType;
  location: string;
}

export interface FetchedSkill {
  name: string;
  /** Local directory containing the fetched skill. */
  path: string;
  /** True if the path is a temporary directory that should be cleaned up. */
  isTemporary: boolean;
}

/** Interface all source adapters must implement. */
export interface SkillSource {
  readonly name: string;
  readonly type: SourceType;
  resolve(skillName: string): Promise<ResolvedSkill | null>;
  fetch(resolved: ResolvedSkill): Promise<FetchedSkill>;
  provenance(resolved: ResolvedSkill): SourceProvenance;
}
