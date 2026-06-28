import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateConfig, writeProjectConfig } from "../../../src/core/config-generator.js";
import { hashSkillDirectory } from "../../../src/core/hasher.js";
import { loadSkillPackage } from "../../../src/core/parser.js";
import type { LockFile, Manifest, TargetConfig } from "../../../src/core/types.js";
import { verifyTrackedTargets } from "../../../src/core/verify.js";

let projectRoot: string;
let targetRoot: string;

const SKILL_MD = ["---", "name: code", "description: Code skill", "---", "", "# Code"].join("\n");

function manifestWith(target: TargetConfig, config: Manifest["config"] = {}): Manifest {
  return {
    version: 1,
    sources: [],
    skills: ["code"],
    targets: { claude: target },
    installMode: "mirror",
    config,
    overrides: {},
    hooks: { beforeSync: [] },
    projectRegistry: { autoRegister: true, includeWorktrees: false },
  };
}

async function lockFromDisk(): Promise<LockFile> {
  const files = await hashSkillDirectory(join(targetRoot, "code"));
  return {
    version: 1,
    lockedAt: "2026-01-01T00:00:00.000Z",
    skills: {
      code: {
        source: { type: "local", name: "s", fetchedAt: "2026-01-01T00:00:00.000Z" },
        installMode: "mirror",
        files: Object.fromEntries(files.map((f) => [f.relativePath, { sha256: f.sha256, size: f.size }])),
      },
    },
  };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-verify-"));
  targetRoot = join(projectRoot, ".claude", "skills");
  await mkdir(join(targetRoot, "code"), { recursive: true });
  await writeFile(join(targetRoot, "code", "SKILL.md"), SKILL_MD, "utf-8");
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("verifyTrackedTargets", () => {
  it("passes when the committed snapshot matches the lock", async () => {
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true }),
      await lockFromDisk(),
    );
    expect(report.ok).toBe(true);
    expect(report.checkedTargets).toEqual(["claude"]);
  });

  it("ignores untracked targets entirely (even with drift)", async () => {
    const lock = await lockFromDisk();
    await writeFile(join(targetRoot, "code", "SKILL.md"), "HAND-EDITED", "utf-8");
    const report = await verifyTrackedTargets(projectRoot, manifestWith({ dir: ".claude/skills" }), lock);
    expect(report.ok).toBe(true);
    expect(report.checkedTargets).toEqual([]);
  });

  it("catches a hand-edited committed file", async () => {
    const lock = await lockFromDisk();
    await writeFile(join(targetRoot, "code", "SKILL.md"), `${SKILL_MD}\nTAMPERED`, "utf-8");
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true }),
      lock,
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === "modified-file")).toBe(true);
  });

  it("catches an extra file committed inside a skill (Gap A)", async () => {
    const lock = await lockFromDisk();
    await writeFile(join(targetRoot, "code", "backdoor.md"), "# extra", "utf-8");
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true }),
      lock,
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === "extra-file")).toBe(true);
  });

  it("catches a stray top-level file in the tracked target (Gap C)", async () => {
    const lock = await lockFromDisk();
    await writeFile(join(targetRoot, "NOTES.md"), "# notes", "utf-8");
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true }),
      lock,
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === "stray-path")).toBe(true);
  });

  it("reports a missing skill", async () => {
    const lock = await lockFromDisk();
    await rm(join(targetRoot, "code"), { recursive: true, force: true });
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true }),
      lock,
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === "missing-skill")).toBe(true);
  });

  it("rejects a symlinked skill in a tracked target (Gap D)", async () => {
    const lock = await lockFromDisk();
    // Replace the real dir with a symlink to an external location.
    const external = await mkdtemp(join(tmpdir(), "skill-sync-ext-"));
    await mkdir(join(external, "code"), { recursive: true });
    await writeFile(join(external, "code", "SKILL.md"), SKILL_MD, "utf-8");
    await rm(join(targetRoot, "code"), { recursive: true, force: true });
    await symlink(join(external, "code"), join(targetRoot, "code"));
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true }),
      lock,
    );
    expect(report.issues.some((i) => i.kind === "symlink")).toBe(true);
    await rm(external, { recursive: true, force: true });
  });

  it("skips excluded skills instead of reporting them missing (Gap E)", async () => {
    const lock = await lockFromDisk();
    // Excluded skill is gitignored → legitimately absent in a fresh clone.
    await rm(join(targetRoot, "code"), { recursive: true, force: true });
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true, ignore: ["code"] }),
      lock,
    );
    expect(report.ok).toBe(true);
  });

  it("catches a missing config that should exist (Gap B)", async () => {
    const lock = await lockFromDisk();
    const report = await verifyTrackedTargets(
      projectRoot,
      manifestWith({ dir: ".claude/skills", tracked: true }, { code: { verify: "npm test" } }),
      lock,
    );
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.kind === "missing-config")).toBe(true);
  });

  it("catches a hand-edited config and passes a canonical one (Gap B)", async () => {
    const lock = await lockFromDisk();
    const manifest = manifestWith({ dir: ".claude/skills", tracked: true }, { code: { verify: "npm test" } });

    // Hand-edited / non-canonical config → mismatch.
    await writeFile(join(targetRoot, "skill-sync.config.yaml"), "code:\n  verify: WRONG\n", "utf-8");
    const bad = await verifyTrackedTargets(projectRoot, manifest, lock);
    expect(bad.issues.some((i) => i.kind === "config-mismatch")).toBe(true);

    // Canonical config written exactly as sync would → passes.
    const pkg = await loadSkillPackage(join(targetRoot, "code"));
    const merged = generateConfig({ manifestConfig: manifest.config, installedSkills: [pkg] });
    await writeProjectConfig(targetRoot, merged);
    const good = await verifyTrackedTargets(projectRoot, manifest, lock);
    expect(good.ok).toBe(true);
  });
});
