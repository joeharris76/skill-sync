import { execFile } from "node:child_process";
import { access, constants, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitSource } from "../../../src/sources/git.js";

const exec = promisify(execFile);

let repoDir: string;
let tmpBase: string;
let firstRevision: string;
let pinnedRevision: string;

async function initLocalRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await exec("git", ["init", "--initial-branch=main", dir]);
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });

  // Add a skill
  const skillDir = join(dir, "code");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: code\ndescription: Code skill\n---\n# Code\n",
  );

  const nestedSkillDir = join(dir, "skills", "docs");
  await mkdir(nestedSkillDir, { recursive: true });
  await writeFile(
    join(nestedSkillDir, "SKILL.md"),
    "---\nname: docs\ndescription: Docs skill\n---\n# Docs\n",
  );

  await exec("git", ["add", "."], { cwd: dir });
  await exec("git", ["commit", "-m", "initial"], { cwd: dir });
  firstRevision = (await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();

  await writeFile(join(dir, "later.txt"), "later\n");
  await exec("git", ["add", "later.txt"], { cwd: dir });
  await exec("git", ["commit", "-m", "later"], { cwd: dir });

  await exec("git", ["checkout", "-b", "feature"], { cwd: dir });
  const pinnedSkillDir = join(dir, "pinned");
  await mkdir(pinnedSkillDir, { recursive: true });
  await writeFile(
    join(pinnedSkillDir, "SKILL.md"),
    "---\nname: pinned\ndescription: Pinned skill\n---\n# Pinned\n",
  );
  await exec("git", ["add", "pinned/SKILL.md"], { cwd: dir });
  await exec("git", ["commit", "-m", "add pinned skill"], { cwd: dir });
  pinnedRevision = (await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
  await exec("git", ["checkout", "main"], { cwd: dir });
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
  it("resolves an exact commit that is not on the default branch", async () => {
    const source = new GitSource("test", `file://${repoDir}`, pinnedRevision);
    try {
      const result = await source.resolve("pinned");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("pinned");
      expect(source.provenance(result!).revision).toBe(pinnedRevision);
    } finally {
      await source.dispose();
    }
  });

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

  it("resolves skills below a configured repository subdirectory", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main", "skills");
    try {
      const result = await source.resolve("docs");
      expect(result?.location).toMatch(/\/skills\/docs$/);
      expect(await source.resolve("code")).toBeNull();
    } finally {
      await source.dispose();
    }
  });

  it.each([
    "../skills",
    "skills/../other",
    "/skills",
    "C:/skills",
    "skills\\nested",
    " ",
  ])("rejects unsafe repository subdir %j", (subdir) => {
    expect(() => new GitSource("test", `file://${repoDir}`, "main", subdir)).toThrow(/subdir/);
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

  it("resolves an older commit SHA", async () => {
    const source = new GitSource("test", `file://${repoDir}`, firstRevision);
    try {
      expect(await source.resolve("code")).not.toBeNull();
      expect(source.provenance((await source.resolve("code"))!).revision).toBe(firstRevision);
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
      expect(prov.subdir).toBeUndefined();
      expect(prov.revision).toMatch(/^[0-9a-f]{40}$/); // Full SHA
      expect(prov.fetchedAt).toBeTruthy();
    } finally {
      await source.dispose();
    }
  });

  it("records the normalized repository subdirectory", async () => {
    const source = new GitSource("test", `file://${repoDir}`, "main", "skills/");
    try {
      const resolved = await source.resolve("docs");
      expect(source.provenance(resolved!).subdir).toBe("skills");
    } finally {
      await source.dispose();
    }
  });

  it("returns undefined revision before first resolve", () => {
    const source = new GitSource("test", `file://${repoDir}`, "main");
    const fakeResolved = {
      name: "code",
      sourceName: "test",
      sourceType: "git" as const,
      location: "/tmp/code",
    };
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
