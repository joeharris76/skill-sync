import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, join } from "node:path";
import { readFile, readdir, access, constants } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { readManifest } from "../core/manifest.js";
import { readLockFile } from "../core/lock.js";
import { detectDrift } from "../core/drift.js";
import { loadSkillPackage } from "../core/parser.js";
import { validatePortability } from "../core/portability.js";
import { checkAllTargetCompatibility } from "../core/compatibility.js";
import { validateConfigOverrides } from "../core/config-generator.js";
import type { SkillPackage, ValidationDiagnostic, LockFile } from "../core/types.js";

/**
 * Create a skillsync MCP server backed by a project directory.
 *
 * The server exposes installed skills as MCP resources, provides
 * search and validation tools, and offers a use-skill prompt.
 */
export function createServer(projectRoot: string): McpServer {
  const root = resolve(projectRoot);

  const server = new McpServer({
    name: "skillsync",
    version: "0.0.1",
  });

  // ---------------------------------------------------------------------------
  // Resources: list all installed skills
  // ---------------------------------------------------------------------------

  server.resource(
    "skills-list",
    "skill://list",
    { description: "List all installed skills with metadata" },
    async () => {
      const skills = await listInstalledSkills(root);
      const listing = skills.map((s) => ({
        name: s.name,
        description: s.description,
        files: s.files.length,
      }));
      return {
        contents: [{
          uri: "skill://list",
          mimeType: "application/json",
          text: JSON.stringify(listing, null, 2),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Resource Template: read individual skill content
  // ---------------------------------------------------------------------------

  server.resource(
    "skill",
    new ResourceTemplate("skill://{name}", { list: async () => {
      const skills = await listInstalledSkills(root);
      return {
        resources: skills.map((s) => ({
          uri: `skill://${s.name}`,
          name: s.name,
          description: s.description,
          mimeType: "text/markdown",
        })),
      };
    }}),
    { description: "Read a skill's SKILL.md content" },
    async (uri, variables) => {
      const name = String(variables.name);
      const targetRoot = await getPrimaryTargetRoot(root);
      const skillMdPath = join(targetRoot, name, "SKILL.md");
      const content = await readFile(skillMdPath, "utf-8");
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/markdown",
          text: content,
        }],
      };
    },
  );

  server.resource(
    "skill-file",
    new ResourceTemplate("skill://{name}/{+path}", { list: undefined }),
    { description: "Read a specific file within a skill package" },
    async (uri, variables) => {
      const name = String(variables.name);
      const filePath = String(variables.path);
      const targetRoot = await getPrimaryTargetRoot(root);
      const fullPath = join(targetRoot, name, filePath);
      // Security: ensure path stays within skill directory
      const resolvedPath = resolve(fullPath);
      const skillDir = resolve(join(targetRoot, name));
      if (!resolvedPath.startsWith(skillDir + "/") && resolvedPath !== skillDir) {
        throw new Error("Path traversal not allowed");
      }
      const content = await readFile(resolvedPath, "utf-8");
      const mimeType = filePath.endsWith(".md") ? "text/markdown"
        : filePath.endsWith(".yaml") || filePath.endsWith(".yml") ? "text/yaml"
        : filePath.endsWith(".json") ? "application/json"
        : "text/plain";
      return {
        contents: [{
          uri: uri.href,
          mimeType,
          text: content,
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Tools (read-only in v0)
  // ---------------------------------------------------------------------------

  server.tool(
    "search-skills",
    "Search installed skills by name or tag",
    { query: z.string().describe("Search term to match against skill names, descriptions, and tags") },
    async ({ query }) => {
      const skills = await listInstalledSkills(root);
      const lower = query.toLowerCase();
      const matches = skills.filter((s) => {
        if (s.name.toLowerCase().includes(lower)) return true;
        if (s.description.toLowerCase().includes(lower)) return true;
        if (s.meta?.tags?.some((t: string) => t.toLowerCase().includes(lower))) return true;
        return false;
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(matches.map((s) => ({
            name: s.name,
            description: s.description,
            tags: s.meta?.tags ?? [],
            files: s.files.map((f) => f.relativePath),
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    "skill-status",
    "Show installation status and drift for all skills",
    {},
    async () => {
      const lockFile = await readLockFile(root);
      if (!lockFile) {
        return {
          content: [{ type: "text" as const, text: "No lock file found. Run `skillsync sync` first." }],
        };
      }
      const targetRoot = await getPrimaryTargetRoot(root);
      const drift = await detectDrift(targetRoot, lockFile);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            clean: drift.clean,
            modified: drift.modified.map((d) => `${d.skill}:${d.file}`),
            missing: drift.missing,
            extra: drift.extra,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "validate-skills",
    "Run portability and compatibility validation on installed skills",
    {},
    async () => {
      const diagnostics = await runValidation(root);
      const hasErrors = diagnostics.some((d) => d.severity === "error");
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            valid: !hasErrors,
            diagnostics: diagnostics.map((d) => ({
              severity: d.severity,
              rule: d.rule,
              message: d.message,
              skill: d.skill,
            })),
          }, null, 2),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Prompts
  // ---------------------------------------------------------------------------

  server.prompt(
    "use-skill",
    "Generate a prompt that incorporates a skill's instructions",
    { name: z.string().describe("Name of the skill to use") },
    async ({ name }) => {
      const targetRoot = await getPrimaryTargetRoot(root);
      const skillMdPath = join(targetRoot, name, "SKILL.md");
      let content: string;
      try {
        content = await readFile(skillMdPath, "utf-8");
      } catch {
        return {
          messages: [{
            role: "user" as const,
            content: { type: "text" as const, text: `Skill "${name}" not found.` },
          }],
        };
      }

      // Strip frontmatter for the prompt body
      const body = content.replace(/^---[\s\S]*?---\n?/, "").trim();

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Use the following skill instructions:\n\n${body}`,
          },
        }],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPrimaryTargetRoot(projectRoot: string): Promise<string> {
  try {
    const manifest = await readManifest(projectRoot);
    const primary = Object.values(manifest.targets)[0];
    if (primary) return resolve(projectRoot, primary);
  } catch { /* fall through */ }
  // Fallback: .claude/skills
  return resolve(projectRoot, ".claude/skills");
}

async function listInstalledSkills(projectRoot: string): Promise<SkillPackage[]> {
  const targetRoot = await getPrimaryTargetRoot(projectRoot);
  const skillNames = await discoverSkillNames(targetRoot);
  const skills: SkillPackage[] = [];
  for (const name of skillNames) {
    try {
      const pkg = await loadSkillPackage(join(targetRoot, name));
      skills.push(pkg);
    } catch { /* skip unreadable skills */ }
  }
  return skills;
}

async function discoverSkillNames(targetRoot: string, prefix = ""): Promise<string[]> {
  const names: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(join(targetRoot, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    try {
      await access(join(targetRoot, skillPath, "SKILL.md"), constants.R_OK);
      names.push(skillPath);
    } catch {
      const nested = await discoverSkillNames(targetRoot, skillPath);
      names.push(...nested);
    }
  }
  return names;
}

async function runValidation(projectRoot: string): Promise<ValidationDiagnostic[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  try {
    const manifest = await readManifest(projectRoot);
    const lockFile = await readLockFile(projectRoot);
    if (!lockFile) return [{ rule: "no-lock-file", severity: "warning", message: "No lock file found." }];

    const targetRoot = await getPrimaryTargetRoot(projectRoot);
    const installedPkgs: SkillPackage[] = [];

    for (const [skillName, locked] of Object.entries(lockFile.skills)) {
      try {
        const pkg = await loadSkillPackage(resolve(targetRoot, skillName));
        installedPkgs.push(pkg);
        const portDiags = await validatePortability(pkg, locked.installMode);
        diagnostics.push(...portDiags);
        const compatDiags = checkAllTargetCompatibility(pkg, manifest.targets);
        diagnostics.push(...compatDiags);
      } catch {
        diagnostics.push({ rule: "skill-not-found", severity: "error", message: `Skill "${skillName}" not found on disk`, skill: skillName });
      }
    }

    const configWarnings = validateConfigOverrides(manifest.config, installedPkgs);
    for (const w of configWarnings) {
      diagnostics.push({ rule: "config-override", severity: "warning", message: w });
    }
  } catch (err) {
    diagnostics.push({ rule: "manifest-error", severity: "error", message: err instanceof Error ? err.message : String(err) });
  }
  return diagnostics;
}
