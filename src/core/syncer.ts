import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { stringify as stringifyYaml } from "yaml";
import type {
  LockFile,
  SyncPlan,
  PlannedInstall,
  PlannedUpdate,
  ConflictEntry,
  SkippedEntry,
  InstallMode,
  SkillFile,
  FileChange,
  SourceProvenance,
  DriftReport,
  DriftEntry,
} from "./types.js";
import { getLockedSkill } from "./lock.js";
import { hashSkillDirectory } from "./hasher.js";

// ---------------------------------------------------------------------------
// Pre-resolved skill representation for planning
// ---------------------------------------------------------------------------

/** A skill that has already been fetched and hashed (resolution complete). */
export interface PreparedSkill {
  name: string;
  source: SourceProvenance;
  files: SkillFile[];
}

// ---------------------------------------------------------------------------
// Plan Input / Output
// ---------------------------------------------------------------------------

export interface PlanSyncInput {
  manifest: {
    skills: string[];
    installMode: InstallMode;
    overrides?: Record<string, { installMode?: InstallMode }>;
  };
  lockFile?: LockFile;
  resolvedSkills: PreparedSkill[];
  driftReport?: DriftReport;
  driftReports?: DriftReport[];
  /** Deprecated single-target alias retained for compatibility with existing callers/tests. */
  targetRoot?: string;
  /** Target roots used for source-vs-disk comparison. */
  targetRoots?: string[];
}

export interface ApplySyncInput {
  plan: SyncPlan;
  targets: string[];
  config?: Record<string, Record<string, unknown>>;
  /** When true, treat conflicts as updates instead of blocking. */
  force?: boolean;
}

export interface ApplySyncResult {
  wroteConfig: boolean;
  configPath?: string;
  /** Skills whose local modifications were overwritten (only populated when force=true). */
  forcedOverwrites: string[];
}

// ---------------------------------------------------------------------------
// planSync
// ---------------------------------------------------------------------------

/**
 * Produce a sync plan without mutating any files.
 *
 * Compares resolved skills against the current lock state and drift report.
 * Identifies installs, updates, removals, and conflicts.
 */
