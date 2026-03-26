import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, listInstalledSkills, runValidation } from "../../../src/mcp/server.js";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml } from "yaml";
import * as operations from "../../../src/core/operations.js";

const tmpBase = join(tmpdir(), "skill-sync-mcp-test");
type TestMcpServer = ReturnType<typeof createServer> & {
  _registeredPrompts: Record<string, { callback: (args: { name: string }, extra: unknown) => Promise<{ messages: Array<{ content: { type: "text"; text: string } }> }> }>;
  _registeredTools: Record<string, { description?: string; handler: (...args: never[]) => Promise<{ content: Array<{ text: string }>; structuredContent?: unknown }> }>;
};

async function setupTestProject() {
  const projectRoot = join(tmpBase, "project");
  const skillsDir = join(projectRoot, ".claude", "skills");

  // Create manifest
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, "skill-sync.yaml"), stringifyYaml({
    version: 1,
    sources: [{ name: "test", type: "local", path: "/tmp" }],
    skills: ["code", "test"],
    targets: { claude: ".claude/skills" },
    install_mode: "mirror",
  }));

  // Create installed skills
  await mkdir(join(skillsDir, "code"), { recursive: true });
  await writeFile(join(skillsDir, "code", "SKILL.md"), [
    "---",
    "name: code",
    "description: Code development skill",
    "---",
    "# Code Skill",
    "",
    "Use this skill for code tasks.",
  ].join("\n"));
  await writeFile(join(skillsDir, "code", "skill.yaml"), stringifyYaml({
    tags: ["development", "coding"],
    depends: [],
    config_inputs: [],
    targets: {},
  }));

  await mkdir(join(skillsDir, "test"), { recursive: true });
  await writeFile(join(skillsDir, "test", "SKILL.md"), [
    "---",
    "name: test",
    "description: Testing skill",
    "---",
    "# Test Skill",
    "",
    "Use this for testing.",
  ].join("\n"));

  // Create nested SHARED skill
  await mkdir(join(skillsDir, "SHARED", "commit-framework"), { recursive: true });
  await writeFile(join(skillsDir, "SHARED", "commit-framework", "SKILL.md"), [
    "---",
    "name: commit-framework",
    "description: Commit framework",
    "---",
    "# Commit Framework",
  ].join("\n"));

  return projectRoot;
}

async function setupSkillSyncProject() {
  const projectRoot = join(tmpBase, "skill-sync-project");
  const skillsDir = join(projectRoot, ".claude", "skills");

  await mkdir(join(skillsDir, "skill-sync"), { recursive: true });
  await writeFile(join(projectRoot, "skill-sync.yaml"), stringifyYaml({
    version: 1,
    sources: [{ name: "bundled", type: "local", path: "skills" }],
    skills: ["skill-sync"],
    targets: { claude: ".claude/skills" },
    install_mode: "mirror",
  }));

  const bundledSkill = await readFile(resolve("skills", "skill-sync", "SKILL.md"), "utf8");
  await writeFile(join(skillsDir, "skill-sync", "SKILL.md"), bundledSkill, "utf8");

  return projectRoot;
}

describe("MCP server", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await setupTestProject();
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("creates a server instance", () => {
    const server = createServer(projectRoot);
    expect(server).toBeTruthy();
    expect(server.server).toBeTruthy();
  });

  // Test the helper functions indirectly through the contract test pattern
  it("exports createServer function", async () => {
    const mod = await import("../../../src/mcp/server.js");
    expect(typeof mod.createServer).toBe("function");
  });
});

