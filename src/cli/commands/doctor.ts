import { resolve } from "node:path";
import { access, constants } from "node:fs/promises";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { readManifest } from "../../core/manifest.js";
import { readLockFile } from "../../core/lock.js";
import { detectDrift } from "../../core/drift.js";
import { isPortableMode } from "../../core/portability.js";
import { isImplementedSourceType } from "../source-factory.js";

interface CheckResult {
  check: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function doctorCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));
  const checks: CheckResult[] = [];

  // Check 1: Manifest exists and parses
  let manifest;
  try {
    manifest = await readManifest(projectRoot);
    checks.push({ check: "manifest", status: "ok", message: "skillsync.yaml found and valid" });
  } catch (err) {
    checks.push({
      check: "manifest",
      status: "error",
      message: err instanceof Error ? err.message : "skillsync.yaml not found or invalid",
    });
  }

  // Check 2: Lock file exists
  const lockFile = await readLockFile(projectRoot);
  if (lockFile) {
    checks.push({ check: "lockfile", status: "ok", message: `Lock file has ${Object.keys(lockFile.skills).length} skill(s)` });
  } else {
    checks.push({ check: "lockfile", status: "warn", message: "No lock file. Run `skillsync sync` to create one." });
  }

  // Check 3: Target directories exist
  if (manifest) {
    for (const source of manifest.sources) {
      if (isImplementedSourceType(source.type)) {
        checks.push({
          check: `source:${source.name}`,
          status: "ok",
          message: `Source type "${source.type}" is supported`,
        });
      } else {
        checks.push({
          check: `source:${source.name}`,
          status: "warn",
          message: `Source type "${source.type}" is not implemented yet`,
        });
      }
    }

    for (const [target, dir] of Object.entries(manifest.targets)) {
      const targetPath = resolve(projectRoot, dir);
      try {
        await access(targetPath, constants.R_OK);
        checks.push({ check: `target:${target}`, status: "ok", message: `${dir} exists` });
      } catch {
        checks.push({ check: `target:${target}`, status: "warn", message: `${dir} does not exist yet` });
      }
    }
  }

  // Check 4: Drift detection
  if (manifest && lockFile) {
    for (const [target, dir] of Object.entries(manifest.targets)) {
      const targetRoot = resolve(projectRoot, dir);
      const drift = await detectDrift(targetRoot, lockFile);
      if (drift.modified.length === 0 && drift.missing.length === 0) {
        checks.push({
          check: `drift:${target}`,
          status: "ok",
          message: "All installed skills match lock file",
        });
      } else {
        const issues: string[] = [];
        if (drift.modified.length > 0) issues.push(`${drift.modified.length} modified file(s)`);
        if (drift.missing.length > 0) issues.push(`${drift.missing.length} missing skill(s)`);
        checks.push({
          check: `drift:${target}`,
          status: "warn",
          message: `Drift detected: ${issues.join(", ")}`,
        });
      }
      if (drift.extra.length > 0) {
        checks.push({
          check: `extra:${target}`,
          status: "warn",
          message: `${drift.extra.length} untracked skill(s): ${drift.extra.join(", ")}`,
        });
      }
    }
  }

  // Check 5: Portability
  if (manifest) {
    if (isPortableMode(manifest.installMode)) {
      checks.push({ check: "portability", status: "ok", message: `Install mode "${manifest.installMode}" is portable` });
    } else {
      checks.push({ check: "portability", status: "warn", message: `Install mode "${manifest.installMode}" is not portable (CI/web won't work)` });
    }
  }

  const hasErrors = checks.some((c) => c.status === "error");
  const data = { healthy: !hasErrors, checks };

  const output = formatOutput(data, mode, () => {
    return checks
      .map((c) => {
        const icon = c.status === "ok" ? "OK" : c.status === "warn" ? "!!" : "XX";
        return `[${icon}] ${c.check}: ${c.message}`;
      })
      .join("\n");
  });

  return { exitCode: hasErrors ? 1 : 0, stdout: output };
}
