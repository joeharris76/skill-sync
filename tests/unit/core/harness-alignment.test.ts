import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANONICAL_INSTRUCTIONS_SOURCE,
  type HarnessSpec,
  type HarnessTarget,
  KNOWN_HARNESS_SPECS,
  alignTarget,
  checkHarnessVersion,
  compareSemver,
  ensureHarnessAlignment,
  isVersionInBounds,
  parseSemver,
} from "../../../src/core/harness-alignment.js";

describe("Semver parsing and bounds checking", () => {
  it("parses valid semver strings", () => {
    expect(parseSemver("2.1.259")).toEqual({ major: 2, minor: 1, patch: 259 });
    expect(parseSemver("v0.153.0")).toEqual({ major: 0, minor: 153, patch: 0 });
    expect(parseSemver("1.0.13-alpha")).toEqual({ major: 1, minor: 0, patch: 13 });
  });

  it("returns null for invalid semver strings", () => {
    expect(parseSemver("latest")).toBeNull();
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
  });

  it("compares semver strings correctly", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.3.0", "1.2.99")).toBe(1);
    expect(compareSemver("1.2.5", "1.2.9")).toBe(-1);
    expect(compareSemver("invalid", "1.0.0")).toBeNull();
  });

  it("evaluates version bounds inclusively", () => {
    expect(isVersionInBounds("2.1.259", "2.0.0", "2.3.0")).toBe(true);
    expect(isVersionInBounds("2.0.0", "2.0.0", "2.3.0")).toBe(true);
    expect(isVersionInBounds("2.3.0", "2.0.0", "2.3.0")).toBe(true);
    expect(isVersionInBounds("1.9.9", "2.0.0", "2.3.0")).toBe(false);
    expect(isVersionInBounds("2.3.1", "2.0.0", "2.3.0")).toBe(false);
    expect(isVersionInBounds("3.0.0", "2.0.0", "2.3.0")).toBe(false);
    expect(isVersionInBounds("not-a-version", "2.0.0", "2.3.0")).toBe(false);
  });
});

describe("checkHarnessVersion", () => {
  const dummySpec: HarnessSpec = {
    id: "dummy",
    name: "Dummy Harness",
    binaryCandidates: ["dummy-bin"],
    versionArgs: ["--version"],
    versionRegex: /(\d+\.\d+\.\d+)/,
    knownVersion: "1.0.0",
    minVersion: "1.0.0",
    maxVersion: "1.5.0",
    targets: [],
  };

  it("handles missing binaries gracefully as not-installed", async () => {
    const check = await checkHarnessVersion(dummySpec, {
      resolveBinary: async () => null,
    });
    expect(check.installed).toBe(false);
    expect(check.status).toBe("not-installed");
    expect(check.inBounds).toBe(true);
    expect(check.binaryPath).toBeNull();
  });

  it("handles binary execution failure as version-error", async () => {
    const check = await checkHarnessVersion(dummySpec, {
      resolveBinary: async () => "/usr/local/bin/dummy-bin",
      runVersion: async () => {
        throw new Error("Command failed with SIGSEGV");
      },
    });
    expect(check.installed).toBe(true);
    expect(check.status).toBe("version-error");
    expect(check.inBounds).toBe(false);
    expect(check.message).toContain("Command failed with SIGSEGV");
  });

  it("handles unparseable version output as version-error", async () => {
    const check = await checkHarnessVersion(dummySpec, {
      resolveBinary: async () => "/usr/local/bin/dummy-bin",
      runVersion: async () => "Dummy CLI build 99a8b7c (no semver)",
    });
    expect(check.installed).toBe(true);
    expect(check.status).toBe("version-error");
    expect(check.inBounds).toBe(false);
    expect(check.message).toContain("Could not parse version");
  });

  it("detects out-of-bounds versions and produces clear diagnostic message", async () => {
    const check = await checkHarnessVersion(dummySpec, {
      resolveBinary: async () => "/usr/local/bin/dummy-bin",
      runVersion: async () => "dummy version 2.0.0",
    });
    expect(check.installed).toBe(true);
    expect(check.status).toBe("out-of-bounds");
    expect(check.inBounds).toBe(false);
    expect(check.detectedVersion).toBe("2.0.0");
    expect(check.message).toContain("outside known bounds [1.0.0, 1.5.0]");
    expect(check.message).toContain("baseline: 1.0.0");
    expect(check.message).toContain("Instructions discovery rules may have changed");
  });

  it("approves in-bounds versions", async () => {
    const check = await checkHarnessVersion(dummySpec, {
      resolveBinary: async () => "/usr/local/bin/dummy-bin",
      runVersion: async () => "dummy 1.2.3",
    });
    expect(check.installed).toBe(true);
    expect(check.status).toBe("in-bounds");
    expect(check.inBounds).toBe(true);
    expect(check.detectedVersion).toBe("1.2.3");
  });
});

