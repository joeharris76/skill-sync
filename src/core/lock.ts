import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type {
  LockFile,
  LockedSkill,
  SkillFile,
  SourceProvenance,
  InstallMode,
} from "./types.js";

const LOCK_VERSION = 1;
const LOCK_FILENAME = "skillsync.lock";

/** Create an empty lock file. */
export function createLockFile(): LockFile {
  return {
    version: LOCK_VERSION,
    lockedAt: new Date().toISOString(),
    skills: {},
  };
}

/** Read a lock file from the project root. Returns null if not found. */
export async function readLockFile(
  projectRoot: string,
): Promise<LockFile | null> {
  try {
    const content = await readFile(join(projectRoot, LOCK_FILENAME), "utf-8");
    const parsed = JSON.parse(content) as LockFile;
    if (parsed.version !== LOCK_VERSION) {
      throw new Error(
        `Unsupported lock file version: ${parsed.version} (expected ${LOCK_VERSION})`,
      );
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Write a lock file atomically to the project root.
 * Writes to a temporary file first, then renames.
 */
export async function writeLockFile(
  projectRoot: string,
  lockFile: LockFile,
): Promise<void> {
  const lockPath = join(projectRoot, LOCK_FILENAME);
  const tmpPath = lockPath + ".tmp";

  lockFile.lockedAt = new Date().toISOString();
  const content = JSON.stringify(lockFile, null, 2) + "\n";

  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, lockPath);
}

/** Add or update a skill entry in the lock file. */
export function lockSkill(
  lockFile: LockFile,
  skillName: string,
  source: SourceProvenance,
  installMode: InstallMode,
  files: SkillFile[],
): void {
  const fileEntries: Record<string, { sha256: string; size: number }> = {};
  for (const f of files) {
    fileEntries[f.relativePath] = { sha256: f.sha256, size: f.size };
  }

  lockFile.skills[skillName] = {
    source,
    installMode,
    files: fileEntries,
  };
}

/** Remove a skill entry from the lock file. */
export function unlockSkill(lockFile: LockFile, skillName: string): void {
  delete lockFile.skills[skillName];
}

/** Get a locked skill entry, or null if not locked. */
export function getLockedSkill(
  lockFile: LockFile,
  skillName: string,
): LockedSkill | null {
  return lockFile.skills[skillName] ?? null;
}

/** Parse a lock file JSON string into a LockFile. */
export function parseLockFile(content: string): LockFile {
  const parsed = JSON.parse(content) as LockFile;
  if (parsed.version !== LOCK_VERSION) {
    throw new Error(
      `Unsupported lock file version: ${parsed.version} (expected ${LOCK_VERSION})`,
    );
  }
  return parsed;
}

/** Serialize a LockFile to a JSON string. */
export function serializeLockFile(lockFile: LockFile): string {
  return JSON.stringify(lockFile, null, 2) + "\n";
}
