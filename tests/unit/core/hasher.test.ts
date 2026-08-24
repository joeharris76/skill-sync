import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashSkillDirectory } from "../../../src/core/hasher.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("hashSkillDirectory", () => {
  it("emits POSIX paths for nested files on every platform", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-hasher-"));
    tempDirs.push(root);
    await mkdir(join(root, "references"), { recursive: true });
    await writeFile(join(root, "SKILL.md"), "# Skill\n");
    await writeFile(join(root, "references", "guide.md"), "# Guide\n");

    const files = await hashSkillDirectory(root);

    expect(files.map((file) => file.relativePath)).toEqual(["references/guide.md", "SKILL.md"]);
    expect(files.every((file) => !file.relativePath.includes("\\"))).toBe(true);
  });
});
