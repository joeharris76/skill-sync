import { beforeAll, describe, expect, it } from "vitest";
import { moduleExists } from "../../helpers/module-availability.js";

type ResolverModule = {
  resolveSkill: (skillName: string, sources: unknown[]) => Promise<unknown>;
  resolveAll?: (skillNames: string[], sources: unknown[]) => Promise<unknown[]>;
};

const describeResolver = moduleExists("src/core/resolver.ts") ? describe : describe.skip;

describeResolver("core/resolver contract", () => {
  let resolverModule: ResolverModule;

  beforeAll(async () => {
    resolverModule = (await import("../../../src/core/resolver.js")) as ResolverModule;
  });

  it("exports resolveSkill", () => {
    expect(typeof resolverModule.resolveSkill).toBe("function");
  });

  it("returns the first matching skill according to source order", async () => {
    const sources = [
      {
        name: "personal",
        type: "local",
        resolve: async (skillName: string) =>
          skillName === "code"
            ? { name: "code", sourceName: "personal", sourceType: "local", location: "/a/code" }
            : null,
      },
      {
        name: "team",
        type: "git",
        resolve: async (skillName: string) =>
          skillName === "code"
            ? { name: "code", sourceName: "team", sourceType: "git", location: "/b/code" }
            : null,
      },
    ];

    const resolved = (await resolverModule.resolveSkill("code", sources)) as {
      sourceName: string;
      location: string;
    };

    expect(resolved.sourceName).toBe("personal");
    expect(resolved.location).toBe("/a/code");
  });

  it("throws an actionable error when no source contains the skill", async () => {
    await expect(
      resolverModule.resolveSkill("missing-skill", [
        {
          name: "personal",
          type: "local",
          resolve: async () => null,
        },
      ]),
    ).rejects.toThrow(/missing-skill/i);
  });

  it("optionally resolves a full skill list when resolveAll is implemented", async () => {
    if (!resolverModule.resolveAll) {
      return;
    }

    const resolved = await resolverModule.resolveAll(["code", "test"], [
      {
        name: "personal",
        type: "local",
        resolve: async (skillName: string) => ({
          name: skillName,
          sourceName: "personal",
          sourceType: "local",
          location: `/skills/${skillName}`,
        }),
      },
    ]);

    expect(resolved).toHaveLength(2);
  });
});