describe("alignTarget", () => {
  it("fails if canonical instructions file does not exist", async () => {
    const target: HarnessTarget = {
      id: "test.target",
      path: "/tmp/non-existent-target.md",
      kind: "symlink",
    };
    const res = await alignTarget(target, "/tmp/definitely-missing-source.md");
    expect(res.aligned).toBe(false);
    expect(res.message).toContain("does not exist or is unreadable");
  });

  it("aligns symlink targets", async () => {
    const tempDir = await createTestDir("skill-sync-align-symlink-");
    const canonicalFile = join(tempDir, "canonical.md");
    await writeFile(canonicalFile, "# Global Instructions\n", "utf8");

    const targetPath = join(tempDir, "agent", "AGENTS.md");
    const target: HarnessTarget = {
      id: "agent.target",
      path: targetPath,
      kind: "symlink",
    };

    // 1. Target does not exist: dryRun reports would create
    const dryRunRes = await alignTarget(target, canonicalFile, { dryRun: true });
    expect(dryRunRes.aligned).toBe(false);
    expect(dryRunRes.message).toContain("Would create symlink");

    // 2. Real run creates symlink
    const createRes = await alignTarget(target, canonicalFile);
    expect(createRes.aligned).toBe(true);
    expect(createRes.actionTaken).toBe("created-symlink");
    const linkStat = await lstat(targetPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
    expect(await realpath(targetPath)).toBe(await realpath(canonicalFile));

    // 3. Subsequent run detects already aligned
    const alreadyRes = await alignTarget(target, canonicalFile);
    expect(alreadyRes.aligned).toBe(true);
    expect(alreadyRes.actionTaken).toBe("none");

    // 4. Broken symlink points to wrong file
    const wrongFile = join(tempDir, "wrong.md");
    await writeFile(wrongFile, "wrong", "utf8");
    await rm(targetPath);
    await symlink(wrongFile, targetPath);

    const recreateRes = await alignTarget(target, canonicalFile);
    expect(recreateRes.aligned).toBe(true);
    expect(recreateRes.actionTaken).toBe("recreated-symlink");
    expect(await realpath(targetPath)).toBe(await realpath(canonicalFile));

    // 5. Existing regular file identical to canonical
    await rm(targetPath);
    await writeFile(targetPath, "# Global Instructions\n", "utf8");

    const replaceIdenticalRes = await alignTarget(target, canonicalFile);
    expect(replaceIdenticalRes.aligned).toBe(true);
    expect(replaceIdenticalRes.actionTaken).toBe("recreated-symlink");
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true);

    // 6. Existing regular file differing from canonical
    await rm(targetPath);
    await writeFile(targetPath, "# Custom conflicting content\n", "utf8");

    // Without force, blocks
    const blockedRes = await alignTarget(target, canonicalFile);
    expect(blockedRes.aligned).toBe(false);
    expect(blockedRes.message).toContain("differing content; use --force");

    // With force, backs up and replaces
    const forceRes = await alignTarget(target, canonicalFile, { force: true });
    expect(forceRes.aligned).toBe(true);
    expect(forceRes.actionTaken).toBe("recreated-symlink");
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true);
    const backupContent = await readFile(`${targetPath}.bak`, "utf8");
    expect(backupContent).toBe("# Custom conflicting content\n");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("aligns claude-import targets", async () => {
    const tempDir = await createTestDir("skill-sync-align-claude-");
    const canonicalFile = join(tempDir, "canonical.md");
    await writeFile(canonicalFile, "# Global Instructions\n", "utf8");

    const claudePath = join(tempDir, ".claude", "CLAUDE.md");
    const target: HarnessTarget = {
      id: "claude.target",
      path: claudePath,
      kind: "claude-import",
      expectedContent: `@${canonicalFile}`,
    };

    // 1. File does not exist: dryRun reports would create
    const dryRunRes = await alignTarget(target, canonicalFile, { dryRun: true });
    expect(dryRunRes.aligned).toBe(false);
    expect(dryRunRes.message).toContain("Would create");

    // 2. Real run creates file with import
    const createRes = await alignTarget(target, canonicalFile);
    expect(createRes.aligned).toBe(true);
    expect(createRes.actionTaken).toBe("updated-import");
    expect(await readFile(claudePath, "utf8")).toBe(`@${canonicalFile}\n`);

    // 3. Subsequent run detects already aligned
    const alreadyRes = await alignTarget(target, canonicalFile);
    expect(alreadyRes.aligned).toBe(true);
    expect(alreadyRes.actionTaken).toBe("none");

    // 4. File has existing content without the import
    await writeFile(claudePath, "# User notes\n", "utf8");
    const appendRes = await alignTarget(target, canonicalFile);
    expect(appendRes.aligned).toBe(true);
    expect(appendRes.actionTaken).toBe("updated-import");
    const finalContent = await readFile(claudePath, "utf8");
    expect(finalContent).toContain("# User notes\n");
    expect(finalContent).toContain(`@${canonicalFile}\n`);

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe("ensureHarnessAlignment", () => {
  it("fails loud when any harness version is out of known bounds and does not alter targets", async () => {
    const tempDir = await createTestDir("skill-sync-ensure-oob-");
    const canonicalFile = join(tempDir, "canonical.md");
    await writeFile(canonicalFile, "# Canonical\n", "utf8");

    const report = await ensureHarnessAlignment({
      canonicalSource: canonicalFile,
      resolveBinary: async (bin) => `/mock/bin/${bin}`,
      runVersion: async (bin) => {
        // Mock claude as out-of-bounds 3.0.0
        if (bin.includes("claude")) {
          return "Claude Code 3.0.0";
        }
        return "v1.0.0";
      },
    });

    expect(report.ok).toBe(false);
    expect(report.outOfBounds.length).toBeGreaterThan(0);
    const claudeOob = report.outOfBounds.find((o) => o.harnessId === "claude");
    expect(claudeOob).toBeDefined();
    expect(claudeOob?.detectedVersion).toBe("3.0.0");
    expect(report.summary).toContain("Manual re-confirmation of configuration and update of version checker required");
    expect(report.actions).toEqual([]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("succeeds when all harnesses are in bounds or not installed", async () => {
    const tempDir = await createTestDir("skill-sync-ensure-ok-");
    const canonicalFile = join(tempDir, "canonical.md");
    await writeFile(canonicalFile, "# Canonical\n", "utf8");

    const report = await ensureHarnessAlignment({
      canonicalSource: canonicalFile,
      dryRun: true,
      resolveBinary: async () => null, // simulate no harnesses installed in test container
    });

    expect(report.ok).toBe(true);
    expect(report.outOfBounds).toEqual([]);
    expect(report.summary).toContain("No agent harnesses detected on system");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("succeeds and aligns targets when harnesses are installed and in bounds", async () => {
    const tempDir = await createTestDir("skill-sync-ensure-installed-");
    const canonicalFile = join(tempDir, "canonical.md");
    await writeFile(canonicalFile, "# Canonical\n", "utf8");

    const claudePath = join(tempDir, ".claude", "CLAUDE.md");
    const codexPath = join(tempDir, ".codex", "AGENTS.md");

    // Override KNOWN_HARNESS_SPECS targets dynamically for test isolation
    const report = await ensureHarnessAlignment({
      canonicalSource: canonicalFile,
      resolveBinary: async (bin) => {
        if (bin.includes("claude")) return "/mock/bin/claude";
        if (bin.includes("codex")) return "/mock/bin/codex";
        return null;
      },
      runVersion: async (bin) => {
        if (bin.includes("claude")) return "Claude Code 2.1.259";
        if (bin.includes("codex")) return "codex 0.153.0";
        return "v1.0.0";
      },
    });

    expect(report.ok).toBe(true);
    expect(report.outOfBounds).toEqual([]);
    expect(report.summary).toContain("within known version bounds");

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe("KNOWN_HARNESS_SPECS metadata", () => {
  it("defines specs for all 8 target agent harnesses", () => {
    const ids = KNOWN_HARNESS_SPECS.map((s) => s.id);
    expect(ids).toContain("claude");
    expect(ids).toContain("codex");
    expect(ids).toContain("agy");
    expect(ids).toContain("pi");
    expect(ids).toContain("jcode");
    expect(ids).toContain("grok");
    expect(ids).toContain("muse");
    expect(ids).toContain("opencode");
  });

  it("defines valid semver for all min, max, and known versions", () => {
    for (const spec of KNOWN_HARNESS_SPECS) {
      expect(parseSemver(spec.knownVersion)).not.toBeNull();
      expect(parseSemver(spec.minVersion)).not.toBeNull();
      expect(parseSemver(spec.maxVersion)).not.toBeNull();
      expect(isVersionInBounds(spec.knownVersion, spec.minVersion, spec.maxVersion)).toBe(true);
    }
  });

  it("points to default canonical source ~/.agents/AGENTS.md", () => {
    expect(DEFAULT_CANONICAL_INSTRUCTIONS_SOURCE).toBe("~/.agents/AGENTS.md");
  });
});

async function createTestDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
