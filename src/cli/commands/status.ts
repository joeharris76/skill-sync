import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput, formatTable } from "../output.js";
import { readManifest } from "../../core/manifest.js";
import { readLockFile } from "../../core/lock.js";
import { detectDrift } from "../../core/drift.js";

export async function statusCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));

  try {
    let manifest;
    try {
      manifest = await readManifest(projectRoot);
    } catch {
      const data = { locked: false, skills: [], message: "No skill-sync.yaml found." };
      return { exitCode: 0, stdout: formatOutput(data, mode, () => data.message) };
    }
    const lockFile = await readLockFile(projectRoot);

    if (!lockFile) {
      const msg = "No lock file found. Run `skill-sync sync` first.";
      if (mode === "json") {
        return { exitCode: 0, stdout: JSON.stringify({ locked: false, skills: [] }, null, 2) };
      }
      return { exitCode: 0, stdout: msg };
    }

    const targetEntries = Object.entries(manifest.targets);
    const primaryTarget = targetEntries[0]?.[1];
    if (!primaryTarget) {
      return { exitCode: 1, stderr: "No targets defined in skill-sync.yaml" };
    }
    const perTarget = await Promise.all(
      targetEntries.map(async ([targetName, targetPath]) => {
        const drift = await detectDrift(resolve(projectRoot, targetPath), lockFile);
        const skills = Object.entries(lockFile.skills).map(([name, locked]) => {
          let state: string;
          if (drift.missing.includes(name)) {
            state = "missing";
          } else if (drift.modified.some((d) => d.skill === name)) {
            state = "modified";
          } else {
            state = "clean";
          }
          return {
            name,
            source: locked.source.name,
            mode: locked.installMode,
            state,
            files: Object.keys(locked.files).length,
          };
        });

        for (const extra of drift.extra) {
          skills.push({
            name: extra,
            source: "<untracked>",
            mode: "unknown" as never,
            state: "extra",
            files: 0,
          });
        }

        return {
          target: targetName,
          path: targetPath,
          skills,
          summary: {
            clean: drift.clean.length,
            modified:
              drift.modified.length > 0
                ? [...new Set(drift.modified.map((d) => d.skill))].length
                : 0,
            missing: drift.missing.length,
            extra: drift.extra.length,
          },
        };
      }),
    );

    const data = {
      locked: true,
      targets: perTarget,
    };

    const output = formatOutput(data, mode, () => {
      const lines: string[] = [];
      for (const target of perTarget) {
        lines.push(`Target: ${target.target} (${target.path})`, "");
        if (target.skills.length === 0) {
          lines.push("No skills installed.");
        } else {
          lines.push(
            formatTable(
              target.skills.map((s) => ({
                Name: s.name,
                Source: s.source,
                Mode: s.mode,
                State: s.state,
                Files: s.files,
              })),
              ["Name", "Source", "Mode", "State", "Files"],
            ),
          );
          lines.push("");
          lines.push(
            `${target.summary.clean} clean, ${target.summary.modified} modified, ${target.summary.missing} missing, ${target.summary.extra} extra`,
          );
        }
        lines.push("");
      }
      return lines.join("\n").trimEnd();
    });

    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}
