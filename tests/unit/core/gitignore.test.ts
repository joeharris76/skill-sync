import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyGitTracking,
  applyManagedBlock,
  planGitTracking,
} from "../../../src/core/gitignore.js";
import type { TargetConfig } from "../../../src/core/types.js";

const BEGIN = "# >>> skill-sync managed (do not edit) >>>";
const END = "# <<< skill-sync managed <<<";

describe("applyManagedBlock", () => {
  it("inserts a block into an empty file", () => {
    const out = applyManagedBlock(null, ["/.codex/skills/"]);
    expect(out).toBe(`${BEGIN}\n/.codex/skills/\n${END}\n`);
  });

  it("appends the block after existing content with one blank separator", () => {
    const out = applyManagedBlock("node_modules/\n.env\n", ["/.codex/skills/"]);
    expect(out).toBe(`node_modules/\n.env\n\n${BEGIN}\n/.codex/skills/\n${END}\n`);
  });

  it("is idempotent when run twice", () => {
    const once = applyManagedBlock("node_modules/\n", ["/.codex/skills/"]);
    const twice = applyManagedBlock(once, ["/.codex/skills/"]);
    expect(twice).toBe(once);
  });

  it("replaces an existing block in place (re-emitted at end)", () => {
    const first = applyManagedBlock("node_modules/\n", ["/.codex/skills/"]);
    const updated = applyManagedBlock(first, ["/.gemini/skills/"]);
    expect(updated).toBe(`node_modules/\n\n${BEGIN}\n/.gemini/skills/\n${END}\n`);
  });

  it("removes the block (and markers) when the body is empty", () => {
    const withBlock = applyManagedBlock("node_modules/\n", ["/.codex/skills/"]);
    const removed = applyManagedBlock(withBlock, []);
    expect(removed).toBe("node_modules/\n");
    expect(removed).not.toContain(BEGIN);
  });

  it("returns empty string when removing the block leaves no content", () => {
    const onlyBlock = applyManagedBlock(null, ["/.codex/skills/"]);
    expect(applyManagedBlock(onlyBlock, [])).toBe("");
  });
});

describe("planGitTracking", () => {
  const root = "/repo";

  it("ignores the dir of an untracked target", () => {
    const targets: Record<string, TargetConfig> = { codex: { dir: ".codex/skills" } };
    const plan = planGitTracking(root, targets, null, null);
    expect(plan.gitignore).toContain("/.codex/skills/");
    expect(plan.gitattributes).toBe("");
  });

  it("emits no dir ignore for a tracked target, but adds a -text attribute", () => {
    const targets: Record<string, TargetConfig> = {
      claude: { dir: ".claude/skills", tracked: true },
    };
    const plan = planGitTracking(root, targets, null, null);
    expect(plan.gitignore).toBe(""); // nothing to ignore
    expect(plan.gitattributes).toContain("/.claude/skills/** -text");
  });

  it("ignores only excluded skills within a tracked target (no negations)", () => {
    const targets: Record<string, TargetConfig> = {
      claude: { dir: ".claude/skills", tracked: true, ignore: ["substack", "blog"] },
    };
    const plan = planGitTracking(root, targets, null, null);
    expect(plan.gitignore).toContain("/.claude/skills/blog/");
    expect(plan.gitignore).toContain("/.claude/skills/substack/");
    expect(plan.gitignore).not.toContain("!"); // never use negations
    // deterministic: excluded skills are sorted
    expect(plan.gitignore.indexOf("blog")).toBeLessThan(plan.gitignore.indexOf("substack"));
  });

  it("flags a tracked target that resolves outside the repo", () => {
    const targets: Record<string, TargetConfig> = {
      claude: { dir: "~/.claude/skills", tracked: true },
    };
    const plan = planGitTracking(root, targets, null, null);
    expect(plan.outsideRepoTracked).toEqual(["claude"]);
  });

  it("skips (does not ignore) an untracked target outside the repo", () => {
    const targets: Record<string, TargetConfig> = {
      claude: { dir: "~/.claude/skills" },
    };
    const plan = planGitTracking(root, targets, null, null);
    expect(plan.gitignore).toBe("");
    expect(plan.outsideRepoTracked).toEqual([]);
  });

  it("detects an external ignore line shadowing a tracked dir", () => {
    const targets: Record<string, TargetConfig> = {
      claude: { dir: ".claude/skills", tracked: true },
    };
    const prev = ".claude/skills/\nnode_modules/\n";
    const plan = planGitTracking(root, targets, prev, null);
    expect(plan.externalConflicts).toEqual([".claude/skills"]);
  });

  it("orders entries deterministically by target key", () => {
    const targets: Record<string, TargetConfig> = {
      gemini: { dir: ".gemini/skills" },
      codex: { dir: ".codex/skills" },
    };
    const plan = planGitTracking(root, targets, null, null);
    expect(plan.gitignore.indexOf(".codex")).toBeLessThan(plan.gitignore.indexOf(".gemini"));
  });
});

