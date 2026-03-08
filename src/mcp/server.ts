import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, join } from "node:path";
import { readFile, readdir, access, constants, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { readManifest, serializeManifest } from "../core/manifest.js";
import { readLockFile, writeLockFile, createLockFile, lockSkill } from "../core/lock.js";
import { detectDrift } from "../core/drift.js";
import { loadSkillPackage } from "../core/parser.js";
import { validatePortability } from "../core/portability.js";
import { checkAllTargetCompatibility } from "../core/compatibility.js";
import { validateConfigOverrides, generateConfig, writeProjectConfig } from "../core/config-generator.js";
import { resolveSkill } from "../core/resolver.js";
import { planSync } from "../core/syncer.js";
import type { PreparedSkill } from "../core/syncer.js";
import { materialize, dematerialize } from "../core/materializer.js";
import { createSourcesFromConfigForSkill } from "../sources/factory.js";
import type { SkillPackage, ValidationDiagnostic, LockFile, SkillSource } from "../core/types.js";

interface TargetRoot {
  name: string;
  root: string;
}

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
      const skillRoot = await findSkillRoot(root, name);
      if (!skillRoot) {
        throw new Error(`Skill "${name}" not found`);
      }
      const skillMdPath = join(skillRoot.root, name, "SKILL.md");
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
      const skillRoot = await findSkillRoot(root, name);
      if (!skillRoot) {
        throw new Error(`Skill "${name}" not found`);
      }
      const fullPath = join(skillRoot.root, name, filePath);
      // Security: ensure path stays within skill directory
      const resolvedPath = resolve(fullPath);
      const skillDir = resolve(join(skillRoot.root, name));
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
      const targets = await getTargetRoots(root);
      const statuses = await Promise.all(
        targets.map(async (target) => ({
          target: target.name,
          drift: await detectDrift(target.root, lockFile),
        })),
      );
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            statuses.map((status) => ({
              target: status.target,
              clean: status.drift.clean,
              modified: status.drift.modified.map((d) => `${d.skill}:${d.file}`),
              missing: status.drift.missing,
              extra: status.drift.extra,
            })),
            null,
            2,
          ),
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

  server.tool(
    "sync-skills",
    "Resolve skills from configured sources and apply them to all targets. Supports dry-run and force modes.",
    {
      dry_run: z.boolean().optional().default(false).describe("Preview changes without applying them"),
      force: z.boolean().optional().default(false).describe("Overwrite local modifications without conflict check"),
    },
    async ({ dry_run, force }) => {
      const sources: SkillSource[] = [];
      try {
        let manifest;
        try {
          manifest = await readManifest(root);
        } catch {
          const emptyPlan = { install: [], update: [], remove: [], conflicts: [], unchanged: [], skipped: [], warnings: [] };
          return { content: [{ type: "text" as const, text: JSON.stringify(emptyPlan, null, 2) }] };
        }

        const lockFile = (await readLockFile(root)) ?? createLockFile();
        const prepared: PreparedSkill[] = [];
        const resolved = [];
        const queue = [...manifest.skills];
        const visited = new Set<string>();

        while (queue.length > 0) {
          const skillName = queue.shift()!;
          if (visited.has(skillName)) continue;
          visited.add(skillName);

          const skillSources = createSourcesFromConfigForSkill(manifest.sources, manifest.overrides[skillName]);
          sources.push(...skillSources);

          const resolvedSkill = await resolveSkill(skillName, skillSources);
          resolved.push(resolvedSkill);

          const source = skillSources.find((s) => s.name === resolvedSkill.sourceName)!;
          const fetched = await source.fetch(resolvedSkill);
          const pkg = await loadSkillPackage(fetched.path);
          prepared.push({ name: resolvedSkill.name, source: source.provenance(resolvedSkill), files: pkg.files });

          for (const dep of pkg.meta?.depends ?? []) {
            if (!visited.has(dep)) queue.push(dep);
          }
        }

        const targetEntries = Object.entries(manifest.targets);
        if (!targetEntries[0]) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No targets defined in skillsync.yaml" }, null, 2) }] };
        }

        const driftReports = await Promise.all(
          targetEntries.map(async ([targetName, targetPath]) => ({
            targetName,
            targetPath,
            targetRoot: resolve(root, targetPath),
            drift: await detectDrift(resolve(root, targetPath), lockFile),
          })),
        );

        const plan = await planSync({
          manifest: { skills: manifest.skills, installMode: manifest.installMode, overrides: manifest.overrides },
          lockFile,
          resolvedSkills: prepared,
          driftReports: driftReports.map((r) => r.drift),
          targetRoots: driftReports.map((r) => r.targetRoot),
        });

        if (dry_run) {
          return { content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }] };
        }

        if (plan.conflicts.length > 0 && !force) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: "conflicts", conflicts: plan.conflicts }, null, 2),
            }],
          };
        }

        const updatedLock = { ...lockFile, skills: { ...lockFile.skills } };

        for (const install of plan.install) {
          const sourcePkg = prepared.find((p) => p.name === install.name)!;
          const sourceDir = resolved.find((r) => r.name === install.name)!.location;
          let lockFiles = sourcePkg.files;
          for (const { targetRoot } of driftReports) {
            const result = await materialize({ skillName: install.name, sourcePath: sourceDir, targetRoot, mode: install.installMode, sourceFiles: sourcePkg.files });
            lockFiles = result.files;
          }
          lockSkill(updatedLock, install.name, install.source, install.installMode, lockFiles);
        }

        for (const update of plan.update) {
          const sourceDir = resolved.find((r) => r.name === update.name)!.location;
          const sourcePkg = prepared.find((p) => p.name === update.name)!;
          let lockFiles = sourcePkg.files;
          for (const { targetRoot } of driftReports) {
            const result = await materialize({ skillName: update.name, sourcePath: sourceDir, targetRoot, mode: update.installMode, sourceFiles: sourcePkg.files });
            lockFiles = result.files;
          }
          lockSkill(updatedLock, update.name, update.source, update.installMode, lockFiles);
        }

        if (force) {
          for (const conflict of plan.conflicts) {
            const sourceDir = resolved.find((r) => r.name === conflict.name)!.location;
            const sourcePkg = prepared.find((p) => p.name === conflict.name)!;
            const installMode = manifest.overrides[conflict.name]?.installMode ?? manifest.installMode;
            let lockFiles = sourcePkg.files;
            for (const { targetRoot } of driftReports) {
              const result = await materialize({ skillName: conflict.name, sourcePath: sourceDir, targetRoot, mode: installMode, sourceFiles: sourcePkg.files });
              lockFiles = result.files;
            }
            lockSkill(updatedLock, conflict.name, sourcePkg.source, installMode, lockFiles);
          }
        }

        for (const skipped of plan.skipped) {
          const sourcePkg = prepared.find((p) => p.name === skipped.name)!;
          const installMode = manifest.overrides[skipped.name]?.installMode ?? manifest.installMode;
          lockSkill(updatedLock, skipped.name, sourcePkg.source, installMode, sourcePkg.files);
        }

        for (const name of plan.remove) {
          for (const { targetRoot } of driftReports) {
            await dematerialize(name, targetRoot);
          }
          delete updatedLock.skills[name];
        }

        if (Object.keys(manifest.config).length > 0) {
          for (const { targetRoot } of driftReports) {
            const installedPkgs = [];
            for (const skillName of Object.keys(updatedLock.skills)) {
              try {
                const pkg = await loadSkillPackage(resolve(targetRoot, skillName));
                installedPkgs.push(pkg);
              } catch { /* skip missing */ }
            }
            const mergedConfig = generateConfig({ manifestConfig: manifest.config, installedSkills: installedPkgs });
            await writeProjectConfig(targetRoot, mergedConfig);
          }
        }

        await writeLockFile(root, updatedLock);

        const summary = {
          installed: plan.install.map((i) => i.name),
          updated: plan.update.map((u) => u.name),
          removed: plan.remove,
          unchanged: plan.unchanged,
          skipped: plan.skipped.map((s) => ({ name: s.name, reason: s.reason })),
          forced: force ? plan.conflicts.map((c) => c.name) : [],
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } finally {
        for (const source of sources) {
          if ("dispose" in source && typeof (source as { dispose: () => Promise<void> }).dispose === "function") {
            await (source as { dispose: () => Promise<void> }).dispose();
          }
        }
      }
    },
  );

  server.tool(
    "pin-skill",
    "Lock a skill to its current source revision so future syncs use that exact version.",
    { skill: z.string().describe("Name of the skill to pin") },
    async ({ skill }) => {
      const manifest = await readManifest(root);
      const lockFile = await readLockFile(root);

      if (!lockFile) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No lock file found. Run sync-skills first." }, null, 2) }] };
      }

      const locked = lockFile.skills[skill];
      if (!locked) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${skill}" is not installed.` }, null, 2) }] };
      }

      if (locked.source.type !== "git" || !locked.source.revision) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `Skill "${skill}" is sourced from ${locked.source.type} and cannot be pinned to a revision.` }, null, 2),
          }],
        };
      }

      if (!manifest.overrides[skill]) manifest.overrides[skill] = {};
      manifest.overrides[skill]!.installMode = locked.installMode;
      manifest.overrides[skill]!.sourceName = locked.source.name;
      manifest.overrides[skill]!.revision = locked.source.revision;

      await writeFile(join(root, "skillsync.yaml"), serializeManifest(manifest), "utf-8");

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ pinned: skill, revision: locked.source.revision, source: locked.source.name }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "unpin-skill",
    "Remove a revision pin from a skill, allowing it to receive updates on future syncs.",
    { skill: z.string().describe("Name of the skill to unpin") },
    async ({ skill }) => {
      const manifest = await readManifest(root);

      if (!manifest.overrides[skill]) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ unpinned: false, message: `Skill "${skill}" is not pinned.` }, null, 2) }] };
      }

      delete manifest.overrides[skill];
      await writeFile(join(root, "skillsync.yaml"), serializeManifest(manifest), "utf-8");

      return { content: [{ type: "text" as const, text: JSON.stringify({ unpinned: skill }, null, 2) }] };
    },
  );

  server.tool(
    "prune-skills",
    "Remove installed skills that are not declared in the project manifest.",
    { dry_run: z.boolean().optional().default(false).describe("Show what would be removed without removing it") },
    async ({ dry_run }) => {
      const manifest = await readManifest(root);
      const lockFile = await readLockFile(root);

      if (!lockFile) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ pruned: [] }, null, 2) }] };
      }

      const targetEntries = Object.entries(manifest.targets);
      const primaryTarget = targetEntries[0]?.[1];
      if (!primaryTarget) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No targets defined in skillsync.yaml" }, null, 2) }] };
      }

      const drift = await detectDrift(resolve(root, primaryTarget), lockFile);
      const manifestSkills = new Set(manifest.skills);
      const lockOnly = Object.keys(lockFile.skills).filter((name) => !manifestSkills.has(name));
      const toPrune = [...lockOnly, ...drift.extra];

      if (toPrune.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ pruned: [] }, null, 2) }] };
      }

      if (dry_run) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ wouldPrune: toPrune }, null, 2) }] };
      }

      for (const name of toPrune) {
        for (const [, targetPath] of targetEntries) {
          await dematerialize(name, resolve(root, targetPath));
        }
        delete lockFile.skills[name];
      }
      await writeLockFile(root, lockFile);

      return { content: [{ type: "text" as const, text: JSON.stringify({ pruned: toPrune }, null, 2) }] };
    },
  );

  server.tool(
    "promote-skill",
    "Display guidance for promoting local skill modifications back to their canonical source.",
    { skill: z.string().optional().describe("Name of a specific skill to promote (optional)") },
    async ({ skill }) => {
      const guidance = {
        version: "v0",
        automated: false,
        skill: skill ?? null,
        steps: [
          "1. Call skill-status to identify modified skills",
          "2. Call sync-skills with dry_run=true to review what would change",
          "3. Copy modified files from the target directory back to the source",
          "4. Call sync-skills to confirm the source and target are in sync",
        ],
        note: "Automated promotion will be available in v0.2.",
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(guidance, null, 2) }] };
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
      const skillRoot = await findSkillRoot(root, name);
      if (!skillRoot) {
        return {
          messages: [{
            role: "user" as const,
            content: { type: "text" as const, text: `Skill "${name}" not found.` },
          }],
        };
      }
      const skillMdPath = join(skillRoot.root, name, "SKILL.md");
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
  const targets = await getTargetRoots(projectRoot);
  return targets[0]!.root;
}

