import { describe, it, expect, afterAll } from "vitest";
import { loadSkillPackage } from "../../../src/core/parser.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpBase = join(tmpdir(), "skillsync-parser-error-test");

describe("loadSkillPackage sidecar error handling", () => {
  it("loads fine when no sidecar exists", async () => {
    const skillDir = join(tmpBase, "no-sidecar");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: test\ndescription: ok\n---\n# Test");

    const pkg = await loadSkillPackage(skillDir);
    expect(pkg.meta).toBeNull();
    expect(pkg.name).toBe("test");
  });

  it("throws on malformed sidecar YAML", async () => {
    const skillDir = join(tmpBase, "bad-yaml");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: test\ndescription: ok\n---\n# Test");
    await writeFile(join(skillDir, "skillsync.meta.yaml"), "key: [unclosed");

    await expect(loadSkillPackage(skillDir)).rejects.toThrow("Failed to parse skillsync.meta.yaml");
  });

  it("loads valid sidecar correctly", async () => {
    const skillDir = join(tmpBase, "valid-sidecar");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: test\ndescription: ok\n---\n# Test");
    await writeFile(join(skillDir, "skillsync.meta.yaml"), "tags:\n  - testing\ndepends:\n  - SHARED/commit-framework\n");

    const pkg = await loadSkillPackage(skillDir);
    expect(pkg.meta).not.toBeNull();
    expect(pkg.meta!.tags).toContain("testing");
    expect(pkg.meta!.depends).toContain("SHARED/commit-framework");
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });
});
