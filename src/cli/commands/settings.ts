import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { settingsGenerateOperation } from "../../core/operations.js";

export async function settingsCommand(args: ParsedArgs): Promise<CliResult> {
  const subcommand = args.positionals[0];

  if (subcommand === "generate") {
    return settingsGenerate(args);
  }

  const usage = [
    "Usage: skill-sync settings <subcommand> [options]",
    "",
    "Subcommands:",
    "  generate   Print suggested settings fragment for installed skills",
    "",
    "Options:",
    "  --agent <name>   Agent to check (default: claude)",
    "  --json           Machine-readable output",
  ].join("\n");

  return { exitCode: 1, stderr: usage };
}

async function settingsGenerate(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));
  const agent = typeof args.flags.agent === "string" ? args.flags.agent : "claude";

  const result = await settingsGenerateOperation({ projectRoot, agent });

  const output = formatOutput(result, mode, () => {
    const lines: string[] = [];

    if (result.missingCount === 0) {
      lines.push(`All ${agent} settings requirements are already satisfied.`);
      if (result.totalRequired.length > 0) {
        lines.push(`(${result.totalRequired.length} required permission(s) confirmed present)`);
      }
      return lines.join("\n");
    }

    lines.push(
      `Settings requirements for ${result.gaps.length} skill(s) targeting ${agent}:`,
      "",
    );

    for (const gap of result.gaps) {
      lines.push(`  ${gap.skillName}: ${gap.missingAllows.join(", ")}`);
    }

    lines.push(
      "",
      `Missing permissions — add to .${agent}/settings.json:`,
      "",
      JSON.stringify(result.suggestedFragment, null, 2),
      "",
      "Review carefully before applying. skill-sync does not modify settings files.",
    );

    return lines.join("\n");
  });

  return { exitCode: 0, stdout: output };
}