describe("applyGitTracking (IO)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "skill-sync-gitignore-"));
  });

  afterAll(async () => {
    // mkdtemp dirs are created per test; clean the parent tmp pattern best-effort
  });

  it("writes .gitignore and .gitattributes, then reports no change on re-run", async () => {
    const targets: Record<string, TargetConfig> = {
      claude: { dir: ".claude/skills", tracked: true, ignore: ["blog"] },
      codex: { dir: ".codex/skills" },
    };
    const first = await applyGitTracking(tmp, targets);
    expect(first.gitignoreChanged).toBe(true);
    expect(first.gitattributesChanged).toBe(true);

    const gi = await readFile(join(tmp, ".gitignore"), "utf-8");
    expect(gi).toContain("/.codex/skills/");
    expect(gi).toContain("/.claude/skills/blog/");
    const ga = await readFile(join(tmp, ".gitattributes"), "utf-8");
    expect(ga).toContain("/.claude/skills/** -text");

    const second = await applyGitTracking(tmp, targets);
    expect(second.gitignoreChanged).toBe(false);
    expect(second.gitattributesChanged).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });

  it("preserves pre-existing unmanaged .gitignore content", async () => {
    await writeFile(join(tmp, ".gitignore"), "node_modules/\ndist/\n");
    await applyGitTracking(tmp, {
      claude: { dir: ".claude/skills", tracked: true },
      codex: { dir: ".codex/skills" },
    });
    const gi = await readFile(join(tmp, ".gitignore"), "utf-8");
    expect(gi).toContain("node_modules/");
    expect(gi).toContain("dist/");
    expect(gi).toContain("/.codex/skills/");
    await rm(tmp, { recursive: true, force: true });
  });

  it("removes the .gitattributes file when no targets are tracked", async () => {
    await applyGitTracking(tmp, { claude: { dir: ".claude/skills", tracked: true } });
    expect(existsSync(join(tmp, ".gitattributes"))).toBe(true);
    // flip to untracked → managed block empties → file removed
    await applyGitTracking(tmp, { claude: { dir: ".claude/skills" } });
    expect(existsSync(join(tmp, ".gitattributes"))).toBe(false);
    await rm(tmp, { recursive: true, force: true });
  });

  it("does not write when dryRun is set", async () => {
    const report = await applyGitTracking(
      tmp,
      { claude: { dir: ".claude/skills", tracked: true }, codex: { dir: ".codex/skills" } },
      { dryRun: true },
    );
    expect(report.gitignoreChanged).toBe(true);
    expect(existsSync(join(tmp, ".gitignore"))).toBe(false);
    await rm(tmp, { recursive: true, force: true });
  });

  it("stays hands-off when no target is tracked and no managed block exists", async () => {
    const report = await applyGitTracking(tmp, { codex: { dir: ".codex/skills" } });
    expect(report.gitignoreChanged).toBe(false);
    expect(existsSync(join(tmp, ".gitignore"))).toBe(false);
    await rm(tmp, { recursive: true, force: true });
  });

  it("maintains an existing managed block even after all targets go untracked", async () => {
    // Opt in, then revert to untracked: the block must be maintained, not abandoned.
    await applyGitTracking(tmp, { claude: { dir: ".claude/skills", tracked: true } });
    const reverted = await applyGitTracking(tmp, { claude: { dir: ".claude/skills" } });
    expect(reverted.gitignoreChanged).toBe(true);
    const gi = await readFile(join(tmp, ".gitignore"), "utf-8");
    expect(gi).toContain("/.claude/skills/");
    await rm(tmp, { recursive: true, force: true });
  });

  it("throws when a tracked target is outside the repo", async () => {
    await mkdir(tmp, { recursive: true });
    await expect(
      applyGitTracking(tmp, { claude: { dir: "/elsewhere/skills", tracked: true } }),
    ).rejects.toThrow(/outside the project/);
    await rm(tmp, { recursive: true, force: true });
  });
});