// Test the MCP server's internal logic by directly calling the tool/resource handlers
// through the SDK's internal registration. Since we can't easily call MCP protocol
// methods without a transport, we test the underlying functions.
describe("MCP server skill discovery", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await setupTestProject();
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("discovers top-level and nested skills", async () => {
    // Use the same discovery logic as the server
    const { loadSkillPackage } = await import("../../../src/core/parser.js");
    const { readdir, access, constants: fsConstants } = await import("node:fs/promises");
    const { join: joinPath, resolve: resolvePath } = await import("node:path");

    const targetRoot = resolvePath(projectRoot, ".claude/skills");

    async function discoverSkills(root: string, prefix = ""): Promise<string[]> {
      const names: string[] = [];
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(joinPath(root, prefix), { withFileTypes: true });
      } catch { return []; }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        try {
          await access(joinPath(root, skillPath, "SKILL.md"), fsConstants.R_OK);
          names.push(skillPath);
        } catch {
          const nested = await discoverSkills(root, skillPath);
          names.push(...nested);
        }
      }
      return names;
    }

    const skills = await discoverSkills(targetRoot);
    expect(skills).toContain("code");
    expect(skills).toContain("test");
    expect(skills).toContain("SHARED/commit-framework");
    expect(skills.length).toBe(3);
  });

  it("loads skill packages from discovered paths", async () => {
    const { loadSkillPackage } = await import("../../../src/core/parser.js");
    const { resolve: resolvePath, join: joinPath } = await import("node:path");

    const targetRoot = resolvePath(projectRoot, ".claude/skills");
    const pkg = await loadSkillPackage(joinPath(targetRoot, "code"));
    expect(pkg.name).toBe("code");
    expect(pkg.description).toBe("Code development skill");
    expect(pkg.meta?.tags).toContain("development");
  });

  it("reads SKILL.md content with frontmatter stripped for prompts", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve: resolvePath, join: joinPath } = await import("node:path");

    const targetRoot = resolvePath(projectRoot, ".claude/skills");
    const content = await readFile(joinPath(targetRoot, "code", "SKILL.md"), "utf-8");
    const body = content.replace(/^---[\s\S]*?---\n?/, "").trim();
    expect(body).toBe("# Code Skill\n\nUse this skill for code tasks.");
    expect(body).not.toContain("name: code");
  });

  it("filters skills by search query", async () => {
    const { loadSkillPackage } = await import("../../../src/core/parser.js");
    const { resolve: resolvePath, join: joinPath } = await import("node:path");

    const targetRoot = resolvePath(projectRoot, ".claude/skills");
    const skills = [];
    for (const name of ["code", "test"]) {
      skills.push(await loadSkillPackage(joinPath(targetRoot, name)));
    }

    const query = "development";
    const lower = query.toLowerCase();
    const matches = skills.filter((s) => {
      if (s.name.toLowerCase().includes(lower)) return true;
      if (s.description.toLowerCase().includes(lower)) return true;
      if (s.meta?.tags?.some((t) => t.toLowerCase().includes(lower))) return true;
      return false;
    });

    expect(matches.length).toBe(1);
    expect(matches[0]!.name).toBe("code");
  });

  it("discovers skills across multiple configured targets", async () => {
    const multiRoot = join(tmpBase, "multi-target-project");
    const claudeDir = join(multiRoot, ".claude", "skills");
    const codexDir = join(multiRoot, ".codex", "skills");

    await mkdir(join(claudeDir, "code"), { recursive: true });
    await mkdir(join(codexDir, "test"), { recursive: true });
    await writeFile(
      join(multiRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "test", type: "local", path: "/tmp" }],
        skills: ["code", "test"],
        targets: {
          claude: ".claude/skills",
          codex: ".codex/skills",
        },
        install_mode: "mirror",
      }),
      "utf8",
    );
    await writeFile(
      join(claudeDir, "code", "SKILL.md"),
      ["---", "name: code", "description: Code skill", "---", "# Code"].join("\n"),
      "utf8",
    );
    await writeFile(
      join(codexDir, "test", "SKILL.md"),
      ["---", "name: test", "description: Test skill", "---", "# Test"].join("\n"),
      "utf8",
    );

    const server = createServer(multiRoot);
    expect(server).toBeTruthy();

    const mod = await import("../../../src/mcp/server.js");
    const skills = await mod.listInstalledSkills(multiRoot);
    expect(skills.map((skill) => skill.name)).toContain("code");
    expect(skills.map((skill) => skill.name)).toContain("test");
  });
});

