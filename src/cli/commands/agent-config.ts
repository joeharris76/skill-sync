import { resolve } from "node:path";
import type {
  AgentConfigCaptureResult,
  AgentConfigRestoreResult,
  AgentConfigValidationReport,
} from "../../core/agent-config.js";
import {
  agentConfigCaptureOperation,
  agentConfigRestoreOperation,
  agentConfigValidateOperation,
} from "../../core/operations.js";
import { formatOutput } from "../output.js";
import type { CliResult, OutputMode, ParsedArgs } from "../types.js";

const USAGE =
  "Usage: skill-sync agent-config <capture|validate|restore> [--dry-run] [--force] [--json]";

export async function agentConfigCommand(args: ParsedArgs): Promise<CliResult> {
  const action = args.positionals[0];
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));

  if (action !== "capture" && action !== "validate" && action !== "restore") {
    return {
      exitCode: 1,
      stderr: `${USAGE}\nUnknown agent-config action: ${action ?? "(missing)"}`,
    };
  }
  if (args.flags.force && action !== "restore") {
    return { exitCode: 1, stderr: "The --force flag is only supported by agent-config restore." };
  }

  try {
    if (action === "capture") {
      const result = await agentConfigCaptureOperation({
        projectRoot,
        dryRun: !!args.flags["dry-run"],
      });
      return { exitCode: 0, stdout: formatOutput(result, mode, renderCapture) };
    }

    if (action === "validate") {
      const result = await agentConfigValidateOperation({ projectRoot });
      return {
        exitCode: result.ok ? 0 : 1,
        stdout: formatOutput(result, mode, renderValidation),
      };
    }

    const result = await agentConfigRestoreOperation({
      projectRoot,
      dryRun: !!args.flags["dry-run"],
      force: !!args.flags.force,
    });
    return {
      exitCode: result.conflicts.length === 0 ? 0 : 1,
      stdout: formatOutput(result, mode, renderRestore),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return mode === "json"
      ? { exitCode: 1, stdout: JSON.stringify({ error: message }, null, 2), stderr: message }
      : { exitCode: 1, stderr: message };
  }
}

function renderCapture(result: unknown): string {
  const capture = result as AgentConfigCaptureResult;
  const lines = [
    capture.dryRun
      ? `Would capture six agent instruction files to ${capture.snapshotPath}.`
      : `Captured six agent instruction files to ${capture.snapshotPath}.`,
  ];
  for (const entry of capture.snapshot.files) {
    const detail = entry.state === "present" ? ` (${entry.sha256})` : "";
    lines.push(`  ${entry.state.padEnd(7)} ${entry.sourcePath}${detail}`);
  }
  return lines.join("\n");
}

function renderValidation(result: unknown): string {
  const report = result as AgentConfigValidationReport;
  const lines = [
    report.ok
      ? `Agent-config snapshot is clean (${report.entries.length} files).`
      : "Agent-config snapshot drift detected:",
  ];
  for (const entry of report.entries) {
    if (entry.status !== "unchanged") {
      lines.push(
        `  ${entry.status.padEnd(8)} ${entry.sourcePath}${
          entry.actualSha256 ? ` (${entry.actualSha256})` : ""
        }`,
      );
    }
  }
  return lines.join("\n");
}

function renderRestore(result: unknown): string {
  const restore = result as AgentConfigRestoreResult;
  const lines: string[] = [];
  if (restore.conflicts.length > 0) {
    lines.push(`Restore blocked by ${restore.conflicts.length} conflict(s):`);
    for (const conflict of restore.conflicts) lines.push(`  - ${conflict.message}`);
  }
  const restored = restore.restored.filter((id) => !restore.forced.includes(id));
  if (restored.length > 0) {
    lines.push(`${restore.dryRun ? "Would restore" : "Restored"}: ${restored.join(", ")}`);
  }
  if (restore.forced.length > 0) {
    lines.push(
      `${restore.dryRun ? "Would force-restore" : "Force-restored"}: ${restore.forced.join(", ")}`,
    );
  }
  if (lines.length === 0) lines.push("Nothing to restore.");
  return lines.join("\n");
}
