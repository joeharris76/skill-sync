import { describe, it, expect } from "vitest";
import { formatOutput, formatTable, formatDiagnostics } from "../../../src/cli/output.js";

describe("formatOutput", () => {
  it("returns JSON when mode is json", () => {
    const result = formatOutput({ key: "value" }, "json");
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("uses text formatter when mode is text", () => {
    const result = formatOutput({ key: "value" }, "text", () => "custom output");
    expect(result).toBe("custom output");
  });

  it("falls back to String() without formatter", () => {
    const result = formatOutput(42, "text");
    expect(result).toBe("42");
  });
});

describe("formatTable", () => {
  it("renders a header, separator, and rows", () => {
    const rows = [
      { Name: "code", State: "clean" },
      { Name: "test", State: "modified" },
    ];
    const result = formatTable(rows, ["Name", "State"]);
    const lines = result.split("\n");
    expect(lines.length).toBe(4); // header + separator + 2 rows
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("State");
    expect(lines[1]).toMatch(/^-+/);
  });

  it("returns empty string for no rows", () => {
    expect(formatTable([], ["A", "B"])).toBe("");
  });
});

describe("formatDiagnostics", () => {
  it("formats error and warning diagnostics", () => {
    const diags = [
      { severity: "error", rule: "test", message: "broken", skill: "code", file: "SKILL.md", line: 5 },
      { severity: "warning", rule: "test", message: "risky" },
    ];
    const result = formatDiagnostics(diags);
    expect(result).toContain("ERROR [code:SKILL.md:5] broken");
    expect(result).toContain("WARN  risky");
  });
});
