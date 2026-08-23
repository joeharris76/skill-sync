import { copyFile, mkdir, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashSkillDirectory } from "./hasher.js";
import { normalizeSkillName } from "./paths.js";
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

/**
 * Materialize a skill from source into a target directory.
 *
 * - **copy**: Plain file copy. No tracking beyond provenance.
 * - **symlink**: Create a symlink from target to source. Fast, not portable.
 * - **mirror**: File copy with full hash tracking in the lock file.
 */
export async function materialize(opts: MaterializeOptions): Promise<MaterializeResult> {
  const normalizedSkill = normalizeSkillName(opts.skillName);
  const targetDir = join(opts.targetRoot, normalizedSkill);
  assertContained(opts.targetRoot, targetDir);

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
    const normalizedFileRel = normalizeSkillName(file.relativePath);
    const srcFile = join(opts.sourcePath, normalizedFileRel);
    const destFile = join(targetDir, normalizedFileRel);
    assertContained(targetDir, destFile);
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
export async function dematerialize(skillName: string, targetRoot: string): Promise<void> {
  const normalizedSkill = normalizeSkillName(skillName);
  const targetDir = join(targetRoot, normalizedSkill);
  assertContained(targetRoot, targetDir);
  await rm(targetDir, { recursive: true, force: true });
}
