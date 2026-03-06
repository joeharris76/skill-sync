import type { CliResult } from "./types.js";
import { parseArgv } from "./parse.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { validateCommand } from "./commands/validate.js";
import { diffCommand } from "./commands/diff.js";
import { doctorCommand } from "./commands/doctor.js";
import { pinCommand, unpinCommand } from "./commands/pin.js";
import { pruneCommand } from "./commands/prune.js";
import { promoteCommand } from "./commands/promote.js";

const VERSION = "0.0.1";

const COMMANDS: Record<string, { description: string; usage: string }> = {
  sync: {
    description: "Sync skills from sources to target directories",
    usage: "skillsync sync [--dry-run] [--force] [--json]",
  },
  status: {
    description: "Show installed skill state and drift",
    usage: "skillsync status [--json]",
  },
  validate: {
    description: "Check manifest, portability, and compatibility",
    usage: "skillsync validate [--exit-code] [--json]",
  },
  diff: {
    description: "Preview what sync would change (alias: sync --dry-run)",
    usage: "skillsync diff [--json]",
  },
  doctor: {
    description: "Run diagnostic health checks",
    usage: "skillsync doctor [--json]",
  },
  pin: {
    description: "Pin a skill to its current version",
    usage: "skillsync pin <skill-name> [--json]",
  },
  unpin: {
    description: "Remove a version pin from a skill",
    usage: "skillsync unpin <skill-name> [--json]",
  },
  prune: {
    description: "Remove skills not listed in the manifest",
    usage: "skillsync prune [--dry-run] [--json]",
  },
  promote: {
    description: "Guidance for pushing local changes back to source",
    usage: "skillsync promote [--json]",
  },
};

function helpText(): string {
  const lines = [
    `skillsync v${VERSION} - Local-first skill distribution for AI agents`,
    "",
    "Usage: skillsync <command> [options]",
    "",
    "Commands:",
  ];

  const maxLen = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(maxLen + 2)}${cmd.description}`);
  }

  lines.push(
    "",
    "Global options:",
    "  --json, -j         Output machine-readable JSON",
    "  --project, -p      Project root directory (default: .)",
    "  --help, -h         Show help",
    "",
    "Install modes:",
    "  mirror   Full copy with SHA256 integrity tracking (default)",
    "  copy     Plain file copy without lock tracking",
    "  symlink  Symlink to source (local dev only, not portable)",
    "",
    "Examples:",
    "  skillsync sync                  # Sync skills from all sources",
    "  skillsync sync --dry-run        # Preview changes without applying",
    "  skillsync status --json         # Machine-readable install state",
    "  skillsync validate --exit-code  # Fail CI on validation errors",
    "  skillsync doctor                # Run health checks",
    "  skillsync prune --dry-run       # Preview untracked skill removal",
  );

  return lines.join("\n");
}

function commandHelp(command: string): string {
  const cmd = COMMANDS[command];
  if (!cmd) return `Unknown command: ${command}\n\nRun "skillsync --help" for available commands.`;
  return `${cmd.description}\n\nUsage: ${cmd.usage}`;
}

/**
 * Run the CLI with the given argv (without node and script path).
 * Returns a structured result suitable for testing and machine consumption.
 */
export async function runCli(argv: string[]): Promise<CliResult> {
  const parsed = parseArgv(argv);

  if (parsed.flags.help || parsed.command === "help") {
    if (parsed.positionals[0]) {
      return { exitCode: 0, stdout: commandHelp(parsed.positionals[0]) };
    }
    if (parsed.command !== "help" && parsed.command in COMMANDS) {
      return { exitCode: 0, stdout: commandHelp(parsed.command) };
    }
    return { exitCode: 0, stdout: helpText() };
  }

  if (parsed.command === "version" || parsed.flags.version) {
    return { exitCode: 0, stdout: VERSION };
  }

  switch (parsed.command) {
    case "sync":
      return syncCommand(parsed);
    case "status":
      return statusCommand(parsed);
    case "validate":
      return validateCommand(parsed);
    case "diff":
      return diffCommand(parsed);
    case "doctor":
      return doctorCommand(parsed);
    case "pin":
      return pinCommand(parsed);
    case "unpin":
      return unpinCommand(parsed);
    case "prune":
      return pruneCommand(parsed);
    case "promote":
      return promoteCommand(parsed);
    default:
      return {
        exitCode: 1,
        stderr: `Unknown command: ${parsed.command}\n\nRun "skillsync --help" for available commands.`,
      };
  }
}

/**
 * CLI entrypoint for direct execution.
 * Strips node and script path from process.argv.
 */
export async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout + "\n");
  if (result.stderr) process.stderr.write(result.stderr + "\n");
  process.exitCode = result.exitCode;
}

// Auto-run when executed directly
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/cli/index.js") || process.argv[1].endsWith("/cli/index.ts"));

if (isDirectExecution) {
  main();
}
