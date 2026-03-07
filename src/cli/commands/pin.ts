import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { readManifest, serializeManifest } from "../../core/manifest.js";
import { readLockFile } from "../../core/lock.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function pinCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));
  const skillName = args.positionals[0];

  if (!skillName) {
    return { exitCode: 1, stderr: "Usage: skillsync pin <skill-name>" };
  }

  try {
    const manifest = await readManifest(projectRoot);
    const lockFile = await readLockFile(projectRoot);

    if (!lockFile) {
      return { exitCode: 1, stderr: "No lock file found. Run `skillsync sync` first." };
    }

    const locked = lockFile.skills[skillName];
    if (!locked) {
      return { exitCode: 1, stderr: `Skill "${skillName}" is not installed.` };
    }

    if (locked.source.type !== "git" || !locked.source.revision) {
      return {
        exitCode: 1,
        stderr:
          `Skill "${skillName}" is sourced from ${locked.source.type} and does not have a fixed revision to pin.`,
      };
    }

    // Pin by recording the exact git revision used for this skill.
    if (!manifest.overrides[skillName]) {
      manifest.overrides[skillName] = {};
    }
    manifest.overrides[skillName]!.installMode = locked.installMode;
    manifest.overrides[skillName]!.sourceName = locked.source.name;
    manifest.overrides[skillName]!.revision = locked.source.revision;

    // Write updated manifest
    const manifestPath = join(projectRoot, "skillsync.yaml");
    await writeFile(manifestPath, serializeManifest(manifest), "utf-8");

    const data = {
      pinned: skillName,
      installMode: locked.installMode,
      source: locked.source.name,
      revision: locked.source.revision,
    };

    const output = formatOutput(data, mode, () =>
      `Pinned "${skillName}" at ${data.revision} (${locked.installMode} mode)`,
    );

    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}

export async function unpinCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));
  const skillName = args.positionals[0];

  if (!skillName) {
    return { exitCode: 1, stderr: "Usage: skillsync unpin <skill-name>" };
  }

  try {
    const manifest = await readManifest(projectRoot);

    if (!manifest.overrides[skillName]) {
      const msg = `Skill "${skillName}" is not pinned.`;
      if (mode === "json") {
        return { exitCode: 0, stdout: JSON.stringify({ unpinned: false, message: msg }, null, 2) };
      }
      return { exitCode: 0, stdout: msg };
    }

    delete manifest.overrides[skillName];

    const manifestPath = join(projectRoot, "skillsync.yaml");
    await writeFile(manifestPath, serializeManifest(manifest), "utf-8");

    const output = formatOutput({ unpinned: skillName }, mode, () => `Unpinned "${skillName}"`);
    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}
