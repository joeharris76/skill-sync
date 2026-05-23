// Type exports

export type { AgentTarget, AgentTargetConfig } from "./compatibility.js";
// Runtime exports — compatibility
export {
  AGENT_TARGETS,
  checkAllTargetCompatibility,
  checkCompatibility,
} from "./compatibility.js";
export type { ConfigGeneratorInput } from "./config-generator.js";
// Runtime exports — config generator
export {
  generateConfig,
  validateConfigOverrides,
  writeProjectConfig,
} from "./config-generator.js";
// Runtime exports — drift
export { detectDrift } from "./drift.js";
// Runtime exports — hasher
export { hashSkillDirectory, sha256, sha256File } from "./hasher.js";
// Runtime exports — instruction audit
export {
  auditAgentInstructions,
  auditInstructions,
} from "./instruction-audit.js";
export { INSTRUCTION_TARGETS } from "./instruction-targets.js";
export type {
  InstructionAgent,
  InstructionAgentAudit,
  InstructionAuditDiagnostic,
  InstructionAuditEntry,
  InstructionAuditReport,
  InstructionFileScope,
  InstructionFileState,
  InstructionTargetConfig,
  OverlapDetail,
} from "./instruction-types.js";
// Runtime exports — lock
export {
  createLockFile,
  getLockedSkill,
  lockSkill,
  parseLockFile,
  readLockFile,
  serializeLockFile,
  unlockSkill,
  writeLockFile,
} from "./lock.js";
// Runtime exports — manifest
export { parseManifest, readManifest, serializeManifest } from "./manifest.js";
export type { MaterializeOptions, MaterializeResult } from "./materializer.js";
// Runtime exports — materializer
export { dematerialize, materialize } from "./materializer.js";
export type {
  InstructionAuditOptions,
  PinResult,
  PruneResult,
  SyncOptions,
  SyncResult,
  UnpinResult,
} from "./operations.js";
// Runtime exports — operations (shared CLI/MCP orchestration)
export {
  instructionAuditOperation,
  pinOperation,
  pruneOperation,
  syncOperation,
  unpinOperation,
} from "./operations.js";
// Runtime exports — parser
export {
  loadSkillPackage,
  parseSkillMdFrontmatter,
  parseSkillSyncMeta,
} from "./parser.js";
// Runtime exports — paths
export { expandTilde, resolvePath } from "./paths.js";
// Runtime exports — portability
export {
  checkPortability,
  isPortableMode,
  validatePortability,
} from "./portability.js";
// Runtime exports — resolver
export { resolveAll, resolveSkill, SkillNotFoundError } from "./resolver.js";
// Runtime exports — security
export { checkScriptSafety, checkUnsafePatterns } from "./security.js";
export type { ApplySyncInput, ApplySyncResult, PlanSyncInput, PreparedSkill } from "./syncer.js";
// Runtime exports — syncer
export { applySync, planSync } from "./syncer.js";
export type { SourcePattern, TrustPolicy } from "./trust.js";
// Runtime exports — trust
export {
  checkProvenanceRequired,
  checkSourceTrust,
  DEFAULT_TRUST_POLICY,
  formatProvenanceReport,
} from "./trust.js";
export type {
  ConfigInput,
  ConflictEntry,
  DriftEntry,
  DriftReport,
  FetchedSkill,
  FileChange,
  // Store
  InstalledSkill,
  InstallMode,
  LockedFile,
  LockedSkill,
  // Lock File
  LockFile,
  // Manifest
  Manifest,
  PlannedInstall,
  PlannedUpdate,
  ResolvedSkill,
  SkillFile,
  SkillMdMetadata,
  SkillOverride,
  // Skill Package
  SkillPackage,
  SkillSource,
  SkillSyncMeta,
  SkippedEntry,
  SourceConfig,
  SourceProvenance,
  // Source
  SourceType,
  // Sync
  SyncPlan,
  ValidationDiagnostic,
  ValidationResult,
  // Validation
  ValidationSeverity,
} from "./types.js";
// Runtime exports — validator
export {
  validateManifest,
  validateSkillPackage,
} from "./validator.js";
