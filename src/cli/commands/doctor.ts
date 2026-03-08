import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { doctorOperation } from "../../core/operations.js";

export async function doctorCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));

  const { healthy, checks } = await doctorOperation(projectRoot);

  const output = formatOutput({ healthy, checks }, mode, () =>
    checks
      .map((c) => {
        const icon = c.status === "ok" ? "OK" : c.status === "warn" ? "!!" : "XX";
        return `[${icon}] ${c.check}: ${c.message}`;
      })
      .join("\n"),
  );

  return { exitCode: healthy ? 0 : 1, stdout: output };
}
