import { access, constants, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  SkillSource,
  ResolvedSkill,
  FetchedSkill,
  SourceProvenance,
} from "../core/types.js";

const exec = promisify(execFile);

/**
 * Source adapter for git-hosted skill repositories.
 *
 * Clones the repository (shallow, single-branch) to a temporary cache
 * directory and resolves skills within the cloned tree.
 */
export class GitSource implements SkillSource {
  readonly name: string;
  readonly type = "git" as const;
  private readonly url: string;
  private readonly ref: string;
  private clonePath: string | null = null;
  private resolvedRevision: string | null = null;

  constructor(name: string, url: string, ref = "main") {
    this.name = name;
    this.url = url;
    this.ref = ref;
  }

  async resolve(skillName: string): Promise<ResolvedSkill | null> {
    await this.ensureCloned();
    const skillDir = join(this.clonePath!, skillName);
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
    // The skill directory already exists in the clone.
    return {
      name: resolved.name,
      path: resolved.location,
      isTemporary: false, // Cleaned up when the source is disposed, not per-skill
    };
  }

  provenance(resolved: ResolvedSkill): SourceProvenance {
    return {
      type: this.type,
      name: this.name,
      url: this.url,
      ref: this.ref,
      revision: this.resolvedRevision ?? undefined,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Clean up the temporary clone directory. */
  async dispose(): Promise<void> {
    if (this.clonePath) {
      await rm(this.clonePath, { recursive: true, force: true });
      this.clonePath = null;
    }
  }

  private async ensureCloned(): Promise<void> {
    if (this.clonePath) return;

    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-git-"));
    try {
      await exec("git", [
        "clone",
        "--depth",
        "1",
        this.url,
        tmpDir,
      ]);

      await exec("git", ["checkout", this.ref], {
        cwd: tmpDir,
      });

      // Resolve the HEAD revision
      const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
        cwd: tmpDir,
      });
      this.resolvedRevision = stdout.trim();
      this.clonePath = tmpDir;
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }
}