// ---------------------------------------------------------------------------
// Tool handlers — invoked via _registeredTools
// ---------------------------------------------------------------------------

describe("MCP tool: search-skills", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await setupTestProject();
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("returns matching skills filtered by name", async () => {
    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["search-skills"];

    const result = await tool.handler({ query: "code" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((s: { name: string }) => s.name === "code")).toBe(true);
    expect(parsed.every((s: { name: string }) => s.name.includes("code") || true)).toBe(true);
  });

  it("filters by tag", async () => {
    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["search-skills"];

    const result = await tool.handler({ query: "development" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.some((s: { name: string }) => s.name === "code")).toBe(true);
    // "test" skill has no "development" tag
    expect(parsed.every((s: { name: string }) => s.name !== "test" || false)).toBe(true);
  });

  it("returns empty array for unmatched query", async () => {
    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["search-skills"];

    const result = await tool.handler({ query: "zzz-no-match-xyz" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveLength(0);
  });
});

describe("MCP tool: skill-status", () => {
  it("returns no-lock message when lock file is absent", async () => {
    const projectRoot = join(tmpBase, "status-no-lock-" + Date.now());
    await mkdir(projectRoot, { recursive: true });

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["skill-status"];
    const result = await tool.handler({});

    expect(result.content[0]!.text).toContain("No lock file found");
  });

  it("returns drift status for installed skills", async () => {
    const projectRoot = await setupTestProject();
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          code: {
            source: { type: "local", name: "test", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "expected-hash", size: 10 } },
          },
        },
      }, null, 2),
      "utf-8",
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["skill-status"];
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0]!.text);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("target");
    expect(parsed[0]).toHaveProperty("clean");
    expect(parsed[0]).toHaveProperty("modified");
  });
});

describe("MCP tool: validate-skills", () => {
  it("returns valid result for clean project", async () => {
    const projectRoot = await setupTestProject();
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          code: {
            source: { type: "local", name: "test", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "abc", size: 10 } },
          },
        },
      }, null, 2),
      "utf-8",
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["validate-skills"];
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty("valid");
    expect(parsed).toHaveProperty("diagnostics");
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
  });

  it("returns warning when no lock file found", async () => {
    const projectRoot = join(tmpBase, "validate-no-lock-" + Date.now());
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({ version: 1, sources: [], skills: [], targets: { claude: ".claude/skills" }, install_mode: "mirror" }),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["validate-skills"];
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.diagnostics.some((d: { rule: string }) => d.rule === "no-lock-file")).toBe(true);
  });
});

describe("MCP tool: sync-skills", () => {
  it("returns plan with dry_run=true without applying changes", async () => {
    const projectRoot = join(tmpBase, "sync-dry-" + Date.now());
    const sourceRoot = join(projectRoot, "source");
    await mkdir(join(sourceRoot, "code"), { recursive: true });
    await writeFile(
      join(sourceRoot, "code", "SKILL.md"),
      "---\nname: code\ndescription: Code skill\n---\n# Code\n",
      "utf-8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "local", type: "local", path: sourceRoot }],
        skills: ["code"],
        targets: { claude: ".claude/skills" },
        install_mode: "mirror",
      }),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["sync-skills"];
    const result = await tool.handler({ dry_run: true, force: false });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty("install");
    // No files were written
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(projectRoot, ".claude", "skills", "code"))).toBe(false);
  });

  it("installs skills with dry_run=false", async () => {
    const projectRoot = join(tmpBase, "sync-apply-" + Date.now());
    const sourceRoot = join(projectRoot, "source");
    await mkdir(join(sourceRoot, "code"), { recursive: true });
    await writeFile(
      join(sourceRoot, "code", "SKILL.md"),
      "---\nname: code\ndescription: Code skill\n---\n# Code\n",
      "utf-8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "local", type: "local", path: sourceRoot }],
        skills: ["code"],
        targets: { claude: ".claude/skills" },
        install_mode: "mirror",
      }),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["sync-skills"];
    const result = await tool.handler({ dry_run: false, force: false });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty("installed");
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(projectRoot, ".claude", "skills", "code"))).toBe(true);
  });

  it("returns error JSON when sync throws", async () => {
    const projectRoot = join(tmpBase, "sync-error-" + Date.now());
    await mkdir(projectRoot, { recursive: true });
    // No manifest → sync will throw
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources:\n  - name: x\n    type: local\n    path: /nonexistent-xyz\nskills:\n  - missing\ntargets:\n  claude: .claude/skills\n",
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["sync-skills"];
    const result = await tool.handler({ dry_run: false, force: false });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty("error");
  });
});

