import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { readdir } from "node:fs/promises";
import type { SkillFile } from "./types.js";

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
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  await walkDir(skillDir, skillDir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

async function walkDir(
  baseDir: string,
  currentDir: string,
  out: SkillFile[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(baseDir, fullPath, out);
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      const hash = await sha256File(fullPath);
      out.push({
        relativePath: relative(baseDir, fullPath),
        size: fileStat.size,
        sha256: hash,
      });
    }
  }
}