async function getTargetRoots(projectRoot: string): Promise<TargetRoot[]> {
  try {
    const manifest = await readManifest(projectRoot);
    const targets = Object.entries(manifest.targets).map(([name, path]) => ({
      name,
      root: resolve(projectRoot, path),
    }));
    if (targets.length > 0) {
      return targets;
    }
  } catch {
    // Fall through to default target.
  }
  return [{ name: "claude", root: resolve(projectRoot, ".claude/skills") }];
}

export async function listInstalledSkills(projectRoot: string): Promise<SkillPackage[]> {
  const targets = await getTargetRoots(projectRoot);
  const skills = new Map<string, SkillPackage>();
  for (const target of targets) {
    const skillNames = await discoverSkillNames(target.root);
    for (const name of skillNames) {
      if (skills.has(name)) continue;
      try {
        const pkg = await loadSkillPackage(join(target.root, name));
        skills.set(name, pkg);
      } catch {
        // Skip unreadable skills.
      }
    }
  }
  return [...skills.values()];
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

export async function runValidation(projectRoot: string): Promise<ValidationDiagnostic[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  try {
    const manifest = await readManifest(projectRoot);
    const lockFile = await readLockFile(projectRoot);
    if (!lockFile) return [{ rule: "no-lock-file", severity: "warning", message: "No lock file found." }];

    const installedPkgs: SkillPackage[] = [];
    const targets = await getTargetRoots(projectRoot);

    for (const [skillName, locked] of Object.entries(lockFile.skills)) {
      let pkgForWarnings: SkillPackage | null = null;
      for (const target of targets) {
        try {
          const pkg = await loadSkillPackage(resolve(target.root, skillName));
          if (!pkgForWarnings) {
            pkgForWarnings = pkg;
            installedPkgs.push(pkg);
          }
          const portDiags = await validatePortability(pkg, locked.installMode);
          diagnostics.push(...portDiags.map((diag) => ({ ...diag, message: `[${target.name}] ${diag.message}` })));
        } catch {
          diagnostics.push({
            rule: "skill-not-found",
            severity: "error",
            message: `Skill "${skillName}" not found on disk for target "${target.name}"`,
            skill: skillName,
          });
        }
      }
      if (pkgForWarnings) {
        const compatDiags = checkAllTargetCompatibility(pkgForWarnings, manifest.targets);
        diagnostics.push(...compatDiags);
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

async function findSkillRoot(projectRoot: string, skillName: string): Promise<TargetRoot | null> {
  const targets = await getTargetRoots(projectRoot);
  for (const target of targets) {
    try {
      await access(join(target.root, skillName, "SKILL.md"), constants.R_OK);
      return target;
    } catch {
      // Keep searching other targets.
    }
  }
  return null;
}
