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
 * Fetches one requested revision into a temporary shallow checkout and resolves
 * skills within that tree.
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

  private describeFetchFailure(err: unknown): string {
    const detail = err instanceof Error ? err.message.trim() : String(err);
    let message = `source "${this.name}": failed to fetch ref "${this.ref}" from ${this.url}.`;
    if (/^[0-9a-f]{4,39}$/i.test(this.ref)) {
      message +=
        " Abbreviated commit SHAs cannot be fetched directly; use the full 40-character SHA, a branch, or a tag.";
    } else if (/^[0-9a-f]{40}$/i.test(this.ref)) {
      message +=
        " Fetching by commit SHA requires server support (uploadpack.allowReachableSHA1InWant); use a branch or tag if the server does not allow it.";
    }
    return `${message} ${detail}`;
  }

  private async ensureCloned(): Promise<void> {
    if (this.clonePath) return;

    const tmpDir = await mkdtemp(join(tmpdir(), "skill-sync-git-"));
    try {
      await exec("git", ["init", "--quiet", tmpDir]);
      await exec("git", ["remote", "add", "origin", this.url], { cwd: tmpDir });
      try {
        await exec("git", ["fetch", "--depth", "1", "origin", this.ref], { cwd: tmpDir });
      } catch (err) {
        throw new Error(this.describeFetchFailure(err), { cause: err });
      }
      await exec("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], { cwd: tmpDir });

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
