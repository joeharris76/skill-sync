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

describe("Gemini Support", () => {
  describe("checkCompatibility", () => {
    it("returns no diagnostics for a compatible Gemini skill", () => {
      const pkg = makePackage();
      const result = checkCompatibility(pkg, "gemini");
      expect(result).toEqual([]);
    });

    it("errors when skill declares itself incompatible with gemini", () => {
      const pkg = makePackage({
        meta: {
          tags: [],
          depends: [],
          configInputs: [],
          targets: { gemini: false },
        },
      });
      const result = checkCompatibility(pkg, "gemini");
      expect(result.some((d) => d.rule === "target-declared-incompatible")).toBe(true);
    });

    it("warns about missing frontmatter for Gemini target", () => {
      const pkg = makePackage({
        skillMd: { name: "", description: "" },
      });
      const result = checkCompatibility(pkg, "gemini");
      expect(result.some((d) => d.rule === "missing-frontmatter-name")).toBe(true);
      expect(result.some((d) => d.rule === "missing-frontmatter-description")).toBe(true);
    });
  });

  describe("INSTRUCTION_TARGETS", () => {
    it("has correct configuration for gemini", () => {
      const config = INSTRUCTION_TARGETS.gemini;
      expect(config.label).toBe("Gemini CLI");
      expect(config.globalFiles).toContain("~/.gemini/GEMINI.md");
      expect(config.projectFiles).toContain("GEMINI.md");
      expect(config.projectFiles).toContain(".gemini/GEMINI.md");
      expect(config.agentTargetKey).toBe("gemini");
    });
  });
});
