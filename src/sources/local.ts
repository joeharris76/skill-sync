import { access, constants } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expandTilde } from "../core/paths.js";
import type {
  SkillSource,
  ResolvedSkill,
  FetchedSkill,
  SourceProvenance,
} from "../core/types.js";

/** Source adapter for local filesystem skill directories. */
export class LocalSource implements SkillSource {
  readonly name: string;
  readonly type = "local" as const;
  private readonly basePath: string;

  constructor(name: string, path: string) {
    this.name = name;
    // Expand ~ to home directory
    this.basePath = resolve(expandTilde(path));
  }

  async resolve(skillName: string): Promise<ResolvedSkill | null> {
    const skillDir = join(this.basePath, skillName);
    const skillMdPath = join(skillDir, "SKILL.md");

    try {
      await access(skillMdPath, constants.R_OK);
      return {
        name: skillName,
        sourceName: this.name,
        sourceType: this.type,
        location: skillDir,
      };
    } catch {
      return null;
    }
  }

  async fetch(resolved: ResolvedSkill): Promise<FetchedSkill> {
    // Local sources don't need to fetch — the skill is already on disk.
    return {
      name: resolved.name,
      path: resolved.location,
      isTemporary: false,
    };
  }

  provenance(resolved: ResolvedSkill): SourceProvenance {
    return {
      type: this.type,
      name: this.name,
      path: resolved.location,
      fetchedAt: new Date().toISOString(),
    };
  }
}
