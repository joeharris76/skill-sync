import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";

/**
 * Promote command: v0 provides guidance for manual promotion.
 * Automated promotion is deferred to v0.2.
 */
export async function promoteCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";

  const guidance = {
    version: "v0",
    automated: false,
    steps: [
      "1. Run `skill-sync status` to identify modified skills",
      "2. Run `skill-sync diff` to review upstream vs local changes",
      "3. Copy modified files from the target directory back to the source",
      "4. Run `skill-sync sync` to confirm the source and target are in sync",
    ],
    note: "Automated `skill-sync promote` will be available in v0.2.",
  };

  const output = formatOutput(guidance, mode, () =>
    [
      "Promote: Push local skill modifications back to their source.",
      "",
      "Automated promotion is not yet available (coming in v0.2).",
      "Manual workflow:",
      ...guidance.steps,
    ].join("\n"),
  );

  return { exitCode: 0, stdout: output };
}
