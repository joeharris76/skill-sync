import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, readlink, stat, rm } from "node:fs/promises";
import { join, tmpdir, resolve } from "node:path";
import { tmpdir as osTmpdir } from "node:os";
import { hashSkillDirectory } from "../../../src/core/hasher.js";
import {
  dematerialize,
  materialize,
  materializeBatch,
} from "../../../src/core/materializer.js";

const SOURCE_CONTENT = "---\nname: code\ndescription: Code skill\n---\n# Code\n";
const REF_CONTENT = "# Compare reference\n";

async function makeSourceSkill(
  root: string,
): Promise<{ sourcePath: string; sourceFiles: SkillFile[] }> {
  const sourcePath = join(root, "source", "code");
  await mkdir(join(sourcePath, "references"), { recursive: true });
  await writeFile(join(sourcePath, "SKILL.md"), SOURCE_CONTENT, "utf-8");
  await writeFile(join(sourcePath, "references", "compare.md"), REF_CONTENT, "utf-8");
  const sourceFiles = await hashSkillDirectory(sourcePath);
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

    const result = await materialize({
      skillName: "code",
      sourcePath,
      targetRoot,
      mode: "symlink",
      sourceFiles,
    });

    expect(result.mode).toBe("symlink");
    expect(result.targetPath).toBe(join(targetRoot, "code"));

    const linkTarget = await readlink(join(targetRoot, "code"));
    // Verify the symlink is absolute and points exactly to sourcePath
    expect(linkTarget).toBe(resolve(sourcePath));
  });

  it("returns the source files unchanged without re-hashing", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({
      skillName: "code",
      sourcePath,
      targetRoot,
      mode: "symlink",
      sourceFiles,
    });

    // Files array should be exactly the same reference/content — no re-hashing
    expect(result.files).toEqual(sourceFiles);
    expect(result.files[0]!.sha256).toHaveLength(64);
    expect(result.files[1]!.sha256).toHaveLength(64);
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
    // Verify the symlink is absolute and points exactly to sourcePath
    expect(linkTarget).toBe(resolve(sourcePath));
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
    // Verify the symlink is absolute and points exactly to sourcePath
    expect(linkTarget).toBe(resolve(sourcePath));
  });
});

describe("materialize — copy mode", () => {
  it("copies files to the target directory", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({
      skillName: "code",
      sourcePath,
      targetRoot,
      mode: "copy",
      sourceFiles,
    });

    expect(result.mode).toBe("copy");
    // Copy re-hashes the staged target and confirms exact parity.
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

    const result = await materialize({
      skillName: "code",
      sourcePath,
      targetRoot,
      mode: "copy",
      sourceFiles,
    });

    expect(result.targetPath).toBe(join(targetRoot, "code"));
  });

  it.each([
    "copy",
    "mirror",
  ] as const)("%s rejects a digest mismatch without replacing the current target", async (mode) => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");
    const targetDir = join(targetRoot, "code");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "CURRENT.md"), "keep me\n");
    const incorrect = sourceFiles.map((file, index) =>
      index === 0 ? { ...file, sha256: "0".repeat(64) } : file,
    );

    await expect(
      materialize({ skillName: "code", sourcePath, targetRoot, mode, sourceFiles: incorrect }),
    ).rejects.toThrow("Materialized integrity error");

    expect(await stat(join(targetDir, "CURRENT.md"))).toBeDefined();
  });

  it("stages every target before committing any target", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const firstRoot = join(root, "first", "skills");
    const secondRoot = join(root, "second", "skills");
    const blockedParent = join(root, "blocked");
    await writeFile(blockedParent, "not a directory\n");

    await expect(
      materializeBatch(
        [firstRoot, secondRoot, join(blockedParent, "skills")].map((targetRoot) => ({
          skillName: "code",
          sourcePath,
          targetRoot,
          mode: "copy" as const,
          sourceFiles,
        })),
      ),
    ).rejects.toThrow();

    expect(existsSync(join(firstRoot, "code"))).toBe(false);
    expect(existsSync(join(secondRoot, "code"))).toBe(false);
  });
});

describe("materialize — mirror mode", () => {
  it("copies files and re-hashes the target directory", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    const result = await materialize({
      skillName: "code",
      sourcePath,
      targetRoot,
      mode: "mirror",
      sourceFiles,
    });

    expect(result.mode).toBe("mirror");
    // Mirror re-hashes the copied target.
    expect(result.files).toEqual(sourceFiles);
    expect(result.files[0]!.sha256).toHaveLength(64); // SHA256 hex
  });
});

describe("materialize — containment & normalization safety", () => {
  it("rejects skill names that attempt path traversal outside targetRoot", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    await expect(
      materialize({
        skillName: "../../escape",
        sourcePath,
        targetRoot,
        mode: "copy",
        sourceFiles,
      }),
    ).rejects.toThrow("traversal segments");
  });

  it("rejects absolute skill names in materialize", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "target", "skills");

    await expect(
      materialize({
        skillName: "/etc/passwd",
        sourcePath,
        targetRoot,
        mode: "copy",
        sourceFiles,
      }),
    ).rejects.toThrow("relative path");
  });

  it("rejects loader-owned aliases before materializing or removing from disk", async () => {
    const root = await makeTempDir();
    const { sourcePath, sourceFiles } = await makeSourceSkill(root);
    const targetRoot = join(root, "missing-target");

    for (const skillName of [
      ".system/imagegen",
      ".System/imagegen",
      ".SYSTEM/imagegen",
      ".ſystem/imagegen",
    ]) {
      await expect(
        materialize({
          skillName,
          sourcePath,
          targetRoot,
          mode: "mirror",
          sourceFiles,
        }),
      ).rejects.toThrow("loader-owned");

      await expect(dematerialize(skillName, targetRoot)).rejects.toThrow("loader-owned");
    }
    expect(existsSync(targetRoot)).toBe(false);
  });

  it("preserves .system bytes when a case-fold alias resolves to it", async () => {
    const root = await makeTempDir();
    const targetRoot = join(root, "target");
    const systemFile = join(targetRoot, ".system", "imagegen", "SKILL.md");
    const systemBytes = Buffer.from([0x00, 0x42, 0x4d, 0xff, 0x0a]);
    await mkdir(join(systemFile, ".."), { recursive: true });
    await writeFile(systemFile, systemBytes);

    const aliases = [".System/imagegen", ".ſystem/imagegen"];
    if (aliases.some((alias) => !existsSync(join(targetRoot, alias, "SKILL.md")))) return;

    for (const alias of aliases) {
      await expect(dematerialize(alias, targetRoot)).rejects.toThrow("loader-owned");
      expect(await readFile(systemFile)).toEqual(systemBytes);
    }
  });
});
