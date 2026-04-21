import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
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
  syncOperation,
  settingsGenerateOperation,
} from "../../../src/core/operations.js";
import { readManifest } from "../../../src/core/manifest.js";
import { readLockFile, writeLockFile } from "../../../src/core/lock.js";
import type { LockFile } from "../../../src/core/types.js";
import { existsSync } from "node:fs";

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

afterEach(() => {
  mockedOs.homeDir = "";
});

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

// ---------------------------------------------------------------------------
// SyncOperation — local source scenarios
// ---------------------------------------------------------------------------

async function makeLocalSkillSource(root: string, skillName: string, content = `---\nname: ${skillName}\ndescription: ${skillName} skill\n---\n# ${skillName}\n`): Promise<string> {
  const skillDir = join(root, skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content);
  return root;
}

async function makeConsumerProject(name: string, sourceRoot: string, skills: string[]): Promise<string> {
  const projectRoot = join(tmpBase, name);
  await mkdir(projectRoot, { recursive: true });
  const manifest: Record<string, unknown> = {
    version: 1,
    sources: [{ name: "local", type: "local", path: sourceRoot }],
    skills,
    targets: { claude: ".claude/skills" },
    install_mode: "mirror",
  };
  await writeFile(join(projectRoot, "skill-sync.yaml"), stringifyYaml(manifest));
  return projectRoot;
}

describe("syncOperation — skill removal", () => {
  it("removes skills from all targets when removed from manifest", async () => {
    const sourceRoot = join(tmpBase, "removal-source-" + Date.now());
    await mkdir(sourceRoot, { recursive: true });
    await makeLocalSkillSource(sourceRoot, "code");
    await makeLocalSkillSource(sourceRoot, "test");

    const projectRoot = join(tmpBase, "removal-project-" + Date.now());
    await mkdir(projectRoot, { recursive: true });

    // Manifest declares both skills
    const manifestBoth: Record<string, unknown> = {
      version: 1,
      sources: [{ name: "local", type: "local", path: sourceRoot }],
      skills: ["code", "test"],
      targets: { claude: ".claude/skills", codex: ".codex/skills" },
      install_mode: "mirror",
    };
    await writeFile(join(projectRoot, "skill-sync.yaml"), stringifyYaml(manifestBoth));

    // First sync installs both
    await syncOperation({ projectRoot });
    expect(existsSync(join(projectRoot, ".claude", "skills", "code"))).toBe(true);
    expect(existsSync(join(projectRoot, ".codex", "skills", "test"))).toBe(true);

    // Now update manifest to only declare "code"
    const manifestOne: Record<string, unknown> = {
      ...manifestBoth,
      skills: ["code"],
    };
    await writeFile(join(projectRoot, "skill-sync.yaml"), stringifyYaml(manifestOne));

    const result = await syncOperation({ projectRoot });

    expect(result.summary.removed).toContain("test");
    // Removed from both targets
    expect(existsSync(join(projectRoot, ".claude", "skills", "test"))).toBe(false);
    expect(existsSync(join(projectRoot, ".codex", "skills", "test"))).toBe(false);
    // Remaining skill still present
    expect(existsSync(join(projectRoot, ".claude", "skills", "code"))).toBe(true);
    // Lock no longer has "test"
    const lock = await readLockFile(projectRoot);
    expect(lock!.skills["test"]).toBeUndefined();
    expect(lock!.skills["code"]).toBeDefined();
  });
});

