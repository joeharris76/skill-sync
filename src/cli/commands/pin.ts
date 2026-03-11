import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { pinOperation, unpinOperation } from "../../core/operations.js";

export async function pinCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));
  const skillName = args.positionals[0];

  if (!skillName) {
    return { exitCode: 1, stderr: "Usage: skill-sync pin <skill-name>" };
  }

  try {
    const result = await pinOperation(projectRoot, skillName);
    const output = formatOutput(result, mode, () =>
      `Pinned "${result.pinned}" at ${result.revision}`,
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
    return { exitCode: 1, stderr: "Usage: skill-sync unpin <skill-name>" };
  }

  try {
    const result = await unpinOperation(projectRoot, skillName);
    if (result.unpinned === false) {
      const msg = result.message ?? `Skill "${skillName}" is not pinned.`;
      if (mode === "json") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ unpinned: false, message: msg }, null, 2),
        };
      }
      return { exitCode: 0, stdout: msg };
    }
    const output = formatOutput(
      { unpinned: result.unpinned },
      mode,
      () => `Unpinned "${result.unpinned}"`,
    );
    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}
