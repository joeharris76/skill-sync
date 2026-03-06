import { describe, it, expect } from "vitest";
import { isPortableMode, checkPortability } from "../../../src/core/portability.js";
import type { SkillPackage } from "../../../src/core/types.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("isPortableMode", () => {
  it("copy is portable", () => expect(isPortableMode("copy")).toBe(true));
  it("mirror is portable", () => expect(isPortableMode("mirror")).toBe(true));
  it("symlink is NOT portable", () =>
    expect(isPortableMode("symlink")).toBe(false));
});

describe("checkPortability", () => {
  const tmpBase = join(tmpdir(), "skillsync-portability-test");

  async function makeSkillWithContent(
    name: string,
    skillMdContent: string,
  ): Promise<SkillPackage> {
    const skillDir = join(tmpBase, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), skillMdContent);
    return {
      name,
      description: "test",
      path: skillDir,
      skillMd: { name, description: "test" },
      meta: null,
      files: [{ relativePath: "SKILL.md", sha256: "x", size: skillMdContent.length }],
    };
  }

  it("flags home directory references", async () => {
    const pkg = await makeSkillWithContent(
      "bad-home",
      "---\nname: test\n---\nRun: ~/scripts/build.sh\n",
    );
    const diags = await checkPortability(pkg);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0]!.rule).toBe("non-portable-path");
  });

  it("flags absolute user paths", async () => {
    const pkg = await makeSkillWithContent(
      "bad-abs",
      "---\nname: test\n---\nPath: /Users/joe/.claude/skills/code\n",
    );
    const diags = await checkPortability(pkg);
    expect(diags.length).toBeGreaterThan(0);
  });

  it("passes for clean portable skills", async () => {
    const pkg = await makeSkillWithContent(
      "good",
      "---\nname: test\ndescription: clean\n---\n# Skill\nUse relative paths only.\n",
    );
    const diags = await checkPortability(pkg);
    expect(diags).toEqual([]);
  });

  // Cleanup
  it("cleanup", async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });
});
