import { describe, it, expect, afterAll } from "vitest";
import { validateSkillPackage, validateManifest } from "../../../src/core/validator.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const tmpBase = join(tmpdir(), "skill-sync-validator-test");

describe("validateSkillPackage", () => {
  it("passes for a valid skill", async () => {
    const skillDir = join(tmpBase, "valid");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: valid\ndescription: A valid skill\n---\n# Valid\n");

    const result = await validateSkillPackage(skillDir);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("fails on missing frontmatter name", async () => {
    const skillDir = join(tmpBase, "no-name");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\ndescription: test\n---\n# Test\n");

    const result = await validateSkillPackage(skillDir);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.rule === "missing-frontmatter-name")).toBe(true);
  });

  it("fails on missing frontmatter description", async () => {
    const skillDir = join(tmpBase, "no-desc");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: no-desc\n---\n# Test\n");

    const result = await validateSkillPackage(skillDir);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.rule === "missing-frontmatter-description")).toBe(true);
  });

  it("fails on non-portable paths", async () => {
    const skillDir = join(tmpBase, "nonportable");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: np\ndescription: test\n---\nSee /Users/joe/code\n");

    const result = await validateSkillPackage(skillDir);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.rule === "non-portable-path")).toBe(true);
  });

  it("passes for the bundled skill-sync wrapper", async () => {
    const result = await validateSkillPackage(resolve("skills/skill-sync"));
    expect(result.valid).toBe(true);
    expect(result.diagnostics.some((d) => d.rule === "non-portable-path")).toBe(false);
  });

  it("fails when SKILL.md is missing", async () => {
    const skillDir = join(tmpBase, "no-skill-md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "README.md"), "# Not a skill\n");

    const result = await validateSkillPackage(skillDir);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]!.rule).toBe("load-error");
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });
});

describe("validateManifest", () => {
  it("passes for a valid manifest", async () => {
    const path = join(tmpBase, "valid.yaml");
    await mkdir(tmpBase, { recursive: true });
    await writeFile(path, "version: 1\nsources:\n  - name: test\n    type: local\n    path: /tmp\nskills:\n  - code\ntargets:\n  claude: .claude/skills\n");

    const result = await validateManifest(path);
    expect(result.valid).toBe(true);
  });

  it("fails on parse errors", async () => {
    const path = join(tmpBase, "bad.yaml");
    await writeFile(path, "version: 2\nsources: []\nskills: []\n");

    const result = await validateManifest(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]!.rule).toBe("manifest-parse-error");
  });

  it("warns on missing skills", async () => {
    const path = join(tmpBase, "no-skills.yaml");
    await writeFile(path, "version: 1\nsources:\n  - name: test\n    type: local\n    path: /tmp\nskills: []\ntargets:\n  claude: .claude/skills\n");

    const result = await validateManifest(path);
    expect(result.diagnostics.some((d) => d.rule === "no-skills")).toBe(true);
  });

  it("fails on missing targets", async () => {
    const path = join(tmpBase, "no-targets.yaml");
    await writeFile(path, "version: 1\nsources: []\nskills: []\ntargets: {}\n");

    const result = await validateManifest(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.rule === "no-targets")).toBe(true);
  });

  it("warns on symlink install mode", async () => {
    const path = join(tmpBase, "symlink.yaml");
    await writeFile(path, "version: 1\nsources:\n  - name: test\n    type: local\n    path: /tmp\nskills:\n  - x\ntargets:\n  claude: .claude/skills\ninstall_mode: symlink\n");

    const result = await validateManifest(path);
    expect(result.diagnostics.some((d) => d.rule === "non-portable-install-mode")).toBe(true);
  });

  it("fails with manifest-read-error when manifest file does not exist", async () => {
    const path = join(tmpBase, "nonexistent-dir", "skill-sync.yaml");

    const result = await validateManifest(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]!.rule).toBe("manifest-read-error");
    expect(result.diagnostics[0]!.message).toContain("Cannot read manifest");
  });

  it("fails with manifest-parse-error when YAML is syntactically invalid", async () => {
    const path = join(tmpBase, "invalid-yaml.yaml");
    await mkdir(tmpBase, { recursive: true });
    await writeFile(path, "version: 1\nbroken: [unclosed\n");

    const result = await validateManifest(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]!.rule).toBe("manifest-parse-error");
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });
});
