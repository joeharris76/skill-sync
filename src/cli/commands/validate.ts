import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput, formatDiagnostics } from "../output.js";
import { readManifest } from "../../core/manifest.js";
import { readLockFile } from "../../core/lock.js";
import { loadSkillPackage } from "../../core/parser.js";
import { validatePortability } from "../../core/portability.js";
import { checkAllTargetCompatibility } from "../../core/compatibility.js";
import { validateConfigOverrides } from "../../core/config-generator.js";
import type { ValidationDiagnostic } from "../../core/types.js";
import { checkSourceTrust, checkProvenanceRequired, DEFAULT_TRUST_POLICY } from "../../core/trust.js";
import { checkScriptSafety } from "../../core/security.js";
import { isImplementedSourceType } from "../source-factory.js";

export async function validateCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const exitCodeFlag = !!args.flags["exit-code"];
  const projectRoot = resolve(String(args.flags.project ?? "."));

  try {
    let manifest;
    try {
      manifest = await readManifest(projectRoot);
    } catch {
      const result = { valid: true, diagnostics: [{ rule: "no-manifest", severity: "warning" as const, message: "No skill-sync.yaml found." }] };
      return { exitCode: 0, stdout: formatOutput(result, mode, () => "WARN  No skill-sync.yaml found.\n\nValidation passed with warnings.") };
    }
    const lockFile = await readLockFile(projectRoot);

    const diagnostics: ValidationDiagnostic[] = [];

    for (const source of manifest.sources) {
      if (!isImplementedSourceType(source.type)) {
        diagnostics.push({
          rule: "unsupported-source-type",
          severity: "error",
          message: `Source "${source.name}" uses type "${source.type}", which is not implemented yet`,
        });
      }
      diagnostics.push(...checkSourceTrust(source, DEFAULT_TRUST_POLICY));
    }

    if (!lockFile) {
      diagnostics.push({
        rule: "no-lock-file",
        severity: "warning",
        message: "No lock file found. Run `skill-sync sync` to create one.",
      });
    }

    const targetEntries = Object.entries(manifest.targets);
    const primaryTarget = targetEntries[0]?.[1];
    if (!primaryTarget) {
      diagnostics.push({
        rule: "no-targets",
        severity: "error",
        message: "No targets defined in skill-sync.yaml",
      });
    }

    // Validate installed skills
    if (lockFile && primaryTarget) {
      const installedPkgs = [];

      for (const [skillName, locked] of Object.entries(lockFile.skills)) {
        let primaryPkgLoaded = false;
        for (const [targetName, targetPath] of targetEntries) {
          const skillPath = resolve(projectRoot, targetPath, skillName);
          try {
            const pkg = await loadSkillPackage(skillPath);
            if (!primaryPkgLoaded) {
              installedPkgs.push(pkg);
              primaryPkgLoaded = true;
            }
            if (targetName === targetEntries[0]?.[0]) {
              const portDiags = await validatePortability(pkg, locked.installMode);
              diagnostics.push(...portDiags);
              const compatDiags = checkAllTargetCompatibility(pkg, manifest.targets);
              diagnostics.push(...compatDiags);
              diagnostics.push(...checkScriptSafety(pkg, DEFAULT_TRUST_POLICY));
              diagnostics.push(...checkProvenanceRequired(skillName, locked.source, DEFAULT_TRUST_POLICY));
            }
          } catch {
            diagnostics.push({
              rule: "skill-not-found",
              severity: "error",
              message: `Locked skill "${skillName}" not found at ${skillPath}`,
              skill: skillName,
            });
          }
        }
      }

      const configWarnings = validateConfigOverrides(manifest.config, installedPkgs);
      for (const warning of configWarnings) {
        diagnostics.push({
          rule: "config-override",
          severity: "warning",
          message: warning,
        });
      }
    }

    const hasErrors = diagnostics.some((d) => d.severity === "error");
    const valid = !hasErrors;
    const result = { valid, diagnostics };

    const output = formatOutput(result, mode, () => {
      if (diagnostics.length === 0) {
        return "Validation passed. No issues found.";
      }
      const lines = [formatDiagnostics(diagnostics), ""];
      lines.push(valid ? "Validation passed with warnings." : "Validation failed.");
      return lines.join("\n");
    });

    const exitCode = exitCodeFlag && hasErrors ? 1 : 0;
    return { exitCode, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}
