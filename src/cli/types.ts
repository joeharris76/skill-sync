/* v8 ignore file */
/** Structured result from any CLI command. */
export interface CliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

/** Parsed CLI invocation. */
export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean | undefined>;
}

/** Common flags supported by all commands. */
export interface CommonFlags {
  json: boolean;
  help: boolean;
  project: string;
}

/** Output mode: text for humans, json for machines. */
export type OutputMode = "text" | "json";
