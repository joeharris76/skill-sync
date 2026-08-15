import { access, constants } from "node:fs/promises";
import { isAbsolute, join, posix, resolve, sep } from "node:path";
import { expandTilde } from "../core/paths.js";
import type { FetchedSkill, ResolvedSkill, SkillSource, SourceProvenance } from "../core/types.js";

/** Source adapter for local filesystem skill directories. */
export class LocalSource implements SkillSource {
  readonly name: string;
  readonly type = "local" as const;
  private readonly basePath: string;
  private readonly configuredPath: string;

  constructor(name: string, path: string, projectRoot: string) {
    this.name = name;
    const expanded = expandTilde(path);
    this.basePath = resolve(projectRoot, expanded);
    this.configuredPath = isAbsolute(expanded) ? this.basePath : path;
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
    // Normalize only the host platform's separator. A backslash is a valid
    // filename character on POSIX and must not be rewritten there.
    const portableConfiguredPath = this.configuredPath.split(sep).join(posix.sep);
    return {
      type: this.type,
      name: this.name,
      path: isAbsolute(this.configuredPath)
        ? resolved.location
        : posix.join(portableConfiguredPath, resolved.name),
      fetchedAt: new Date().toISOString(),
    };
  }
}
