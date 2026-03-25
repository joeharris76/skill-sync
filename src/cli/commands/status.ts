import { resolve } from "node:path";
import type { CliResult, ParsedArgs, OutputMode } from "../types.js";
import { formatOutput, formatTable } from "../output.js";
import { readManifest } from "../../core/manifest.js";
import { readLockFile } from "../../core/lock.js";
import { detectDrift } from "../../core/drift.js";
import { instructionAuditOperation } from "../../core/operations.js";
import type { InstructionAgentAudit } from "../../core/instruction-types.js";

export async function statusCommand(args: ParsedArgs): Promise<CliResult> {
  const mode: OutputMode = args.flags.json ? "json" : "text";
  const projectRoot = resolve(String(args.flags.project ?? "."));

  try {
    const instructionReport = await instructionAuditOperation({ projectRoot });
    let manifest;
    try {
      manifest = await readManifest(projectRoot);
    } catch {
      const data = {
        locked: false,
        targets: [],
        instructions: instructionReport.agents,
        message: "No skill-sync.yaml found.",
      };
      return {
        exitCode: 0,
        stdout: formatOutput(data, mode, () =>
          renderStatusText([], instructionReport.agents, data.message),
        ),
      };
    }
    const lockFile = await readLockFile(projectRoot);

    if (!lockFile) {
      const msg = "No lock file found. Run `skill-sync sync` first.";
      const data = {
        locked: false,
        targets: [],
        instructions: instructionReport.agents,
        message: msg,
      };
      return {
        exitCode: 0,
        stdout: formatOutput(data, mode, () =>
          renderStatusText([], instructionReport.agents, msg),
        ),
      };
    }

    const targetEntries = Object.entries(manifest.targets);
    const primaryTarget = targetEntries[0]?.[1];
    if (!primaryTarget) {
      return { exitCode: 1, stderr: "No targets defined in skill-sync.yaml" };
    }
    const perTarget = await Promise.all(
      targetEntries.map(async ([targetName, targetPath]) => {
        const drift = await detectDrift(resolve(projectRoot, targetPath), lockFile);
        const skills = Object.entries(lockFile.skills).map(([name, locked]) => {
          let state: string;
          if (drift.missing.includes(name)) {
            state = "missing";
          } else if (drift.modified.some((d) => d.skill === name)) {
            state = "modified";
          } else {
            state = "clean";
          }
          return {
            name,
            source: locked.source.name,
            mode: locked.installMode,
            state,
            files: Object.keys(locked.files).length,
          };
        });

        for (const extra of drift.extra) {
          skills.push({
            name: extra,
            source: "<untracked>",
            mode: "unknown" as never,
            state: "extra",
            files: 0,
          });
        }

        return {
          target: targetName,
          path: targetPath,
          skills,
          summary: {
            clean: drift.clean.length,
            modified:
              drift.modified.length > 0
                ? [...new Set(drift.modified.map((d) => d.skill))].length
                : 0,
            missing: drift.missing.length,
            extra: drift.extra.length,
          },
        };
      }),
    );
    const data = {
      locked: true,
      targets: perTarget,
      instructions: instructionReport.agents,
    };

    const output = formatOutput(data, mode, () =>
      renderStatusText(perTarget, instructionReport.agents),
    );

    return { exitCode: 0, stdout: output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stderr: message };
  }
}

function renderStatusText(
  perTarget: Array<{
    target: string;
    path: string;
    skills: Array<{
      name: string;
      source: string;
      mode: string;
      state: string;
      files: number;
    }>;
    summary: {
      clean: number;
      modified: number;
      missing: number;
      extra: number;
    };
  }>,
  agents: InstructionAgentAudit[],
  message?: string,
): string {
  const lines: string[] = [];

  if (message) {
    lines.push(message, "");
  }

  for (const target of perTarget) {
    lines.push(`Target: ${target.target} (${target.path})`, "");
    if (target.skills.length === 0) {
      lines.push("No skills installed.");
    } else {
      lines.push(
        formatTable(
          target.skills.map((s) => ({
            Name: s.name,
            Source: s.source,
            Mode: s.mode,
            State: s.state,
            Files: s.files,
          })),
          ["Name", "Source", "Mode", "State", "Files"],
        ),
      );
      lines.push("");
      lines.push(
        `${target.summary.clean} clean, ${target.summary.modified} modified, ${target.summary.missing} missing, ${target.summary.extra} extra`,
      );
    }
    lines.push("");
  }

  if (shouldShowInstructionSection(agents)) {
    lines.push("Instruction Files:", "");
    lines.push(
      formatTable(
        buildInstructionRows(agents),
        ["Agent", "Global", "Project", "State"],
      ),
    );
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function shouldShowInstructionSection(agents: InstructionAgentAudit[]): boolean {
  return agents.some((agent) =>
    agent.configured ||
    [...agent.globalFiles, ...agent.projectFiles, ...agent.overrideFiles].some(
      (entry) => entry.state !== "missing",
    )
  );
}

function buildInstructionRows(agents: InstructionAgentAudit[]) {
  return agents
    .filter((agent) => shouldShowInstructionSection([agent]))
    .map((agent) => {
      const localEntries = [...agent.projectFiles, ...agent.overrideFiles];
      return {
        Agent: agent.agent,
        Global: displayInstructionPath(agent.globalFiles, agent.expectedGlobalFiles),
        Project: displayInstructionPath(
          localEntries,
          [...agent.expectedProjectFiles, ...agent.expectedOverrideFiles],
        ),
        State: summarizeInstructionState(agent),
      };
    });
}

function displayInstructionPath(
  entries: Array<{ path: string; state: string }>,
  expected: string[],
): string {
  const presentEntries = entries.filter((entry) => entry.state !== "missing");
  if (presentEntries.length > 0) {
    return presentEntries.map((entry) => entry.path).join(", ");
  }
  return formatExpectedPaths(expected);
}

function summarizeInstructionState(agent: InstructionAgentAudit): string {
  const localEntries = [...agent.projectFiles, ...agent.overrideFiles];
  const presentLocalEntries = localEntries.filter((entry) => entry.state !== "missing");

  if (presentLocalEntries.some((entry) => entry.state === "mirror-of-global")) {
    return "mirror-of-global";
  }
  if (presentLocalEntries.some((entry) => entry.state === "overlaps-global")) {
    return "overlaps-global";
  }
  if (presentLocalEntries.length > 0) {
    return "present";
  }
  if (agent.globalFiles.some((entry) => entry.state !== "missing")) {
    return "global-only";
  }
  return "missing";
}

function formatExpectedPaths(expected: string[]): string {
  if (expected.length === 0) {
    return "(none)";
  }
  if (expected.length === 1) {
    return expected[0]!;
  }
  return expected.join(" or ");
}
