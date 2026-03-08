import type {
  SkillSource,
  ResolvedSkill,
  FetchedSkill,
  SkillSyncMeta,
} from "./types.js";
import { loadSkillPackage } from "./parser.js";

export class SkillNotFoundError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly searchedSources: string[],
  ) {
    super(
      `Skill "${skillName}" not found in sources: ${searchedSources.join(", ")}`,
    );
    this.name = "SkillNotFoundError";
  }
}

/**
 * Resolve a skill name against an ordered list of sources.
 * First source containing the skill wins.
 */
export async function resolveSkill(
  skillName: string,
  sources: SkillSource[],
): Promise<ResolvedSkill> {
  for (const source of sources) {
    const resolved = await source.resolve(skillName);
    if (resolved) return resolved;
  }
  throw new SkillNotFoundError(
    skillName,
    sources.map((s) => s.name),
  );
}

/**
 * Resolve all requested skills, including transitive dependencies
 * from skill.yaml `depends` fields.
 *
 * Returns the full set of resolved skills (requested + dependencies).
 */
export async function resolveAll(
  requestedSkills: string[],
  sources: SkillSource[],
): Promise<ResolvedSkill[]> {
  const resolved = new Map<string, ResolvedSkill>();
  const queue = [...requestedSkills];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const skillName = queue.shift()!;
    if (visited.has(skillName)) continue;
    visited.add(skillName);

    const result = await resolveSkill(skillName, sources);
    resolved.set(skillName, result);

    // Check for dependencies in the resolved skill's meta
    const deps = await loadDependencies(result);
    for (const dep of deps) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return Array.from(resolved.values());
}

/** Load dependencies from a resolved skill's skill.yaml. */
async function loadDependencies(resolved: ResolvedSkill): Promise<string[]> {
  try {
    const pkg = await loadSkillPackage(resolved.location);
    return pkg.meta?.depends ?? [];
  } catch {
    return [];
  }
}
