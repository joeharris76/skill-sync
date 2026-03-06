import { describe, it, expect } from "vitest";
import {
  parseSkillMdFrontmatter,
  parseSkillSyncMeta,
} from "../../../src/core/parser.js";

describe("parseSkillMdFrontmatter", () => {
  it("parses standard SKILL.md frontmatter", () => {
    const content = `---
name: code
description: Universal code development operations
license: MIT
allowed-tools:
  - Read
  - Edit
---

# Code Workflow

Instructions here...`;

    const meta = parseSkillMdFrontmatter(content);
    expect(meta.name).toBe("code");
    expect(meta.description).toBe("Universal code development operations");
    expect(meta.license).toBe("MIT");
    expect(meta.allowedTools).toEqual(["Read", "Edit"]);
  });

  it("returns empty name/description when no frontmatter", () => {
    const meta = parseSkillMdFrontmatter("# Just markdown\nNo frontmatter.");
    expect(meta.name).toBe("");
    expect(meta.description).toBe("");
  });

  it("handles minimal frontmatter", () => {
    const content = `---
name: test
description: Run tests
---
Body`;
    const meta = parseSkillMdFrontmatter(content);
    expect(meta.name).toBe("test");
    expect(meta.license).toBeUndefined();
    expect(meta.allowedTools).toBeUndefined();
  });
});

describe("parseSkillSyncMeta", () => {
  it("parses a complete sidecar file", () => {
    const content = `
tags: [python, backend]
category: development
depends:
  - SHARED/commit-framework
  - SHARED/verify-framework
config_inputs:
  - key: test.runner
    type: string
    description: Test runner command
    default: pytest
targets:
  claude: true
  codex: true
`;
    const meta = parseSkillSyncMeta(content);
    expect(meta.tags).toEqual(["python", "backend"]);
    expect(meta.category).toBe("development");
    expect(meta.depends).toEqual([
      "SHARED/commit-framework",
      "SHARED/verify-framework",
    ]);
    expect(meta.configInputs).toHaveLength(1);
    expect(meta.configInputs[0]!.key).toBe("test.runner");
    expect(meta.targets.claude).toBe(true);
    expect(meta.source).toBeUndefined();
  });

  it("handles empty/missing fields gracefully", () => {
    const meta = parseSkillSyncMeta("tags: []");
    expect(meta.tags).toEqual([]);
    expect(meta.depends).toEqual([]);
    expect(meta.configInputs).toEqual([]);
    expect(meta.targets).toEqual({});
  });
});
