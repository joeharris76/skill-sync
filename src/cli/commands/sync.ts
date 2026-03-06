import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput, formatDiagnostics } from "../output.js";
import { readManifest } from "../../core/manifest.js";
import { readLockFile, createLockFile, writeLockFile, lockSkill } from "../../core/lock.js";
import { resolveAll } from "../../core/resolver.js";
import { planSync, applySync } from "../../core/syncer.js";
import type { PreparedSkill } from "../../core/syncer.js";
import { detectDrift } from "../../core/drift.js";
import { materialize, dematerialize } from "../../core/materializer.js";
import { loadSkillPackage } from "../../core/parser.js";
import { hashSkillDirectory } from "../../core/hasher.js";
import { generateConfig, writeProjectConfig } from "../../core/config-generator.js";
import { checkAllTargetCompatibility } from "../../core/compatibility.js";
import { createSourcesFromConfig } from "../source-factory.js";
import type { SkillSource } from "../../core/types.js";

export async function syncCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const dryRun = !!args.flags["dry-run"];
  const force = !!args.flags.force;
  const projectRoot = resolve(String(args.flags.project ?? "."));

  let sources: SkillSource[] = [];
  try {
    // Load manifest
    let manifest;
    try {
      manifest = await readManifest(projectRoot);
    } catch (err) {
      if (dryRun) {
        const emptyPlan = { install: [], update: [], remove: [], conflicts: [], unchanged: [], warnings: [] };
        return { exitCode: 0, stdout: formatOutput(emptyPlan, mode, () => "No skillsync.yaml found. Nothing to sync.") };
      }
      throw err;
    }
    const lockFile = (await readLockFile(projectRoot)) ?? createLockFile();

    // Create source adapters
    sources = createSourcesFromConfig(manifest.sources);

    // Resolve all skills (including transitive deps)
    const resolved = await resolveAll(manifest.skills, sources);

    // Prepare skills: fetch + hash
    const prepared: PreparedSkill[] = [];
    for (const r of resolved) {
      const source = sources.find((s) => s.name === r.sourceName)!;
      const fetched = await source.fetch(r);
      const pkg = await loadSkillPackage(fetched.path);
      prepared.push({
        name: r.name,
        source: source.provenance(r),
        files: pkg.files,
      });
    }

    const targetEntries = Object.entries(manifest.targets);
    const primaryTarget = targetEntries[0]?.[1];
    if (!primaryTarget) {
      return { exitCode: 1, stderr: "No targets defined in skillsync.yaml" };
    }
    const driftReports = await Promise.all(
      targetEntries.map(async ([targetName, targetPath]) => ({
        targetName,
        targetPath,
        targetRoot: resolve(projectRoot, targetPath),
        drift: await detectDrift(resolve(projectRoot, targetPath), lockFile),
      })),
    );
    const primaryDrift = driftReports[0]?.drift;
    if (!primaryDrift) {
      return { exitCode: 1, stderr: "No targets defined in skillsync.yaml" };
    }

    // Plan sync
    const plan = await planSync({
      manifest: {
        skills: manifest.skills,
        installMode: manifest.installMode,
        overrides: manifest.overrides,
      },
      lockFile,
      resolvedSkills: prepared,
      driftReport: primaryDrift,
    });

    if (dryRun) {
      const output = formatOutput(plan, mode, (data) => formatPlanText(data as typeof plan));
      return { exitCode: 0, stdout: output };
    }

    // Check for conflicts
    if (plan.conflicts.length > 0 && !force) {
      const conflictNames = plan.conflicts.map((c) => c.name).join(", ");
      const msg = `Sync blocked by ${plan.conflicts.length} conflict(s): ${conflictNames}\nUse --force to overwrite local changes.`;
      if (mode === "json") {
        return { exitCode: 1, stdout: JSON.stringify({ error: "conflicts", conflicts: plan.conflicts }, null, 2), stderr: msg };
      }
      return { exitCode: 1, stderr: msg };
    }

    // Apply: materialize installs and updates
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
      lockSkill(updatedLock, install.name, install.source, install.installMode, lockFiles);
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
      lockSkill(updatedLock, update.name, update.source, update.installMode, lockFiles);
    }

    for (const name of plan.remove) {
      for (const { targetRoot } of driftReports) {
        await dematerialize(name, targetRoot);
      }
      delete updatedLock.skills[name];
    }

    // Write config if present
    if (Object.keys(manifest.config).length > 0) {
      for (const { targetRoot } of driftReports) {
        const installedPkgs = [];
        for (const skillName of Object.keys(updatedLock.skills)) {
          try {
            const pkg = await loadSkillPackage(resolve(targetRoot, skillName));
            installedPkgs.push(pkg);
          } catch {
            // Skip missing installs for this target; drift will report them elsewhere.
          }
        }
        const mergedConfig = generateConfig({
          manifestConfig: manifest.config,
          installedSkills: installedPkgs,
        });
        await writeProjectConfig(targetRoot, mergedConfig);
      }
    }

    // Write lock file
    await writeLockFile(projectRoot, updatedLock);

    // Cleanup disposable sources
    for (const source of sources) {
      if ("dispose" in source && typeof (source as { dispose: () => Promise<void> }).dispose === "function") {
        await (source as { dispose: () => Promise<void> }).dispose();
      }
    }

    // Compatibility warnings
    const warnings: string[] = [];
    for (const install of [...plan.install, ...plan.update]) {
      try {
        const pkg = await loadSkillPackage(resolve(projectRoot, primaryTarget, install.name));
        const diags = checkAllTargetCompatibility(pkg, manifest.targets);
        for (const d of diags) {
          warnings.push(`${d.severity}: ${d.message}`);
        }
      } catch {
        // Skip warning generation when a target copy could not be read.
      }
    }

    const summary = {
      installed: plan.install.map((i) => i.name),
      updated: plan.update.map((u) => u.name),
      removed: plan.remove,
      unchanged: plan.unchanged,
      warnings,
    };

    const output = formatOutput(summary, mode, (data) => {
      const s = data as typeof summary;
      const lines: string[] = [];
      if (s.installed.length) lines.push(`Installed: ${s.installed.join(", ")}`);
      if (s.updated.length) lines.push(`Updated: ${s.updated.join(", ")}`);
      if (s.removed.length) lines.push(`Removed: ${s.removed.join(", ")}`);
      if (s.unchanged.length) lines.push(`Unchanged: ${s.unchanged.join(", ")}`);
      if (s.warnings.length) lines.push("", ...s.warnings);
      return lines.length ? lines.join("\n") : "Nothing to do.";
    });

    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
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

function formatPlanText(plan: { install: { name: string }[]; update: { name: string }[]; remove: string[]; conflicts: { name: string }[]; unchanged: string[]; warnings: string[] }): string {
  const lines: string[] = [];
  if (plan.install.length) lines.push(`Install: ${plan.install.map((i) => i.name).join(", ")}`);
  if (plan.update.length) lines.push(`Update: ${plan.update.map((u) => u.name).join(", ")}`);
  if (plan.remove.length) lines.push(`Remove: ${plan.remove.join(", ")}`);
  if (plan.conflicts.length) lines.push(`Conflicts: ${plan.conflicts.map((c) => c.name).join(", ")}`);
  if (plan.unchanged.length) lines.push(`Unchanged: ${plan.unchanged.join(", ")}`);
  if (plan.warnings.length) lines.push("", ...plan.warnings);
  return lines.length ? lines.join("\n") : "Nothing to do.";
}
