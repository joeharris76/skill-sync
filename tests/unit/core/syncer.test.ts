import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSync, applySync } from "../../../src/core/syncer.js";
import { sha256 } from "../../../src/core/hasher.js";

describe("planSync", () => {
  it("skips update when on-disk content matches source (disk-matches-source)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-syncer-disk-"));
    const skillDir = join(tmpDir, "code");
    await mkdir(skillDir, { recursive: true });

    // On-disk content matches the source content
    const content = "# Code Skill\nUpdated version.\n";
    const contentHash = sha256(content);
    await writeFile(join(skillDir, "SKILL.md"), content, "utf8");

    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-03-07T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "old-source", fetchedAt: "2026-03-06T10:00:00Z" },
            installMode: "mirror",
            files: {
              "SKILL.md": { sha256: "stale-lock-hash", size: 10 },
            },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "new-source", fetchedAt: "2026-03-07T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: contentHash, size: Buffer.byteLength(content) }],
        },
      ],
      targetRoot: tmpDir,
    });

    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toEqual({ name: "code", reason: "disk-matches-source" });
    expect(plan.update).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not skip when on-disk content differs from source", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-syncer-nodisk-"));
    const skillDir = join(tmpDir, "code");
    await mkdir(skillDir, { recursive: true });

    await writeFile(join(skillDir, "SKILL.md"), "old content on disk\n", "utf8");

    const newContent = "new content from source\n";
    const newHash = sha256(newContent);

    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-03-07T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-03-06T10:00:00Z" },
            installMode: "mirror",
            files: {
              "SKILL.md": { sha256: "stale-lock-hash", size: 10 },
            },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-03-07T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: newHash, size: Buffer.byteLength(newContent) }],
        },
      ],
      targetRoot: tmpDir,
    });

    expect(plan.skipped).toHaveLength(0);
    // With no drift report, it goes to update (not conflict)
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.name).toBe("code");

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not skip when skill directory does not exist on disk", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-syncer-nodir-"));
    // No skill directory created — disk is empty

    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-03-07T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-03-06T10:00:00Z" },
            installMode: "mirror",
            files: {
              "SKILL.md": { sha256: "stale-lock-hash", size: 10 },
            },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-03-07T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: "new-hash", size: 10 }],
        },
      ],
      targetRoot: tmpDir,
    });

    expect(plan.skipped).toHaveLength(0);
    expect(plan.update).toHaveLength(1);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("without targetRoot, skips disk comparison and plans update normally", async () => {
    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-03-07T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-03-06T10:00:00Z" },
            installMode: "mirror",
            files: {
              "SKILL.md": { sha256: "old", size: 10 },
            },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-03-07T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: "new", size: 10 }],
        },
      ],
      // No targetRoot — no disk comparison
    });

    expect(plan.skipped).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
  });

  it("does not skip when disk has extra files not in source", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-syncer-extra-"));
    const skillDir = join(tmpDir, "code");
    await mkdir(skillDir, { recursive: true });

    const content = "# Code\n";
    const contentHash = sha256(content);
    await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
    await writeFile(join(skillDir, "extra-local-file.md"), "local only\n", "utf8");

    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-03-07T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-03-06T10:00:00Z" },
            installMode: "mirror",
            files: {
              "SKILL.md": { sha256: "old-hash", size: 10 },
            },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-03-07T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: contentHash, size: Buffer.byteLength(content) }],
        },
      ],
      targetRoot: tmpDir,
    });

    // Disk has 2 files, source has 1 — not a match
    expect(plan.skipped).toHaveLength(0);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not skip when only one target matches source", async () => {
    const targetA = await mkdtemp(join(tmpdir(), "skill-sync-syncer-target-a-"));
    const targetB = await mkdtemp(join(tmpdir(), "skill-sync-syncer-target-b-"));
    const newContent = "# Code Skill\nUpdated version.\n";
    const newHash = sha256(newContent);

    await mkdir(join(targetA, "code"), { recursive: true });
    await mkdir(join(targetB, "code"), { recursive: true });
    await writeFile(join(targetA, "code", "SKILL.md"), newContent, "utf8");
    await writeFile(join(targetB, "code", "SKILL.md"), "# Old version\n", "utf8");

    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-03-07T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-03-06T10:00:00Z" },
            installMode: "mirror",
            files: {
              "SKILL.md": { sha256: "stale-lock-hash", size: 10 },
            },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-03-07T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: newHash, size: Buffer.byteLength(newContent) }],
        },
      ],
      targetRoots: [targetA, targetB],
    });

    expect(plan.skipped).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.name).toBe("code");

    await rm(targetA, { recursive: true, force: true });
    await rm(targetB, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Silent-overwrite bug regression: source unchanged + local drift → conflict
  // -------------------------------------------------------------------------

  it("surfaces conflict when source is unchanged but target has local modifications", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-syncer-local-drift-"));
    const skillDir = join(tmpDir, "code");
    await mkdir(skillDir, { recursive: true });

    // Source content (what's in the personal library)
    const sourceContent = "# Code Skill\nOriginal version.\n";
    const sourceHash = sha256(sourceContent);

    // On-disk content — user locally modified the target (e.g. added /code iterate)
    const diskContent = "# Code Skill\nOriginal version.\n\n## Iterate\nLocal addition.\n";
    await writeFile(join(skillDir, "SKILL.md"), diskContent, "utf8");
    const diskHash = sha256(diskContent);

    // Lock was written after the previous sync (source was at sourceHash then, still is now)
    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-04-01T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-04-01T10:00:00Z" },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: sourceHash, size: Buffer.byteLength(sourceContent) } },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-04-21T10:00:00Z" },
          // Source is unchanged — still the same hash as the lock
          files: [{ relativePath: "SKILL.md", sha256: sourceHash, size: Buffer.byteLength(sourceContent) }],
        },
      ],
      driftReport: {
        clean: [],
        modified: [{ skill: "code", file: "SKILL.md", expected: sourceHash, actual: diskHash }],
        missing: [],
        extra: [],
      },
      targetRoot: tmpDir,
    });

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.name).toBe("code");
    expect(plan.install).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(0);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("installs when source is unchanged and target is genuinely missing (no drift)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-syncer-new-target-"));
    // Skill directory does NOT exist (new target directory scenario)

    const sourceContent = "# Code Skill\nOriginal version.\n";
    const sourceHash = sha256(sourceContent);

    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-04-01T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-04-01T10:00:00Z" },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: sourceHash, size: Buffer.byteLength(sourceContent) } },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-04-21T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: sourceHash, size: Buffer.byteLength(sourceContent) }],
        },
      ],
      driftReport: {
        // clean drift report — no local modifications, skill just absent from this new target
        clean: [],
        modified: [],
        missing: ["code"],
        extra: [],
      },
      targetRoot: tmpDir,
    });

    expect(plan.install).toHaveLength(1);
    expect(plan.install[0]!.name).toBe("code");
    expect(plan.conflicts).toHaveLength(0);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("surfaces conflict when source unchanged and one of multiple targets has local drift", async () => {
    const targetA = await mkdtemp(join(tmpdir(), "skill-sync-syncer-multi-a-"));
    const targetB = await mkdtemp(join(tmpdir(), "skill-sync-syncer-multi-b-"));

    const sourceContent = "# Code Skill\nOriginal.\n";
    const sourceHash = sha256(sourceContent);
    const diskContentB = "# Code Skill\nOriginal.\n\n## Local edit\n";
    const diskHashB = sha256(diskContentB);

    // targetA: matches source (clean)
    await mkdir(join(targetA, "code"), { recursive: true });
    await writeFile(join(targetA, "code", "SKILL.md"), sourceContent, "utf8");

    // targetB: locally modified
    await mkdir(join(targetB, "code"), { recursive: true });
    await writeFile(join(targetB, "code", "SKILL.md"), diskContentB, "utf8");

    const plan = await planSync({
      manifest: { skills: ["code"], installMode: "mirror" },
      lockFile: {
        version: 1,
        lockedAt: "2026-04-01T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "personal", fetchedAt: "2026-04-01T10:00:00Z" },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: sourceHash, size: Buffer.byteLength(sourceContent) } },
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-04-21T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: sourceHash, size: Buffer.byteLength(sourceContent) }],
        },
      ],
      driftReports: [
        { clean: ["code"], modified: [], missing: [], extra: [] },
        { clean: [], modified: [{ skill: "code", file: "SKILL.md", expected: sourceHash, actual: diskHashB }], missing: [], extra: [] },
      ],
      targetRoots: [targetA, targetB],
    });

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.name).toBe("code");
    expect(plan.install).toHaveLength(0);

    await rm(targetA, { recursive: true, force: true });
    await rm(targetB, { recursive: true, force: true });
  });
});

