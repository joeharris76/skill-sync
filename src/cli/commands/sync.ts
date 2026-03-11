import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput } from "../output.js";
import { syncOperation } from "../../core/operations.js";
import type { SyncPlan } from "../../core/types.js";

export async function syncCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const dryRun = !!args.flags["dry-run"];
  const force = !!args.flags.force;
  const projectRoot = resolve(String(args.flags.project ?? "."));

  try {
    let result;
    try {
      result = await syncOperation({ projectRoot, dryRun, force });
    } catch (err) {
      if (dryRun) {
        const emptyPlan = { install: [], update: [], remove: [], conflicts: [], unchanged: [], skipped: [], warnings: [] };
        return { exitCode: 0, stdout: formatOutput(emptyPlan, mode, () => "No skill-sync.yaml found. Nothing to sync.") };
      }
      throw err;
    }

    if (dryRun) {
      const output = formatOutput(result.plan, mode, (data) =>
        formatPlanText(data as SyncPlan),
      );
      return { exitCode: 0, stdout: output };
    }

    if (result.conflicts && result.conflicts.length > 0) {
      const conflictNames = result.conflicts.map((c) => c.name).join(", ");
      const msg =
        `Sync blocked by ${result.conflicts.length} conflict(s): ${conflictNames}\n` +
        `Run \`skill-sync promote\` to push local changes upstream first,\n` +
        `or use \`skill-sync sync --force\` to overwrite local modifications.`;
      if (mode === "json") {
        return {
          exitCode: 1,
          stdout: JSON.stringify(
            { error: "conflicts", conflicts: result.conflicts },
            null,
            2,
          ),
          stderr: msg,
        };
      }
      return { exitCode: 1, stderr: msg };
    }

    const output = formatOutput(result.summary, mode, (data) => {
      const s = data as typeof result.summary;
      const lines: string[] = [];
      if (s.installed.length)
        lines.push(`Installed: ${s.installed.join(", ")}`);
      if (s.updated.length) lines.push(`Updated: ${s.updated.join(", ")}`);
      if (s.removed.length) lines.push(`Removed: ${s.removed.join(", ")}`);
      if (s.forced.length)
        lines.push(
          `Forced (overwrote local changes): ${s.forced.join(", ")}`,
        );
      if (s.skipped.length)
        lines.push(
          `Skipped (disk matches source): ${s.skipped.map((sk) => sk.name).join(", ")}`,
        );
      if (s.unchanged.length)
        lines.push(`Unchanged: ${s.unchanged.join(", ")}`);
      if (s.warnings.length) lines.push("", ...s.warnings);
      return lines.length ? lines.join("\n") : "Nothing to do.";
    });

    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}

function formatPlanText(plan: SyncPlan): string {
  const lines: string[] = [];
  if (plan.install.length)
    lines.push(`Install: ${plan.install.map((i) => i.name).join(", ")}`);
  if (plan.update.length)
    lines.push(`Update: ${plan.update.map((u) => u.name).join(", ")}`);
  if (plan.remove.length) lines.push(`Remove: ${plan.remove.join(", ")}`);
  if (plan.conflicts.length)
    lines.push(
      `Conflicts: ${plan.conflicts.map((c) => c.name).join(", ")}`,
    );
  if (plan.skipped.length)
    lines.push(
      `Skipped (disk matches source): ${plan.skipped.map((s) => s.name).join(", ")}`,
    );
  if (plan.unchanged.length)
    lines.push(`Unchanged: ${plan.unchanged.join(", ")}`);
  if (plan.warnings.length) lines.push("", ...plan.warnings);
  return lines.length ? lines.join("\n") : "Nothing to do.";
}
