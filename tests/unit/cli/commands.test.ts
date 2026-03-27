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
    expect(result.stdout).toContain("skill-sync");
    expect(result.stdout).toContain("sync");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("validate");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("pin");
    expect(result.stdout).toContain("unpin");
    expect(result.stdout).toContain("prune");
    expect(result.stdout).toContain("promote");
    expect(result.stdout).toContain("settings");
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
    expect(parsed).toHaveProperty("targets");
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
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-pin-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
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
      join(projectRoot, "skill-sync.lock"),
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
    const manifest = await readFile(join(projectRoot, "skill-sync.yaml"), "utf8");

    expect(result.exitCode).toBe(0);
    expect(manifest).toContain("source_name: team");
    expect(manifest).toContain("revision: abc123def456");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("validate fails on unimplemented registry sources", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-validate-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
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
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-sync-"));
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
      join(projectRoot, "skill-sync.yaml"),
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
    expect(await readFile(join(projectRoot, ".claude/skills/skill-sync.config.yaml"), "utf8")).toContain("verify: npm run test:run");
    expect(await readFile(join(projectRoot, ".codex/skills/skill-sync.config.yaml"), "utf8")).toContain("verify: npm run test:run");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync detects conflicts on non-primary targets", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-multi-target-"));
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
      join(projectRoot, "skill-sync.yaml"),
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
      join(projectRoot, "skill-sync.lock"),
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
    expect(result.stderr).toContain("skill-sync promote");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync honors pinned source_name when multiple sources contain the same skill", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-pinned-source-"));
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
      join(projectRoot, "skill-sync.yaml"),
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
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-force-"));
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
      join(projectRoot, "skill-sync.yaml"),
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
      join(projectRoot, "skill-sync.lock"),
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
    expect(blocked.stderr).toContain("skill-sync promote");

    // With --force: should succeed and overwrite
    const forced = await runCli(["sync", "--force", "--project", projectRoot]);
    expect(forced.exitCode).toBe(0);
    const installed = await readFile(join(projectRoot, ".claude/skills/code/SKILL.md"), "utf8");
    expect(installed).toContain("Code v2 (upstream)");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("sync conflict --json includes conflicts array and promote guidance", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-conflict-json-"));
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
      join(projectRoot, "skill-sync.yaml"),
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
      join(projectRoot, "skill-sync.lock"),
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
    expect(result.stderr).toContain("skill-sync promote");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("doctor reports drift per target", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-doctor-"));
    await mkdir(join(projectRoot, ".claude/skills/code"), { recursive: true });
    await mkdir(join(projectRoot, ".codex/skills"), { recursive: true });
    await writeFile(join(projectRoot, ".claude/skills/code/SKILL.md"), "# Code\n", "utf8");
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
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
      join(projectRoot, "skill-sync.lock"),
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

  it("status includes instruction audit data in JSON and text output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-status-instructions-"));
    await mkdir(join(projectRoot, ".claude/skills"), { recursive: true });
    await writeFile(join(projectRoot, "CLAUDE.md"), "# Project instructions\n", "utf8");
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({ version: 1, lockedAt: "2026-03-25T10:00:00Z", skills: {} }, null, 2),
      "utf8",
    );

    const jsonResult = await runCli(["status", "--json", "--project", projectRoot]);
    const textResult = await runCli(["status", "--project", projectRoot]);
    const parsed = JSON.parse(jsonResult.stdout ?? "{}");

    expect(jsonResult.exitCode).toBe(0);
    expect(Array.isArray(parsed.instructions)).toBe(true);
    expect(parsed.instructions.some((item: { agent: string }) => item.agent === "claude")).toBe(true);
    expect(textResult.stdout).toContain("Instruction Files");
    expect(textResult.stdout).toContain("CLAUDE.md");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("status reports configured instruction paths even when no lock file exists", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-status-instructions-no-lock-"));
    await mkdir(join(projectRoot, ".codex/skills"), { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  codex: .codex/skills",
        "",
      ].join("\n"),
      "utf8",
    );

    const jsonResult = await runCli(["status", "--json", "--project", projectRoot]);
    const textResult = await runCli(["status", "--project", projectRoot]);
    const parsed = JSON.parse(jsonResult.stdout ?? "{}");

    expect(jsonResult.exitCode).toBe(0);
    expect(parsed.locked).toBe(false);
    expect(Array.isArray(parsed.instructions)).toBe(true);
    expect(parsed.instructions.some((item: { agent: string; configured: boolean }) => item.agent === "codex" && item.configured)).toBe(true);
    expect(textResult.stdout).toContain("No lock file found. Run `skill-sync sync` first.");
    expect(textResult.stdout).toContain("Instruction Files");
    expect(textResult.stdout).toContain("AGENTS.md or AGENTS.override.md");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("validate includes instruction diagnostics", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-validate-instructions-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  codex: .codex/skills",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["validate", "--json", "--project", projectRoot]);
    const parsed = JSON.parse(result.stdout ?? "{}");

    expect(result.exitCode).toBe(0);
    expect(
      parsed.diagnostics.some(
        (item: { rule: string; skill?: string }) =>
          item.rule.startsWith("instruction-") && item.skill === "codex",
      ),
    ).toBe(true);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("diff shows planned installs for an unsynced skill", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-diff-"));
    const sourceRoot = join(projectRoot, "source-skills");
    await mkdir(join(sourceRoot, "code"), { recursive: true });
    await writeFile(
      join(sourceRoot, "code", "SKILL.md"),
      ["---", "name: code", "description: Code skill", "---", "", "# Code"].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: local",
        "    type: local",
        `    path: ${sourceRoot}`,
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["diff", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("code");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("diff --json returns structured plan with install/update/remove arrays", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-diff-json-"));
    const sourceRoot = join(projectRoot, "source-skills");
    await mkdir(join(sourceRoot, "code"), { recursive: true });
    await writeFile(
      join(sourceRoot, "code", "SKILL.md"),
      ["---", "name: code", "description: Code skill", "---", "", "# Code"].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: local",
        "    type: local",
        `    path: ${sourceRoot}`,
        "skills:",
        "  - code",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["diff", "--json", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed).toHaveProperty("install");
    expect(parsed).toHaveProperty("update");
    expect(parsed).toHaveProperty("remove");
    expect(parsed.install).toContainEqual(expect.objectContaining({ name: "code" }));

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("diff shows nothing to change when already up to date", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-diff-clean-"));
    const sourceRoot = join(projectRoot, "source-skills");
    await mkdir(join(sourceRoot, "code"), { recursive: true });
    const skillContent = ["---", "name: code", "description: Code skill", "---", "", "# Code"].join("\n");
    await writeFile(join(sourceRoot, "code", "SKILL.md"), skillContent, "utf8");
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources:",
        "  - name: local",
        "    type: local",
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

    // First sync to install
    await runCli(["sync", "--project", projectRoot]);

    // Diff should show nothing
    const result = await runCli(["diff", "--json", "--project", projectRoot]);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed.install).toHaveLength(0);
    expect(parsed.update).toHaveLength(0);
    expect(parsed.remove).toHaveLength(0);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("prune --dry-run reports skills to remove without deleting them", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-prune-dry-"));
    const skillsDir = join(projectRoot, ".claude", "skills", "obsolete");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, "SKILL.md"), "---\nname: obsolete\ndescription: old\n---\n", "utf8");

    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: "2026-03-26T10:00:00Z",
        skills: {
          obsolete: {
            source: { type: "local", name: "local", fetchedAt: "2026-03-26T10:00:00Z" },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "abc", size: 10 } },
          },
        },
      }, null, 2),
      "utf8",
    );

    const result = await runCli(["prune", "--dry-run", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("obsolete");
    // Files still present (dry run)
    const { existsSync } = await import("node:fs");
    expect(existsSync(skillsDir)).toBe(true);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("prune removes undeclared skills from disk and lock", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-prune-"));
    const skillsDir = join(projectRoot, ".claude", "skills", "obsolete");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, "SKILL.md"), "---\nname: obsolete\ndescription: old\n---\n", "utf8");

    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: "2026-03-26T10:00:00Z",
        skills: {
          obsolete: {
            source: { type: "local", name: "local", fetchedAt: "2026-03-26T10:00:00Z" },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: "abc", size: 10 } },
          },
        },
      }, null, 2),
      "utf8",
    );

    const result = await runCli(["prune", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("obsolete");
    const { existsSync } = await import("node:fs");
    expect(existsSync(skillsDir)).toBe(false);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("prune --json outputs structured result", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-prune-json-"));
    await mkdir(join(projectRoot, ".claude", "skills"), { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources: []\nskills: []\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );

    const result = await runCli(["prune", "--json", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed).toHaveProperty("pruned");
    expect(Array.isArray(parsed.pruned)).toBe(true);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("prune reports nothing to prune when everything is clean", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-prune-clean-"));
    await mkdir(join(projectRoot, ".claude", "skills"), { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources: []\nskills: []\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );

    const result = await runCli(["prune", "--project", projectRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Nothing to prune");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("pin returns error text when skill is not installed", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-pin-error-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources:\n  - name: team\n    type: git\n    url: https://example.com/skills.git\n    ref: main\nskills:\n  - code\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({ version: 1, lockedAt: new Date().toISOString(), skills: {} }, null, 2),
      "utf8",
    );

    const result = await runCli(["pin", "code", "--project", projectRoot]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not installed");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("unpin removes revision pin and reports success", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-unpin-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
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
        "overrides:",
        "  code:",
        "    source_name: team",
        "    revision: abc123def456",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["unpin", "code", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("code");

    const manifest = await readFile(join(projectRoot, "skill-sync.yaml"), "utf8");
    expect(manifest).not.toContain("revision");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("unpin --json reports not-pinned for unpinned skill", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-unpin-json-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources: []\nskills: []\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );

    const result = await runCli(["unpin", "code", "--json", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed.unpinned).toBe(false);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("unpin text mode reports not-pinned for unpinned skill", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-unpin-text-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources: []\nskills: []\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );

    const result = await runCli(["unpin", "code", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("not pinned");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("doctor text mode formats checks with icons", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-doctor-text-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources:\n  - name: local\n    type: local\n    path: /tmp\nskills: []\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );

    const result = await runCli(["doctor", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    // Text mode should include status icons
    expect(result.stdout).toMatch(/\[(OK|!!|XX)\]/);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("status text mode renders skill table when skills are installed", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-status-text-"));
    const skillDir = join(projectRoot, ".claude", "skills", "code");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: code\ndescription: Code skill\n---\n# Code\n", "utf8");
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources: []\nskills:\n  - code\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({
        version: 1,
        lockedAt: new Date().toISOString(),
        skills: {
          code: {
            source: { type: "local", name: "local", fetchedAt: new Date().toISOString() },
            installMode: "mirror",
            files: { "SKILL.md": { sha256: sha256(Buffer.from("---\nname: code\ndescription: Code skill\n---\n# Code\n")), size: 10 } },
          },
        },
      }, null, 2),
      "utf8",
    );

    const result = await runCli(["status", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Target:");
    expect(result.stdout).toContain("code");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("status text mode renders expected instruction path when no file exists for claude target", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-status-no-inst-"));
    await mkdir(join(projectRoot, ".claude", "skills"), { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources: []\nskills: []\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({ version: 1, lockedAt: new Date().toISOString(), skills: {} }, null, 2),
      "utf8",
    );
    // No CLAUDE.md present — should show expected path

    const result = await runCli(["status", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CLAUDE.md");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("validate text mode returns 'Validation passed' when no issues found", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-validate-text-"));
    await mkdir(join(projectRoot, ".claude", "skills"), { recursive: true });
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources:\n  - name: local\n    type: local\n    path: /tmp\nskills: []\ntargets:\n  claude: .claude/skills\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "skill-sync.lock"),
      JSON.stringify({ version: 1, lockedAt: new Date().toISOString(), skills: {} }, null, 2),
      "utf8",
    );

    const result = await runCli(["validate", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Validation passed");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("validate text mode renders diagnostics when warnings exist", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-validate-warn-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      "version: 1\nsources:\n  - name: local\n    type: local\n    path: /tmp\nskills: []\ntargets:\n  claude: .claude/skills\ninstall_mode: symlink\n",
      "utf8",
    );

    const result = await runCli(["validate", "--project", projectRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/warn|WARN/i);

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("doctor includes instruction checks for configured targets", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-cli-doctor-instructions-"));
    await writeFile(
      join(projectRoot, "skill-sync.yaml"),
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  claude: .claude/skills",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runCli(["doctor", "--json", "--project", projectRoot]);
    const parsed = JSON.parse(result.stdout ?? "{}");

    expect(result.exitCode).toBe(0);
    expect(
      parsed.checks.some((item: { check: string }) => item.check === "instruction:claude"),
    ).toBe(true);

    await rm(projectRoot, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// settings command
// ---------------------------------------------------------------------------

describe("skill-sync settings", () => {
  it("returns usage and exit 1 when no subcommand given", async () => {
    const result = await runCli(["settings"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("generate");
  });

  it("returns usage and exit 1 for unknown subcommand", async () => {
    const result = await runCli(["settings", "unknown"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("generate");
  });

  it("settings generate returns satisfied message when no manifest exists", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-settings-test-"));
    try {
      const result = await runCli(["settings", "generate", "--project", projectRoot]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("satisfied");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("settings generate --json returns structured result", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-settings-json-"));
    try {
      const result = await runCli(["settings", "generate", "--json", "--project", projectRoot]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout ?? "{}");
      expect(parsed).toHaveProperty("agent", "claude");
      expect(parsed).toHaveProperty("missingCount");
      expect(parsed).toHaveProperty("suggestedFragment");
      expect(parsed).toHaveProperty("gaps");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("settings generate --agent sets the agent field in JSON output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "skill-sync-settings-agent-"));
    try {
      const result = await runCli([
        "settings", "generate", "--agent", "codex", "--json", "--project", projectRoot,
      ]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout ?? "{}");
      expect(parsed.agent).toBe("codex");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
