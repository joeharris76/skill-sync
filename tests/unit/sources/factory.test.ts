import { describe, it, expect } from "vitest";
import { createSourcesFromConfig, createSourcesFromConfigForSkill, isImplementedSourceType } from "../../../src/sources/factory.js";
import { LocalSource } from "../../../src/sources/local.js";
import { GitSource } from "../../../src/sources/git.js";

describe("isImplementedSourceType", () => {
  it("returns true for local", () => expect(isImplementedSourceType("local")).toBe(true));
  it("returns true for git", () => expect(isImplementedSourceType("git")).toBe(true));
  it("returns false for registry", () => expect(isImplementedSourceType("registry")).toBe(false));
});

describe("createSourcesFromConfig", () => {
  it("creates a LocalSource for local type", () => {
    const sources = createSourcesFromConfig([{ name: "test", type: "local", path: "/tmp/skills" }]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBeInstanceOf(LocalSource);
    expect(sources[0]!.name).toBe("test");
  });

  it("creates a GitSource for git type", () => {
    const sources = createSourcesFromConfig([{ name: "repo", type: "git", url: "https://example.com/skills.git", ref: "main" }]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBeInstanceOf(GitSource);
    expect(sources[0]!.name).toBe("repo");
  });

  it("throws for registry type", () => {
    expect(() =>
      createSourcesFromConfig([{ name: "npm", type: "registry", registry: "npm" }])
    ).toThrow(/registry sources are not implemented/);
  });
});

describe("createSourcesFromConfigForSkill", () => {
  it("filters to override source when sourceName is set", () => {
    const configs = [
      { name: "personal", type: "local" as const, path: "/personal" },
      { name: "team", type: "local" as const, path: "/team" },
    ];
    const sources = createSourcesFromConfigForSkill(configs, { sourceName: "team" });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.name).toBe("team");
  });

  it("throws when override references unknown source name", () => {
    expect(() =>
      createSourcesFromConfigForSkill(
        [{ name: "personal", type: "local" as const, path: "/personal" }],
        { sourceName: "nonexistent" },
      )
    ).toThrow(/unknown source/);
  });

  it("uses override revision for git source with pinned source", () => {
    const sources = createSourcesFromConfigForSkill(
      [{ name: "repo", type: "git" as const, url: "https://example.com/skills.git", ref: "main" }],
      { sourceName: "repo", revision: "abc123" },
    );
    expect(sources[0]).toBeInstanceOf(GitSource);
  });
});
