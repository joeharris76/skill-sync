import { beforeAll, describe, expect, it } from "vitest";
import { readFixture } from "../../helpers/fixtures.js";
import { moduleExists } from "../../helpers/module-availability.js";

type LockModule = {
  parseLockFile: (input: string) => unknown;
  serializeLockFile: (input: unknown) => string;
};

const describeLock = moduleExists("src/core/lock.ts") ? describe : describe.skip;

describeLock("core/lock contract", () => {
  let lockModule: LockModule;

  beforeAll(async () => {
    lockModule = (await import("../../../src/core/lock.js")) as LockModule;
  });

  it("exports parseLockFile and serializeLockFile", () => {
    expect(typeof lockModule.parseLockFile).toBe("function");
    expect(typeof lockModule.serializeLockFile).toBe("function");
  });

  it("parses a lock file fixture with provenance and file digests", () => {
    const parsed = lockModule.parseLockFile(readFixture("project", "skillsync.lock.json")) as {
      version: number;
      lockedAt: string;
      skills: Record<
        string,
        {
          installMode: string;
          source: { type: string; name: string };
          files: Record<string, { sha256: string; size: number }>;
        }
      >;
    };

    expect(parsed.version).toBe(1);
    expect(parsed.lockedAt).toBe("2026-03-06T10:30:00Z");
    expect(parsed.skills.code?.installMode).toBe("mirror");
    expect(parsed.skills.code?.source).toMatchObject({
      type: "local",
      name: "personal",
    });
    expect(parsed.skills.code?.files["SKILL.md"]?.size).toBe(4210);
  });

  it("round-trips lock files without dropping tracked files", () => {
    const parsed = lockModule.parseLockFile(readFixture("project", "skillsync.lock.json"));
    const serialized = lockModule.serializeLockFile(parsed);
    const reparsed = lockModule.parseLockFile(serialized) as {
      skills: Record<string, { files: Record<string, unknown> }>;
    };

    expect(Object.keys(reparsed.skills.code?.files ?? {})).toEqual([
      "SKILL.md",
      "skill.yaml",
    ]);
  });
});

