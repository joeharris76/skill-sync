import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml } from "yaml";

const mockedOs = vi.hoisted(() => ({ homeDir: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockedOs.homeDir,
  };
});

import {
  doctorOperation,
  pinOperation,
  unpinOperation,
  pruneOperation,
} from "../../../src/core/operations.js";
import { readManifest } from "../../../src/core/manifest.js";
import { writeLockFile } from "../../../src/core/lock.js";
import type { LockFile } from "../../../src/core/types.js";

const tmpBase = join(tmpdir(), "skill-sync-operations-test-" + Date.now());

async function writeManifest(
  projectRoot: string,
  overrides?: Record<string, Record<string, unknown>>,
  targets: Record<string, string> = { claude: ".claude/skills" },
) {
  const manifest: Record<string, unknown> = {
    version: 1,
    sources: [{ name: "team", type: "git", url: "https://github.com/org/skills.git", ref: "main" }],
    skills: ["code", "test"],
    targets,
    install_mode: "mirror",
  };
  if (overrides) manifest.overrides = overrides;
  await writeFile(join(projectRoot, "skill-sync.yaml"), stringifyYaml(manifest));
}

function createTestLockFile(): LockFile {
  return {
    version: 1,
    lockedAt: new Date().toISOString(),
    skills: {
      code: {
        source: {
          type: "git",
          name: "team",
          url: "https://github.com/org/skills.git",
          ref: "main",
          revision: "abc123def456",
          fetchedAt: new Date().toISOString(),
        },
        installMode: "mirror",
        files: {
          "SKILL.md": { sha256: "deadbeef", size: 100 },
        },
      },
      test: {
        source: {
          type: "local",
          name: "personal",
          path: "/tmp/skills/test",
          fetchedAt: new Date().toISOString(),
        },
        installMode: "mirror",
        files: {
          "SKILL.md": { sha256: "cafebabe", size: 200 },
        },
      },
    },
  };
}

async function setupProject(name: string): Promise<string> {
  const projectRoot = join(tmpBase, name);
  const skillsDir = join(projectRoot, ".claude", "skills");
  await mkdir(skillsDir, { recursive: true });

  // Create installed skills on disk
  for (const skillName of ["code", "test"]) {
    await mkdir(join(skillsDir, skillName), { recursive: true });
    await writeFile(
      join(skillsDir, skillName, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: ${skillName} skill\n---\n# ${skillName}`,
    );
  }

  return projectRoot;
}

afterAll(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------

describe("pinOperation", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await setupProject("pin-" + Date.now());
    await writeManifest(projectRoot);
    await writeLockFile(projectRoot, createTestLockFile());
  });

  it("pins a git-sourced skill to its revision", async () => {
    const result = await pinOperation(projectRoot, "code");
    expect(result.pinned).toBe("code");
    expect(result.revision).toBe("abc123def456");
    expect(result.source).toBe("team");

    // Verify manifest was updated
    const manifest = await readManifest(projectRoot);
    expect(manifest.overrides.code?.revision).toBe("abc123def456");
    expect(manifest.overrides.code?.sourceName).toBe("team");
  });

  it("does not overwrite existing installMode override", async () => {
    await writeManifest(projectRoot, { code: { install_mode: "copy" } });
    const result = await pinOperation(projectRoot, "code");
    expect(result.pinned).toBe("code");

    const manifest = await readManifest(projectRoot);
    expect(manifest.overrides.code?.installMode).toBe("copy");
    expect(manifest.overrides.code?.revision).toBe("abc123def456");
  });

  it("throws for local sources without revision", async () => {
    await expect(pinOperation(projectRoot, "test")).rejects.toThrow(
      /sourced from local/,
    );
  });

  it("throws when no lock file exists", async () => {
    const emptyRoot = await setupProject("pin-no-lock-" + Date.now());
    await writeManifest(emptyRoot);
    await expect(pinOperation(emptyRoot, "code")).rejects.toThrow(
      /No lock file/,
    );
  });

  it("throws for non-installed skill", async () => {
    await expect(pinOperation(projectRoot, "nonexistent")).rejects.toThrow(
      /not installed/,
    );
  });
});

// ---------------------------------------------------------------------------
// Unpin
// ---------------------------------------------------------------------------

