import { execFile } from "node:child_process";
import { access, constants, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { normalizeRepositorySubdir } from "../core/paths.js";
import type { FetchedSkill, ResolvedSkill, SkillSource, SourceProvenance } from "../core/types.js";

const exec = promisify(execFile);

/**
 * Source adapter for git-hosted skill repositories.
 *
 * Clones the repository without a working tree to a temporary directory and
 * checks out the configured ref. A ref may be a branch, tag, or exact commit;
 * pinned commits must remain resolvable even when they are not on the default
 * branch.
 */
export class GitSource implements SkillSource {
  readonly name: string;
  readonly type = "git" as const;
  private readonly url: string;
  private readonly ref: string;
  private readonly subdir: string | undefined;
  private clonePath: string | null = null;
  private resolvedRevision: string | null = null;

  constructor(name: string, url: string, ref = "main", subdir?: string) {
    this.name = name;
    this.url = url;
    this.ref = ref;
    this.subdir = subdir === undefined ? undefined : normalizeRepositorySubdir(subdir);
  }

  async resolve(skillName: string): Promise<ResolvedSkill | null> {
    await this.ensureCloned();
    const skillDir = join(this.clonePath!, this.subdir ?? "", skillName);
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

  provenance(_resolved: ResolvedSkill): SourceProvenance {
    return {
      type: this.type,
      name: this.name,
      url: this.url,
      ref: this.ref,
      subdir: this.subdir,
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
      await exec("git", ["clone", "--no-checkout", this.url, tmpDir]);
      await exec("git", ["checkout", "--quiet", "--detach", this.ref], {
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
