import type { HarnessAlignmentReport } from "../../core/harness-alignment.js";
import { serializeHarnessReport } from "../../core/harness-alignment.js";
import { harnessAlignmentOperation } from "../../core/operations.js";
import { formatOutput } from "../output.js";
import type { CliResult, OutputMode, ParsedArgs } from "../types.js";

const USAGE =
  "Usage: skill-sync align-agents [--canonical-source <path>] [--dry-run] [--force] [--json]";

export async function alignAgentsCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";

  try {
    const report = await harnessAlignmentOperation({
      dryRun: Boolean(args.flags["dry-run"]),
      force: Boolean(args.flags.force),
      canonicalSource: args.flags["canonical-source"]
        ? String(args.flags["canonical-source"])
        : undefined,
    });

    const outputData = mode === "json" ? serializeHarnessReport(report) : report;
    const stdout = formatOutput(outputData, mode, (d) =>
      renderHarnessReport(d, Boolean(args.flags["dry-run"])),
    );

    return {
      exitCode: report.ok ? 0 : 1,
      stdout,
      stderr: report.ok ? undefined : report.summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return mode === "json"
      ? { exitCode: 1, stdout: JSON.stringify({ error: message }, null, 2), stderr: message }
      : { exitCode: 1, stderr: `${USAGE}\n${message}` };
  }
}

export function renderHarnessReport(data: unknown, isDryRun = false): string {
  const report = data as HarnessAlignmentReport;
  const lines: string[] = [];

  const hasOob = report.outOfBounds && report.outOfBounds.length > 0;
  const hasVerErrors = report.versionErrors && report.versionErrors.length > 0;

  if (hasOob || hasVerErrors) {
    lines.push("ALIGNMENT BLOCKED: Harness version check failed");
    lines.push("");

    if (hasOob) {
      for (const oob of report.outOfBounds) {
        lines.push(`  ✖ ${oob.name}: detected version ${oob.detectedVersion ?? "unknown"}`);
        lines.push(
          `    Allowed bounds: [${oob.minVersion}, ${oob.maxVersion}] (baseline: ${oob.knownVersion})`,
        );
        lines.push(`    Reason: Instructions discovery or precedence rules may have changed.`);
        lines.push(
          `    Action required: Inspect new release notes, re-confirm instruction search order,`,
        );
        lines.push(`                     and update version bounds in skill-sync.`);
      }
    }

    if (hasVerErrors) {
      for (const ve of report.versionErrors) {
        lines.push(`  ✖ ${ve.name}: binary error or unparseable version`);
        lines.push(`    Details: ${ve.message}`);
        lines.push(`    Action required: Verify binary installation and CLI options.`);
      }
    }

    lines.push("");
    lines.push(`Summary: ${report.summary}`);
    return lines.join("\n");
  }

  if (!report.ok) {
    lines.push("ALIGNMENT FAILED");
    lines.push(`Canonical source: ${report.canonicalSource}`);
    lines.push("");
    lines.push("Harness target status:");

    for (const item of report.harnesses) {
      const v = item.version;
      if (!v.installed) {
        lines.push(`  ○ ${v.name.padEnd(16)} not installed`);
        continue;
      }
      const versionStr = v.detectedVersion ? `v${v.detectedVersion}` : "unknown";
      lines.push(
        `  ● ${v.name.padEnd(16)} ${versionStr.padEnd(10)} (bounds: [${v.minVersion}, ${v.maxVersion}])`,
      );
      for (const t of item.targets) {
        let icon = "✗";
        if (t.aligned) icon = "✓";
        else if (isDryRun && t.wouldAlign) icon = "~";
        const action = t.actionTaken && t.actionTaken !== "none" ? ` (${t.actionTaken})` : "";
        const blockedMsg = t.blocked ? ` [BLOCKED: ${t.message}]` : "";
        lines.push(`      ${icon} ${t.path} [${t.kind}]${action}${blockedMsg}`);
      }
    }

    lines.push("");
    lines.push(`Summary: ${report.summary}`);
    return lines.join("\n");
  }

  lines.push(`Harness Alignment: ${report.summary}`);
  lines.push(`Canonical instructions source: ${report.canonicalSource}`);
  lines.push("");

  for (const item of report.harnesses) {
    const v = item.version;
    if (!v.installed) {
      lines.push(`  ○ ${v.name.padEnd(16)} not installed`);
      continue;
    }

    const versionStr = v.detectedVersion ? `v${v.detectedVersion}` : "unknown";
    lines.push(
      `  ● ${v.name.padEnd(16)} ${versionStr.padEnd(10)} (bounds: [${v.minVersion}, ${v.maxVersion}])`,
    );
    for (const t of item.targets) {
      let icon = "✗";
      if (t.aligned) icon = "✓";
      else if (isDryRun && t.wouldAlign) icon = "~";
      const action = t.actionTaken && t.actionTaken !== "none" ? ` (${t.actionTaken})` : "";
      lines.push(`      ${icon} ${t.path} [${t.kind}]${action}`);
    }
  }

  if (report.actions.length > 0) {
    lines.push("");
    lines.push("Actions performed:");
    for (const action of report.actions) {
      lines.push(`  - ${action}`);
    }
  }

  return lines.join("\n");
}
