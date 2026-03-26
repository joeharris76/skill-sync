import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readlink, stat, rm } from "node:fs/promises";
import { join, tmpdir } from "node:path";
import { tmpdir as osTmpdir } from "node:os";
import { materialize } from "../../../src/core/materializer.js";
import type { SkillFile } from "../../../src/core/types.js";

const SOURCE_CONTENT = "---\nname: code\ndescription: Code skill\n---\n# Code\n";
const REF_CONTENT = "# Compare reference\n";

async function makeSourceSkill(root: string): Promise<{ sourcePath: string; sourceFiles: SkillFile[] }> {
  const sourcePath = join(root, "source", "code");
  await mkdir(join(sourcePath, "references"), { recursive: true });
  await writeFile(join(sourcePath, "SKILL.md"), SOURCE_CONTENT, "utf-8");
  await writeFile(join(sourcePath, "references", "compare.md"), REF_CONTENT, "utf-8");
  const sourceFiles: SkillFile[] = [
    { relativePath: "SKILL.md", sha256: "abc123", size: SOURCE_CONTENT.length },
    { relativePath: "references/compare.md", sha256: "def456", size: REF_CONTENT.length },
  ];
  return { sourcePath, sourceFiles };
}

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(osTmpdir(), "skill-sync-mat-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("materialize — symlink mode", () => {
  it("creates a directory symlink pointing to the source path", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({ skillName: "code", sourcePath, targetRoot, mode: "symlink", sourceFiles });

    expect(result.mode).toBe("symlink");
    expect(result.targetPath).toBe(join(targetRoot, "code"));

    const linkTarget = await readlink(join(targetRoot, "code"));
    expect(linkTarget).toBe(sourcePath);
  });

  it("returns the source files unchanged without re-hashing", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({ skillName: "code", sourcePath, targetRoot, mode: "symlink", sourceFiles });

    // Files array should be exactly the same reference/content — no re-hashing
    expect(result.files).toEqual(sourceFiles);
    expect(result.files[0]!.sha256).toBe("abc123");
    expect(result.files[1]!.sha256).toBe("def456");
  });

  it("replaces an existing directory with a symlink", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");
    const targetDir = join(targetRoot, "code");

    // Pre-create a real directory at the target location
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "OLD.md"), "old content", "utf-8");

    await materialize({ skillName: "code", sourcePath, targetRoot, mode: "symlink", sourceFiles });

    // Should now be a symlink, not a directory with the old file
    const linkTarget = await readlink(targetDir);
    expect(linkTarget).toBe(sourcePath);
  });

  it("creates parent directories when they do not exist", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    // Deep nested target root that doesn't exist yet
    const targetRoot = join(root, "deeply", "nested", "target", "skills");

    await materialize({ skillName: "code", sourcePath, targetRoot, mode: "symlink", sourceFiles });

    const linkTarget = await readlink(join(targetRoot, "code"));
    expect(linkTarget).toBe(sourcePath);
  });

  it("replaces an existing symlink with a new one", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    // Create an initial symlink pointing somewhere else
    const otherSource = join(root, "other");
    await mkdir(otherSource, { recursive: true });
    await mkdir(targetRoot, { recursive: true });

    const { symlink: symlinkFn } = await import("node:fs/promises");
    await symlinkFn(otherSource, join(targetRoot, "code"), "dir");

    await materialize({ skillName: "code", sourcePath, targetRoot, mode: "symlink", sourceFiles });

    const linkTarget = await readlink(join(targetRoot, "code"));
    expect(linkTarget).toBe(sourcePath);
  });
});

describe("materialize — copy mode", () => {
  it("copies files to the target directory", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({ skillName: "code", sourcePath, targetRoot, mode: "copy", sourceFiles });

    expect(result.mode).toBe("copy");
    // Files returned are source files (no re-hash)
    expect(result.files).toEqual(sourceFiles);

    // Verify files actually exist at target
    const targetSkillMd = join(targetRoot, "code", "SKILL.md");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(targetSkillMd, "utf-8");
    expect(content).toBe(SOURCE_CONTENT);
  });

  it("result targetPath points to the skill subdirectory", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({ skillName: "code", sourcePath, targetRoot, mode: "copy", sourceFiles });

    expect(result.targetPath).toBe(join(targetRoot, "code"));
  });
});

describe("materialize — mirror mode", () => {
  it("copies files and re-hashes the target directory", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({ skillName: "code", sourcePath, targetRoot, mode: "mirror", sourceFiles });

    expect(result.mode).toBe("mirror");
    // Mirror re-hashes, so sha256 values are real (not the placeholder "abc123")
    expect(result.files[0]!.sha256).not.toBe("abc123");
    expect(result.files[0]!.sha256).toHaveLength(64); // SHA256 hex
  });
});
