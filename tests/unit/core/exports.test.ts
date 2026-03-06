import { describe, it, expect } from "vitest";
import * as core from "../../../src/core/index.js";

describe("public package exports", () => {
  it("exports manifest functions", () => {
    expect(typeof core.readManifest).toBe("function");
    expect(typeof core.parseManifest).toBe("function");
    expect(typeof core.serializeManifest).toBe("function");
  });

  it("exports lock file functions", () => {
    expect(typeof core.createLockFile).toBe("function");
    expect(typeof core.readLockFile).toBe("function");
    expect(typeof core.writeLockFile).toBe("function");
    expect(typeof core.lockSkill).toBe("function");
    expect(typeof core.parseLockFile).toBe("function");
    expect(typeof core.serializeLockFile).toBe("function");
  });

  it("exports parser functions", () => {
    expect(typeof core.parseSkillMdFrontmatter).toBe("function");
    expect(typeof core.parseSkillSyncMeta).toBe("function");
    expect(typeof core.loadSkillPackage).toBe("function");
  });

  it("exports resolver functions", () => {
    expect(typeof core.resolveSkill).toBe("function");
    expect(typeof core.resolveAll).toBe("function");
    expect(typeof core.SkillNotFoundError).toBe("function");
  });

  it("exports sync engine functions", () => {
    expect(typeof core.planSync).toBe("function");
    expect(typeof core.applySync).toBe("function");
  });

  it("exports drift detection", () => {
    expect(typeof core.detectDrift).toBe("function");
  });

  it("exports materializer", () => {
    expect(typeof core.materialize).toBe("function");
    expect(typeof core.dematerialize).toBe("function");
  });

  it("exports compatibility functions", () => {
    expect(typeof core.checkCompatibility).toBe("function");
    expect(typeof core.checkAllTargetCompatibility).toBe("function");
    expect(core.AGENT_TARGETS).toBeDefined();
  });

  it("exports config generator", () => {
    expect(typeof core.generateConfig).toBe("function");
    expect(typeof core.writeProjectConfig).toBe("function");
    expect(typeof core.validateConfigOverrides).toBe("function");
  });

  it("exports portability functions", () => {
    expect(typeof core.checkPortability).toBe("function");
    expect(typeof core.isPortableMode).toBe("function");
    expect(typeof core.validatePortability).toBe("function");
  });

  it("exports hasher functions", () => {
    expect(typeof core.sha256File).toBe("function");
    expect(typeof core.sha256).toBe("function");
    expect(typeof core.hashSkillDirectory).toBe("function");
  });
});
