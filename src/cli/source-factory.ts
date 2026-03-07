import type { SourceConfig, SkillOverride, SkillSource } from "../core/types.js";
import { LocalSource } from "../sources/local.js";
import { GitSource } from "../sources/git.js";

const IMPLEMENTED_SOURCE_TYPES = new Set(["local", "git"]);

export function isImplementedSourceType(type: SourceConfig["type"]): boolean {
  return IMPLEMENTED_SOURCE_TYPES.has(type);
}

/**
 * Create SkillSource instances from manifest source configs.
 * Sources are ordered by manifest declaration order (first match wins).
 */
export function createSourcesFromConfig(configs: SourceConfig[]): SkillSource[] {
  return createSourcesFromConfigForSkill(configs);
}

export function createSourcesFromConfigForSkill(
  configs: SourceConfig[],
  override?: SkillOverride,
): SkillSource[] {
  const selectedConfigs = override?.sourceName
    ? configs.filter((config) => config.name === override.sourceName)
    : configs;

  if (override?.sourceName && selectedConfigs.length === 0) {
    throw new Error(`Override references unknown source "${override.sourceName}".`);
  }

  return selectedConfigs.map((config) => {
    switch (config.type) {
      case "local":
        return new LocalSource(config.name, config.path!);
      case "git":
        return new GitSource(
          config.name,
          config.url!,
          config.name === override?.sourceName && override.revision
            ? override.revision
            : config.ref,
        );
      case "registry":
        throw new Error(
          `Source "${config.name}" uses type "registry", but registry sources are not implemented yet.`,
        );
      default:
        throw new Error(`Unsupported source type: ${config.type}`);
    }
  });
}
