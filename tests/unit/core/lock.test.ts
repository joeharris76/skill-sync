import { describe, it, expect } from "vitest";
import {
  createLockFile,
  lockSkill,
  parseLockFile,
  unlockSkill,
  getLockedSkill,
} from "../../../src/core/lock.js";
import type { SourceProvenance, SkillFile } from "../../../src/core/types.js";

const testProvenance: SourceProvenance = {
  type: "local",
  name: "personal",
  path: "/home/user/.claude/skills/code",
  fetchedAt: "2026-03-06T10:00:00Z",
};

const testFiles: SkillFile[] = [
  { relativePath: "SKILL.md", sha256: "abc123", size: 1024 },
  { relativePath: "references/compare.md", sha256: "def456", size: 512 },
];

describe("LockFile", () => {
  it("creates an empty lock file", () => {
    const lock = createLockFile();
    expect(lock.version).toBe(1);
    expect(lock.skills).toEqual({});
    expect(lock.lockedAt).toBeTruthy();
  });

  it("locks a skill with source provenance and file digests", () => {
    const lock = createLockFile();
    lockSkill(lock, "code", testProvenance, "mirror", testFiles);

    const locked = getLockedSkill(lock, "code");
    expect(locked).not.toBeNull();
    expect(locked!.source).toEqual(testProvenance);
    expect(locked!.installMode).toBe("mirror");
    expect(locked!.files["SKILL.md"]).toEqual({ sha256: "abc123", size: 1024 });
    expect(locked!.files["references/compare.md"]).toEqual({
      sha256: "def456",
      size: 512,
    });
  });

  it("returns null for unlocked skills", () => {
    const lock = createLockFile();
    expect(getLockedSkill(lock, "nonexistent")).toBeNull();
  });

  it("removes a skill from the lock", () => {
    const lock = createLockFile();
    lockSkill(lock, "code", testProvenance, "mirror", testFiles);
    unlockSkill(lock, "code");
    expect(getLockedSkill(lock, "code")).toBeNull();
  });

  it("preserves source revision and install mode on round-trip", () => {
    const lock = createLockFile();
    const gitProvenance: SourceProvenance = {
      type: "git",
      name: "team",
      url: "git@github.com:org/skills.git",
      ref: "main",
      revision: "abc123def456",
      fetchedAt: "2026-03-06T10:00:00Z",
    };

    lockSkill(lock, "deploy", gitProvenance, "copy", testFiles);

    // Simulate JSON round-trip (serialization)
    const serialized = JSON.parse(JSON.stringify(lock));
    const roundTripped = getLockedSkill(serialized, "deploy");

    expect(roundTripped!.source.type).toBe("git");
    expect(roundTripped!.source.revision).toBe("abc123def456");
    expect(roundTripped!.source.ref).toBe("main");
    expect(roundTripped!.installMode).toBe("copy");
    expect(roundTripped!.files["SKILL.md"]!.sha256).toBe("abc123");
  });

  it("normalizes legacy Windows file keys", () => {
    const lock = createLockFile();
    lockSkill(lock, "code", testProvenance, "mirror", [
      { relativePath: "references\\compare.md", sha256: "abc", size: 3 },
    ]);

    const parsed = parseLockFile(JSON.stringify(lock));

    expect(parsed.skills.code!.files["references/compare.md"]).toEqual({
      sha256: "abc",
      size: 3,
    });
  });

  it("rejects legacy keys that collide after normalization", () => {
    const lock = createLockFile();
    lockSkill(lock, "code", testProvenance, "mirror", [
      { relativePath: "references/compare.md", sha256: "abc", size: 3 },
      { relativePath: "references\\compare.md", sha256: "def", size: 3 },
    ]);

    expect(() => parseLockFile(JSON.stringify(lock))).toThrow("colliding paths");
  });

  it("rejects loader-owned skill identities but preserves package-relative files", () => {
    const lock = createLockFile();
    expect(() => lockSkill(lock, ".system/imagegen", testProvenance, "mirror", testFiles)).toThrow(
      "loader-owned",
    );
    expect(() =>
      parseLockFile(
        JSON.stringify({
          version: 1,
          lockedAt: "",
          skills: {
            ".system/imagegen": {
              source: testProvenance,
              installMode: "mirror",
              files: {},
            },
          },
        }),
      ),
    ).toThrow("loader-owned");

    lockSkill(lock, "code", testProvenance, "mirror", [
      { relativePath: ".system/example.md", sha256: "abc", size: 3 },
    ]);
    expect(parseLockFile(JSON.stringify(lock)).skills.code!.files[".system/example.md"]).toBeDefined();
  });
});
