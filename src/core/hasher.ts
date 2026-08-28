import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { SkillFile } from "./types.js";

export interface HashSkillDirectoryOptions {
  /** Skip an entry and its descendants when its package-relative path matches. */
  excludePath?: (relativePath: string) => boolean;
}

/** Compute SHA256 hex digest of a file. */
export async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/** Compute SHA256 hex digest of a string or buffer. */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Walk a skill directory and return SkillFile entries for every file.
 * Excludes directories, follows no symlinks into outside paths.
 */
export async function hashSkillDirectory(
  skillDir: string,
  options: HashSkillDirectoryOptions = {},
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  await walkDir(skillDir, skillDir, files, options);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

async function walkDir(
  baseDir: string,
  currentDir: string,
  out: SkillFile[],
  options: HashSkillDirectoryOptions,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relativePath = relative(baseDir, fullPath).split(sep).join(posix.sep);
    if (options.excludePath?.(relativePath)) continue;
    if (entry.isDirectory()) {
      await walkDir(baseDir, fullPath, out, options);
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      const hash = await sha256File(fullPath);
      out.push({
        relativePath,
        size: fileStat.size,
        sha256: hash,
      });
    }
  }
}
