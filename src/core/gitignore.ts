import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { relativeInside } from "./paths.js";
import type { TargetConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Managed .gitignore / .gitattributes blocks
// ---------------------------------------------------------------------------
//
// skill-sync owns a single marked region in the consumer's .gitignore (and a
// sibling region in .gitattributes). Content outside the markers is never
// touched. The block expresses git-visibility for each target:
//
//   - untracked target  → ignore the whole skills dir (today's default)
//   - tracked target     → emit NOTHING for the dir (so git sees the committed
//                          snapshot); add an anchored ignore for each per-skill
//                          exclusion (kept gitignored within a tracked target)
//
// Two correctness rules drive the design:
//   1. No negations (`!`). Git cannot re-include a path whose parent dir is
//      ignored, so negations silently fail. We only ever ADD ignores, never
//      un-ignore — a tracked dir is visible because we emit no ignore for it.
//   2. Anchor every pattern with a leading "/" relative to projectRoot, so a
//      pattern never matches a same-named dir elsewhere in a monorepo.

const BEGIN_MARKER = "# >>> skill-sync managed (do not edit) >>>";
const END_MARKER = "# <<< skill-sync managed <<<";

const GITIGNORE_FILENAME = ".gitignore";
const GITATTRIBUTES_FILENAME = ".gitattributes";

export interface GitTrackingPlan {
  /** Desired full .gitignore content; "" means the file should be empty/removed. */
  gitignore: string;
  /** Desired full .gitattributes content; "" means the file should be empty/removed. */
  gitattributes: string;
  /** Target names that are `tracked` but resolve outside the repo (hard error). */
  outsideRepoTracked: string[];
  /**
   * Target names whose tracked dir appears to be ignored by a line OUTSIDE the
   * managed block (e.g. a stale hand-added `.claude/skills/`). These shadow the
   * tracked intent and must be removed by the user.
   */
  externalConflicts: string[];
}

export interface GitTrackingReport {
  gitignoreChanged: boolean;
  gitattributesChanged: boolean;
  outsideRepoTracked: string[];
  externalConflicts: string[];
}

/**
 * Compute the desired managed-block contents for both files from the targets.
 * Pure: takes the previous file contents (or null) and returns the next ones.
 */
export function planGitTracking(
  projectRoot: string,
  targets: Record<string, TargetConfig>,
  prevGitignore: string | null,
  prevGitattributes: string | null,
): GitTrackingPlan {
  const ignoreLines: string[] = [];
  const attributeLines: string[] = [];
  const outsideRepoTracked: string[] = [];
  const trackedRels: string[] = [];

  for (const key of Object.keys(targets).sort()) {
    const cfg = targets[key]!;
    const rel = relativeInside(projectRoot, cfg.dir);

    if (rel === null) {
      // Target lives outside the repo tree (e.g. ~/.claude/skills).
      if (cfg.tracked) outsideRepoTracked.push(key);
      // Untracked + outside-repo: nothing to ignore (it isn't in the tree).
      continue;
    }

    if (!cfg.tracked) {
      ignoreLines.push(`/${rel}/`);
      continue;
    }

    // Tracked: do NOT ignore the dir. Ignore only the excluded skills, and mark
    // the whole tree as `-text` so committed bytes survive EOL normalization
    // (the SHA gate hashes committed bytes).
    trackedRels.push(rel);
    attributeLines.push(`/${rel}/** -text`);
    for (const skill of [...(cfg.ignore ?? [])].sort()) {
      ignoreLines.push(`/${rel}/${skill}/`);
    }
  }

  const externalConflicts = detectExternalConflicts(prevGitignore, trackedRels);

  return {
    gitignore: applyManagedBlock(prevGitignore, ignoreLines),
    gitattributes: applyManagedBlock(prevGitattributes, attributeLines),
    outsideRepoTracked,
    externalConflicts,
  };
}

/**
 * Compute and (unless dryRun) apply the managed blocks to .gitignore and
 * .gitattributes at projectRoot. Writes are atomic (temp + rename); a file that
 * becomes empty is removed. Throws if a tracked target resolves outside the repo.
 */
export async function applyGitTracking(
  projectRoot: string,
  targets: Record<string, TargetConfig>,
  opts: { dryRun?: boolean } = {},
): Promise<GitTrackingReport> {
  const gitignorePath = join(projectRoot, GITIGNORE_FILENAME);
  const gitattributesPath = join(projectRoot, GITATTRIBUTES_FILENAME);

  const prevGitignore = await readIfExists(gitignorePath);
  const prevGitattributes = await readIfExists(gitattributesPath);

  // Backwards compatibility: stay hands-off for repos that never opt in. Only
  // begin managing .gitignore once a target is tracked, or once a managed block
  // already exists (i.e. the repo opted in previously and may now be reverting).
  const hasTracked = Object.values(targets).some((t) => t.tracked);
  const hadBlock =
    (prevGitignore?.includes(BEGIN_MARKER) ?? false) ||
    (prevGitattributes?.includes(BEGIN_MARKER) ?? false);
  if (!hasTracked && !hadBlock) {
    return {
      gitignoreChanged: false,
      gitattributesChanged: false,
      outsideRepoTracked: [],
      externalConflicts: [],
    };
  }

  const plan = planGitTracking(projectRoot, targets, prevGitignore, prevGitattributes);

  const gitignoreChanged = plan.gitignore !== (prevGitignore ?? "");
  const gitattributesChanged = plan.gitattributes !== (prevGitattributes ?? "");

  if (!opts.dryRun) {
    if (plan.outsideRepoTracked.length > 0) {
      throw new Error(
        `Cannot commit targets that resolve outside the project: ${plan.outsideRepoTracked.join(
          ", ",
        )}. Set tracked: false or point the target inside the repo.`,
      );
    }
    if (gitignoreChanged) await writeOrRemove(gitignorePath, plan.gitignore);
    if (gitattributesChanged) await writeOrRemove(gitattributesPath, plan.gitattributes);
  }

  return {
    gitignoreChanged,
    gitattributesChanged,
    outsideRepoTracked: plan.outsideRepoTracked,
    externalConflicts: plan.externalConflicts,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Replace (or remove) the skill-sync managed block within `prev`, leaving all
 * other content untouched. The block is always re-emitted at the end of the
 * file separated by one blank line, which makes the operation idempotent.
 *
 * Returns the full file content with a single trailing newline, or "" when the
 * file would have no content at all.
 */
export function applyManagedBlock(prev: string | null, body: string[]): string {
  const lines = prev != null ? prev.split("\n") : [];

  // Strip an existing managed block, if present.
  const begin = lines.indexOf(BEGIN_MARKER);
  let remainder: string[];
  if (begin !== -1) {
    let end = -1;
    for (let i = begin + 1; i < lines.length; i++) {
      if (lines[i] === END_MARKER) {
        end = i;
        break;
      }
    }
    const tail = end !== -1 ? lines.slice(end + 1) : [];
    remainder = [...lines.slice(0, begin), ...tail];
  } else {
    remainder = lines;
  }

  // Trim trailing blank lines from the surviving content.
  while (remainder.length > 0 && remainder[remainder.length - 1]!.trim() === "") {
    remainder.pop();
  }

  if (body.length === 0) {
    return remainder.length > 0 ? `${remainder.join("\n")}\n` : "";
  }

  const block = [BEGIN_MARKER, ...body, END_MARKER];
  const out = remainder.length > 0 ? [...remainder, "", ...block] : block;
  return `${out.join("\n")}\n`;
}

/**
 * Heuristic scan for lines OUTSIDE the managed block that would ignore a
 * tracked dir. The authoritative check (`git check-ignore`) lives in `doctor`;
 * this catches the common stale hand-added entry without shelling out.
 */
function detectExternalConflicts(prevGitignore: string | null, trackedRels: string[]): string[] {
  if (!prevGitignore || trackedRels.length === 0) return [];

  const lines = prevGitignore.split("\n");
  const begin = lines.indexOf(BEGIN_MARKER);
  const end = lines.indexOf(END_MARKER);
  const inBlock = (i: number) => begin !== -1 && end !== -1 && i > begin && i < end;

  const conflicts = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (inBlock(i)) continue;
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const norm = line.replace(/^\//, "").replace(/\/$/, "");
    for (const rel of trackedRels) {
      if (norm === rel) conflicts.add(rel);
    }
  }
  return [...conflicts];
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeOrRemove(path: string, content: string): Promise<void> {
  if (content === "") {
    try {
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return;
  }
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, path);
}
