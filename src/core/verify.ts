import { lstat, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { generateConfig, serializeProjectConfig } from "./config-generator.js";
import { hashSkillDirectory } from "./hasher.js";
import { loadSkillPackage } from "./parser.js";
import { relativeInside, resolvePath } from "./paths.js";
import type { LockFile, Manifest } from "./types.js";

// ---------------------------------------------------------------------------
// Tracked-snapshot integrity gate
// ---------------------------------------------------------------------------
//
// `verify` proves that a committed snapshot of a tracked target matches the
// lock + the generated config — OFFLINE, with no access to the skills source.
// This is the cloud/CI-enforceable check: it catches hand-edits, stale or
// edited config, extra committed files, and missing files.
//
// It deliberately does NOT use `detectDrift`, which is unsound as a gate: it
// only checks files listed in the lock (so an extra committed file passes), it
// never verifies config content, and it treats symlinked skills as clean. This
// module enumerates the actual on-disk tree and checks completeness in both
// directions.

export type VerifyIssueKind =
  | "missing-skill"
  | "modified-file"
  | "extra-file"
  | "stray-path"
  | "config-mismatch"
  | "missing-config"
  | "symlink"
  | "outside-repo";

export interface VerifyIssue {
  /** Target key (e.g. "claude"). */
  target: string;
  kind: VerifyIssueKind;
  message: string;
  skill?: string;
  file?: string;
}

export interface VerifyReport {
  ok: boolean;
  /** Tracked target keys that were checked. */
  checkedTargets: string[];
  issues: VerifyIssue[];
}

/**
 * Verify every tracked target's committed snapshot against the lock + config.
 * Untracked targets are ignored. Excluded skills (gitignored within a tracked
 * target) are skipped — they are legitimately absent in a fresh clone.
 */
export async function verifyTrackedTargets(
  projectRoot: string,
  manifest: Manifest,
  lockFile: LockFile,
): Promise<VerifyReport> {
  const issues: VerifyIssue[] = [];
  const checkedTargets: string[] = [];

  for (const [targetKey, cfg] of Object.entries(manifest.targets)) {
    if (!cfg.tracked) continue;
    checkedTargets.push(targetKey);

    if (relativeInside(projectRoot, cfg.dir) === null) {
      issues.push({
        target: targetKey,
        kind: "outside-repo",
        message: `Tracked target "${targetKey}" (${cfg.dir}) resolves outside the repo and cannot be committed.`,
      });
      continue;
    }

    const targetRoot = resolvePath(projectRoot, cfg.dir);
    const exclusions = new Set(cfg.ignore ?? []);
    const expectedSkills = Object.keys(lockFile.skills).filter((n) => !exclusions.has(n));

    // One walk of the whole target tree → every committed file under it.
    let onDisk: Map<string, string>;
    try {
      const files = await hashSkillDirectory(targetRoot);
      onDisk = new Map(files.map((f) => [toPosix(f.relativePath), f.sha256]));
    } catch {
      // Target dir doesn't exist at all → every expected skill is missing.
      for (const skill of expectedSkills) {
        issues.push({
          target: targetKey,
          kind: "missing-skill",
          skill,
          message: `Skill "${skill}" is missing from tracked target "${targetKey}".`,
        });
      }
      continue;
    }

    const claimed = new Set<string>();

    // Forward check: every locked file must be present with the right hash.
    for (const skill of expectedSkills) {
      const skillDir = join(targetRoot, skill);
      const stat = await lstat(skillDir).catch(() => null);
      if (!stat) {
        issues.push({
          target: targetKey,
          kind: "missing-skill",
          skill,
          message: `Skill "${skill}" is missing from tracked target "${targetKey}".`,
        });
        continue;
      }
      if (stat.isSymbolicLink()) {
        issues.push({
          target: targetKey,
          kind: "symlink",
          skill,
          message: `Skill "${skill}" in tracked target "${targetKey}" is a symlink; symlinks cannot be committed portably. Use install_mode copy/mirror.`,
        });
        continue;
      }

      for (const [fileRel, locked] of Object.entries(lockFile.skills[skill]!.files)) {
        const full = `${skill}/${toPosix(fileRel)}`;
        claimed.add(full);
        const actual = onDisk.get(full);
        if (actual === undefined) {
          issues.push({
            target: targetKey,
            kind: "modified-file",
            skill,
            file: fileRel,
            message: `File "${full}" is in the lock but missing on disk.`,
          });
        } else if (actual !== locked.sha256) {
          issues.push({
            target: targetKey,
            kind: "modified-file",
            skill,
            file: fileRel,
            message: `File "${full}" does not match the lock (was it hand-edited?).`,
          });
        }
      }
    }

    // Config check: regenerate exclusion-aware and byte-compare the committed file.
    await verifyConfig(targetKey, targetRoot, manifest, expectedSkills, claimed, issues);

    // Reverse check: every committed file must belong to an expected skill, the
    // config, or an excluded skill (gitignored but possibly present locally).
    for (const path of onDisk.keys()) {
      if (claimed.has(path)) continue;
      if ([...exclusions].some((ex) => path === ex || path.startsWith(`${ex}/`))) continue;
      const ownerSkill = expectedSkills.find((s) => path.startsWith(`${s}/`));
      if (ownerSkill) {
        issues.push({
          target: targetKey,
          kind: "extra-file",
          skill: ownerSkill,
          file: path.slice(ownerSkill.length + 1),
          message: `File "${path}" is committed but not in the lock (extra file inside a skill).`,
        });
      } else {
        issues.push({
          target: targetKey,
          kind: "stray-path",
          file: path,
          message: `File "${path}" is committed under tracked target "${targetKey}" but belongs to no locked skill.`,
        });
      }
    }
  }

  return { ok: issues.length === 0, checkedTargets, issues };
}

async function verifyConfig(
  targetKey: string,
  targetRoot: string,
  manifest: Manifest,
  expectedSkills: string[],
  claimed: Set<string>,
  issues: VerifyIssue[],
): Promise<void> {
  const exclusions = new Set(manifest.targets[targetKey]?.ignore ?? []);
  const installedPkgs = [];
  for (const skill of expectedSkills) {
    try {
      installedPkgs.push(await loadSkillPackage(join(targetRoot, skill)));
    } catch {
      // A missing skill is already reported by the forward check.
    }
  }
  const manifestConfig = Object.fromEntries(
    Object.entries(manifest.config).filter(([skill]) => !exclusions.has(skill)),
  );
  const merged = generateConfig({ manifestConfig, installedSkills: installedPkgs });

  const configRel = "skill-sync.config.yaml";
  claimed.add(configRel);
  const committed = await readFile(join(targetRoot, configRel), "utf-8").catch(() => null);

  if (Object.keys(merged).length === 0) {
    if (committed !== null) {
      issues.push({
        target: targetKey,
        kind: "config-mismatch",
        file: configRel,
        message: `"${configRel}" is committed but no config is expected; re-run sync.`,
      });
    }
    return;
  }

  const expected = serializeProjectConfig(merged);
  if (committed === null) {
    issues.push({
      target: targetKey,
      kind: "missing-config",
      file: configRel,
      message: `"${configRel}" is expected but missing from tracked target "${targetKey}".`,
    });
  } else if (committed !== expected) {
    issues.push({
      target: targetKey,
      kind: "config-mismatch",
      file: configRel,
      message: `"${configRel}" does not match the regenerated config (stale or hand-edited).`,
    });
  }
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
