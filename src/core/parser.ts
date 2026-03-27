import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  SkillMdMetadata,
  SkillSyncMeta,
  SkillPackage,
  ConfigInput,
  SettingsRequirements,
} from "./types.js";
import { hashSkillDirectory } from "./hasher.js";

/**
 * Parse SKILL.md YAML frontmatter.
 * Expects `---` delimiters around YAML block at the start of the file.
 */
export function parseSkillMdFrontmatter(content: string): SkillMdMetadata {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: "", description: "" };
  }
  const raw = parseYaml(match[1]) as Record<string, unknown>;
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    license: typeof raw.license === "string" ? raw.license : undefined,
    allowedTools: Array.isArray(raw["allowed-tools"])
      ? (raw["allowed-tools"] as string[])
      : undefined,
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
    compatibility:
      raw.compatibility && typeof raw.compatibility === "object"
        ? (raw.compatibility as Record<string, unknown>)
        : undefined,
  };
}

/** Parse skill.yaml sidecar file. */
export function parseSkillSyncMeta(content: string): SkillSyncMeta {
  const raw = parseYaml(content) as Record<string, unknown>;
  return {
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    category: typeof raw.category === "string" ? raw.category : undefined,
    depends: Array.isArray(raw.depends) ? (raw.depends as string[]) : [],
    configInputs: Array.isArray(raw.config_inputs)
      ? (raw.config_inputs as ConfigInput[])
      : [],
    targets:
      raw.targets && typeof raw.targets === "object"
        ? (raw.targets as Record<string, boolean>)
        : {},
    settingsRequirements: parseSettingsRequirements(raw.settings_requirements),
    source: undefined, // Populated by sync engine, not parsed from author file
  };
}

function parseSettingsRequirements(raw: unknown): SettingsRequirements | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const result: SettingsRequirements = {};
  for (const [agent, agentRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!agentRaw || typeof agentRaw !== "object" || Array.isArray(agentRaw)) continue;
    const agentObj = agentRaw as Record<string, unknown>;
    const perms = agentObj.permissions;
    if (!perms || typeof perms !== "object" || Array.isArray(perms)) {
      result[agent] = {};
      continue;
    }
    const permsObj = perms as Record<string, unknown>;
    result[agent] = {
      permissions: {
        allow: Array.isArray(permsObj.allow)
          ? (permsObj.allow as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined,
        deny: Array.isArray(permsObj.deny)
          ? (permsObj.deny as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined,
      },
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Load a complete SkillPackage from a directory on disk.
 * The directory must contain a SKILL.md file.
 */
export async function loadSkillPackage(
  skillDir: string,
): Promise<SkillPackage> {
  const skillMdPath = join(skillDir, "SKILL.md");
  const skillMdContent = await readFile(skillMdPath, "utf-8");
  const skillMd = parseSkillMdFrontmatter(skillMdContent);

  let meta: SkillSyncMeta | null = null;
  try {
    const metaPath = join(skillDir, "skill.yaml");
    const metaContent = await readFile(metaPath, "utf-8");
    meta = parseSkillSyncMeta(metaContent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `Failed to parse skill.yaml in ${skillDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // ENOENT: No sidecar file — that's fine
  }

  const files = await hashSkillDirectory(skillDir);

  return {
    name: skillMd.name || inferNameFromPath(skillDir),
    description: skillMd.description,
    path: skillDir,
    skillMd,
    meta,
    files,
  };
}

/** Infer a skill name from its directory path (last segment). */
function inferNameFromPath(skillDir: string): string {
  const segments = skillDir.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] ?? "unknown";
}
