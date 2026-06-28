import { describe, it, expect } from "vitest";
import { isPortableMode, checkPortability } from "../../../src/core/portability.js";
import type { SkillPackage } from "../../../src/core/types.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("isPortableMode", () => {
  it("copy is portable", () => expect(isPortableMode("copy")).toBe(true));
  it("mirror is portable", () => expect(isPortableMode("mirror")).toBe(true));
  it("symlink is NOT portable", () =>
    expect(isPortableMode("symlink")).toBe(false));
});

describe("checkPortability", () => {
  const tmpBase = join(tmpdir(), "skill-sync-portability-test");

  async function makeSkillWithContent(
    name: string,
    skillMdContent: string,
    portabilityAllow?: string[],
  ): Promise<SkillPackage> {
    const skillDir = join(tmpBase, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), skillMdContent);
    return {
      name,
      description: "test",
      path: skillDir,
      skillMd: { name, description: "test" },
      meta: portabilityAllow
        ? { tags: [], depends: [], configInputs: [], targets: {}, portabilityAllow }
        : null,
      files: [{ relativePath: "SKILL.md", sha256: "x", size: skillMdContent.length }],
    };
  }

  it("flags home directory references", async () => {
    const pkg = await makeSkillWithContent(
      "bad-home",
      "---\nname: test\n---\nRun: ~/scripts/build.sh\n",
    );
    const diags = await checkPortability(pkg);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0]!.rule).toBe("non-portable-path");
  });

  it("flags absolute user paths", async () => {
    const pkg = await makeSkillWithContent(
      "bad-abs",
      "---\nname: test\n---\nPath: /Users/joe/.claude/skills/code\n",
    );
    const diags = await checkPortability(pkg);
    expect(diags.length).toBeGreaterThan(0);
  });

  it("passes for clean portable skills", async () => {
    const pkg = await makeSkillWithContent(
      "good",
      "---\nname: test\ndescription: clean\n---\n# Skill\nUse relative paths only.\n",
    );
    const diags = await checkPortability(pkg);
    expect(diags).toEqual([]);
  });

  it("does not flag documentary ~/ paths covered by portability_allow", async () => {
    // Mirrors the tidy-perms case: documenting where CLIs store global config.
    const content = [
      "---",
      "name: tidy",
      "description: perms",
      "---",
      "| Codex CLI | `~/.codex/config.toml` | check |",
      "| Gemini CLI | `~/.gemini/settings.json`, `trustedFolders.json` | check |",
      "Never commit `~/.codex/config.toml`, or `~/.gemini/*.json`.",
      "",
    ].join("\n");
    const pkg = await makeSkillWithContent("tidy", content, [
      "~/.codex/config.toml",
      "~/.gemini/settings.json",
      "~/.gemini/*.json",
    ]);
    const diags = await checkPortability(pkg);
    expect(diags).toEqual([]);
  });

  it("still flags a genuine ~/ leak that is not allowlisted", async () => {
    const pkg = await makeSkillWithContent(
      "leak",
      "---\nname: t\n---\nTODO_CLI=\"uv run --project ~/.claude/tools/todo todo-cli\"\n",
      ["~/.codex/config.toml"], // unrelated allow entry must NOT mask the leak
    );
    const diags = await checkPortability(pkg);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0]!.rule).toBe("non-portable-path");
  });

  it("still flags a leak sharing a line with an allowlisted documentary path", async () => {
    const pkg = await makeSkillWithContent(
      "mixed",
      "---\nname: t\n---\nSee `~/.codex/config.toml`; run uv --project ~/.claude/tools/todo.\n",
      ["~/.codex/config.toml"],
    );
    const diags = await checkPortability(pkg);
    // The documented path is stripped, but the real ~/.claude/tools leak remains.
    expect(diags.length).toBeGreaterThan(0);
  });

  // Cleanup
  it("cleanup", async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });
});
