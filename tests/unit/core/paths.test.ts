import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandTilde, relativeInside, resolvePath, toTildePath } from "../../../src/core/paths.js";

describe("expandTilde", () => {
  it("expands a bare ~ to the home directory", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("expands ~/... to a home-rooted absolute path", () => {
    expect(expandTilde("~/.claude/skills")).toBe(join(homedir(), ".claude/skills"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandTilde("/abs/.codex/skills")).toBe("/abs/.codex/skills");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandTilde(".claude/skills")).toBe(".claude/skills");
  });

  it("does not expand ~user forms (only ~ and ~/)", () => {
    expect(expandTilde("~alice/skills")).toBe("~alice/skills");
  });
});

describe("resolvePath", () => {
  it("resolves a ~-rooted target to the home directory, ignoring the base", () => {
    expect(resolvePath("/some/project", "~/.claude/skills")).toBe(
      join(homedir(), ".claude/skills"),
    );
  });

  it("never produces a literal ~ path segment (junk-dir regression)", () => {
    const out = resolvePath("/some/project", "~/.claude/skills");
    // The bug was resolve(base, "~/x") => "/some/project/~/x".
    expect(out).not.toContain("/~/");
    expect(out.startsWith("/some/project")).toBe(false);
  });

  it("resolves a relative target against the base", () => {
    expect(resolvePath("/some/project", ".codex/skills")).toBe(
      resolve("/some/project", ".codex/skills"),
    );
  });

  it("returns an absolute target unchanged", () => {
    expect(resolvePath("/some/project", "/abs/skills")).toBe("/abs/skills");
  });
});

describe("toTildePath", () => {
  it("collapses a home-rooted path to ~/...", () => {
    expect(toTildePath(join(homedir(), ".skill-sync/skills/code"))).toBe(
      "~/.skill-sync/skills/code",
    );
  });

  it("collapses the home directory itself to ~", () => {
    expect(toTildePath(homedir())).toBe("~");
  });

  it("leaves paths outside the home directory unchanged", () => {
    expect(toTildePath("/var/lib/skills")).toBe("/var/lib/skills");
  });

  it("round-trips with expandTilde", () => {
    const abs = join(homedir(), ".skill-sync/skills/code");
    expect(expandTilde(toTildePath(abs))).toBe(abs);
  });
});

describe("relativeInside", () => {
  it("returns a forward-slashed relative path for an in-repo target", () => {
    expect(relativeInside("/repo", ".claude/skills")).toBe(".claude/skills");
  });

  it("returns null for a target outside the repo (~-rooted)", () => {
    expect(relativeInside("/repo", "~/.claude/skills")).toBeNull();
  });

  it("returns null for an absolute target outside the repo", () => {
    expect(relativeInside("/repo", "/other/skills")).toBeNull();
  });

  it("returns null when the target is the repo root itself", () => {
    expect(relativeInside("/repo", ".")).toBeNull();
  });

  it("resolves an absolute target that is inside the repo", () => {
    expect(relativeInside("/repo", "/repo/.codex/skills")).toBe(".codex/skills");
  });
});
