import { resolve } from "node:path";
import { verifyOperation } from "../../core/operations.js";
import type { VerifyReport } from "../../core/verify.js";
import { formatOutput } from "../output.js";
import type { CliResult, OutputMode, ParsedArgs } from "../types.js";

/**
 * Verify that committed snapshots of tracked targets match the lock + config.
 * Offline gate — exits non-zero on any integrity issue, so it can fail CI.
 */
export async function verifyCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));

  try {
    const report = await verifyOperation({ projectRoot });
    return {
      exitCode: report.ok ? 0 : 1,
      stdout: formatOutput(report, mode, () => renderText(report)),
    };
  } catch (err) {
    return { exitCode: 1, stderr: err instanceof Error ? err.message : String(err) };
  }
}

function renderText(report: VerifyReport): string {
  if (report.checkedTargets.length === 0) {
    return "No tracked targets to verify.";
  }
  if (report.ok) {
    return `OK  ${report.checkedTargets.length} tracked target(s) verified (${report.checkedTargets.join(
      ", ",
    )}): committed snapshot matches lock + config.`;
  }
  const lines = [`FAIL  ${report.issues.length} integrity issue(s) in tracked target(s):`, ""];
  for (const issue of report.issues) {
    const loc = issue.skill ? ` [${issue.target}/${issue.skill}]` : ` [${issue.target}]`;
    lines.push(`  - ${issue.kind}${loc}: ${issue.message}`);
  }
  lines.push("", "Re-run `skill-sync sync` and commit the result to fix.");
  return lines.join("\n");
}
