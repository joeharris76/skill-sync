import type { Dirent } from "node:fs";
import { access, constants, readdir } from "node:fs/promises";
import { join } from "node:path";
import { sha256File } from "./hasher.js";
import { isLoaderOwnedStorePath } from "./paths.js";
import type { DriftReport, LockFile } from "./types.js";

export interface TargetReadiness {
  /** Drift relevant to the target's tracking policy. */
  drift: DriftReport;
  /** Raw on-disk state, including intentionally untracked skills. */
  materialization: DriftReport;
  /** Skills excluded from tracked-snapshot integrity for this target. */
  ignored: string[];
}

/**
 * Apply a target's tracking exclusions without hiding local materialization gaps.
 *
 * A tracked target may intentionally ignore selected skills so they are absent in
 * a fresh clone. Those skills must not be called snapshot drift, but an absent
 * local copy is still useful readiness information.
 */
export async function detectTargetReadiness(
  targetRoot: string,
  lockFile: LockFile,
  ignoredSkills: string[] = [],
): Promise<TargetReadiness> {
  const materialization = await detectDrift(targetRoot, lockFile);
  const ignoredSet = new Set(ignoredSkills);
  const ignored = Object.keys(lockFile.skills)
    .filter((name) => ignoredSet.has(name))
    .sort();

  return {
    materialization,
    ignored,
    drift: {
      clean: materialization.clean.filter((name) => !ignoredSet.has(name)),
      modified: materialization.modified.filter((entry) => !ignoredSet.has(entry.skill)),
      missing: materialization.missing.filter((name) => !ignoredSet.has(name)),
      extra: [...materialization.extra],
    },
  };
}

/**
 * Check the installed store against the lock file.
 * Reports clean skills, modified files, missing skills, and extra skills.
 */
export async function detectDrift(targetRoot: string, lockFile: LockFile): Promise<DriftReport> {
  const report: DriftReport = {
    clean: [],
    modified: [],
    missing: [],
    extra: [],
  };

  const lockedNames = new Set(Object.keys(lockFile.skills));
  const installedNames = await listInstalledSkillNames(targetRoot);
  const _installedSet = new Set(installedNames);

  // Check each locked skill
  for (const [skillName, locked] of Object.entries(lockFile.skills)) {
    if (locked.installMode === "symlink") {
      // Symlinked skills are inherently "drifted" — skip integrity checks
      report.clean.push(skillName);
      continue;
    }

    const skillDir = join(targetRoot, skillName);
    try {
      await access(skillDir, constants.R_OK);
    } catch {
      report.missing.push(skillName);
      continue;
    }

    let isClean = true;
    for (const [relPath, expected] of Object.entries(locked.files)) {
      const filePath = join(skillDir, relPath);
      try {
        const actual = await sha256File(filePath);
        if (actual !== expected.sha256) {
          report.modified.push({
            skill: skillName,
            file: relPath,
            expected: expected.sha256,
            actual,
          });
          isClean = false;
        }
      } catch {
        // File missing from disk but expected by lock
        report.modified.push({
          skill: skillName,
          file: relPath,
          expected: expected.sha256,
          actual: "<missing>",
        });
        isClean = false;
      }
    }

    if (isClean) {
      report.clean.push(skillName);
    }
  }

  // Check for skills on disk but not in lock
  for (const name of installedNames) {
    if (!lockedNames.has(name) && name !== "skill-sync.config.yaml") {
      report.extra.push(name);
    }
  }

  return report;
}

/**
 * List installed skill names in a target root.
 *
 * A skill directory is identified by containing a SKILL.md file.
 * Supports nested paths like SHARED/commit-framework by recursing into
 * subdirectories that don't contain SKILL.md themselves.
 */
export async function listInstalledSkillNames(targetRoot: string, prefix = ""): Promise<string[]> {
  const names: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(join(targetRoot, prefix), { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const skillPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (prefix === "" && isLoaderOwnedStorePath(skillPath)) continue;
    const fullPath = join(targetRoot, skillPath);

    // Check if this directory contains a SKILL.md (is a skill)
    try {
      await access(join(fullPath, "SKILL.md"), constants.R_OK);
      names.push(skillPath);
    } catch {
      // No SKILL.md — recurse into it (could be a namespace like SHARED/)
      const nested = await listInstalledSkillNames(targetRoot, skillPath);
      names.push(...nested);
    }
  }

  return names;
}
