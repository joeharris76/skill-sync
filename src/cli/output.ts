import type { OutputMode } from "./types.js";

/** Format output as text or JSON based on mode. */
export function formatOutput(
  data: unknown,
  mode: OutputMode,
  textFormatter?: (data: unknown) => string,
): string {
  if (mode === "json") {
    return JSON.stringify(data, null, 2);
  }
  if (textFormatter) {
    return textFormatter(data);
  }
  return String(data);
}

/** Format a table of key-value pairs for text output. */
export function formatTable(
  rows: Array<Record<string, string | number | boolean>>,
  columns: string[],
): string {
  if (rows.length === 0) return "";

  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
  );

  const header = columns.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) =>
      columns.map((c, i) => String(row[c] ?? "").padEnd(widths[i]!)).join("  "),
    )
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}

/** Format a list of diagnostic messages. */
export function formatDiagnostics(
  diagnostics: Array<{
    severity: string;
    rule: string;
    message: string;
    skill?: string;
    file?: string;
    line?: number;
  }>,
): string {
  return diagnostics
    .map((d) => {
      const location = [d.skill, d.file, d.line].filter(Boolean).join(":");
      const prefix = d.severity === "error" ? "ERROR" : "WARN ";
      return `${prefix} ${location ? `[${location}] ` : ""}${d.message}`;
    })
    .join("\n");
}
