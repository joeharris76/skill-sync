/**
 * Shared operations called by both CLI and MCP surfaces.
 *
 * These functions own the orchestration logic (resolve → plan → apply → lock).
 * CLI and MCP are thin adapters over these operations.
 */

import { resolve, join } from "node:path";
import { writeFile, access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { readManifest, serializeManifest } from "./manifest.js";
import {
  readLockFile,
  writeLockFile,
  createLockFile,
  lockSkill,
} from "./lock.js";
import { resolveSkill } from "./resolver.js";
import { planSync } from "./syncer.js";
import type { PreparedSkill } from "./syncer.js";
import { detectDrift } from "./drift.js";
import { materialize, dematerialize } from "./materializer.js";
import { loadSkillPackage } from "./parser.js";
import { generateConfig, writeProjectConfig } from "./config-generator.js";
import { auditInstructions } from "./instruction-audit.js";
import { isInstructionAgent } from "./instruction-targets.js";
import { isPortableMode } from "./portability.js";
import { createSourcesFromConfigForSkill, isImplementedSourceType } from "../sources/factory.js";
import type {
  SyncPlan,
  SkippedEntry,
  ConflictEntry,
  SkillSource,
  ResolvedSkill,
} from "./types.js";
import type { InstructionAgent, InstructionAuditReport } from "./instruction-types.js";

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

      const source = skillSources.find(
        (s) => s.name === resolvedSkill.sourceName,
      )!;
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
      targetEntries.map(async ([targetName, targetPath]) => ({
        targetName,
        targetPath,
        targetRoot: resolve(projectRoot, targetPath),
        drift: await detectDrift(
          resolve(projectRoot, targetPath),
          lockFile,
        ),
      })),
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
        install.source,
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
        update.source,
        update.installMode,
        lockFiles,
      );
    }

    if (force) {
      for (const conflict of plan.conflicts) {
        const sourceDir = resolved.find(
          (r) => r.name === conflict.name,
        )!.location;
        const sourcePkg = prepared.find((p) => p.name === conflict.name)!;
        const installMode =
          manifest.overrides[conflict.name]?.installMode ?? manifest.installMode;
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
          sourcePkg.source,
          installMode,
          lockFiles,
        );
      }
    }

    // Update lock for skipped skills (disk matches source, lock needs refresh)
    for (const skipped of plan.skipped) {
      const sourcePkg = prepared.find((p) => p.name === skipped.name)!;
      const installMode =
        manifest.overrides[skipped.name]?.installMode ?? manifest.installMode;
      lockSkill(
        updatedLock,
        skipped.name,
        sourcePkg.source,
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

    // Generate skill-sync.config.yaml
    if (Object.keys(manifest.config).length > 0) {
      for (const { targetRoot } of driftReports) {
        const installedPkgs = [];
        for (const skillName of Object.keys(updatedLock.skills)) {
          try {
            const pkg = await loadSkillPackage(resolve(targetRoot, skillName));
            installedPkgs.push(pkg);
          } catch {
            // Skip missing installs; drift will report them.
          }
        }
        const mergedConfig = generateConfig({
          manifestConfig: manifest.config,
          installedSkills: installedPkgs,
        });
        await writeProjectConfig(targetRoot, mergedConfig);
      }
    }

    await writeLockFile(projectRoot, updatedLock);
    await registerProjectInSources(projectRoot, manifest.sources);

    const summary = {
      ...emptySummary,
      forced: force ? plan.conflicts.map((c) => c.name) : [],
    };

    return { plan, applied: true, summary };
  } finally {
    for (const source of sources) {
      if (
        "dispose" in source &&
        typeof (source as { dispose: () => Promise<void> }).dispose ===
          "function"
      ) {
        await (source as { dispose: () => Promise<void> }).dispose();
      }
    }
  }
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
export async function pinOperation(
  projectRoot: string,
  skillName: string,
): Promise<PinResult> {
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

  await writeFile(
    join(projectRoot, "skill-sync.yaml"),
    serializeManifest(manifest),
    "utf-8",
  );

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
export async function unpinOperation(
  projectRoot: string,
  skillName: string,
): Promise<UnpinResult> {
  const manifest = await readManifest(projectRoot);

  const override = manifest.overrides[skillName];
  if (!override || !override.revision) {
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

  await writeFile(
    join(projectRoot, "skill-sync.yaml"),
    serializeManifest(manifest),
    "utf-8",
  );

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

export async function pruneOperation(
  projectRoot: string,
  dryRun = false,
): Promise<PruneResult> {
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

  const drift = await detectDrift(resolve(projectRoot, primaryTarget), lockFile);
  const manifestSkills = new Set(manifest.skills);
  const lockOnly = Object.keys(lockFile.skills).filter(
    (name) => !manifestSkills.has(name),
  );
  const toPrune = [...lockOnly, ...drift.extra];

  if (toPrune.length === 0 || dryRun) {
    return { pruned: toPrune, dryRun };
  }

  for (const name of toPrune) {
    for (const [, targetPath] of targetEntries) {
      await dematerialize(name, resolve(projectRoot, targetPath));
    }
    delete lockFile.skills[name];
  }
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

export async function doctorOperation(
  projectRoot: string,
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  // Check 1: Manifest exists and parses
  let manifest;
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
    checks.push({ check: "lockfile", status: "ok", message: `Lock file has ${Object.keys(lockFile.skills).length} skill(s)` });
  } else {
    checks.push({ check: "lockfile", status: "warn", message: "No lock file. Run `skill-sync sync` to create one." });
  }

  // Check 3: Sources and target directories
  if (manifest) {
    for (const source of manifest.sources) {
      if (isImplementedSourceType(source.type)) {
        checks.push({ check: `source:${source.name}`, status: "ok", message: `Source type "${source.type}" is supported` });
      } else {
        checks.push({ check: `source:${source.name}`, status: "warn", message: `Source type "${source.type}" is not implemented yet` });
      }
    }

    for (const [target, dir] of Object.entries(manifest.targets)) {
      const targetPath = resolve(projectRoot, dir);
      try {
        await access(targetPath, constants.R_OK);
        checks.push({ check: `target:${target}`, status: "ok", message: `${dir} exists` });
      } catch {
        checks.push({ check: `target:${target}`, status: "warn", message: `${dir} does not exist yet` });
      }
    }
  }

  // Check 4: Drift detection
  if (manifest && lockFile) {
    for (const [target, dir] of Object.entries(manifest.targets)) {
      const targetRoot = resolve(projectRoot, dir);
      const drift = await detectDrift(targetRoot, lockFile);
      if (drift.modified.length === 0 && drift.missing.length === 0) {
        checks.push({ check: `drift:${target}`, status: "ok", message: "All installed skills match lock file" });
      } else {
        const issues: string[] = [];
        if (drift.modified.length > 0) issues.push(`${drift.modified.length} modified file(s)`);
        if (drift.missing.length > 0) issues.push(`${drift.missing.length} missing skill(s)`);
        checks.push({ check: `drift:${target}`, status: "warn", message: `Drift detected: ${issues.join(", ")}` });
      }
      if (drift.extra.length > 0) {
        checks.push({ check: `extra:${target}`, status: "warn", message: `${drift.extra.length} untracked skill(s): ${drift.extra.join(", ")}` });
      }
    }
  }

  // Check 5: Portability
  if (manifest) {
    if (isPortableMode(manifest.installMode)) {
      checks.push({ check: "portability", status: "ok", message: `Install mode "${manifest.installMode}" is portable` });
    } else {
      checks.push({ check: "portability", status: "warn", message: `Install mode "${manifest.installMode}" is not portable (CI/web won't work)` });
    }

    const instructionReport = await instructionAuditOperation({ projectRoot });
    checks.push(...buildInstructionChecks(instructionReport));
  }

  const healthy = !checks.some((c) => c.status === "error");
  return { healthy, checks };
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
  const expandHome = (p: string) => p.replace(/^~/, homedir());
  for (const source of sources) {
    if (source.type !== "local" || !source.path) continue;
    const sourcePath = expandHome(source.path);
    // The source path points to the skills directory; the manifest lives one level up
    const sourceRoot = resolve(sourcePath, "..");
    const sourceManifestPath = join(sourceRoot, "skill-sync.yaml");
    try {
      const sourceManifest = await readManifest(sourceRoot);
      const existing = sourceManifest.projects ?? [];
      // Normalize projectRoot to use ~ when it's under the home directory
      const homeDir = homedir();
      const normalized = projectRoot.startsWith(homeDir)
        ? `~${projectRoot.slice(homeDir.length)}`
        : projectRoot;
      if (!existing.includes(normalized)) {
        sourceManifest.projects = [...existing, normalized];
        await writeFile(sourceManifestPath, serializeManifest(sourceManifest), "utf-8");
      }
    } catch {
      // Source has no manifest or isn't writable — silently skip
    }
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
