import { describe, expect, it, beforeAll } from "vitest";
import { readFixture } from "../../helpers/fixtures.js";
import { moduleExists } from "../../helpers/module-availability.js";

type ManifestModule = {
  parseManifest: (input: string) => unknown;
  serializeManifest: (input: unknown) => string;
};

const describeManifest = moduleExists("src/core/manifest.ts") ? describe : describe.skip;

describeManifest("core/manifest contract", () => {
  let manifestModule: ManifestModule;

  beforeAll(async () => {
    manifestModule = (await import("../../../src/core/manifest.js")) as ManifestModule;
  });

  it("exports parseManifest and serializeManifest", () => {
    expect(typeof manifestModule.parseManifest).toBe("function");
    expect(typeof manifestModule.serializeManifest).toBe("function");
  });

  it("parses a complete project manifest fixture", () => {
    const parsed = manifestModule.parseManifest(readFixture("project", "skillsync.yaml")) as {
      version: number;
      sources: Array<{ name: string; type: string }>;
      skills: string[];
      profile?: string;
      targets: Record<string, string>;
      installMode: string;
      config: Record<string, Record<string, unknown>>;
      overrides: Record<string, { installMode?: string }>;
    };

    expect(parsed.version).toBe(1);
    expect(parsed.sources).toHaveLength(2);
    expect(parsed.sources[0]).toMatchObject({ name: "personal", type: "local" });
    expect(parsed.skills).toEqual(["code", "test", "SHARED/commit-framework"]);
    expect(parsed.profile).toBe("python-backend");
    expect(parsed.targets.codex).toBe(".codex/skills");
    expect(parsed.installMode).toBe("mirror");
    expect(parsed.config.test?.runner).toBe("uv run pytest");
    expect(parsed.overrides.test?.installMode).toBe("copy");
  });

  it("serializes parsed manifests without losing core fields", () => {
    const fixture = readFixture("project", "skillsync.yaml");
    const parsed = manifestModule.parseManifest(fixture);
    const serialized = manifestModule.serializeManifest(parsed);
    const reparsed = manifestModule.parseManifest(serialized) as {
      skills: string[];
      targets: Record<string, string>;
      installMode: string;
    };

    expect(reparsed.skills).toContain("code");
    expect(reparsed.targets.claude).toBe(".claude/skills");
    expect(reparsed.installMode).toBe("mirror");
  });

  it("rejects invalid manifests that omit required install configuration", () => {
    expect(() =>
      manifestModule.parseManifest(readFixture("project", "skillsync.invalid.yaml")),
    ).toThrow();
  });
});

