import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, rename, rm, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashSkillDirectory } from "./hasher.js";
import { normalizeManagedSkillName, normalizeSkillName } from "./paths.js";
import type { InstallMode, SkillFile } from "./types.js";

function assertContained(parentRoot: string, childPath: string): void {
  const root = resolve(parentRoot);
  const target = resolve(childPath);
  const rel = relative(root, target);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  ) {
    throw new Error(`Path "${childPath}" must be contained within root "${parentRoot}"`);
  }
}

export interface MaterializeOptions {
  /** Skill name (used for the target subdirectory). */
  skillName: string;
  /** Absolute path to the source skill directory. */
  sourcePath: string;
  /** Absolute path to the target root directory (e.g., .claude/skills). */
  targetRoot: string;
  /** Install mode. */
  mode: InstallMode;
  /** Pre-computed file list from source (avoids re-hashing). */
  sourceFiles: SkillFile[];
}

export interface MaterializeResult {
  /** Absolute path to the materialized skill directory. */
  targetPath: string;
  /** Files that were written/linked. */
  files: SkillFile[];
  /** Install mode that was used. */
  mode: InstallMode;
}

interface PreparedMaterialization {
  result: MaterializeResult;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Materialize a skill from source into a target directory.
 *
 * - **copy**: Plain file copy with staged digest verification.
 * - **symlink**: Create a symlink from target to source. Fast, not portable.
 * - **mirror**: Verified file copy intended for drift-enforced mirrors.
 */
export async function materialize(opts: MaterializeOptions): Promise<MaterializeResult> {
  const prepared = await prepareMaterialization(opts);
  try {
    await prepared.commit();
  } catch (err) {
    await prepared.rollback();
    await prepared.cleanup();
    throw err;
  }
  await prepared.cleanup();
  return prepared.result;
}

/** Stage every target before committing any of them. */
export async function materializeBatch(
  options: MaterializeOptions[],
): Promise<MaterializeResult[]> {
  const prepared: PreparedMaterialization[] = [];
  try {
    for (const opts of options) {
      prepared.push(await prepareMaterialization(opts));
    }
    for (const item of prepared) {
      await item.commit();
    }
  } catch (err) {
    for (const item of [...prepared].reverse()) {
      await item.rollback();
    }
    await Promise.all(prepared.map((item) => item.cleanup()));
    throw err;
  }
  await Promise.all(prepared.map((item) => item.cleanup()));
  return prepared.map((item) => item.result);
}

async function prepareMaterialization(opts: MaterializeOptions): Promise<PreparedMaterialization> {
  const normalizedSkill = normalizeManagedSkillName(opts.skillName);
  const targetDir = join(opts.targetRoot, normalizedSkill);
  assertContained(opts.targetRoot, targetDir);
  await mkdir(dirname(targetDir), { recursive: true });
  const token = randomUUID();
  const stem = basename(targetDir);
  const stageDir = join(dirname(targetDir), `.${stem}.skill-sync-stage-${token}`);
  const backupDir = join(dirname(targetDir), `.${stem}.skill-sync-backup-${token}`);
  assertContained(opts.targetRoot, stageDir);
  assertContained(opts.targetRoot, backupDir);

  let resultFiles = opts.sourceFiles;
  try {
    if (opts.mode === "symlink") {
      await symlink(opts.sourcePath, stageDir, "dir");
    } else {
      await mkdir(stageDir, { recursive: true });
      for (const file of opts.sourceFiles) {
        const normalizedFileRel = normalizeSkillName(file.relativePath);
        const srcFile = join(opts.sourcePath, normalizedFileRel);
        const destFile = join(stageDir, normalizedFileRel);
        assertContained(stageDir, destFile);
        await mkdir(dirname(destFile), { recursive: true });
        await copyFile(srcFile, destFile);
      }
      resultFiles = await hashSkillDirectory(stageDir);
      assertFileDigestsMatch(opts.skillName, opts.sourceFiles, resultFiles, opts.targetRoot);
    }
  } catch (err) {
    await rm(stageDir, { recursive: true, force: true });
    throw err;
  }

  const result: MaterializeResult = {
    targetPath: targetDir,
    files: resultFiles,
    mode: opts.mode,
  };

  let committed = false;
  let hasBackup = false;

  return {
    result,
    async commit() {
      if (await pathExists(targetDir)) {
        await rename(targetDir, backupDir);
        hasBackup = true;
      }
      try {
        await rename(stageDir, targetDir);
        committed = true;
      } catch (err) {
        if (hasBackup) {
          await rename(backupDir, targetDir);
          hasBackup = false;
        }
        throw err;
      }
    },
    async rollback() {
      if (committed) {
        await rm(targetDir, { recursive: true, force: true });
        committed = false;
      }
      if (hasBackup) {
        await rename(backupDir, targetDir);
        hasBackup = false;
      }
      await rm(stageDir, { recursive: true, force: true });
    },
    async cleanup() {
      await rm(stageDir, { recursive: true, force: true });
      await rm(backupDir, { recursive: true, force: true });
      hasBackup = false;
    },
  };
}

function assertFileDigestsMatch(
  skillName: string,
  expectedFiles: SkillFile[],
  actualFiles: SkillFile[],
  targetRoot: string,
): void {
  if (expectedFiles.length !== actualFiles.length) {
    throw new Error(
      `Materialized integrity error for skill "${skillName}" in "${targetRoot}": file count mismatch (expected ${expectedFiles.length}, got ${actualFiles.length})`,
    );
  }
  const actualMap = new Map(actualFiles.map((file) => [file.relativePath, file]));
  for (const expected of expectedFiles) {
    const actual = actualMap.get(expected.relativePath);
    if (actual?.sha256 !== expected.sha256 || actual.size !== expected.size) {
      throw new Error(
        `Materialized integrity error for skill "${skillName}" in "${targetRoot}": file "${expected.relativePath}" differs from the source`,
      );
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Remove a materialized skill from a target directory.
 */
export async function dematerialize(skillName: string, targetRoot: string): Promise<void> {
  const normalizedSkill = normalizeManagedSkillName(skillName);
  const targetDir = join(targetRoot, normalizedSkill);
  assertContained(targetRoot, targetDir);
  await rm(targetDir, { recursive: true, force: true });
}
