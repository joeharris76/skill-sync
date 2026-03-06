import type { CliResult, ParsedArgs } from "../types.js";
import { syncCommand } from "./sync.js";

/**
 * Diff command: alias for `sync --dry-run`.
 * Shows what sync would change without mutating any files.
 */
export async function diffCommand(args: ParsedArgs): Promise<CliResult> {
  return syncCommand({
    ...args,
    flags: { ...args.flags, "dry-run": true },
  });
}