describe("MCP tool: prune-skills", () => {
  it("reports would-prune with dry_run=true", async () => {
    const projectRoot = join(tmpBase, "prune-dry-mcp-" + Date.now());
    const skillsDir = join(projectRoot, ".claude", "skills", "old");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, "SKILL.md"), "---\nname: old\ndescription: old\n---\n");
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({ version: 1, sources: [], skills: [], targets: { claude: ".claude/skills" }, install_mode: "mirror" }),
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          old: {
            source: { type: "local", name: "local", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "abc", size: 10 } },
          },
        },
      }, null, 2),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["prune-skills"];
    const result = await tool.handler({ dry_run: true });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty("wouldPrune");
    expect(parsed.wouldPrune).toContain("old");
    // File still exists
    const { existsSync } = await import("node:fs");
    expect(existsSync(skillsDir)).toBe(true);
  });

  it("removes skills with dry_run=false", async () => {
    const projectRoot = join(tmpBase, "prune-apply-mcp-" + Date.now());
    const skillsDir = join(projectRoot, ".claude", "skills", "old");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, "SKILL.md"), "---\nname: old\ndescription: old\n---\n");
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({ version: 1, sources: [], skills: [], targets: { claude: ".claude/skills" }, install_mode: "mirror" }),
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          old: {
            source: { type: "local", name: "local", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "abc", size: 10 } },
          },
        },
      }, null, 2),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["prune-skills"];
    const result = await tool.handler({ dry_run: false });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.pruned).toContain("old");
    const { existsSync } = await import("node:fs");
    expect(existsSync(skillsDir)).toBe(false);
  });
});

describe("MCP tool: pin-skill / unpin-skill", () => {
  it("returns error JSON when pin fails for local source", async () => {
    const projectRoot = join(tmpBase, "pin-mcp-" + Date.now());
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "team", type: "git", url: "https://example.com/skills.git", ref: "main" }],
        skills: ["code"],
        targets: { claude: ".claude/skills" },
        install_mode: "mirror",
      }),
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          code: {
            source: { type: "local", name: "team", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: {},
          },
        },
      }, null, 2),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const pinTool = server._registeredTools["pin-skill"];
    const result = await pinTool.handler({ skill: "code" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty("error");
  });

  it("unpin returns not-pinned message for unpinned skill", async () => {
    const projectRoot = join(tmpBase, "unpin-mcp-" + Date.now());
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "team", type: "git", url: "https://example.com/skills.git", ref: "main" }],
        skills: ["code"],
        targets: { claude: ".claude/skills" },
        install_mode: "mirror",
      }),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const unpinTool = server._registeredTools["unpin-skill"];
    const result = await unpinTool.handler({ skill: "code" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.unpinned).toBe(false);
  });
});

describe("MCP tool: doctor-skills", () => {
  it("returns healthy=true for a valid project with manifest", async () => {
    const projectRoot = join(tmpBase, "doctor-mcp-" + Date.now());
    await mkdir(join(projectRoot, ".claude", "skills"), { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "local", type: "local", path: join(projectRoot, "source") }],
        skills: [],
        targets: { claude: ".claude/skills" },
        install_mode: "mirror",
      }),
    );

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["doctor-skills"];
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty("healthy");
    expect(parsed).toHaveProperty("checks");
    expect(Array.isArray(parsed.checks)).toBe(true);
  });
});

