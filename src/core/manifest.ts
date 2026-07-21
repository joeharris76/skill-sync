import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  InstallMode,
  Manifest,
  ManifestHooks,
  ProjectRegistryConfig,
  SourceConfig,
  TargetConfig,
} from "./types.js";

const MANIFEST_FILENAME = "skill-sync.yaml";
const SUPPORTED_VERSION = 1;

const VALID_INSTALL_MODES = new Set<InstallMode>(["copy", "symlink", "mirror"]);

export class ManifestNotFoundError extends Error {
  constructor(public readonly manifestPath: string) {
    super(`No skill-sync.yaml found at ${manifestPath}`);
    this.name = "ManifestNotFoundError";
  }
}

/**
 * Read and parse a skill-sync.yaml manifest from a project root.
 * Throws if the file is missing or malformed.
 */
export async function readManifest(projectRoot: string): Promise<Manifest> {
  const manifestPath = join(projectRoot, MANIFEST_FILENAME);
  let content: string;
  try {
    content = await readFile(manifestPath, "utf-8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new ManifestNotFoundError(manifestPath);
    }
    throw err;
  }
  return parseManifest(content);
}

/** Parse a skill-sync.yaml string into a validated Manifest. */
export function parseManifest(content: string): Manifest {
  const raw = parseYaml(content) as Record<string, unknown>;

  const version = raw.version;
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`Unsupported manifest version: ${version} (expected ${SUPPORTED_VERSION})`);
  }

  const sources = parseSources(raw.sources);
  const skills = parseSkills(raw.skills);
  const targets = parseTargets(raw.targets);
  const installMode = parseInstallMode(raw.install_mode);
  const config = parseConfig(raw.config);
  const overrides = parseOverrides(raw.overrides);
  const profile = typeof raw.profile === "string" ? raw.profile : undefined;
  const projects = parseProjects(raw.projects);
  const hooks = parseHooks(raw.hooks);
  const projectRegistry = parseProjectRegistry(raw.project_registry);

  return {
    version: SUPPORTED_VERSION,
    sources,
    skills,
    profile,
    targets,
    installMode,
    config,
    overrides,
    hooks,
    projectRegistry,
    ...(projects.length > 0 ? { projects } : {}),
  };
}

function parseSources(raw: unknown): SourceConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: Record<string, unknown>, i: number) => {
    if (!s.name || typeof s.name !== "string") {
      throw new Error(`Source at index ${i} is missing a "name" field`);
    }
    if (!s.type || typeof s.type !== "string") {
      throw new Error(`Source "${s.name}" is missing a "type" field`);
    }
    // Validate source type
    const VALID_SOURCE_TYPES = new Set(["local", "git", "registry"]);
    if (!VALID_SOURCE_TYPES.has(s.type)) {
      throw new Error(
        `Source "${s.name}" has unsupported type "${s.type}" (expected: ${[...VALID_SOURCE_TYPES].join(", ")})`,
      );
    }
    const sourceType = s.type as SourceConfig["type"];
    if (sourceType === "local" && typeof s.path !== "string") {
      throw new Error(`Local source "${s.name}" is missing a "path" field`);
    }
    if (sourceType === "git" && typeof s.url !== "string") {
      throw new Error(`Git source "${s.name}" is missing a "url" field`);
    }
    return {
      name: s.name,
      type: sourceType,
      path: typeof s.path === "string" ? s.path : undefined,
      url: typeof s.url === "string" ? s.url : undefined,
      ref: typeof s.ref === "string" ? s.ref : undefined,
      registry: typeof s.registry === "string" ? s.registry : undefined,
    };
  });
}

function parseSkills(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string");
}

function parseTargets(raw: unknown): Record<string, TargetConfig> {
  if (!raw || typeof raw !== "object") {
    return { claude: { dir: ".claude/skills" } };
  }
  const result: Record<string, TargetConfig> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    // Back-compat: a bare string is the directory path (untracked mirror).
    if (typeof val === "string") {
      result[key] = { dir: val };
      continue;
    }
    if (val && typeof val === "object") {
      const o = val as Record<string, unknown>;
      if (typeof o.dir !== "string") {
        throw new Error(`Target "${key}" must have a string "dir" field`);
      }
      const cfg: TargetConfig = { dir: o.dir };
      if (o.tracked === true) cfg.tracked = true;
      if (Array.isArray(o.ignore)) {
        const ignore = o.ignore.filter(
          (s): s is string => typeof s === "string" && s.trim().length > 0,
        );
        if (ignore.length > 0) cfg.ignore = ignore;
      }
      result[key] = cfg;
    }
  }
  return result;
}

function parseProjects(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string");
}

