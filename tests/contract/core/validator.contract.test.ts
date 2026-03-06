import { beforeAll, describe, expect, it } from "vitest";
import { moduleExists, projectPath } from "../../helpers/module-availability.js";

type ValidatorModule = {
  validateSkillPackage: (path: string) => Promise<{
    valid: boolean;
    diagnostics: Array<{ rule: string; severity: string; message: string }>;
  }>;
  validateManifest?: (path: string) => Promise<{
    valid: boolean;
    diagnostics: Array<{ rule: string; severity: string; message: string }>;
  }>;
};

const describeValidator = moduleExists("src/core/validator.ts") ? describe : describe.skip;

describeValidator("core/validator contract", () => {
  let validatorModule: ValidatorModule;

  beforeAll(async () => {
    validatorModule = (await import("../../../src/core/validator.js")) as ValidatorModule;
  });

  it("exports validateSkillPackage", () => {
    expect(typeof validatorModule.validateSkillPackage).toBe("function");
  });

  it("accepts a valid skill package fixture", async () => {
    const result = await validatorModule.validateSkillPackage(
      projectPath("tests", "fixtures", "skills", "code"),
    );

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects non-portable absolute path references", async () => {
    const result = await validatorModule.validateSkillPackage(
      projectPath("tests", "fixtures", "skills", "invalid-absolute-path"),
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.rule.includes("portable"))).toBe(true);
  });

  it("optionally validates project manifests when validateManifest is implemented", async () => {
    if (!validatorModule.validateManifest) {
      return;
    }

    const result = await validatorModule.validateManifest(
      projectPath("tests", "fixtures", "project", "skillsync.invalid.yaml"),
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