describe("applySync", () => {
  it("throws on conflicts when force=false", async () => {
    await expect(
      applySync({
        plan: {
          install: [],
          update: [],
          remove: [],
          conflicts: [
            {
              name: "code",
              localChanges: [{ skill: "code", file: "SKILL.md", expected: "a", actual: "b" }],
              upstreamChanges: [{ relativePath: "SKILL.md", sha256: "c", size: 10 }],
            },
          ],
          unchanged: [],
          skipped: [],
          warnings: [],
        },
        targets: [],
        force: false,
      }),
    ).rejects.toThrow("conflict");
  });

  it("throws on conflicts when force is omitted (default)", async () => {
    await expect(
      applySync({
        plan: {
          install: [],
          update: [],
          remove: [],
          conflicts: [
            {
              name: "code",
              localChanges: [{ skill: "code", file: "SKILL.md", expected: "a", actual: "b" }],
              upstreamChanges: [{ relativePath: "SKILL.md", sha256: "c", size: 10 }],
            },
          ],
          unchanged: [],
          skipped: [],
          warnings: [],
        },
        targets: [],
      }),
    ).rejects.toThrow("conflict");
  });

  it("includes promote guidance in conflict error message", async () => {
    await expect(
      applySync({
        plan: {
          install: [],
          update: [],
          remove: [],
          conflicts: [
            {
              name: "code",
              localChanges: [{ skill: "code", file: "SKILL.md", expected: "a", actual: "b" }],
              upstreamChanges: [{ relativePath: "SKILL.md", sha256: "c", size: 10 }],
            },
          ],
          unchanged: [],
          skipped: [],
          warnings: [],
        },
        targets: [],
      }),
    ).rejects.toThrow("skill-sync promote");
  });

  it("does not throw on conflicts when force=true", async () => {
    const result = await applySync({
      plan: {
        install: [],
        update: [],
        remove: [],
        conflicts: [
          {
            name: "code",
            localChanges: [{ skill: "code", file: "SKILL.md", expected: "a", actual: "b" }],
            upstreamChanges: [{ relativePath: "SKILL.md", sha256: "c", size: 10 }],
          },
        ],
        unchanged: [],
        skipped: [],
        warnings: [],
      },
      targets: [],
      force: true,
    });

    expect(result.forcedOverwrites).toEqual(["code"]);
  });

  it("returns empty forcedOverwrites when no conflicts", async () => {
    const result = await applySync({
      plan: {
        install: [],
        update: [],
        remove: [],
        conflicts: [],
        unchanged: ["code"],
        skipped: [],
        warnings: [],
      },
      targets: [],
    });

    expect(result.forcedOverwrites).toEqual([]);
  });
});