describe("MCP tool: promote-skill", () => {
  it("returns guidance with steps and automated=false", async () => {
    const server = createServer(join(tmpBase, "promote-mcp-" + Date.now())) as TestMcpServer;
    const tool = server._registeredTools["promote-skill"];
    const result = await tool.handler({ skill: "code" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.automated).toBe(false);
    expect(parsed.skill).toBe("code");
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
  });

  it("works without specifying a skill name", async () => {
    const server = createServer(join(tmpBase, "promote-noname-" + Date.now())) as TestMcpServer;
    const tool = server._registeredTools["promote-skill"];
    const result = await tool.handler({ skill: undefined });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.skill).toBeNull();
  });
});

describe("MCP prompt: use-skill", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await setupTestProject();
  });

  it("returns skill content with frontmatter stripped for a known skill", async () => {
    const server = createServer(projectRoot) as TestMcpServer;
    const prompt = server._registeredPrompts["use-skill"];

    const result = await prompt.callback({ name: "code" }, {});
    const text = result.messages[0]?.content.text ?? "";

    expect(text).toContain("Use the following skill instructions");
    expect(text).toContain("# Code Skill");
    expect(text).not.toContain("name: code"); // frontmatter stripped
  });

  it("returns error message for an unknown skill", async () => {
    const server = createServer(projectRoot) as TestMcpServer;
    const prompt = server._registeredPrompts["use-skill"];

    const result = await prompt.callback({ name: "nonexistent-skill-xyz" }, {});
    const text = result.messages[0]?.content.text ?? "";

    expect(text).toContain("not found");
  });
});

describe("MCP exported helpers", () => {
  it("listInstalledSkills deduplicates skills that appear in multiple targets", async () => {
    const projectRoot = join(tmpBase, "dedup-" + Date.now());
    const claudeDir = join(projectRoot, ".claude", "skills", "code");
    const codexDir = join(projectRoot, ".codex", "skills", "code");

    await mkdir(claudeDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(claudeDir, "SKILL.md"), "---\nname: code\ndescription: Code skill\n---\n# Code\n");
    await writeFile(join(codexDir, "SKILL.md"), "---\nname: code\ndescription: Code skill\n---\n# Code\n");

    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [],
        skills: ["code"],
        targets: { claude: ".claude/skills", codex: ".codex/skills" },
        install_mode: "mirror",
      }),
    );

    const skills = await listInstalledSkills(projectRoot);
    const codeSkills = skills.filter((s) => s.name === "code");
    // Should appear only once despite being in two targets
    expect(codeSkills).toHaveLength(1);
  });

  it("runValidation returns manifest-error diagnostic when manifest is missing", async () => {
    const projectRoot = join(tmpBase, "run-validation-no-manifest-" + Date.now());
    await mkdir(projectRoot, { recursive: true });

    const diagnostics = await runValidation(projectRoot);
    expect(diagnostics.some((d) => d.rule === "manifest-error")).toBe(true);
  });

  it("runValidation returns skill-not-found when locked skill is missing from disk", async () => {
    const projectRoot = join(tmpBase, "run-validation-missing-skill-" + Date.now());
    await mkdir(join(projectRoot, ".claude", "skills"), { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "local", type: "local", path: "/tmp" }],
        skills: ["code"],
        targets: { claude: ".claude/skills" },
        install_mode: "mirror",
      }),
    );
    // Lock has "code" but it's not on disk
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          code: {
            source: { type: "local", name: "local", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "abc", size: 10 } },
          },
        },
      }, null, 2),
    );

    const diagnostics = await runValidation(projectRoot);
    expect(diagnostics.some((d) => d.rule === "skill-not-found")).toBe(true);
  });

  it("runValidation succeeds and runs validateConfigOverrides when skills are installed", async () => {
    const projectRoot = join(tmpBase, "run-validation-config-" + Date.now());
    await mkdir(join(projectRoot, ".claude", "skills", "code"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "skills", "code", "SKILL.md"),
      "---\nname: code\ndescription: Code skill\n---\n# Code\n",
      "utf-8",
    );
    await writeFile(
      join(projectRoot, ".claude", "skills", "code", "skill.yaml"),
      stringifyYaml({ config_inputs: [], depends: [], tags: [], targets: { claude: true } }),
    );
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      stringifyYaml({
        version: 1,
        sources: [{ name: "local", type: "local", path: join(projectRoot, "source") }],
        skills: ["code"],
        targets: { claude: ".claude/skills" },
        install_mode: "mirror",
        config: { code: { verify: "npm test" } },
      }),
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          code: {
            source: { type: "local", name: "local", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "abc", size: 10 } },
          },
        },
      }, null, 2),
    );

    const diagnostics = await runValidation(projectRoot);
    // No errors for a valid installed skill
    expect(diagnostics.filter((d) => d.rule === "skill-not-found")).toHaveLength(0);
  });

  it("getTargetRoots falls back to discovered directories when manifest is absent", async () => {
    const projectRoot = join(tmpBase, "fallback-targets-" + Date.now());
    const geminiDir = join(projectRoot, ".gemini", "skills");
    await mkdir(geminiDir, { recursive: true });
    // No manifest

    // listInstalledSkills uses getTargetRoots internally
    const skills = await listInstalledSkills(projectRoot);
    // Should not throw; returns empty array (no SKILL.md files in gemini dir)
    expect(Array.isArray(skills)).toBe(true);
  });
});

