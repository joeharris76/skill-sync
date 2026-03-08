import { describe, it, expect } from "vitest";
import { runCli } from "../../../src/cli/index.js";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../../../src/core/hasher.js";

describe("runCli", () => {
  it("returns help text for --help", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skillsync");
    expect(result.stdout).toContain("sync");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("validate");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("pin");
    expect(result.stdout).toContain("unpin");
    expect(result.stdout).toContain("prune");
    expect(result.stdout).toContain("promote");
  });

  it("returns help text for 'help' command", async () => {
    const result = await runCli(["help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Commands:");
  });

  it("returns command-specific help", async () => {
    const result = await runCli(["help", "sync"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sync skills");
    expect(result.stdout).toContain("--dry-run");
  });

  it("returns version", async () => {
    const result = await runCli(["version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("returns error for unknown commands", async () => {
    const result = await runCli(["nonexistent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });

  it("explains install modes in help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("mirror");
    expect(result.stdout).toContain("copy");
    expect(result.stdout).toContain("symlink");
  });

  it("sync --dry-run --json returns valid JSON without manifest", async () => {
    const result = await runCli(["sync", "--dry-run", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed).toHaveProperty("install");
    expect(parsed).toHaveProperty("unchanged");
  });

  it("status --json returns valid JSON without manifest", async () => {
    const result = await runCli(["status", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed).toHaveProperty("skills");
  });

  it("validate --json returns valid JSON without manifest", async () => {
    const result = await runCli(["validate", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed).toHaveProperty("valid");
    expect(parsed).toHaveProperty("diagnostics");
  });

  it("doctor returns structured diagnostics", async () => {
    const result = await runCli(["doctor", "--json"]);
    // Doctor without a manifest will flag it
    const parsed = JSON.parse(result.stdout!);
    expect(parsed).toHaveProperty("checks");
    expect(Array.isArray(parsed.checks)).toBe(true);
  });

  it("promote provides guidance", async () => {
    const result = await runCli(["promote", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed.automated).toBe(false);
    expect(parsed.steps.length).toBeGreaterThan(0);
  });

  it("pin requires a skill name", async () => {
    const result = await runCli(["pin"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage");
  });

  it("unpin requires a skill name", async () => {
    const result = await runCli(["unpin"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage");
  });

  it("pin stores the locked git revision in manifest overrides", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-pin-"));
    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: team",
        "    type: git",
        "    url: https://example.com/skills.git",
        "    ref: main",
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skillsync.lock"),
      JSON.stringify(
        {
          version: 1,
          lockedAt: "2026-03-07T10:00:00Z",
          skills: {
            code: {
              source: {
                type: "git",
                name: "team",
                url: "https://example.com/skills.git",
                ref: "main",
                revision: "abc123def456",
                fetchedAt: "2026-03-07T10:00:00Z",
              },
              installMode: "mirror",
              files: {
                "SKILL.md": { sha256: "sha", size: 10 },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCli(["pin", "code", "--project", projectRoot]);
    const manifest = await readFile(join(projectRoot, "skillsync.yaml"), "utf8");

    expect(result.exitCode).toBe(0);
    expect(manifest).toContain("source_name: team");
    expect(manifest).toContain("revision: abc123def456");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("validate fails on unimplemented registry sources", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-validate-"));
    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: community",
        "    type: registry",
        "    registry: npm",
        "skills: []",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["validate", "--json", "--exit-code", "--project", projectRoot]);
    const parsed = JSON.parse(result.stdout ?? "{}");

    expect(result.exitCode).toBe(1);
    expect(parsed.diagnostics.some((item: { rule: string }) => item.rule === "unsupported-source-type")).toBe(true);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync materializes skills and config to every configured target", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-sync-"));
    const sourceRoot = join(projectRoot, "source-skills");
    const skillRoot = join(sourceRoot, "code");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      [
        "---",
        "name: code",
        "description: Code skill",
        "---",
        "",
        "# Code",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(skillRoot, "skill.yaml"),
      [
        "config_inputs:",
        "  - key: code.verify",
        "    type: string",
        "    description: Verification command",
        "    default: npm test",
        "targets:",
        "  claude: true",
        "  codex: true",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(skillRoot, "references", "compare.md"), "# Compare\n", "utf8");
    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: local",
        `    type: local`,
        `    path: ${sourceRoot}`,
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "  codex: .codex/skills",
        "install_mode: mirror",
        "config:",
        "  code:",
        "    verify: npm run test:run",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["sync", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(projectRoot, ".claude/skills/code/SKILL.md"), "utf8")).toContain("name: code");
    expect(await readFile(join(projectRoot, ".codex/skills/code/SKILL.md"), "utf8")).toContain("name: code");
    expect(await readFile(join(projectRoot, ".claude/skills/skillsync.config.yaml"), "utf8")).toContain("verify: npm run test:run");
    expect(await readFile(join(projectRoot, ".codex/skills/skillsync.config.yaml"), "utf8")).toContain("verify: npm run test:run");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync detects conflicts on non-primary targets", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-multi-target-"));
    const sourceRoot = join(projectRoot, "source-skills");
    const skillRoot = join(sourceRoot, "code");
    await mkdir(skillRoot, { recursive: true });

    const upstream = ["---", "name: code", "description: Code skill", "---", "", "# Code v2"].join("\n");
    const previous = "# Code v1\n";
    await writeFile(join(skillRoot, "SKILL.md"), upstream, "utf8");

    const claudeSkillDir = join(projectRoot, ".claude/skills/code");
    const codexSkillDir = join(projectRoot, ".codex/skills/code");
    await mkdir(claudeSkillDir, { recursive: true });
    await mkdir(codexSkillDir, { recursive: true });
    await writeFile(join(claudeSkillDir, "SKILL.md"), previous, "utf8");
    await writeFile(join(codexSkillDir, "SKILL.md"), "# Locally modified\n", "utf8");

    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: local",
        `    type: local`,
        `    path: ${sourceRoot}`,
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "  codex: .codex/skills",
        "install_mode: mirror",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      join(projectRoot, "skillsync.lock"),
      JSON.stringify(
        {
          version: 1,
          lockedAt: "2026-03-07T10:00:00Z",
          skills: {
            code: {
              source: { type: "local", name: "local", fetchedAt: "2026-03-06T10:00:00Z" },
              installMode: "mirror",
              files: {
                "SKILL.md": { sha256: sha256(previous), size: Buffer.byteLength(previous) },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCli(["sync", "--project", projectRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("conflict");
    expect(result.stderr).toContain("skillsync promote");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync honors pinned source_name when multiple sources contain the same skill", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-pinned-source-"));
    const personalRoot = join(projectRoot, "personal-skills");
    const teamRoot = join(projectRoot, "team-skills");
    await mkdir(join(personalRoot, "code"), { recursive: true });
    await mkdir(join(teamRoot, "code"), { recursive: true });

    await writeFile(
      join(personalRoot, "code", "SKILL.md"),
      ["---", "name: code", "description: Personal code skill", "---", "", "# Personal code"].join("\n"),
      "utf8",
    );
    await writeFile(
      join(teamRoot, "code", "SKILL.md"),
      ["---", "name: code", "description: Team code skill", "---", "", "# Team code"].join("\n"),
      "utf8",
    );

    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: personal",
        "    type: local",
        `    path: ${personalRoot}`,
        "  - name: team",
        "    type: local",
        `    path: ${teamRoot}`,
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "overrides:",
        "  code:",
        "    source_name: team",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["sync", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(projectRoot, ".claude/skills/code/SKILL.md"), "utf8")).toContain("Team code");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync --force overwrites conflicting skills", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-force-"));
    const sourceRoot = join(projectRoot, "source-skills");
    const skillRoot = join(sourceRoot, "code");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      ["---", "name: code", "description: Code skill", "---", "", "# Code v2 (upstream)"].join("\n"),
      "utf8",
    );

    // Pre-create installed skill with local modifications
    const claudeSkillDir = join(projectRoot, ".claude/skills/code");
    await mkdir(claudeSkillDir, { recursive: true });
    await writeFile(join(claudeSkillDir, "SKILL.md"), "# Code v1 (locally modified)\n", "utf8");

    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: local",
        `    type: local`,
        `    path: ${sourceRoot}`,
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "install_mode: mirror",
        "",
      ].join("\n"),
      "utf8",
    );

    // Create lock with different hash than what's on disk (triggers drift)
    // and different from source (triggers upstream change)
    await writeFile(
      join(projectRoot, "skillsync.lock"),
      JSON.stringify(
        {
          version: 1,
          lockedAt: "2026-03-07T10:00:00Z",
          skills: {
            code: {
              source: { type: "local", name: "local", fetchedAt: "2026-03-06T10:00:00Z" },
              installMode: "mirror",
              files: {
                "SKILL.md": { sha256: "original-lock-hash", size: 10 },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    // Without --force: should block
    const blocked = await runCli(["sync", "--project", projectRoot]);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain("conflict");
    expect(blocked.stderr).toContain("skillsync promote");

    // With --force: should succeed and overwrite
    const forced = await runCli(["sync", "--force", "--project", projectRoot]);
    expect(forced.exitCode).toBe(0);
    const installed = await readFile(join(projectRoot, ".claude/skills/code/SKILL.md"), "utf8");
    expect(installed).toContain("Code v2 (upstream)");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync conflict --json includes conflicts array and promote guidance", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-conflict-json-"));
    const sourceRoot = join(projectRoot, "source-skills");
    const skillRoot = join(sourceRoot, "code");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      ["---", "name: code", "description: Code skill", "---", "", "# Code v2"].join("\n"),
      "utf8",
    );

    const claudeSkillDir = join(projectRoot, ".claude/skills/code");
    await mkdir(claudeSkillDir, { recursive: true });
    await writeFile(join(claudeSkillDir, "SKILL.md"), "# Locally modified\n", "utf8");

    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: local",
        `    type: local`,
        `    path: ${sourceRoot}`,
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      join(projectRoot, "skillsync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: "2026-03-07T10:00:00Z",
        skills: {
          code: {
            source: { type: "local", name: "local", fetchedAt: "2026-03-06T10:00:00Z" },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "original-hash", size: 10 } },
          },
        },
      }, null, 2),
      "utf8",
    );

    const result = await runCli(["sync", "--json", "--project", projectRoot]);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed.error).toBe("conflicts");
    expect(parsed.conflicts).toHaveLength(1);
    expect(parsed.conflicts[0].name).toBe("code");
    expect(result.stderr).toContain("skillsync promote");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("doctor reports drift per target", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skillsync-cli-doctor-"));
    await mkdir(join(projectRoot, ".claude/skills/code"), { recursive: true });
    await mkdir(join(projectRoot, ".codex/skills"), { recursive: true });
    await writeFile(join(projectRoot, ".claude/skills/code/SKILL.md"), "# Code\n", "utf8");
    await writeFile(
      join(projectRoot, "skillsync.yaml"),
      [
        "version: 1",
        "sources: []",
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "  codex: .codex/skills",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skillsync.lock"),
      JSON.stringify(
        {
          version: 1,
          lockedAt: "2026-03-06T10:30:00Z",
          skills: {
            code: {
              source: { type: "local", name: "local", fetchedAt: "2026-03-06T10:00:00Z" },
              installMode: "mirror",
              files: {
                "SKILL.md": {
                  sha256: "wrong",
                  size: 7,
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runCli(["doctor", "--json", "--project", projectRoot]);
    const parsed = JSON.parse(result.stdout ?? "{}");

    expect(result.exitCode).toBe(0);
    expect(parsed.checks.some((item: { check: string }) => item.check === "drift:claude")).toBe(true);
    expect(parsed.checks.some((item: { check: string }) => item.check === "drift:codex")).toBe(true);

    await rm(projectRoot, { recursive: true, force: true });
  });
});