function parseHooks(raw: unknown): ManifestHooks {
  if (!raw || typeof raw !== "object") return { beforeSync: [] };
  const hooks = raw as Record<string, unknown>;
  const beforeSync = hooks.before_sync;
  if (typeof beforeSync === "string" && beforeSync.trim()) {
    return { beforeSync: [beforeSync] };
  }
  if (Array.isArray(beforeSync)) {
    return {
      beforeSync: beforeSync.filter(
        (command): command is string => typeof command === "string" && command.trim().length > 0,
      ),
    };
  }
  return { beforeSync: [] };
}

function parseProjectRegistry(raw: unknown): ProjectRegistryConfig {
  if (!raw || typeof raw !== "object") {
    return { autoRegister: true, includeWorktrees: false };
  }
  const registry = raw as Record<string, unknown>;
  return {
    autoRegister: registry.auto_register !== false,
    includeWorktrees: registry.include_worktrees === true,
  };
}

function parseInstallMode(raw: unknown): InstallMode {
  if (typeof raw === "string" && VALID_INSTALL_MODES.has(raw as InstallMode)) {
    return raw as InstallMode;
  }
  return "mirror";
}

function parseConfig(raw: unknown): Record<string, Record<string, unknown>> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val && typeof val === "object") {
      result[key] = val as Record<string, unknown>;
    }
  }
  return result;
}

function parseOverrides(
  raw: unknown,
): Record<string, { installMode?: InstallMode; sourceName?: string; revision?: string }> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<
    string,
    { installMode?: InstallMode; sourceName?: string; revision?: string }
  > = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val && typeof val === "object") {
      const o = val as Record<string, unknown>;
      result[key] = {
        installMode:
          typeof o.install_mode === "string" &&
          VALID_INSTALL_MODES.has(o.install_mode as InstallMode)
            ? (o.install_mode as InstallMode)
            : undefined,
        sourceName: typeof o.source_name === "string" ? o.source_name : undefined,
        revision: typeof o.revision === "string" ? o.revision : undefined,
      };
    }
  }
  return result;
}

/** Serialize a Manifest back to YAML string. */
export function serializeManifest(manifest: Manifest): string {
  const raw: Record<string, unknown> = {
    version: manifest.version,
    sources: manifest.sources.map((s) => {
      const entry: Record<string, unknown> = { name: s.name, type: s.type };
      if (s.path) entry.path = s.path;
      if (s.url) entry.url = s.url;
      if (s.ref) entry.ref = s.ref;
      if (s.registry) entry.registry = s.registry;
      return entry;
    }),
    skills: manifest.skills,
  };
  if (manifest.profile) raw.profile = manifest.profile;
  // Emit the compact string form for default (untracked, no exclusions) targets
  // so existing manifests round-trip byte-stable through pin/unpin; only opted-in
  // targets serialize as objects.
  const targetsRaw: Record<string, unknown> = {};
  for (const [key, cfg] of Object.entries(manifest.targets)) {
    if (!cfg.tracked && (!cfg.ignore || cfg.ignore.length === 0)) {
      targetsRaw[key] = cfg.dir;
    } else {
      const entry: Record<string, unknown> = { dir: cfg.dir };
      if (cfg.tracked) entry.tracked = true;
      if (cfg.ignore && cfg.ignore.length > 0) entry.ignore = cfg.ignore;
      targetsRaw[key] = entry;
    }
  }
  raw.targets = targetsRaw;
  raw.install_mode = manifest.installMode;
  if (manifest.hooks.beforeSync.length > 0) {
    raw.hooks = {
      before_sync:
        manifest.hooks.beforeSync.length === 1
          ? manifest.hooks.beforeSync[0]
          : manifest.hooks.beforeSync,
    };
  }
  if (!manifest.projectRegistry.autoRegister || manifest.projectRegistry.includeWorktrees) {
    raw.project_registry = {
      auto_register: manifest.projectRegistry.autoRegister,
      include_worktrees: manifest.projectRegistry.includeWorktrees,
    };
  }
  if (manifest.projects && manifest.projects.length > 0) raw.projects = manifest.projects;
  if (Object.keys(manifest.config).length > 0) raw.config = manifest.config;
  if (Object.keys(manifest.overrides).length > 0) {
    const overrides: Record<string, Record<string, unknown>> = {};
    for (const [key, val] of Object.entries(manifest.overrides)) {
      const entry: Record<string, unknown> = {};
      if (val.installMode) entry.install_mode = val.installMode;
      if (val.sourceName) entry.source_name = val.sourceName;
      if (val.revision) entry.revision = val.revision;
      overrides[key] = entry;
    }
    raw.overrides = overrides;
  }
  return stringifyYaml(raw);
}