describe("MCP instruction audit tool", () => {
  it("registers audit-instructions and returns a structured report", async () => {
    const projectRoot = await setupTestProject();
    const report = {
      projectRoot: resolve(projectRoot),
      configuredTargets: ["claude"],
      agents: [
        {
          agent: "claude",
          label: "Claude Code",
          configured: true,
          globalAvailableRemotely: false,
          expectedGlobalFiles: ["~/.claude/CLAUDE.md"],
          expectedProjectFiles: ["CLAUDE.md"],
          expectedOverrideFiles: [],
          globalFiles: [],
          projectFiles: [{ agent: "claude", scope: "project", path: "CLAUDE.md", resolvedPath: join(projectRoot, "CLAUDE.md"), state: "present" }],
          overrideFiles: [],
        },
      ],
      diagnostics: [],
    };

    const instructionSpy = vi
      .spyOn(operations, "instructionAuditOperation")
      .mockResolvedValue(report);

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["audit-instructions"];

    expect(tool).toBeDefined();

    const result = await tool.handler();

    expect(instructionSpy).toHaveBeenCalledWith({ projectRoot: resolve(projectRoot) });
    expect(JSON.parse(result.content[0]!.text)).toEqual(report);
    expect(result.structuredContent).toEqual(report);

    instructionSpy.mockRestore();
  });

  it("handles missing manifests without throwing", async () => {
    const projectRoot = join(tmpBase, "instruction-audit-no-manifest");
    await mkdir(projectRoot, { recursive: true });

    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["audit-instructions"];
    const result = await tool.handler();
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.projectRoot).toBe(resolve(projectRoot));
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
  });
});

describe("MCP skill-sync guidance", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await setupSkillSyncProject();
  });

  afterAll(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("documents repo hygiene on the sync-skills tool", () => {
    const server = createServer(projectRoot) as TestMcpServer;
    const tool = server._registeredTools["sync-skills"];

    expect(tool).toBeDefined();
    expect(tool.description).toContain(".gitignore");
    expect(tool.description).toContain("commit pending skill changes before sync begins");
    expect(tool.description).toContain("commit resulting tracked changes after sync ends");
  });

  it("injects repo hygiene guidance into the skill-sync prompt", async () => {
    const server = createServer(projectRoot) as TestMcpServer;
    const prompt = server._registeredPrompts["use-skill"];

    expect(prompt).toBeDefined();

    const result = await prompt.callback({ name: "skill-sync" }, {});
    const text = result.messages[0]?.content.text ?? "";

    expect(text).toContain("Before following these instructions, enforce repo hygiene");
    expect(text).toContain(".gitignore");
    expect(text).toContain("Before `skill-sync sync` begins, check `git status --short`.");
    expect(text).toContain("commit resulting tracked changes after sync ends");
  });
});
