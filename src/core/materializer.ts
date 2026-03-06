import { copyFile, mkdir, symlink, readlink, rm } from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";
import type { InstallMode, SkillFile } from "./types.js";
import { hashSkillDirectory } from "./hasher.js";

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

/**
 * Materialize a skill from source into a target directory.
 *
 * - **copy**: Plain file copy. No tracking beyond provenance.
 * - **symlink**: Create a symlink from target to source. Fast, not portable.
 * - **mirror**: File copy with full hash tracking in the lock file.
 */
export async function materialize(
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const targetDir = join(opts.targetRoot, opts.skillName);

  switch (opts.mode) {
    case "symlink":
      return materializeSymlink(opts, targetDir);
    case "copy":
    case "mirror":
      return materializeCopy(opts, targetDir);
  }
}

async function materializeCopy(
  opts: MaterializeOptions,
  targetDir: string,
): Promise<MaterializeResult> {
  // Remove existing target directory to ensure clean state
  await rm(targetDir, { recursive: true, force: true });

  for (const file of opts.sourceFiles) {
    const srcFile = join(opts.sourcePath, file.relativePath);
    const destFile = join(targetDir, file.relativePath);
    await mkdir(dirname(destFile), { recursive: true });
    await copyFile(srcFile, destFile);
  }

  // For mirror mode, re-hash the target to confirm integrity
  const resultFiles =
    opts.mode === "mirror" ? await hashSkillDirectory(targetDir) : opts.sourceFiles;

  return {
    targetPath: targetDir,
    files: resultFiles,
    mode: opts.mode,
  };
}

async function materializeSymlink(
  opts: MaterializeOptions,
  targetDir: string,
): Promise<MaterializeResult> {
  // Remove existing target (file, directory, or symlink)
  await rm(targetDir, { recursive: true, force: true });

  // Ensure parent directory exists
  await mkdir(dirname(targetDir), { recursive: true });

  // Create symlink pointing to the source directory
  await symlink(opts.sourcePath, targetDir, "dir");

  return {
    targetPath: targetDir,
    files: opts.sourceFiles,
    mode: "symlink",
  };
}

/**
 * Remove a materialized skill from a target directory.
 */
export async function dematerialize(
  skillName: string,
  targetRoot: string,
): Promise<void> {
  const targetDir = join(targetRoot, skillName);
  await rm(targetDir, { recursive: true, force: true });
}
