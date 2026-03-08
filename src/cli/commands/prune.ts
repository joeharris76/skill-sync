import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { pruneOperation } from "../../core/operations.js";

export async function pruneCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const dryRun = !!args.flags["dry-run"];
  const projectRoot = resolve(String(args.flags.project ?? "."));

  try {
    const result = await pruneOperation(projectRoot, dryRun);

    if (result.pruned.length === 0) {
      const output = formatOutput(
        { pruned: [] },
        mode,
        () => "Nothing to prune.",
      );
      return { exitCode: 0, stdout: output };
    }

    if (result.dryRun) {
      const output = formatOutput(
        { wouldPrune: result.pruned },
        mode,
        () => `Would prune: ${result.pruned.join(", ")}`,
      );
      return { exitCode: 0, stdout: output };
    }

    const output = formatOutput(
      { pruned: result.pruned },
      mode,
      () => `Pruned: ${result.pruned.join(", ")}`,
    );
    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}
