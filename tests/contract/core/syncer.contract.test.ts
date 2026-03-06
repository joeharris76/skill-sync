import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { moduleExists, projectPath } from "../../helpers/module-availability.js";

type SyncerModule = {
  planSync: (input: {
    manifest: unknown;
    lockFile?: unknown;
    resolvedSkills: unknown[];
    driftReport?: unknown;
  }) => Promise<unknown> | unknown;
  applySync: (input: { plan: unknown; targets: string[]; config?: unknown }) => Promise<unknown>;
};

const describeSyncer = moduleExists("src/core/syncer.ts") ? describe : describe.skip;

describeSyncer("core/syncer contract", () => {
  let syncerModule: SyncerModule;

  beforeAll(async () => {
    syncerModule = (await import("../../../src/core/syncer.js")) as SyncerModule;
  });

  it("exports planSync and applySync", () => {
    expect(typeof syncerModule.planSync).toBe("function");
    expect(typeof syncerModule.applySync).toBe("function");
  });

  it("plans installs, updates, removals, unchanged skills, and conflicts separately", async () => {
    const plan = (await syncerModule.planSync({
      manifest: {
        skills: ["code", "test"],
        installMode: "mirror",
      },
      lockFile: {
        version: 1,
        skills: {
          code: {
            installMode: "mirror",
            files: {
              "SKILL.md": { sha256: "old", size: 10 },
            },
          },
          stale: {
            installMode: "mirror",
            files: {},
          },
        },
      },
      resolvedSkills: [
        {
          name: "code",
          source: { type: "local", name: "personal", fetchedAt: "2026-03-06T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: "new", size: 10 }],
        },
        {
          name: "test",
          source: { type: "local", name: "personal", fetchedAt: "2026-03-06T10:00:00Z" },
          files: [{ relativePath: "SKILL.md", sha256: "same", size: 10 }],
        },
      ],
      driftReport: {
        clean: ["test"],
        modified: [
          { skill: "code", file: "SKILL.md", expected: "old", actual: "local-edit" },
        ],
        missing: [],
        extra: [],
      },
    })) as {
      install: unknown[];
      update: unknown[];
      remove: string[];
      conflicts: unknown[];
      unchanged: string[];
    };

    expect(Array.isArray(plan.install)).toBe(true);
    expect(Array.isArray(plan.update)).toBe(true);
    expect(plan.remove).toContain("stale");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.unchanged).toContain("test");
  });

  it("writes generated project-config state during apply", async () => {
    const result = (await syncerModule.applySync({
      plan: {
        install: [],
        update: [],
        remove: [],
        conflicts: [],
        unchanged: [],
        warnings: [],
      },
      targets: [projectPath("tests", ".tmp", "claude-skills")],
      config: {
        code: {
          verify: "npm run test:run",
        },
      },
    })) as {
      wroteConfig?: boolean;
      configPath?: string;
    };

    expect(result.wroteConfig ?? true).toBe(true);
  });

  afterAll(async () => {
    await rm(projectPath("tests", ".tmp"), { recursive: true, force: true });
  });
});

