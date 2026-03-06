import { describe, it, expect } from "vitest";
import { parseArgv } from "../../../src/cli/parse.js";

describe("parseArgv", () => {
  it("parses command and positionals", () => {
    const result = parseArgv(["sync", "extra"]);
    expect(result.command).toBe("sync");
    expect(result.positionals).toEqual(["extra"]);
  });

  it("defaults to help when no args", () => {
    const result = parseArgv([]);
    expect(result.command).toBe("help");
  });

  it("parses boolean flags", () => {
    const result = parseArgv(["sync", "--dry-run", "--json"]);
    expect(result.command).toBe("sync");
    expect(result.flags["dry-run"]).toBe(true);
    expect(result.flags.json).toBe(true);
  });

  it("parses string flags", () => {
    const result = parseArgv(["status", "--project", "/tmp/test"]);
    expect(result.flags.project).toBe("/tmp/test");
  });

  it("parses short flags", () => {
    const result = parseArgv(["sync", "-n", "-p", "/tmp"]);
    expect(result.flags["dry-run"]).toBe(true);
    expect(result.flags.project).toBe("/tmp");
  });

  it("stops at --", () => {
    const result = parseArgv(["sync", "--", "--json"]);
    expect(result.command).toBe("sync");
    expect(result.flags.json).toBeUndefined();
    expect(result.positionals).toEqual(["--json"]);
  });
});