export async function planSync(input: PlanSyncInput): Promise<SyncPlan> {
  const { manifest, resolvedSkills } = input;
  const lockFile = input.lockFile ?? { version: 1, lockedAt: "", skills: {} };
  const driftReports = input.driftReports ?? (input.driftReport ? [input.driftReport] : []);
  const targetRoots = input.targetRoots ?? (input.targetRoot ? [input.targetRoot] : []);

  const plan: SyncPlan = {
    install: [],
    update: [],
    remove: [],
    conflicts: [],
    unchanged: [],
    skipped: [],
    warnings: [],
  };

  const resolvedNames = new Set(resolvedSkills.map((r) => r.name));

  // Check for removals: skills in lock but not requested
  for (const lockedName of Object.keys(lockFile.skills)) {
    if (!resolvedNames.has(lockedName)) {
      plan.remove.push(lockedName);
    }
  }

  // Build drift index
  const driftBySkill = new Map<string, DriftEntry[]>();
  for (const report of driftReports) {
    for (const entry of report.modified) {
      if (!driftBySkill.has(entry.skill)) {
        driftBySkill.set(entry.skill, []);
      }
      driftBySkill.get(entry.skill)!.push(entry);
    }
  }

  // Plan each resolved skill
  for (const skill of resolvedSkills) {
    const locked = getLockedSkill(lockFile, skill.name);
    const installMode = effectiveInstallMode(
      manifest.installMode,
      manifest.overrides,
      skill.name,
    );

    if (!locked) {
      // Check if already installed and clean (drift report says so)
      if (driftReports.some((report) => report.clean.includes(skill.name))) {
        plan.unchanged.push(skill.name);
        continue;
      }
      // New install
      plan.install.push({
        name: skill.name,
        source: skill.source,
        installMode,
        files: skill.files,
      });
      continue;
    }

    // Existing skill — check for upstream changes
    const changedFiles = diffFiles(locked.files, skill.files);

    if (changedFiles.length === 0) {
      plan.unchanged.push(skill.name);
      continue;
    }

    // Upstream has changes — check if on-disk files already match source
    if (targetRoots.length > 0) {
      const diskMatchesSource = await checkAllTargetsMatchSource(
        targetRoots,
        skill.name,
        skill.files,
      );
      if (diskMatchesSource) {
        plan.skipped.push({ name: skill.name, reason: "disk-matches-source" });
        continue;
      }
    }

    // Upstream has changes — check for local drift (conflict)
    const localDrift = driftBySkill.get(skill.name);
    if (localDrift && localDrift.length > 0) {
      plan.conflicts.push({
        name: skill.name,
        localChanges: localDrift,
        upstreamChanges: skill.files,
      });
    } else {
      plan.update.push({
        name: skill.name,
        source: skill.source,
        installMode,
        changedFiles,
      });
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// applySync
// ---------------------------------------------------------------------------

/**
 * Finalize a sync plan: validate no conflicts and write skill-sync.config.yaml.
 *
 * This function does NOT materialize skills — the caller (CLI or orchestrator)
 * is responsible for calling `materialize()` / `dematerialize()` for each
 * planned install, update, and removal, then updating the lock file.
 *
 * This split exists because materialization requires resolved source paths
 * which are held by the orchestration layer, not the planning layer.
 *
 * Throws if there are unresolved conflicts.
 */
export async function applySync(input: ApplySyncInput): Promise<ApplySyncResult> {
  const { plan, targets, config, force } = input;
  const forcedOverwrites: string[] = [];

  if (plan.conflicts.length > 0) {
    if (!force) {
      const names = plan.conflicts.map((c) => c.name).join(", ");
      throw new Error(
        `Sync blocked by ${plan.conflicts.length} conflict(s): ${names}. ` +
          `Run \`skill-sync promote\` to push local changes upstream first, ` +
          `or use \`skill-sync sync --force\` to overwrite local modifications.`,
      );
    }
    for (const conflict of plan.conflicts) {
      forcedOverwrites.push(conflict.name);
    }
  }

  // Generate skill-sync.config.yaml in each target directory
  let wroteConfig = false;
  let configPath: string | undefined;

  if (config && Object.keys(config).length > 0) {
    for (const target of targets) {
      await mkdir(target, { recursive: true });
      configPath = join(target, "skill-sync.config.yaml");
      const configContent =
        "# Generated by skill-sync. Do not edit manually.\n" +
        stringifyYaml(config);
      await writeFile(configPath, configContent, "utf-8");
      wroteConfig = true;
    }
  }

  return { wroteConfig, configPath, forcedOverwrites };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function effectiveInstallMode(
  defaultMode: InstallMode,
  overrides: Record<string, { installMode?: InstallMode }> | undefined,
  skillName: string,
): InstallMode {
  return overrides?.[skillName]?.installMode ?? defaultMode;
}

/**
 * Check whether on-disk installed files already match the source files.
 * Returns true if every source file exists on disk with the same SHA256.
 */
async function checkAllTargetsMatchSource(
  targetRoots: string[],
  skillName: string,
  sourceFiles: SkillFile[],
): Promise<boolean> {
  for (const targetRoot of targetRoots) {
    const matches = await checkDiskMatchesSource(targetRoot, skillName, sourceFiles);
    if (!matches) return false;
  }
  return true;
}

async function checkDiskMatchesSource(
  targetRoot: string,
  skillName: string,
  sourceFiles: SkillFile[],
): Promise<boolean> {
  const skillDir = join(targetRoot, skillName);
  let diskFiles: SkillFile[];
  try {
    diskFiles = await hashSkillDirectory(skillDir);
  } catch {
    return false;
  }
  const diskMap = new Map(diskFiles.map((f) => [f.relativePath, f.sha256]));

  if (diskFiles.length !== sourceFiles.length) return false;

  for (const sf of sourceFiles) {
    const diskHash = diskMap.get(sf.relativePath);
    if (diskHash !== sf.sha256) return false;
  }
  return true;
}

/**
 * Compare locked file state against current source files.
 * Returns files that have changed (added, modified, or removed).
 */
function diffFiles(
  lockedFiles: Record<string, { sha256: string; size: number }>,
  sourceFiles: SkillFile[],
): FileChange[] {
  const changes: FileChange[] = [];
  const sourceMap = new Map(sourceFiles.map((f) => [f.relativePath, f]));
  const lockedPaths = new Set(Object.keys(lockedFiles));

  for (const sf of sourceFiles) {
    const locked = lockedFiles[sf.relativePath];
    if (!locked) {
      changes.push({
        path: sf.relativePath,
        oldSha256: "<new>",
        newSha256: sf.sha256,
      });
    } else if (locked.sha256 !== sf.sha256) {
      changes.push({
        path: sf.relativePath,
        oldSha256: locked.sha256,
        newSha256: sf.sha256,
      });
    }
  }

  for (const lockedPath of lockedPaths) {
    if (!sourceMap.has(lockedPath)) {
      changes.push({
        path: lockedPath,
        oldSha256: lockedFiles[lockedPath]!.sha256,
        newSha256: "<removed>",
      });
    }
  }

  return changes;
}
