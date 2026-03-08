import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillPackage, InstallMode, ValidationDiagnostic } from "./types.js";

// Patterns that indicate non-portable paths
const NON_PORTABLE_PATTERNS = [
  /~\//,                              // Home directory references
  /\/Users\/[^/]+\//,                 // macOS absolute user paths
  /\/home\/[^/]+\//,                  // Linux absolute user paths
  /C:\\Users\\/i,                     // Windows user paths
  /\/\.claude\/skills\//,             // Direct references to global Claude skill store
  /\/\.codex\/skills\//,              // Direct references to global Codex skill store
];

/**
 * Check a skill package for portability issues.
 *
 * Scans SKILL.md body and reference files for absolute paths or
 * home-directory references that would break in CI, web, or another
 * developer's machine.
 */
export async function checkPortability(
  pkg: SkillPackage,
): Promise<ValidationDiagnostic[]> {
  const diagnostics: ValidationDiagnostic[] = [];

  // Check skill content files (skip sync engine metadata)
  for (const file of pkg.files) {
    if (!isTextFile(file.relativePath)) continue;
    if (file.relativePath === "skill.yaml") continue;

    const filePath = join(pkg.path, file.relativePath);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of NON_PORTABLE_PATTERNS) {
        if (pattern.test(line)) {
          diagnostics.push({
            rule: "non-portable-path",
            severity: "error",
            message: `Non-portable path detected: ${pattern.source}`,
            skill: pkg.name,
            file: file.relativePath,
            line: i + 1,
          });
          break; // One diagnostic per line is enough
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Check if a given install mode is portable.
 * Symlink mode is inherently non-portable.
 */
export function isPortableMode(mode: InstallMode): boolean {
  return mode !== "symlink";
}

/**
 * Validate that a project's skill installation is fully portable.
 * Checks install mode and file content for non-portable references.
 */
export async function validatePortability(
  pkg: SkillPackage,
  mode: InstallMode,
): Promise<ValidationDiagnostic[]> {
  const diagnostics: ValidationDiagnostic[] = [];

  if (!isPortableMode(mode)) {
    diagnostics.push({
      rule: "non-portable-install-mode",
      severity: "warning",
      message: `Skill "${pkg.name}" uses symlink mode, which is not portable to CI or web environments`,
      skill: pkg.name,
    });
  }

  diagnostics.push(...(await checkPortability(pkg)));

  return diagnostics;
}

function isTextFile(relativePath: string): boolean {
  const textExtensions = [".md", ".yaml", ".yml", ".json", ".txt", ".sh"];
  return textExtensions.some((ext) => relativePath.endsWith(ext));
}
