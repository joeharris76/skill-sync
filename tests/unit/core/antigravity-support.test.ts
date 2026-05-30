import { describe, it, expect } from "vitest";
import { checkCompatibility } from "../../../src/core/compatibility.js";
import { INSTRUCTION_TARGETS } from "../../../src/core/instruction-targets.js";
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

describe("Antigravity Support", () => {
  describe("checkCompatibility", () => {
    it("returns no diagnostics for a compatible Antigravity skill", () => {
      const pkg = makePackage();
      const result = checkCompatibility(pkg, "antigravity");
      expect(result).toEqual([]);
    });

    it("errors when skill declares itself incompatible with antigravity", () => {
      const pkg = makePackage({
        meta: {
          tags: [],
          depends: [],
          configInputs: [],
          targets: { antigravity: false },
        },
      });
      const result = checkCompatibility(pkg, "antigravity");
      expect(result.some((d) => d.rule === "target-declared-incompatible")).toBe(true);
    });

    it("warns when skill uses allowed-tools (unsupported by Antigravity)", () => {
      const pkg = makePackage({
        skillMd: { name: "test-skill", description: "A test skill", allowedTools: ["Bash"] },
      });
      const result = checkCompatibility(pkg, "antigravity");
      expect(result.some((d) => d.rule === "unsupported-feature")).toBe(true);
    });

    it("warns about missing frontmatter for Antigravity target", () => {
      const pkg = makePackage({
        skillMd: { name: "", description: "" },
      });
      const result = checkCompatibility(pkg, "antigravity");
      expect(result.some((d) => d.rule === "missing-frontmatter-name")).toBe(true);
      expect(result.some((d) => d.rule === "missing-frontmatter-description")).toBe(true);
    });
  });

  describe("INSTRUCTION_TARGETS", () => {
    it("has correct configuration for antigravity", () => {
      const config = INSTRUCTION_TARGETS.antigravity;
      expect(config.label).toBe("Antigravity CLI");
      expect(config.globalFiles).toContain("~/.gemini/antigravity-cli/ANTIGRAVITY.md");
      expect(config.projectFiles).toContain("ANTIGRAVITY.md");
      expect(config.projectFiles).toContain(".gemini/antigravity-cli/ANTIGRAVITY.md");
      expect(config.agentTargetKey).toBe("antigravity");
    });
  });
});
