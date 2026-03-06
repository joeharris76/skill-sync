import { describe, it, expect } from "vitest";
import { checkCompatibility } from "../../../src/core/compatibility.js";
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
    expect(result.some((d) => d.rule === "target-declared-incompatible")).toBe(
      true,
    );
    expect(result[0]!.severity).toBe("error");
  });

  it("warns about missing frontmatter for targets that read it", () => {
    const pkg = makePackage({
      skillMd: { name: "", description: "" },
    });
    const result = checkCompatibility(pkg, "claude");
    expect(result.some((d) => d.rule === "missing-frontmatter-name")).toBe(true);
    expect(
      result.some((d) => d.rule === "missing-frontmatter-description"),
    ).toBe(true);
  });
});
