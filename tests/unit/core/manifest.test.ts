import { describe, it, expect } from "vitest";
import { parseManifest } from "../../../src/core/manifest.js";

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
`;
    const manifest = parseManifest(yaml);

    expect(manifest.version).toBe(1);
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.sources[0]!.name).toBe("personal");
    expect(manifest.sources[0]!.type).toBe("local");
    expect(manifest.sources[1]!.type).toBe("git");
    expect(manifest.skills).toEqual(["code", "test", "SHARED/commit-framework"]);
    expect(manifest.targets).toEqual({
      claude: ".claude/skills",
      codex: ".codex/skills",
    });
    expect(manifest.installMode).toBe("mirror");
    expect(manifest.config.code).toEqual({ lint: "ruff check ." });
    expect(manifest.overrides.code?.installMode).toBe("symlink");
  });

  it("defaults install_mode to mirror", () => {
    const yaml = `
version: 1
skills:
  - code
`;
    const manifest = parseManifest(yaml);
    expect(manifest.installMode).toBe("mirror");
  });

  it("defaults targets to .claude/skills", () => {
    const yaml = `
version: 1
skills:
  - test
`;
    const manifest = parseManifest(yaml);
    expect(manifest.targets).toEqual({ claude: ".claude/skills" });
  });

  it("rejects unsupported version", () => {
    const yaml = `
version: 99
skills:
  - code
`;
    expect(() => parseManifest(yaml)).toThrow("Unsupported manifest version");
  });
});
