/**
 * Shared operations called by both CLI and MCP surfaces.
 *
 * These functions own the orchestration logic (resolve → plan → apply → lock).
 * CLI and MCP are thin adapters over these operations.
 */

import { exec, execFile } from "node:child_process";
import { access, constants, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createSourcesFromConfigForSkill, isImplementedSourceType } from "../sources/factory.js";
import { generateConfig, writeProjectConfig } from "./config-generator.js";
import { detectDrift } from "./drift.js";
import { applyGitTracking } from "./gitignore.js";
import { auditInstructions } from "./instruction-audit.js";
import { isInstructionAgent } from "./instruction-targets.js";
import type { InstructionAgent, InstructionAuditReport } from "./instruction-types.js";
import { createLockFile, lockSkill, readLockFile, writeLockFile } from "./lock.js";
import { ManifestNotFoundError, readManifest, serializeManifest } from "./manifest.js";
import { dematerialize, materialize } from "./materializer.js";
import { loadSkillPackage } from "./parser.js";
import { expandTilde, relativeInside, resolvePath, toTildePath } from "./paths.js";
import { isPortableMode } from "./portability.js";
import { resolveSkill } from "./resolver.js";
import {
  type AgentSettingsFile,
  buildSuggestedPermissions,
  checkSettingsRequirements,
  collectRequiredAllows,
  type SettingsGap,
} from "./settings-checker.js";
import type { PreparedSkill } from "./syncer.js";
import { planSync } from "./syncer.js";
import type {
  ConflictEntry,
  LockFile,
  Manifest,
  ResolvedSkill,
  SkillSource,
  SourceProvenance,
  SyncPlan,
} from "./types.js";
import { type VerifyReport, verifyTrackedTargets } from "./verify.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncOptions {
  projectRoot: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface SyncResult {
  plan: SyncPlan;
  applied: boolean;
  summary: {
    installed: string[];
    updated: string[];
    removed: string[];
    unchanged: string[];
    skipped: Array<{ name: string; reason: string }>;
    forced: string[];
    warnings: string[];
  };
  /** Non-null when applied is false due to conflicts. */
  conflicts?: ConflictEntry[];
}

/**
 * Collapse a home-rooted provenance path to `~/...` before it is written to the
 * (committable) lock file, so a tracked snapshot doesn't leak the maintainer's
 * filesystem layout into every consumer repo.
 */
function normalizeProvenancePaths(source: SourceProvenance): SourceProvenance {
  return source.path ? { ...source, path: toTildePath(source.path) } : source;
}

