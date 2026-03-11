import { describe, it, expect, afterAll } from "vitest";
import { detectDrift } from "../../../src/core/drift.js";
import type { LockFile } from "../../../src/core/types.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256 } from "../../../src/core/hasher.js";

const tmpBase = join(tmpdir(), "skill-sync-drift-test");

async function writeFileWithHash(dir: string, relPath: string, content: string) {
  const filePath = join(dir, relPath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
  return sha256(content);
}

describe("detectDrift", () => {
  it("detects clean and modified top-level skills", async () => {
    const targetRoot = join(tmpBase, "top-level");
    const hash = await writeFileWithHash(join(targetRoot, "code"), "SKILL.md", "# Code");

    const lockFile: LockFile = {
      version: 1,
      lockedAt: "",
      skills: {
        code: {
          source: { type: "local", name: "test", fetchedAt: "" },
          installMode: "mirror",
          files: { "SKILL.md": { sha256: hash, size: 6 } },
        },
      },
    };

    const report = await detectDrift(targetRoot, lockFile);
    expect(report.clean).toContain("code");
    expect(report.missing).toEqual([]);
    expect(report.modified).toEqual([]);
  });

  it("handles nested skill names like SHARED/commit-framework", async () => {
    const targetRoot = join(tmpBase, "nested");
    const hash = await writeFileWithHash(
      join(targetRoot, "SHARED", "commit-framework"),
      "SKILL.md",
      "# Commit Framework",
    );

    const lockFile: LockFile = {
      version: 1,
      lockedAt: "",
      skills: {
        "SHARED/commit-framework": {
          source: { type: "local", name: "test", fetchedAt: "" },
          installMode: "mirror",
          files: { "SKILL.md": { sha256: hash, size: 18 } },
        },
      },
    };

    const report = await detectDrift(targetRoot, lockFile);
    expect(report.clean).toContain("SHARED/commit-framework");
    expect(report.missing).toEqual([]);
    expect(report.extra).toEqual([]);
  });

  it("reports nested skills as extra when not in lock", async () => {
    const targetRoot = join(tmpBase, "extra-nested");
    await writeFileWithHash(
      join(targetRoot, "SHARED", "verify-framework"),
      "SKILL.md",
      "# Verify",
    );

    const lockFile: LockFile = { version: 1, lockedAt: "", skills: {} };
    const report = await detectDrift(targetRoot, lockFile);
    expect(report.extra).toContain("SHARED/verify-framework");
  });

  it("reports missing skills", async () => {
    const targetRoot = join(tmpBase, "missing");
    await mkdir(targetRoot, { recursive: true });

    const lockFile: LockFile = {
      version: 1,
      lockedAt: "",
      skills: {
        gone: {
          source: { type: "local", name: "test", fetchedAt: "" },
          installMode: "mirror",
          files: { "SKILL.md": { sha256: "abc", size: 5 } },
        },
      },
    };

    const report = await detectDrift(targetRoot, lockFile);
    expect(report.missing).toContain("gone");
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });
});
