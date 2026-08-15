import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSourcesFromConfig,
  createSourcesFromConfigForSkill,
  isImplementedSourceType,
} from "../../../src/sources/factory.js";
import { GitSource } from "../../../src/sources/git.js";
import { LocalSource } from "../../../src/sources/local.js";

describe("isImplementedSourceType", () => {
  it("returns true for local", () => expect(isImplementedSourceType("local")).toBe(true));
  it("returns true for git", () => expect(isImplementedSourceType("git")).toBe(true));
  it("returns false for registry", () => expect(isImplementedSourceType("registry")).toBe(false));
});

describe("createSourcesFromConfig", () => {
  it("creates a LocalSource for local type", () => {
    const sources = createSourcesFromConfig(
      [{ name: "test", type: "local", path: "/tmp/skills" }],
      "/tmp",
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBeInstanceOf(LocalSource);
    expect(sources[0]!.name).toBe("test");
  });

  it("creates a GitSource for git type", () => {
    const sources = createSourcesFromConfig([
      {
        name: "repo",
        type: "git",
        url: "https://example.com/skills.git",
        ref: "main",
        subdir: "skills",
      },
    ], "/tmp");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBeInstanceOf(GitSource);
    expect(sources[0]!.name).toBe("repo");
    const provenance = sources[0]!.provenance({
      name: "skill",
      sourceName: "repo",
      sourceType: "git",
      location: "/tmp",
    });
    expect(provenance.subdir).toBe("skills");
  });

  it("throws for registry type", () => {
    expect(() =>
      createSourcesFromConfig([{ name: "npm", type: "registry", registry: "npm" }], "/tmp"),
    ).toThrow(/registry sources are not implemented/);
  });
});

describe("createSourcesFromConfigForSkill", () => {
  it("resolves relative local sources from the manifest project root", async () => {
    const projectRoot = join(tmpdir(), `skill-sync-relative-source-${Date.now()}`);
    const skillRoot = join(projectRoot, "skills", "skill-sync");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: skill-sync\n---\n");

    const [source] = createSourcesFromConfigForSkill(
      [{ name: "product", type: "local", path: "skills" }],
      { sourceName: "product" },
      projectRoot,
    );
    const resolved = await source!.resolve("skill-sync");

    expect(resolved?.location).toBe(skillRoot);
    expect(source!.provenance(resolved!).path).toBe("skills/skill-sync");
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("records relative provenance paths with POSIX separators", () => {
    const source = new LocalSource("product", join("nested", "skills"), "/tmp");
    const provenance = source.provenance({
      name: "demo",
      sourceName: "product",
      sourceType: "local",
      location: "/tmp/nested/skills/demo",
    });
    expect(provenance.path).toBe("nested/skills/demo");
  });

  it("preserves backslashes that are not platform separators", () => {
    const source = new LocalSource("product", "nested\\skills", "/tmp");
    const provenance = source.provenance({
      name: "demo",
      sourceName: "product",
      sourceType: "local",
      location: "/tmp/nested/skills/demo",
    });

    expect(provenance.path).toBe(
      sep === "\\" ? "nested/skills/demo" : "nested\\skills/demo",
    );
  });

  it("filters to override source when sourceName is set", () => {
    const configs = [
      { name: "personal", type: "local" as const, path: "/personal" },
      { name: "team", type: "local" as const, path: "/team" },
    ];
    const sources = createSourcesFromConfigForSkill(configs, { sourceName: "team" }, "/tmp");
    expect(sources).toHaveLength(1);
    expect(sources[0]!.name).toBe("team");
  });

  it("throws when override references unknown source name", () => {
    expect(() =>
      createSourcesFromConfigForSkill(
        [{ name: "personal", type: "local" as const, path: "/personal" }],
        { sourceName: "nonexistent" },
        "/tmp",
      ),
    ).toThrow(/unknown source/);
  });

  it("uses override revision as ref for git source when pinned", () => {
    const sources = createSourcesFromConfigForSkill(
      [{ name: "repo", type: "git" as const, url: "https://example.com/skills.git", ref: "main" }],
      { sourceName: "repo", revision: "abc123" },
      "/tmp",
    );
    expect(sources[0]).toBeInstanceOf(GitSource);
    // Verify revision is used as ref by checking provenance returns it as the ref
    const prov = sources[0]!.provenance({
      name: "skill",
      sourceName: "repo",
      sourceType: "git",
      location: "/tmp",
    });
    // Before cloning, the ref is the revision override, not "main"
    expect(prov.ref).toBe("abc123");
  });
});
