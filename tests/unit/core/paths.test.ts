import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandTilde,
  isLoaderOwnedStorePath,
  normalizeManagedSkillName,
  normalizeRepositorySubdir,
  normalizeSkillName,
  relativeInside,
  resolvePath,
  toTildePath,
} from "../../../src/core/paths.js";

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
    const absoluteTarget = resolve("/abs/skills");
    expect(resolvePath("/some/project", absoluteTarget)).toBe(absoluteTarget);
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

describe("normalizeSkillName", () => {
  it("normalizes single-segment and nested skill names", () => {
    expect(normalizeSkillName("code")).toBe("code");
    expect(normalizeSkillName("SHARED/change-framework")).toBe("SHARED/change-framework");
    expect(normalizeSkillName("nested/sub/skill")).toBe("nested/sub/skill");
  });

  it("strips trailing slashes", () => {
    expect(normalizeSkillName("code/")).toBe("code");
    expect(normalizeSkillName("SHARED/change-framework/")).toBe("SHARED/change-framework");
  });

  it("rejects empty or whitespace-only names", () => {
    expect(() => normalizeSkillName("")).toThrow("non-empty");
    expect(() => normalizeSkillName("  ")).toThrow("non-empty");
    expect(() => normalizeSkillName(" code ")).toThrow("non-empty");
  });

  it("rejects path traversal segments", () => {
    expect(() => normalizeSkillName("../escape")).toThrow("traversal segments");
    expect(() => normalizeSkillName("foo/../bar")).toThrow("traversal segments");
    expect(() => normalizeSkillName("foo/./bar")).toThrow("traversal segments");
  });

  it("rejects absolute paths and Windows drive letters", () => {
    expect(() => normalizeSkillName("/abs/skill")).toThrow("relative path");
    expect(() => normalizeSkillName("C:/skill")).toThrow("relative path");
    expect(() => normalizeSkillName("foo\\bar")).toThrow("relative path");
  });
});

describe("loader-owned store paths", () => {
  it("recognizes only the exact top-level .system namespace", () => {
    expect(isLoaderOwnedStorePath(".system")).toBe(true);
    expect(isLoaderOwnedStorePath(".system/imagegen/SKILL.md")).toBe(true);
    expect(isLoaderOwnedStorePath(".System/imagegen/SKILL.md")).toBe(false);
    expect(isLoaderOwnedStorePath("nested/.system/SKILL.md")).toBe(false);
    expect(isLoaderOwnedStorePath(".systematic/SKILL.md")).toBe(false);
  });

  it("rejects case-fold aliases of loader-owned managed skill identities", () => {
    for (const name of [
      ".system",
      ".system/imagegen",
      ".System",
      ".SYSTEM/imagegen",
      ".ſystem/imagegen",
    ]) {
      expect(() => normalizeManagedSkillName(name)).toThrow("loader-owned");
    }
    expect(normalizeManagedSkillName("SHARED/change-framework")).toBe(
      "SHARED/change-framework",
    );
    expect(normalizeManagedSkillName(".systematic/example")).toBe(".systematic/example");
    expect(normalizeManagedSkillName("nested/.System/example")).toBe("nested/.System/example");
  });
});
