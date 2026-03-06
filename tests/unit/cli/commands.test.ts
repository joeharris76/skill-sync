import { describe, it, expect } from "vitest";
import { runCli } from "../../../src/cli/index.js";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      join(skillRoot, "skillsync.meta.yaml"),
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
    expect(await readFile(join(projectRoot, ".claude/skills/project-config.yaml"), "utf8")).toContain("verify: npm run test:run");
    expect(await readFile(join(projectRoot, ".codex/skills/project-config.yaml"), "utf8")).toContain("verify: npm run test:run");

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
