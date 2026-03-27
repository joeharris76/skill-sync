import { describe, it, expect } from "vitest";
import {
  checkSettingsRequirements,
  collectRequiredAllows,
  buildSuggestedPermissions,
} from "../../../src/core/settings-checker.js";
import type { SkillSyncMeta } from "../../../src/core/types.js";

function makeSkill(
  name: string,
  allows: string[] | undefined,
  agent = "claude",
): { name: string; meta: SkillSyncMeta | null } {
  return {
    name,
    meta: allows
      ? {
          tags: [],
          depends: [],
          configInputs: [],
          targets: {},
          settingsRequirements: {
            [agent]: { permissions: { allow: allows } },
          },
        }
      : null,
  };
}

describe("checkSettingsRequirements", () => {
  it("returns no gaps when all requirements are satisfied", () => {
    const skills = [makeSkill("code", ["Bash(git:*)", "Bash(npm:*)"])];
    const settings = { permissions: { allow: ["Bash(git:*)", "Bash(npm:*)", "Read"] } };
    expect(checkSettingsRequirements(skills, "claude", settings)).toEqual([]);
  });

  it("returns gaps for missing allow entries", () => {
    const skills = [makeSkill("code", ["Bash(git:*)", "Bash(npm:*)"])];
    const settings = { permissions: { allow: ["Bash(git:*)"] } };
    const gaps = checkSettingsRequirements(skills, "claude", settings);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.skillName).toBe("code");
    expect(gaps[0]!.missingAllows).toEqual(["Bash(npm:*)"]);
  });

  it("returns no gaps when skill has no settingsRequirements", () => {
    const skills = [{ name: "code", meta: null }];
    expect(checkSettingsRequirements(skills, "claude", {})).toEqual([]);
  });

  it("returns no gaps when skill has requirements for a different agent", () => {
    const skills = [makeSkill("code", ["Bash(git:*)"], "codex")];
    expect(checkSettingsRequirements(skills, "claude", {})).toEqual([]);
  });

  it("handles multiple skills with partial overlap", () => {
    const skills = [
      makeSkill("code", ["Bash(git:*)", "Bash(npm:*)"]),
      makeSkill("test", ["Bash(pytest:*)", "Bash(npm:*)"]),
    ];
    const settings = { permissions: { allow: ["Bash(npm:*)"] } };
    const gaps = checkSettingsRequirements(skills, "claude", settings);
    expect(gaps).toHaveLength(2);
    expect(gaps.find((g) => g.skillName === "code")?.missingAllows).toEqual(["Bash(git:*)"]);
    expect(gaps.find((g) => g.skillName === "test")?.missingAllows).toEqual(["Bash(pytest:*)"]);
  });

  it("treats missing settings file (empty object) as no existing permissions", () => {
    const skills = [makeSkill("code", ["Bash(git:*)"])];
    const gaps = checkSettingsRequirements(skills, "claude", {});
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.missingAllows).toEqual(["Bash(git:*)"]);
  });

  it("uses exact string matching — broad wildcard does not satisfy specific rule", () => {
    const skills = [makeSkill("code", ["Bash(git:*)"])];
    // "Bash(*)" is broader but is NOT treated as satisfying "Bash(git:*)" in v0
    const settings = { permissions: { allow: ["Bash(*)"] } };
    const gaps = checkSettingsRequirements(skills, "claude", settings);
    expect(gaps).toHaveLength(1);
  });
});

describe("collectRequiredAllows", () => {
  it("returns deduplicated union of all allow entries", () => {
    const skills = [
      makeSkill("code", ["Bash(git:*)", "Bash(npm:*)"]),
      makeSkill("test", ["Bash(pytest:*)", "Bash(npm:*)"]),
    ];
    const result = collectRequiredAllows(skills, "claude");
    expect(result).toHaveLength(3);
    expect(result).toContain("Bash(git:*)");
    expect(result).toContain("Bash(npm:*)");
    expect(result).toContain("Bash(pytest:*)");
  });

  it("returns empty array when no skills have requirements", () => {
    const skills = [{ name: "code", meta: null }];
    expect(collectRequiredAllows(skills, "claude")).toEqual([]);
  });

  it("ignores requirements for other agents", () => {
    const skills = [makeSkill("code", ["Bash(git:*)"], "codex")];
    expect(collectRequiredAllows(skills, "claude")).toEqual([]);
  });
});

describe("buildSuggestedPermissions", () => {
  it("returns only the missing entries as a fragment", () => {
    const skills = [makeSkill("code", ["Bash(git:*)", "Bash(npm:*)"])];
    const existing = { permissions: { allow: ["Bash(git:*)"] } };
    const fragment = buildSuggestedPermissions(skills, "claude", existing);
    expect(fragment.permissions?.allow).toEqual(["Bash(npm:*)"]);
  });

  it("returns empty object when all requirements are already satisfied", () => {
    const skills = [makeSkill("code", ["Bash(git:*)"])];
    const existing = { permissions: { allow: ["Bash(git:*)", "Read"] } };
    expect(buildSuggestedPermissions(skills, "claude", existing)).toEqual({});
  });

  it("returns all required entries when settings file is empty", () => {
    const skills = [makeSkill("code", ["Bash(git:*)", "Bash(npm:*)"])];
    const fragment = buildSuggestedPermissions(skills, "claude", {});
    expect(fragment.permissions?.allow).toEqual(["Bash(git:*)", "Bash(npm:*)"]);
  });

  it("returns empty object when no skills have requirements", () => {
    const skills = [{ name: "code", meta: null }];
    expect(buildSuggestedPermissions(skills, "claude", {})).toEqual({});
  });
});
