import { describe, it, expect } from "vitest";
import { parseManifest, serializeManifest } from "../../../src/core/manifest.js";

describe("parseManifest", () => {
  it("parses a complete manifest", () => {
    const yaml = `
version: 1
sources:
  - name: personal
    type: local
    path: ~/.claude/skills
  - name: team
    type: git
    url: git@github.com:org/skills.git
    ref: main
skills:
  - code
  - test
  - SHARED/commit-framework
targets:
  claude: .claude/skills
  codex: .codex/skills
install_mode: mirror
config:
  code:
    lint: "ruff check ."
  test:
    runner: pytest
overrides:
  code:
    install_mode: symlink
hooks:
  before_sync:
    - make agent-write-preflight
project_registry:
  auto_register: true
  include_worktrees: true
`;
    const manifest = parseManifest(yaml);

    expect(manifest.version).toBe(1);
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.sources[0]!.name).toBe("personal");
    expect(manifest.sources[0]!.type).toBe("local");
    expect(manifest.sources[1]!.type).toBe("git");
    expect(manifest.skills).toEqual(["code", "test", "SHARED/commit-framework"]);
    expect(manifest.targets).toEqual({
      claude: { dir: ".claude/skills" },
      codex: { dir: ".codex/skills" },
    });
    expect(manifest.installMode).toBe("mirror");
    expect(manifest.config.code).toEqual({ lint: "ruff check ." });
    expect(manifest.overrides.code?.installMode).toBe("symlink");
    expect(manifest.hooks.beforeSync).toEqual(["make agent-write-preflight"]);
    expect(manifest.projectRegistry.includeWorktrees).toBe(true);
  });

  it("defaults install_mode to mirror", () => {
    const yaml = `
version: 1
skills:
  - code
`;
    const manifest = parseManifest(yaml);
    expect(manifest.installMode).toBe("mirror");
    expect(manifest.hooks.beforeSync).toEqual([]);
    expect(manifest.projectRegistry).toEqual({
      autoRegister: true,
      includeWorktrees: false,
    });
  });

  it("defaults targets to .claude/skills", () => {
    const yaml = `
version: 1
skills:
  - test
`;
    const manifest = parseManifest(yaml);
    expect(manifest.targets).toEqual({ claude: { dir: ".claude/skills" } });
  });

  it("rejects unsupported version", () => {
    const yaml = `
version: 99
skills:
  - code
`;
    expect(() => parseManifest(yaml)).toThrow("Unsupported manifest version");
  });

  it("parses object-form targets with tracked + ignore", () => {
    const yaml = `
version: 1
skills:
  - code
targets:
  claude:
    dir: .claude/skills
    tracked: true
    ignore:
      - blog
      - substack
  codex: .codex/skills
`;
    const manifest = parseManifest(yaml);
    expect(manifest.targets.claude).toEqual({
      dir: ".claude/skills",
      tracked: true,
      ignore: ["blog", "substack"],
    });
    // bare string stays an untracked target
    expect(manifest.targets.codex).toEqual({ dir: ".codex/skills" });
  });

  it("throws when an object-form target is missing dir", () => {
    const yaml = `
version: 1
skills:
  - code
targets:
  claude:
    tracked: true
`;
    expect(() => parseManifest(yaml)).toThrow('Target "claude" must have a string "dir" field');
  });
});

describe("serializeManifest target round-trip", () => {
  it("keeps default targets in compact string form", () => {
    const yaml = `
version: 1
skills:
  - code
targets:
  claude: .claude/skills
  codex: .codex/skills
`;
    const serialized = serializeManifest(parseManifest(yaml));
    // Untracked targets must serialize back to bare strings (byte-stable diffs).
    expect(serialized).toMatch(/claude: \.claude\/skills/);
    expect(serialized).not.toMatch(/dir: \.claude\/skills/);
    expect(parseManifest(serialized).targets.claude).toEqual({ dir: ".claude/skills" });
  });

  it("serializes opted-in targets as objects and round-trips losslessly", () => {
    const yaml = `
version: 1
skills:
  - code
targets:
  claude:
    dir: .claude/skills
    tracked: true
    ignore:
      - blog
  codex: .codex/skills
`;
    const parsed = parseManifest(yaml);
    const reparsed = parseManifest(serializeManifest(parsed));
    expect(reparsed.targets).toEqual(parsed.targets);
    expect(reparsed.targets.claude?.tracked).toBe(true);
    // sibling untracked target stays compact
    expect(reparsed.targets.codex).toEqual({ dir: ".codex/skills" });
  });
});
