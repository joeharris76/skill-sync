import { describe, it, expect } from "vitest";
import { checkCompatibility, resolveAgentTarget } from "../../../src/core/compatibility.js";
import type { SkillPackage } from "../../../src/core/types.js";

function makePackage(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    name: "test-skill",
    description: "A test skill",
    path: "/tmp/test-skill",
    skillMd: { name: "test-skill", description: "A test skill" },
    meta: { tags: [], depends: [], configInputs: [], targets: {} },
    files: [],
    ...overrides,
  };
}

describe("checkCompatibility", () => {
  it("returns no diagnostics for a compatible Claude skill", () => {
    const pkg = makePackage();
    const result = checkCompatibility(pkg, "claude");
    expect(result).toEqual([]);
  });

  it("warns about allowed-tools for Codex target", () => {
    const pkg = makePackage({
      skillMd: {
        name: "test-skill",
        description: "test",
        allowedTools: ["Read", "Edit"],
      },
    });
    const result = checkCompatibility(pkg, "codex");
    expect(result).toHaveLength(1);
    expect(result[0]!.rule).toBe("unsupported-feature");
    expect(result[0]!.severity).toBe("warning");
  });

  it("warns about scripts for generic-mcp target", () => {
    const pkg = makePackage({
      files: [
        { relativePath: "SKILL.md", sha256: "a", size: 10 },
        { relativePath: "scripts/helper.sh", sha256: "b", size: 20 },
      ],
    });
    const result = checkCompatibility(pkg, "generic-mcp");
    expect(result.some((d) => d.rule === "unsupported-feature")).toBe(true);
  });

  it("errors when skill declares itself incompatible", () => {
    const pkg = makePackage({
      meta: {
        tags: [],
        depends: [],
        configInputs: [],
        targets: { codex: false },
      },
    });
    const result = checkCompatibility(pkg, "codex");
    expect(result.some((d) => d.rule === "target-declared-incompatible")).toBe(true);
    expect(result[0]!.severity).toBe("error");
  });

  it("warns about missing frontmatter for targets that read it", () => {
    const pkg = makePackage({
      skillMd: { name: "", description: "" },
    });
    const result = checkCompatibility(pkg, "claude");
    expect(result.some((d) => d.rule === "missing-frontmatter-name")).toBe(true);
    expect(result.some((d) => d.rule === "missing-frontmatter-description")).toBe(true);
  });

  it("errors for nested skills that Antigravity cannot discover", () => {
    const pkg = makePackage({
      name: "SHARED/review-protocol",
      skillMd: { name: "review-protocol", description: "Review protocol" },
    });
    const result = checkCompatibility(pkg, "antigravity");
    const nestedDiag = result.find((d) => d.message.includes("Nested skill directory"));
    expect(nestedDiag).toBeDefined();
    expect(nestedDiag!.rule).toBe("unsupported-feature");
    expect(nestedDiag!.severity).toBe("error");
    expect(nestedDiag!.message).toContain("Antigravity CLI");
  });

  it("errors for nested skills that Gemini CLI cannot discover", () => {
    const pkg = makePackage({
      name: "SHARED/change-framework",
      skillMd: { name: "change-framework", description: "Change framework" },
    });
    const result = checkCompatibility(pkg, "gemini");
    const nestedDiag = result.find((d) => d.message.includes("Nested skill directory"));
    expect(nestedDiag).toBeDefined();
    expect(nestedDiag!.rule).toBe("unsupported-feature");
    expect(nestedDiag!.severity).toBe("error");
  });

  it("resolves exact vendor directory segments across path separators", () => {
    expect(resolveAgentTarget("custom", "/repo/.claude/skills")).toBe("claude");
    expect(resolveAgentTarget("custom", "C:\\repo\\.codex\\skills")).toBe("codex");
    expect(resolveAgentTarget("custom", "/repo/.gemini/skills/")).toBe("gemini");
    expect(resolveAgentTarget("custom", "/repo/.agent/skills")).toBe("generic-mcp");
  });

  it("does not infer a runtime from ambiguous or lookalike directories", () => {
    expect(resolveAgentTarget("custom", "/repo/.agents/skills")).toBeNull();
    expect(resolveAgentTarget("custom", "/repo/.claude-backup/skills")).toBeNull();
    expect(resolveAgentTarget("custom", "/repo/.agents-old/skills")).toBeNull();
    expect(resolveAgentTarget("custom", "/repo/.agent-cache/skills")).toBeNull();
  });

  it("resolves the consolidated interoperable agents target", () => {
    expect(resolveAgentTarget("agents", ".agents/skills")).toBe("antigravity");
    expect(resolveAgentTarget("agents", "/repo/.agents/skills/")).toBe("antigravity");
  });

  it("prefers an exact configured target key", () => {
    expect(resolveAgentTarget("antigravity", "/repo/.agents/skills")).toBe("antigravity");
  });
});