describe("unpinOperation", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await setupProject("unpin-" + Date.now());
    await writeLockFile(projectRoot, createTestLockFile());
  });

  it("removes revision pin while preserving installMode", async () => {
    await writeManifest(projectRoot, {
      code: { install_mode: "copy", revision: "abc123def456", source_name: "team" },
    });

    const result = await unpinOperation(projectRoot, "code");
    expect(result.unpinned).toBe("code");

    const manifest = await readManifest(projectRoot);
    expect(manifest.overrides.code?.installMode).toBe("copy");
    expect(manifest.overrides.code?.revision).toBeUndefined();
    expect(manifest.overrides.code?.sourceName).toBeUndefined();
  });

  it("removes entire override when only revision fields exist", async () => {
    await writeManifest(projectRoot, {
      code: { revision: "abc123def456", source_name: "team" },
    });

    const result = await unpinOperation(projectRoot, "code");
    expect(result.unpinned).toBe("code");

    const manifest = await readManifest(projectRoot);
    expect(manifest.overrides.code).toBeUndefined();
  });

  it("returns unpinned=false for non-pinned skill", async () => {
    await writeManifest(projectRoot);

    const result = await unpinOperation(projectRoot, "code");
    expect(result.unpinned).toBe(false);
    expect(result.message).toContain("not pinned");
  });

  it("returns unpinned=false when override exists but has no revision", async () => {
    await writeManifest(projectRoot, { code: { install_mode: "copy" } });

    const result = await unpinOperation(projectRoot, "code");
    expect(result.unpinned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

describe("pruneOperation", () => {
  it("returns empty when nothing to prune", async () => {
    const projectRoot = await setupProject("prune-empty-" + Date.now());
    await writeManifest(projectRoot);
    await writeLockFile(projectRoot, createTestLockFile());

    const result = await pruneOperation(projectRoot);
    expect(result.pruned).toEqual([]);
    expect(result.dryRun).toBe(false);
  });

  it("identifies skills to prune in dry run", async () => {
    const projectRoot = await setupProject("prune-dry-" + Date.now());

    // Manifest only declares "code", but lock has "code" and "test"
    const manifest: Record<string, unknown> = {
      version: 1,
      sources: [{ name: "team", type: "git", url: "https://github.com/org/skills.git", ref: "main" }],
      skills: ["code"],
      targets: { claude: ".claude/skills" },
      install_mode: "mirror",
    };
    await writeFile(join(projectRoot, "skill-sync.yaml"), stringifyYaml(manifest));
    await writeLockFile(projectRoot, createTestLockFile());

    const result = await pruneOperation(projectRoot, true);
    expect(result.pruned).toContain("test");
    expect(result.dryRun).toBe(true);
  });

  it("returns empty when no lock file exists", async () => {
    const projectRoot = await setupProject("prune-no-lock-" + Date.now());
    await writeManifest(projectRoot);

    const result = await pruneOperation(projectRoot);
    expect(result.pruned).toEqual([]);
  });
});

describe("doctorOperation", () => {
  it("lists all valid local Codex instruction paths when no project file exists", async () => {
    const projectRoot = await setupProject("doctor-codex-no-local-" + Date.now());
    await mkdir(join(projectRoot, ".codex", "skills"), { recursive: true });
    await writeManifest(projectRoot, undefined, { codex: ".codex/skills" });

    const result = await doctorOperation(projectRoot);
    const check = result.checks.find((item) => item.check === "instruction:codex");

    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("AGENTS.md or AGENTS.override.md");
  });

  it("emits unique mirror warnings for multiple mirrored Codex instruction files", async () => {
    const projectRoot = await setupProject("doctor-codex-mirrors-" + Date.now());
    const homeRoot = join(projectRoot, "..", "home");
    const content = "# Shared\nKeep this guidance.\n";
    mockedOs.homeDir = homeRoot;

    await mkdir(join(projectRoot, ".codex", "skills"), { recursive: true });
    await mkdir(join(homeRoot, ".codex"), { recursive: true });
    await writeManifest(projectRoot, undefined, { codex: ".codex/skills" });
    await writeFile(join(homeRoot, ".codex", "AGENTS.md"), content, "utf8");
    await writeFile(join(projectRoot, "AGENTS.md"), content, "utf8");
    await writeFile(join(projectRoot, "AGENTS.override.md"), content, "utf8");

    const result = await doctorOperation(projectRoot);
    const mirrorChecks = result.checks.filter((item) =>
      item.check.startsWith("instruction:mirror-warning:codex:"),
    );

    expect(mirrorChecks).toHaveLength(2);
    expect(new Set(mirrorChecks.map((item) => item.check)).size).toBe(2);
    expect(mirrorChecks.some((item) => item.message.includes("AGENTS.md"))).toBe(true);
    expect(mirrorChecks.some((item) => item.message.includes("AGENTS.override.md"))).toBe(true);
  });
});
