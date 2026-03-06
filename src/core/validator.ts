import { readFile } from "node:fs/promises";
import type { ValidationResult, ValidationDiagnostic, SkillPackage, Manifest } from "./types.js";
import { loadSkillPackage } from "./parser.js";
import { checkPortability } from "./portability.js";
import { parseManifest } from "./manifest.js";
import { isPortableMode } from "./portability.js";

/**
 * Validate a skill package directory.
 *
 * Checks:
 * - SKILL.md exists and has frontmatter with name + description
 * - No non-portable paths in content
 * - skillsync.meta.yaml is valid if present
 */
export async function validateSkillPackage(
  skillDir: string,
): Promise<ValidationResult> {
  const diagnostics: ValidationDiagnostic[] = [];

  let pkg: SkillPackage;
  try {
    pkg = await loadSkillPackage(skillDir);
  } catch (err) {
    return {
      valid: false,
      diagnostics: [{
        rule: "load-error",
        severity: "error",
        message: `Failed to load skill package: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }

  // Check frontmatter fields
  if (!pkg.skillMd.name) {
    diagnostics.push({
      rule: "missing-frontmatter-name",
      severity: "warning",
      message: "SKILL.md is missing a \"name\" field in frontmatter",
      skill: pkg.name,
      file: "SKILL.md",
    });
  }
  if (!pkg.skillMd.description) {
    diagnostics.push({
      rule: "missing-frontmatter-description",
      severity: "warning",
      message: "SKILL.md is missing a \"description\" field in frontmatter",
      skill: pkg.name,
      file: "SKILL.md",
    });
  }

  // Check for non-portable paths
  const portabilityDiags = await checkPortability(pkg);
  diagnostics.push(...portabilityDiags);

  // Check for empty files array (no SKILL.md content)
  if (pkg.files.length === 0) {
    diagnostics.push({
      rule: "empty-package",
      severity: "error",
      message: "Skill package contains no files",
      skill: pkg.name,
    });
  }

  // Portability diagnostics are errors (non-portable paths make a skill invalid)
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  return { valid: !hasErrors, diagnostics };
}

/**
 * Validate a skillsync.yaml manifest file.
 *
 * Checks:
 * - Valid YAML with required version field
 * - All sources have required fields per type
 * - Source types are recognized
 * - Skills list is non-empty
 * - Targets are defined
 */
export async function validateManifest(
  manifestPath: string,
): Promise<ValidationResult> {
  const diagnostics: ValidationDiagnostic[] = [];

  let content: string;
  try {
    content = await readFile(manifestPath, "utf-8");
  } catch (err) {
    return {
      valid: false,
      diagnostics: [{
        rule: "manifest-read-error",
        severity: "error",
        message: `Cannot read manifest: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }

  let manifest: Manifest;
  try {
    manifest = parseManifest(content);
  } catch (err) {
    return {
      valid: false,
      diagnostics: [{
        rule: "manifest-parse-error",
        severity: "error",
        message: err instanceof Error ? err.message : String(err),
      }],
    };
  }

  // Check sources
  if (manifest.sources.length === 0) {
    diagnostics.push({
      rule: "no-sources",
      severity: "warning",
      message: "No sources defined in manifest",
    });
  }

  // Check skills
  if (manifest.skills.length === 0) {
    diagnostics.push({
      rule: "no-skills",
      severity: "warning",
      message: "No skills listed in manifest",
    });
  }

  // Check targets
  if (Object.keys(manifest.targets).length === 0) {
    diagnostics.push({
      rule: "no-targets",
      severity: "error",
      message: "No targets defined in manifest",
    });
  }

  // Portability check on install mode
  if (!isPortableMode(manifest.installMode)) {
    diagnostics.push({
      rule: "non-portable-install-mode",
      severity: "warning",
      message: `Default install mode "${manifest.installMode}" is not portable`,
    });
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  return { valid: !hasErrors, diagnostics };
}
