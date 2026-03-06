import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { readManifest } from "../../core/manifest.js";
import { readLockFile, writeLockFile } from "../../core/lock.js";
import { detectDrift } from "../../core/drift.js";
import { dematerialize } from "../../core/materializer.js";

export async function pruneCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const dryRun = !!args.flags["dry-run"];
  const projectRoot = resolve(String(args.flags.project ?? "."));

  try {
    const manifest = await readManifest(projectRoot);
    const lockFile = await readLockFile(projectRoot);

    if (!lockFile) {
      return { exitCode: 0, stdout: mode === "json" ? JSON.stringify({ pruned: [] }, null, 2) : "Nothing to prune (no lock file)." };
    }

    const targetEntries = Object.entries(manifest.targets);
    const primaryTarget = targetEntries[0]?.[1];
    if (!primaryTarget) {
      return { exitCode: 1, stderr: "No targets defined in skillsync.yaml" };
    }
    const drift = await detectDrift(resolve(projectRoot, primaryTarget), lockFile);

    // Find skills to prune: in lock but not in manifest
    const manifestSkills = new Set(manifest.skills);
    const lockOnly = Object.keys(lockFile.skills).filter((name) => !manifestSkills.has(name));
    const toPrune = [...lockOnly, ...drift.extra];

    if (toPrune.length === 0) {
      const output = formatOutput({ pruned: [] }, mode, () => "Nothing to prune.");
      return { exitCode: 0, stdout: output };
    }

    if (dryRun) {
      const output = formatOutput({ wouldPrune: toPrune }, mode, () =>
        `Would prune: ${toPrune.join(", ")}`,
      );
      return { exitCode: 0, stdout: output };
    }

    for (const name of toPrune) {
      for (const [, targetPath] of targetEntries) {
        await dematerialize(name, resolve(projectRoot, targetPath));
      }
      delete lockFile.skills[name];
    }
    await writeLockFile(projectRoot, lockFile);

    const output = formatOutput({ pruned: toPrune }, mode, () =>
      `Pruned: ${toPrune.join(", ")}`,
    );
    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}