describe("syncOperation — skipped skills", () => {
  it("reports skipped when disk already matches source but lock has stale hashes", async () => {
    const sourceRoot = join(tmpBase, "skipped-source-" + Date.now());
    await mkdir(sourceRoot, { recursive: true });

    // Initial source content (version A)
    const versionA = "---\nname: code\ndescription: code skill\n---\n# Version A\n";
    await makeLocalSkillSource(sourceRoot, "code", versionA);

    const projectRoot = await makeConsumerProject("skipped-project-" + Date.now(), sourceRoot, ["code"]);

    // First sync installs version A; lock records version A hashes
    await syncOperation({ projectRoot });

    // Update source to version B
    const versionB = "---\nname: code\ndescription: code skill\n---\n# Version B\n";
    await writeFile(join(sourceRoot, "code", "SKILL.md"), versionB);

    // Manually put version B on disk (as if already applied out-of-band)
    const targetSkillMd = join(projectRoot, ".claude", "skills", "code", "SKILL.md");
    await writeFile(targetSkillMd, versionB);

    // Sync: lock says version A, source is version B, disk is version B → skip
    const result = await syncOperation({ projectRoot });

    expect(result.summary.skipped.length).toBeGreaterThan(0);
    expect(result.summary.skipped[0]!.name).toBe("code");
    expect(result.summary.installed).toHaveLength(0);
    expect(result.summary.updated).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// syncOperation — silent-overwrite regression
// Source unchanged + local target modifications must conflict, not overwrite
// ---------------------------------------------------------------------------

describe("syncOperation — local drift conflict (silent-overwrite regression)", () => {
  it("blocks sync when target has local modifications and source is unchanged", async () => {
    const sourceRoot = join(tmpBase, "lo-source-" + Date.now());
    await mkdir(sourceRoot, { recursive: true });

    const originalContent = "---\nname: code\ndescription: code skill\n---\n# Original\n";
    await makeLocalSkillSource(sourceRoot, "code", originalContent);

    const projectRoot = await makeConsumerProject("lo-blocked-" + Date.now(), sourceRoot, ["code"]);

    // First sync installs and locks the skill
    await syncOperation({ projectRoot });

    // User locally modifies the target skill (e.g. adds a new action)
    const targetSkillMd = join(projectRoot, ".claude", "skills", "code", "SKILL.md");
    await writeFile(targetSkillMd, originalContent + "\n## Local Action\nUser-added content.\n");

    // Source is unchanged — second sync should detect the conflict, not overwrite
    const result = await syncOperation({ projectRoot });

    expect(result.applied).toBe(false);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts!.length).toBeGreaterThan(0);
    expect(result.conflicts![0]!.name).toBe("code");
    expect(result.summary.installed).toHaveLength(0);
    expect(result.summary.updated).toHaveLength(0);
  });

  it("overwrites local modifications when --force is passed", async () => {
    const sourceRoot = join(tmpBase, "lo-force-source-" + Date.now());
    await mkdir(sourceRoot, { recursive: true });

    const originalContent = "---\nname: code\ndescription: code skill\n---\n# Original\n";
    await makeLocalSkillSource(sourceRoot, "code", originalContent);

    const projectRoot = await makeConsumerProject("lo-force-" + Date.now(), sourceRoot, ["code"]);

    await syncOperation({ projectRoot });

    const targetSkillMd = join(projectRoot, ".claude", "skills", "code", "SKILL.md");
    await writeFile(targetSkillMd, originalContent + "\n## Local Action\nUser-added content.\n");

    const result = await syncOperation({ projectRoot, force: true });

    expect(result.applied).toBe(true);
    expect(result.summary.forced).toContain("code");
    expect(result.conflicts).toBeUndefined();
  });
});

describe("syncOperation — registerProjectInSources", () => {
  it("registers the consumer project path in the local source manifest", async () => {
    const sourceRoot = join(tmpBase, "reg-source-" + Date.now());
    await mkdir(sourceRoot, { recursive: true });
    await makeLocalSkillSource(sourceRoot, "code");
    // Give the source its own manifest
    const sourceManifest: Record<string, unknown> = {
      version: 1,
      sources: [],
      skills: ["code"],
      targets: { default: "." },
      install_mode: "mirror",
    };
    await writeFile(join(sourceRoot, "..", "skill-sync.yaml"), stringifyYaml(sourceManifest));

    const projectRoot = await makeConsumerProject("reg-consumer-" + Date.now(), sourceRoot, ["code"]);

    await syncOperation({ projectRoot });

    // Source manifest should now list the consumer project
    const sourceParent = join(sourceRoot, "..");
    const updatedSource = await readManifest(sourceParent);
    expect(updatedSource.projects).toBeDefined();
    expect(updatedSource.projects!.some((p) => p.includes("reg-consumer"))).toBe(true);
  });

  it("does not duplicate project entry on repeated syncs", async () => {
    const sourceRoot = join(tmpBase, "dedup-source-" + Date.now());
    await mkdir(sourceRoot, { recursive: true });
    await makeLocalSkillSource(sourceRoot, "code");
    const sourceManifest: Record<string, unknown> = {
      version: 1,
      sources: [],
      skills: ["code"],
      targets: { default: "." },
      install_mode: "mirror",
    };
    await writeFile(join(sourceRoot, "..", "skill-sync.yaml"), stringifyYaml(sourceManifest));

    const projectRoot = await makeConsumerProject("dedup-consumer-" + Date.now(), sourceRoot, ["code"]);
    const sourceParent = join(sourceRoot, "..");

    // First sync should add the entry
    await syncOperation({ projectRoot });
    const afterFirst = await readManifest(sourceParent);
    const entriesAfterFirst = (afterFirst.projects ?? []).filter((p) => p.includes("dedup-consumer"));
    expect(entriesAfterFirst).toHaveLength(1);

    // Second sync should not add a duplicate
    await syncOperation({ projectRoot });
    const afterSecond = await readManifest(sourceParent);
    const entriesAfterSecond = (afterSecond.projects ?? []).filter((p) => p.includes("dedup-consumer"));
    expect(entriesAfterSecond).toHaveLength(1);
  });

  it("succeeds when local source has no manifest", async () => {
    const sourceRoot = join(tmpBase, "no-manifest-source-" + Date.now());
    await mkdir(sourceRoot, { recursive: true });
    await makeLocalSkillSource(sourceRoot, "code");
    // Deliberately no skill-sync.yaml in parent

    const projectRoot = await makeConsumerProject("no-manifest-consumer-" + Date.now(), sourceRoot, ["code"]);

    const result = await syncOperation({ projectRoot });
    expect(result.applied).toBe(true);
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

  it("warns when installed skills have unmet settings requirements", async () => {
    const projectRoot = await setupProject("doctor-settings-gaps-" + Date.now());
    await writeManifest(projectRoot);
    const lockFile = createTestLockFile();
    await writeLockFile(projectRoot, lockFile);

    // Install a skill with settings_requirements
    const skillsDir = join(projectRoot, ".claude", "skills", "code");
    await writeFile(
      join(skillsDir, "skill.yaml"),
      [
        "tags: []",
        "depends: []",
        "targets:",
        "  claude: true",
        "settings_requirements:",
        "  claude:",
        "    permissions:",
        "      allow:",
        '        - "Bash(git:*)"',
      ].join("\n"),
    );

    // No .claude/settings.json — all requirements are unmet
    const result = await doctorOperation(projectRoot);
    const settingsCheck = result.checks.find((c) =>
      c.check.startsWith("settings-requirements:claude:"),
    );
    expect(settingsCheck?.status).toBe("warn");
    expect(settingsCheck?.message).toContain("Bash(git:*)");
  });

  it("reports ok when installed skills settings requirements are satisfied", async () => {
    const projectRoot = await setupProject("doctor-settings-ok-" + Date.now());
    await writeManifest(projectRoot);
    const lockFile = createTestLockFile();
    await writeLockFile(projectRoot, lockFile);

    // Install a skill with settings_requirements
    const skillsDir = join(projectRoot, ".claude", "skills", "code");
    await writeFile(
      join(skillsDir, "skill.yaml"),
      [
        "tags: []",
        "depends: []",
        "targets:",
        "  claude: true",
        "settings_requirements:",
        "  claude:",
        "    permissions:",
        "      allow:",
        '        - "Bash(git:*)"',
      ].join("\n"),
    );

    // Create settings.json that satisfies the requirement
    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git:*)", "Read"] } }),
    );

    const result = await doctorOperation(projectRoot);
    const settingsCheck = result.checks.find(
      (c) => c.check === "settings-requirements:claude",
    );
    expect(settingsCheck?.status).toBe("ok");
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

// ---------------------------------------------------------------------------
// Settings Generate
// ---------------------------------------------------------------------------

async function setupSettingsProject(name: string): Promise<string> {
  const projectRoot = join(tmpBase, name);
  const skillsDir = join(projectRoot, ".claude", "skills");
  await mkdir(skillsDir, { recursive: true });
  return projectRoot;
}

async function writeSkillWithRequirements(
  skillsDir: string,
  skillName: string,
  allows: string[],
): Promise<void> {
  await mkdir(join(skillsDir, skillName), { recursive: true });
  await writeFile(
    join(skillsDir, skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: ${skillName} skill\n---\n# ${skillName}`,
  );
  await writeFile(
    join(skillsDir, skillName, "skill.yaml"),
    [
      "tags: []",
      "depends: []",
      "targets:",
      "  claude: true",
      "settings_requirements:",
      "  claude:",
      "    permissions:",
      "      allow:",
      ...allows.map((a) => `        - "${a}"`),
    ].join("\n"),
  );
}

describe("settingsGenerateOperation", () => {
  it("returns empty result when no manifest exists", async () => {
    const projectRoot = await setupSettingsProject("settings-no-manifest-" + Date.now());
    const result = await settingsGenerateOperation({ projectRoot });
    expect(result.agent).toBe("claude");
    expect(result.suggestedFragment).toEqual({});
    expect(result.missingCount).toBe(0);
    expect(result.gaps).toEqual([]);
  });

  it("returns missing permissions when settings file is absent", async () => {
    const projectRoot = await setupSettingsProject("settings-missing-" + Date.now());
    const lockFile = createTestLockFile();
    await writeLockFile(projectRoot, lockFile);
    await writeManifest(projectRoot);

    const skillsDir = join(projectRoot, ".claude", "skills");
    await writeSkillWithRequirements(skillsDir, "code", ["Bash(git:*)", "Bash(npm:*)"]);

    const result = await settingsGenerateOperation({ projectRoot });
    expect(result.missingCount).toBe(2);
    expect(result.suggestedFragment.permissions?.allow).toContain("Bash(git:*)");
    expect(result.suggestedFragment.permissions?.allow).toContain("Bash(npm:*)");
    expect(result.totalRequired).toHaveLength(2);
  });

  it("returns only the delta when settings file partially satisfies requirements", async () => {
    const projectRoot = await setupSettingsProject("settings-partial-" + Date.now());
    const lockFile = createTestLockFile();
    await writeLockFile(projectRoot, lockFile);
    await writeManifest(projectRoot);

    const skillsDir = join(projectRoot, ".claude", "skills");
    await writeSkillWithRequirements(skillsDir, "code", ["Bash(git:*)", "Bash(npm:*)"]);

    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git:*)", "Read"] } }),
    );

    const result = await settingsGenerateOperation({ projectRoot });
    expect(result.missingCount).toBe(1);
    expect(result.suggestedFragment.permissions?.allow).toEqual(["Bash(npm:*)"]);
  });

  it("returns empty fragment when all requirements are already satisfied", async () => {
    const projectRoot = await setupSettingsProject("settings-satisfied-" + Date.now());
    const lockFile = createTestLockFile();
    await writeLockFile(projectRoot, lockFile);
    await writeManifest(projectRoot);

    const skillsDir = join(projectRoot, ".claude", "skills");
    await writeSkillWithRequirements(skillsDir, "code", ["Bash(git:*)"]);

    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git:*)", "Read"] } }),
    );

    const result = await settingsGenerateOperation({ projectRoot });
    expect(result.missingCount).toBe(0);
    expect(result.suggestedFragment).toEqual({});
  });

  it("respects the --agent option", async () => {
    const projectRoot = await setupSettingsProject("settings-agent-" + Date.now());
    // No "codex" target in manifest — should return empty result
    await writeManifest(projectRoot);
    const lockFile = createTestLockFile();
    await writeLockFile(projectRoot, lockFile);

    const result = await settingsGenerateOperation({ projectRoot, agent: "codex" });
    expect(result.agent).toBe("codex");
    expect(result.suggestedFragment).toEqual({});
  });
});
