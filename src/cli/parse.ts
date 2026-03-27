import type { ParsedArgs } from "./types.js";

const KNOWN_FLAGS: Record<string, { type: "string" | "boolean"; short?: string }> = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  project: { type: "string", short: "p" },
  "dry-run": { type: "boolean", short: "n" },
  force: { type: "boolean", short: "f" },
  "exit-code": { type: "boolean" },
  agent: { type: "string" },
};

/**
 * Parse raw argv into a structured command invocation.
 * Uses manual parsing to avoid external dependencies.
 */
export function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | undefined> = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const def = KNOWN_FLAGS[key];
      if (def?.type === "string") {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const short = arg.slice(1);
      const entry = Object.entries(KNOWN_FLAGS).find(([, v]) => v.short === short);
      if (entry) {
        const [key, def] = entry;
        if (def.type === "string") {
          flags[key] = argv[++i];
        } else {
          flags[key] = true;
        }
      } else {
        positionals.push(arg);
      }
    } else {
      positionals.push(arg);
    }
    i++;
  }

  const command = positionals.shift() ?? "help";
  return { command, positionals, flags };
}