export async function syncOperation(opts: SyncOptions): Promise<SyncResult> {
  const { projectRoot, dryRun = false, force = false } = opts;
  const sources: SkillSource[] = [];

  try {
    const manifest = await readManifest(projectRoot);
    const lockFile = (await readLockFile(projectRoot)) ?? createLockFile();

    // Resolve all skills (including transitive dependencies)
    const resolved: ResolvedSkill[] = [];
    const prepared: PreparedSkill[] = [];
    const queue = [...manifest.skills];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const skillName = queue.shift()!;
      if (visited.has(skillName)) continue;
      visited.add(skillName);

      const skillSources = createSourcesFromConfigForSkill(
        manifest.sources,
        manifest.overrides[skillName],
      );
      sources.push(...skillSources);

      const resolvedSkill = await resolveSkill(skillName, skillSources);
      resolved.push(resolvedSkill);

      const source = skillSources.find((s) => s.name === resolvedSkill.sourceName)!;
      const fetched = await source.fetch(resolvedSkill);
      const pkg = await loadSkillPackage(fetched.path);
      prepared.push({
        name: resolvedSkill.name,
        source: source.provenance(resolvedSkill),
        files: pkg.files,
      });

      for (const dep of pkg.meta?.depends ?? []) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }

    // Detect drift across all targets
    const targetEntries = Object.entries(manifest.targets);
    if (!targetEntries[0]) {
      throw new Error("No targets defined in skill-sync.yaml");
    }

    const driftReports = await Promise.all(
      targetEntries.map(async ([targetName, targetCfg]) => {
        const targetRoot = resolvePath(projectRoot, targetCfg.dir);
        return {
          targetName,
          targetPath: targetCfg.dir,
          targetRoot,
          drift: await detectDrift(targetRoot, lockFile),
        };
      }),
    );

    // Plan
    const plan = await planSync({
      manifest: {
        skills: manifest.skills,
        installMode: manifest.installMode,
        overrides: manifest.overrides,
      },
      lockFile,
      resolvedSkills: prepared,
      driftReports: driftReports.map((r) => r.drift),
      targetRoots: driftReports.map((r) => r.targetRoot),
    });

    const emptySummary = {
      installed: plan.install.map((i) => i.name),
      updated: plan.update.map((u) => u.name),
      removed: plan.remove,
      unchanged: plan.unchanged,
      skipped: plan.skipped.map((s) => ({ name: s.name, reason: s.reason })),
      forced: [] as string[],
      warnings: [] as string[],
    };

    if (dryRun) {
      // Report (don't write) the git-tracking changes a real sync would make.
      const dryGit = await applyGitTracking(projectRoot, manifest.targets, { dryRun: true });
      if (dryGit.gitignoreChanged) emptySummary.warnings.push(".gitignore would be updated");
      if (dryGit.gitattributesChanged)
        emptySummary.warnings.push(".gitattributes would be updated");
      for (const key of dryGit.outsideRepoTracked) {
        emptySummary.warnings.push(`tracked target "${key}" resolves outside the repo`);
      }
      return { plan, applied: false, summary: emptySummary };
    }

    // Conflict gate
    if (plan.conflicts.length > 0 && !force) {
      return {
        plan,
        applied: false,
        summary: emptySummary,
        conflicts: plan.conflicts,
      };
    }

    await runBeforeSyncHooks(projectRoot, manifest.hooks.beforeSync);

    // Apply: materialize installs, updates, and forced conflicts
    const updatedLock = { ...lockFile, skills: { ...lockFile.skills } };

    for (const install of plan.install) {
      const sourcePkg = prepared.find((p) => p.name === install.name)!;
      const sourceDir = resolved.find((r) => r.name === install.name)!.location;
      let lockFiles = sourcePkg.files;
      for (const { targetRoot } of driftReports) {
        const result = await materialize({
          skillName: install.name,
          sourcePath: sourceDir,
          targetRoot,
          mode: install.installMode,
          sourceFiles: sourcePkg.files,
        });
        lockFiles = result.files;
      }
      lockSkill(
        updatedLock,
        install.name,
        normalizeProvenancePaths(install.source),
        install.installMode,
        lockFiles,
      );
    }

    for (const update of plan.update) {
      const sourceDir = resolved.find((r) => r.name === update.name)!.location;
      const sourcePkg = prepared.find((p) => p.name === update.name)!;
      let lockFiles = sourcePkg.files;
      for (const { targetRoot } of driftReports) {
        const result = await materialize({
          skillName: update.name,
          sourcePath: sourceDir,
          targetRoot,
          mode: update.installMode,
          sourceFiles: sourcePkg.files,
        });
        lockFiles = result.files;
      }
      lockSkill(
        updatedLock,
        update.name,
        normalizeProvenancePaths(update.source),
        update.installMode,
        lockFiles,
      );
    }

    if (force) {
      for (const conflict of plan.conflicts) {
        const sourceDir = resolved.find((r) => r.name === conflict.name)!.location;
        const sourcePkg = prepared.find((p) => p.name === conflict.name)!;
        const installMode = manifest.overrides[conflict.name]?.installMode ?? manifest.installMode;
        let lockFiles = sourcePkg.files;
        for (const { targetRoot } of driftReports) {
          const result = await materialize({
            skillName: conflict.name,
            sourcePath: sourceDir,
            targetRoot,
            mode: installMode,
            sourceFiles: sourcePkg.files,
          });
          lockFiles = result.files;
        }
        lockSkill(
          updatedLock,
          conflict.name,
          normalizeProvenancePaths(sourcePkg.source),
          installMode,
          lockFiles,
        );
      }
    }

    // Update lock for skipped skills (disk matches source, lock needs refresh)
    for (const skipped of plan.skipped) {
      const sourcePkg = prepared.find((p) => p.name === skipped.name)!;
      const installMode = manifest.overrides[skipped.name]?.installMode ?? manifest.installMode;
      lockSkill(
        updatedLock,
        skipped.name,
        normalizeProvenancePaths(sourcePkg.source),
        installMode,
        sourcePkg.files,
      );
    }

    for (const name of plan.remove) {
      for (const { targetRoot } of driftReports) {
        await dematerialize(name, targetRoot);
      }
      delete updatedLock.skills[name];
    }

    // Generate skill-sync.config.yaml per target. Exclusion-aware: a skill that
    // is gitignored within a tracked target must not contribute to that target's
    // committed config, so a fresh clone (which lacks it) regenerates the same
    // file. Written only when the merged config is non-empty.
    for (const { targetRoot, targetName } of driftReports) {
      const exclusions = new Set(manifest.targets[targetName]?.ignore ?? []);
      const installedPkgs = [];
      for (const skillName of Object.keys(updatedLock.skills)) {
        if (exclusions.has(skillName)) continue;
        try {
          const pkg = await loadSkillPackage(resolve(targetRoot, skillName));
          installedPkgs.push(pkg);
        } catch {
          // Skip missing installs; drift will report them.
        }
      }
      const manifestConfig = Object.fromEntries(
        Object.entries(manifest.config).filter(([skill]) => !exclusions.has(skill)),
      );
      const mergedConfig = generateConfig({ manifestConfig, installedSkills: installedPkgs });
      if (Object.keys(mergedConfig).length > 0) {
        await writeProjectConfig(targetRoot, mergedConfig);
      }
    }

    // Maintain the managed .gitignore / .gitattributes blocks (no-op unless a
    // target is tracked or a managed block already exists). Runs before the lock
    // write, which is the commit point.
    const gitTracking = await applyGitTracking(projectRoot, manifest.targets);

    await writeLockFile(projectRoot, updatedLock);
    await registerProjectInSources(projectRoot, manifest.sources);

    const warnings = gitTracking.externalConflicts.map(
      (rel) =>
        `.gitignore has an entry outside the skill-sync block that ignores tracked path "${rel}"; remove it so the committed snapshot is visible to git.`,
    );
    const summary = {
      ...emptySummary,
      forced: force ? plan.conflicts.map((c) => c.name) : [],
      warnings,
    };

    return { plan, applied: true, summary };
  } finally {
    for (const source of sources) {
      if (
        "dispose" in source &&
        typeof (source as { dispose: () => Promise<void> }).dispose === "function"
      ) {
        await (source as { dispose: () => Promise<void> }).dispose();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Verify (tracked-snapshot integrity gate)
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  projectRoot: string;
}

/**
 * Verify that the committed snapshot of every tracked target matches the lock +
 * generated config. Offline (no source access) → safe to run in cloud/CI. When
 * there is no lock file, there is nothing committed to verify (ok).
 */
export async function verifyOperation(opts: VerifyOptions): Promise<VerifyReport> {
  const { projectRoot } = opts;
  let manifest: Manifest;
  try {
    manifest = await readManifest(projectRoot);
  } catch (err) {
    if (err instanceof ManifestNotFoundError) {
      return { ok: true, checkedTargets: [], issues: [] };
    }
    throw err;
  }
  const lockFile = await readLockFile(projectRoot);
  if (!lockFile) {
    return { ok: true, checkedTargets: [], issues: [] };
  }
  return verifyTrackedTargets(projectRoot, manifest, lockFile);
}

// ---------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------

export interface PinResult {
  pinned: string;
  revision: string;
  source: string;
}

/**
 * Pin a skill to its current git revision.
 * Only writes `revision` and `sourceName` to the override — preserves
 * any existing `installMode` override.
 */
export async function pinOperation(projectRoot: string, skillName: string): Promise<PinResult> {
  const manifest = await readManifest(projectRoot);
  const lockFile = await readLockFile(projectRoot);

  if (!lockFile) {
    throw new Error("No lock file found. Run `skill-sync sync` first.");
  }

  const locked = lockFile.skills[skillName];
  if (!locked) {
    throw new Error(`Skill "${skillName}" is not installed.`);
  }

  if (locked.source.type !== "git" || !locked.source.revision) {
    throw new Error(
      `Skill "${skillName}" is sourced from ${locked.source.type} and does not have a fixed revision to pin.`,
    );
  }

  if (!manifest.overrides[skillName]) {
    manifest.overrides[skillName] = {};
  }
  manifest.overrides[skillName]!.sourceName = locked.source.name;
  manifest.overrides[skillName]!.revision = locked.source.revision;

  await writeFile(join(projectRoot, "skill-sync.yaml"), serializeManifest(manifest), "utf-8");

  return {
    pinned: skillName,
    revision: locked.source.revision,
    source: locked.source.name,
  };
}

// ---------------------------------------------------------------------------
// Unpin
// ---------------------------------------------------------------------------

export interface UnpinResult {
  /** Skill name if unpinned, false if it was not pinned. */
  unpinned: string | false;
  message?: string;
}

/**
 * Remove a revision pin from a skill.
 * Only deletes `revision` and `sourceName` from the override — preserves
 * any existing `installMode` override. Removes the override entirely if
 * no fields remain.
 */
export async function unpinOperation(projectRoot: string, skillName: string): Promise<UnpinResult> {
  const manifest = await readManifest(projectRoot);

  const override = manifest.overrides[skillName];
  if (!override?.revision) {
    return {
      unpinned: false,
      message: `Skill "${skillName}" is not pinned.`,
    };
  }

  delete override.revision;
  delete override.sourceName;

  // Remove the override entirely if no fields remain
  if (!override.installMode) {
    delete manifest.overrides[skillName];
  }

  await writeFile(join(projectRoot, "skill-sync.yaml"), serializeManifest(manifest), "utf-8");

  return { unpinned: skillName };
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

export interface PruneResult {
  /** Skills that were (or would be) pruned. */
  pruned: string[];
  /** True if this was a dry run. */
  dryRun: boolean;
}

export async function pruneOperation(projectRoot: string, dryRun = false): Promise<PruneResult> {
  const manifest = await readManifest(projectRoot);
  const lockFile = await readLockFile(projectRoot);

  if (!lockFile) {
    return { pruned: [], dryRun };
  }

  const targetEntries = Object.entries(manifest.targets);
  const primaryTarget = targetEntries[0]?.[1];
  if (!primaryTarget) {
    throw new Error("No targets defined in skill-sync.yaml");
  }

  const drift = await detectDrift(resolvePath(projectRoot, primaryTarget.dir), lockFile);
  const manifestSkills = new Set(manifest.skills);
  const lockOnly = Object.keys(lockFile.skills).filter((name) => !manifestSkills.has(name));
  const toPrune = [...lockOnly, ...drift.extra];

  if (toPrune.length === 0 || dryRun) {
    return { pruned: toPrune, dryRun };
  }

  for (const name of toPrune) {
    for (const [, targetCfg] of targetEntries) {
      await dematerialize(name, resolvePath(projectRoot, targetCfg.dir));
    }
    delete lockFile.skills[name];
  }
  // Keep the managed .gitignore/.gitattributes blocks consistent (no-op unless a
  // target is tracked or a block already exists).
  await applyGitTracking(projectRoot, manifest.targets);
  await writeLockFile(projectRoot, lockFile);

  return { pruned: toPrune, dryRun };
}

// ---------------------------------------------------------------------------
// Instruction Audit
// ---------------------------------------------------------------------------

export interface InstructionAuditOptions {
  projectRoot: string;
}

export async function instructionAuditOperation(
  opts: InstructionAuditOptions,
): Promise<InstructionAuditReport> {
  const { projectRoot } = opts;
  let configuredTargets: InstructionAgent[] = [];

  try {
    const manifest = await readManifest(projectRoot);
    configuredTargets = Object.keys(manifest.targets).filter(isInstructionAgent);
  } catch {
    configuredTargets = [];
  }

  return auditInstructions(projectRoot, configuredTargets);
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

export interface DoctorCheck {
  check: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export interface DoctorResult {
  healthy: boolean;
  checks: DoctorCheck[];
}

export async function doctorOperation(projectRoot: string): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  // Check 1: Manifest exists and parses
  let manifest: Manifest | undefined;
  try {
    manifest = await readManifest(projectRoot);
    checks.push({ check: "manifest", status: "ok", message: "skill-sync.yaml found and valid" });
  } catch (err) {
    checks.push({
      check: "manifest",
      status: "error",
      message: err instanceof Error ? err.message : "skill-sync.yaml not found or invalid",
    });
  }

  // Check 2: Lock file exists
  const lockFile = await readLockFile(projectRoot);
  if (lockFile) {
    checks.push({
      check: "lockfile",
      status: "ok",
      message: `Lock file has ${Object.keys(lockFile.skills).length} skill(s)`,
    });
  } else {
    checks.push({
      check: "lockfile",
      status: "warn",
      message: "No lock file. Run `skill-sync sync` to create one.",
    });
  }

  // Check 3: Sources and target directories
  if (manifest) {
    for (const source of manifest.sources) {
      if (isImplementedSourceType(source.type)) {
        checks.push({
          check: `source:${source.name}`,
          status: "ok",
          message: `Source type "${source.type}" is supported`,
        });
      } else {
        checks.push({
          check: `source:${source.name}`,
          status: "warn",
          message: `Source type "${source.type}" is not implemented yet`,
        });
      }
    }

    for (const [target, cfg] of Object.entries(manifest.targets)) {
      const targetPath = resolvePath(projectRoot, cfg.dir);
      try {
        await access(targetPath, constants.R_OK);
        checks.push({ check: `target:${target}`, status: "ok", message: `${cfg.dir} exists` });
      } catch {
        checks.push({
          check: `target:${target}`,
          status: "warn",
          message: `${cfg.dir} does not exist yet`,
        });
      }
    }
  }

  // Check 4: Drift detection
  if (manifest && lockFile) {
    for (const [target, cfg] of Object.entries(manifest.targets)) {
      const targetRoot = resolvePath(projectRoot, cfg.dir);
      const drift = await detectDrift(targetRoot, lockFile);
      if (drift.modified.length === 0 && drift.missing.length === 0) {
        checks.push({
          check: `drift:${target}`,
          status: "ok",
          message: "All installed skills match lock file",
        });
      } else {
        const issues: string[] = [];
        if (drift.modified.length > 0) issues.push(`${drift.modified.length} modified file(s)`);
        if (drift.missing.length > 0) issues.push(`${drift.missing.length} missing skill(s)`);
        checks.push({
          check: `drift:${target}`,
          status: "warn",
          message: `Drift detected: ${issues.join(", ")}`,
        });
      }
      if (drift.extra.length > 0) {
        checks.push({
          check: `extra:${target}`,
          status: "warn",
          message: `${drift.extra.length} untracked skill(s): ${drift.extra.join(", ")}`,
        });
      }
    }
  }

  // Check: tracked-target health (committed snapshots)
  if (manifest) {
    const trackedTargets = Object.entries(manifest.targets).filter(([, cfg]) => cfg.tracked);
    for (const [target, cfg] of trackedTargets) {
      if (relativeInside(projectRoot, cfg.dir) === null) {
        checks.push({
          check: `tracked:${target}`,
          status: "error",
          message: `${cfg.dir} is tracked but resolves outside the repo and cannot be committed`,
        });
        continue;
      }
      // `git check-ignore -q` exits 0 when the path IS ignored.
      let ignored = false;
      try {
        await execFileAsync("git", ["check-ignore", "-q", cfg.dir], { cwd: projectRoot });
        ignored = true;
      } catch {
        ignored = false;
      }
      checks.push(
        ignored
          ? {
              check: `tracked:${target}`,
              status: "warn",
              message: `${cfg.dir} is tracked but git-ignored (an entry outside the skill-sync block shadows it); the committed snapshot won't reach git`,
            }
          : {
              check: `tracked:${target}`,
              status: "ok",
              message: `${cfg.dir} is tracked and visible to git`,
            },
      );
    }
    if (trackedTargets.length > 0 && manifest.installMode === "symlink") {
      checks.push({
        check: "tracked:install-mode",
        status: "error",
        message:
          'Install mode "symlink" cannot be committed; tracked targets require copy or mirror',
      });
    }
  }

  // Check 5: Portability
  if (manifest) {
    if (isPortableMode(manifest.installMode)) {
      checks.push({
        check: "portability",
        status: "ok",
        message: `Install mode "${manifest.installMode}" is portable`,
      });
    } else {
      checks.push({
        check: "portability",
        status: "warn",
        message: `Install mode "${manifest.installMode}" is not portable (CI/web won't work)`,
      });
    }

    const instructionReport = await instructionAuditOperation({ projectRoot });
    checks.push(...buildInstructionChecks(instructionReport));
  }

  // Check 6: Settings requirements (claude only in v0)
  if (manifest && lockFile) {
    const claudeTarget = manifest.targets.claude?.dir;
    if (claudeTarget) {
      const targetRoot = resolvePath(projectRoot, claudeTarget);
      const settingsPath = join(projectRoot, ".claude", "settings.json");
      const settingsFile = await readAgentSettingsFile(settingsPath);
      const installedPkgs: Array<{
        name: string;
        meta: import("./types.js").SkillSyncMeta | null;
      }> = [];
      for (const skillName of Object.keys(lockFile.skills)) {
        try {
          const pkg = await loadSkillPackage(resolve(targetRoot, skillName));
          installedPkgs.push({ name: skillName, meta: pkg.meta });
        } catch {
          // Skip; drift check already handles missing installs
        }
      }
      const gaps = checkSettingsRequirements(installedPkgs, "claude", settingsFile);
      if (gaps.length > 0) {
        for (const gap of gaps) {
          checks.push({
            check: `settings-requirements:claude:${gap.skillName}`,
            status: "warn",
            message: `Skill "${gap.skillName}" requires claude permissions not in settings.json: ${gap.missingAllows.join(", ")}. Run \`skill-sync settings generate\` to see suggested additions.`,
          });
        }
      } else if (installedPkgs.some((p) => p.meta?.settingsRequirements?.claude)) {
        checks.push({
          check: "settings-requirements:claude",
          status: "ok",
          message: "All claude settings requirements are satisfied",
        });
      }
    }
  }

  const healthy = !checks.some((c) => c.status === "error");
  return { healthy, checks };
}

// ---------------------------------------------------------------------------
// Settings Generate
// ---------------------------------------------------------------------------

export interface SettingsGenerateOptions {
  projectRoot: string;
  /** Agent to generate for. Defaults to "claude". */
  agent?: string;
}

export interface SettingsGenerateResult {
  agent: string;
  /** The delta fragment: permissions entries not yet in the settings file. */
  suggestedFragment: AgentSettingsFile;
  /** Total required allow entries across all installed skills. */
  totalRequired: string[];
  /** Number of entries missing from the current settings file. */
  missingCount: number;
  /** Per-skill breakdown of gaps. */
  gaps: SettingsGap[];
}

export async function settingsGenerateOperation(
  opts: SettingsGenerateOptions,
): Promise<SettingsGenerateResult> {
  const { projectRoot, agent = "claude" } = opts;

  let lockFile: LockFile | null = null;
  let manifest: Manifest | undefined;
  try {
    manifest = await readManifest(projectRoot);
    lockFile = await readLockFile(projectRoot);
  } catch {
    return { agent, suggestedFragment: {}, totalRequired: [], missingCount: 0, gaps: [] };
  }

  if (!lockFile || !manifest) {
    return { agent, suggestedFragment: {}, totalRequired: [], missingCount: 0, gaps: [] };
  }

  const agentTarget = manifest.targets[agent]?.dir;
  if (!agentTarget) {
    return { agent, suggestedFragment: {}, totalRequired: [], missingCount: 0, gaps: [] };
  }

  const targetRoot = resolvePath(projectRoot, agentTarget);
  const settingsPath = join(projectRoot, `.${agent}`, "settings.json");
  const settingsFile = await readAgentSettingsFile(settingsPath);

  const installedPkgs: Array<{ name: string; meta: import("./types.js").SkillSyncMeta | null }> =
    [];
  for (const skillName of Object.keys(lockFile.skills)) {
    try {
      const pkg = await loadSkillPackage(resolve(targetRoot, skillName));
      installedPkgs.push({ name: skillName, meta: pkg.meta });
    } catch {
      // Skip missing installs
    }
  }

  const totalRequired = collectRequiredAllows(installedPkgs, agent);
  const gaps = checkSettingsRequirements(installedPkgs, agent, settingsFile);
  const suggestedFragment = buildSuggestedPermissions(installedPkgs, agent, settingsFile);
  const missingCount = suggestedFragment.permissions?.allow?.length ?? 0;

  return { agent, suggestedFragment, totalRequired, missingCount, gaps };
}

/** Read and parse an agent settings JSON file. Returns {} if the file is missing. */
async function readAgentSettingsFile(filePath: string): Promise<AgentSettingsFile> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as AgentSettingsFile;
  } catch {
    return {};
  }
}

/**
 * After a successful sync, register this project in the `projects` list of
 * each local source that has its own skill-sync.yaml. This lets the global
 * store track which downstream projects consume it.
 */
async function registerProjectInSources(
  projectRoot: string,
  sources: import("./types.js").SourceConfig[],
): Promise<void> {
  const isLinkedWorktree = await isLinkedGitWorktree(projectRoot);
  for (const source of sources) {
    if (source.type !== "local" || !source.path) continue;
    const sourcePath = expandTilde(source.path);
    // The source path points to the skills directory; the manifest lives one level up
    const sourceRoot = resolve(sourcePath, "..");
    // Never register a source's own repo as a downstream project of itself.
    if (resolve(sourceRoot) === resolve(projectRoot)) continue;
    const sourceManifestPath = join(sourceRoot, "skill-sync.yaml");
    try {
      const sourceManifest = await readManifest(sourceRoot);
      if (!sourceManifest.projectRegistry.autoRegister) continue;
      if (isLinkedWorktree && !sourceManifest.projectRegistry.includeWorktrees) {
        continue;
      }
      const existing = sourceManifest.projects ?? [];
      // Normalize projectRoot to use ~ when it's under the home directory
      const normalized = toTildePath(projectRoot);
      if (!existing.includes(normalized)) {
        sourceManifest.projects = [...existing, normalized];
        await writeFile(sourceManifestPath, serializeManifest(sourceManifest), "utf-8");
      }
    } catch {
      // Source has no manifest or isn't writable — silently skip
    }
  }
}

async function runBeforeSyncHooks(projectRoot: string, commands: string[]): Promise<void> {
  for (const command of commands) {
    try {
      await execAsync(command, {
        cwd: projectRoot,
        maxBuffer: 1024 * 1024,
      });
    } catch (err) {
      const detail = formatHookFailureDetail(err);
      throw new Error(`before_sync hook failed: ${command}${detail ? `\n${detail}` : ""}`);
    }
  }
}

function formatHookFailureDetail(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const parts: string[] = [];
  if ("stdout" in err && typeof err.stdout === "string" && err.stdout.trim()) {
    parts.push(`stdout:\n${err.stdout.trim()}`);
  }
  if ("stderr" in err && typeof err.stderr === "string" && err.stderr.trim()) {
    parts.push(`stderr:\n${err.stderr.trim()}`);
  }
  return parts.join("\n");
}

async function isLinkedGitWorktree(projectRoot: string): Promise<boolean> {
  try {
    const [{ stdout: topStdout }, { stdout: commonStdout }] = await Promise.all([
      execFileAsync("git", ["-C", projectRoot, "rev-parse", "--show-toplevel"]),
      execFileAsync("git", ["-C", projectRoot, "rev-parse", "--git-common-dir"]),
    ]);
    const top = resolve(topStdout.trim());
    const commonDir = commonStdout.trim();
    const commonAbs = resolve(top, commonDir);
    const primaryClone = resolve(commonAbs, "..");
    return top !== primaryClone;
  } catch {
    return false;
  }
}

function buildInstructionChecks(report: InstructionAuditReport): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const agent of report.agents) {
    if (!agent.configured) {
      continue;
    }

    const localEntries = [...agent.projectFiles, ...agent.overrideFiles];
    const presentLocalEntries = localEntries.filter((entry) => entry.state !== "missing");
    const globalEntry = agent.globalFiles.find((entry) => entry.state !== "missing");
    const expectedLocalPath = formatExpectedInstructionPaths([
      ...agent.expectedProjectFiles,
      ...agent.expectedOverrideFiles,
    ]);

    if (presentLocalEntries.length > 0) {
      checks.push({
        check: `instruction:${agent.agent}`,
        status: "ok",
        message: `Project ${presentLocalEntries.map((entry) => entry.path).join(", ")} found`,
      });
    } else if (globalEntry && !agent.globalAvailableRemotely) {
      checks.push({
        check: `instruction:${agent.agent}`,
        status: "warn",
        message: `No project ${expectedLocalPath} (global-only, invisible on web/iOS)`,
      });
    } else {
      checks.push({
        check: `instruction:${agent.agent}`,
        status: "warn",
        message: `No project ${expectedLocalPath}`,
      });
    }

    for (const entry of presentLocalEntries) {
      if (entry.state === "mirror-of-global" && globalEntry) {
        checks.push({
          check: `instruction:mirror-warning:${agent.agent}:${entry.path}`,
          status: "warn",
          message: `Project ${entry.path} is identical to global ${globalEntry.path} -- personal content may leak into repo`,
        });
      }
    }
  }

  return checks;
}

function formatExpectedInstructionPaths(expectedPaths: string[]): string {
  if (expectedPaths.length === 0) {
    return "project instruction file";
  }
  if (expectedPaths.length === 1) {
    return expectedPaths[0]!;
  }
  return expectedPaths.join(" or ");
}
