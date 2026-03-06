import { describe, it, expect } from "vitest";
import {
  generateConfig,
  validateConfigOverrides,
} from "../../../src/core/config-generator.js";
import type { SkillPackage } from "../../../src/core/types.js";

function makeSkill(
  name: string,
  configInputs: Array<{
    key: string;
    type: "string";
    description: string;
    default?: string;
  }> = [],
): SkillPackage {
  return {
    name,
    description: "test",
    path: `/tmp/${name}`,
    skillMd: { name, description: "test" },
    meta: { tags: [], depends: [], configInputs, targets: {} },
    files: [],
  };
}

describe("generateConfig", () => {
  it("merges skill defaults with manifest overrides", () => {
    const skills = [
      makeSkill("test", [
        {
          key: "test.runner",
          type: "string",
          description: "Runner",
          default: "pytest",
        },
        {
          key: "test.test_dir",
          type: "string",
          description: "Dir",
          default: "tests/",
        },
      ]),
    ];

    const result = generateConfig({
      manifestConfig: { test: { runner: "uv run pytest" } },
      installedSkills: skills,
    });

    expect(result.test!.runner).toBe("uv run pytest"); // Override wins
    expect(result.test!.test_dir).toBe("tests/"); // Default preserved
  });

  it("returns manifest config when no skill defaults exist", () => {
    const result = generateConfig({
      manifestConfig: { code: { lint: "ruff check ." } },
      installedSkills: [makeSkill("code")],
    });

    expect(result.code!.lint).toBe("ruff check .");
  });

  it("returns empty config when nothing is configured", () => {
    const result = generateConfig({
      manifestConfig: {},
      installedSkills: [],
    });

    expect(result).toEqual({});
  });
});

describe("validateConfigOverrides", () => {
  it("warns about config for non-existent skills", () => {
    const warnings = validateConfigOverrides(
      { missing: { key: "value" } },
      [],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no matching installed skill");
  });

  it("warns about undeclared config keys", () => {
    const skills = [
      makeSkill("test", [
        { key: "test.runner", type: "string", description: "Runner" },
      ]),
    ];

    const warnings = validateConfigOverrides(
      { test: { runner: "pytest", unknown_key: "value" } },
      skills,
    );

    expect(warnings.some((w) => w.includes("unknown_key"))).toBe(true);
  });

  it("passes when all config keys are declared", () => {
    const skills = [
      makeSkill("test", [
        { key: "test.runner", type: "string", description: "Runner" },
      ]),
    ];

    const warnings = validateConfigOverrides(
      { test: { runner: "pytest" } },
      skills,
    );

    expect(warnings).toHaveLength(0);
  });
});
