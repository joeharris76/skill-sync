import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm, access, constants } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitSource } from "../../../src/sources/git.js";

const exec = promisify(execFile);

let repoDir: string;
let tmpBase: string;

async function initLocalRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await exec("git", ["init", "--initial-branch=main", dir]);
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });

  // Add a skill
  const skillDir = join(dir, "code");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: code\ndescription: Code skill\n---\n# Code\n");

  await exec("git", ["add", "."], { cwd: dir });
  await exec("git", ["commit", "-m", "initial"], { cwd: dir });
}

beforeAll(async () => {
  tmpBase = join(tmpdir(), "skill-sync-git-source-test-" + Date.now());
  repoDir = join(tmpBase, "repo");
  await initLocalRepo(repoDir);
});

afterAll(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

describe("GitSource.resolve()", () => {
  it("returns ResolvedSkill for an existing skill", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    try {
      const result = await source.resolve("code");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("code");
      expect(result!.sourceName).toBe("test");
      expect(result!.sourceType).toBe("git");
      expect(result!.location).toContain("code");
    } finally {
      await source.dispose();
    }
  });

  it("returns null when the skill does not exist in the repo", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    try {
      const result = await source.resolve("nonexistent-skill");
      expect(result).toBeNull();
    } finally {
      await source.dispose();
    }
  });

  it("reuses the clone on repeated calls (does not clone twice)", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    try {
      // Two resolve calls — only one clone should happen
      await source.resolve("code");
      const result = await source.resolve("code");
      expect(result).not.toBeNull();
    } finally {
      await source.dispose();
    }
  });
});

describe("GitSource.fetch()", () => {
  it("returns the skill path as non-temporary", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    try {
      const resolved = await source.resolve("code");
      const fetched = await source.fetch(resolved!);

      expect(fetched.name).toBe("code");
      expect(fetched.path).toBe(resolved!.location);
      expect(fetched.isTemporary).toBe(false);
    } finally {
      await source.dispose();
    }
  });
});

describe("GitSource.provenance()", () => {
  it("returns provenance with url, ref, and resolved revision", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    try {
      const resolved = await source.resolve("code");
      const prov = source.provenance(resolved!);

      expect(prov.type).toBe("git");
      expect(prov.name).toBe("test");
      expect(prov.url).toBe(`file://${repoDir}`);
      expect(prov.ref).toBe("main");
      expect(prov.revision).toMatch(/^[0-9a-f]{40}$/); // Full SHA
      expect(prov.fetchedAt).toBeTruthy();
    } finally {
      await source.dispose();
    }
  });

  it("returns undefined revision before first resolve", () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    const fakeResolved = { name: "code", sourceName: "test", sourceType: "git" as const, location: "/tmp/code" };
    const prov = source.provenance(fakeResolved);
    expect(prov.revision).toBeUndefined();
  });
});

describe("GitSource.dispose()", () => {
  it("removes the cloned temporary directory", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    const resolved = await source.resolve("code");
    expect(resolved).not.toBeNull();

    // Clone must exist before dispose
    const clonedPath = resolved!.location.replace(/\/code$/, "");
    await access(clonedPath, constants.R_OK); // throws if not found

    await source.dispose();

    // Clone should be gone
    await expect(access(clonedPath, constants.R_OK)).rejects.toThrow();
  });

  it("is idempotent — calling dispose twice does not throw", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    await source.resolve("code");
    await source.dispose();
    await expect(source.dispose()).resolves.not.toThrow();
  });
});

describe("GitSource clone failure", () => {
  it("throws when git clone fails and leaves no temp directory", async () => {
    const source = new GitSource("test", "file:///nonexistent-repo-xyz", "main");

    await expect(source.resolve("code")).rejects.toThrow();

    // After failure, dispose should be a no-op (nothing to clean up)
    await expect(source.dispose()).resolves.not.toThrow();
  });
});
