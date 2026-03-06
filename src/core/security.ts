import type { SkillPackage, ValidationDiagnostic } from "./types.js";
import type { TrustPolicy } from "./trust.js";

/** File extensions considered executable. */
const EXECUTABLE_EXTENSIONS = new Set([".sh", ".bash", ".py", ".rb", ".js", ".ts", ".ps1", ".bat", ".cmd"]);

/** Patterns indicating executable content in non-executable files. */
const SHEBANG_PATTERN = /^#!\//;

/**
 * Check a skill package for executable scripts and unsafe operations.
 *
 * Returns warnings for scripts found in the package. If the trust policy
 * disallows scripts, these become errors.
 */
export function checkScriptSafety(
  pkg: SkillPackage,
  policy: TrustPolicy = {},
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const severity = policy.allowScripts === false ? "error" as const : "warning" as const;

  for (const file of pkg.files) {
    // Check scripts/ directory
    if (file.relativePath.startsWith("scripts/")) {
      const ext = getExtension(file.relativePath);
      if (EXECUTABLE_EXTENSIONS.has(ext)) {
        diagnostics.push({
          rule: "executable-script",
          severity,
          message: `Skill "${pkg.name}" contains executable script: ${file.relativePath}`,
          skill: pkg.name,
          file: file.relativePath,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Check for unsafe patterns in skill content that could indicate
 * command injection or other security risks.
 */
export function checkUnsafePatterns(
  pkg: SkillPackage,
  content: Map<string, string>,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  for (const [relativePath, text] of content) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Check for shebangs in non-script files
      if (i === 0 && SHEBANG_PATTERN.test(line) && !relativePath.startsWith("scripts/")) {
        diagnostics.push({
          rule: "unexpected-shebang",
          severity: "warning",
          message: `File "${relativePath}" has a shebang line but is not in scripts/`,
          skill: pkg.name,
          file: relativePath,
          line: 1,
        });
      }
    }
  }

  return diagnostics;
}

function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot) : "";
}
