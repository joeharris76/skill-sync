// Type exports
export type {
  // Skill Package
  SkillPackage,
  SkillMdMetadata,
  SkillSyncMeta,
  ConfigInput,
  SkillFile,

  // Source
  SourceType,
  SourceProvenance,
  SourceConfig,
  SkillSource,
  ResolvedSkill,
  FetchedSkill,

  // Manifest
  Manifest,
  InstallMode,
  SkillOverride,

  // Lock File
  LockFile,
  LockedSkill,
  LockedFile,

  // Sync
  SyncPlan,
  PlannedInstall,
  PlannedUpdate,
  FileChange,
  ConflictEntry,
  SkippedEntry,

  // Store
  InstalledSkill,
  DriftReport,
  DriftEntry,

  // Validation
  ValidationSeverity,
  ValidationResult,
  ValidationDiagnostic,
} from "./types.js";

// Runtime exports — manifest
export { readManifest, parseManifest, serializeManifest } from "./manifest.js";

// Runtime exports — lock
export {
  createLockFile,
  readLockFile,
  writeLockFile,
  lockSkill,
  unlockSkill,
  getLockedSkill,
  parseLockFile,
  serializeLockFile,
} from "./lock.js";

// Runtime exports — parser
export {
  parseSkillMdFrontmatter,
  parseSkillSyncMeta,
  loadSkillPackage,
} from "./parser.js";

// Runtime exports — hasher
export { sha256File, sha256, hashSkillDirectory } from "./hasher.js";

// Runtime exports — resolver
export { resolveSkill, resolveAll, SkillNotFoundError } from "./resolver.js";

// Runtime exports — syncer
export { planSync, applySync } from "./syncer.js";
export type { PreparedSkill, PlanSyncInput, ApplySyncInput, ApplySyncResult } from "./syncer.js";

// Runtime exports — drift
export { detectDrift } from "./drift.js";

// Runtime exports — materializer
export { materialize, dematerialize } from "./materializer.js";
export type { MaterializeOptions, MaterializeResult } from "./materializer.js";

// Runtime exports — compatibility
export {
  checkCompatibility,
  checkAllTargetCompatibility,
  AGENT_TARGETS,
} from "./compatibility.js";
export type { AgentTarget, AgentTargetConfig } from "./compatibility.js";

// Runtime exports — config generator
export {
  generateConfig,
  writeProjectConfig,
  validateConfigOverrides,
} from "./config-generator.js";
export type { ConfigGeneratorInput } from "./config-generator.js";

// Runtime exports — portability
export {
  checkPortability,
  isPortableMode,
  validatePortability,
} from "./portability.js";

// Runtime exports — security
export { checkScriptSafety, checkUnsafePatterns } from "./security.js";

// Runtime exports — trust
export {
  checkSourceTrust,
  checkProvenanceRequired,
  formatProvenanceReport,
  DEFAULT_TRUST_POLICY,
} from "./trust.js";
export type { TrustPolicy, SourcePattern } from "./trust.js";

// Runtime exports — validator
export {
  validateSkillPackage,
  validateManifest,
} from "./validator.js";

// Runtime exports — operations (shared CLI/MCP orchestration)
export {
  syncOperation,
  instructionAuditOperation,
  pinOperation,
  unpinOperation,
  pruneOperation,
} from "./operations.js";
export type {
  InstructionAuditOptions,
  SyncOptions,
  SyncResult,
  PinResult,
  UnpinResult,
  PruneResult,
} from "./operations.js";

// Runtime exports — instruction audit
export {
  auditInstructions,
  auditAgentInstructions,
} from "./instruction-audit.js";
export { INSTRUCTION_TARGETS } from "./instruction-targets.js";
export type {
  InstructionAgent,
  InstructionFileScope,
  InstructionFileState,
  InstructionAuditEntry,
  InstructionAgentAudit,
  InstructionAuditDiagnostic,
  InstructionAuditReport,
  InstructionTargetConfig,
  OverlapDetail,
} from "./instruction-types.js";
