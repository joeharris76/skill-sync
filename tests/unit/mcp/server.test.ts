import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../../../src/mcp/server.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml } from "yaml";

const tmpBase = join(tmpdir(), "skillsync-mcp-test");

async function setupTestProject() {
  const projectRoot = join(tmpBase, "project");
  const skillsDir = join(projectRoot, ".claude", "skills");

  // Create manifest
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, "skillsync.yaml"), stringifyYaml({
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
  await writeFile(join(skillsDir, "code", "skillsync.meta.yaml"), stringifyYaml({
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
      join(multiRoot, "skillsync.yaml"),
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
