import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { AGENT_CONFIG_FILE_SPECS } from "../../../src/core/agent-config.js";

const mockedOs = vi.hoisted(() => ({ homeDir: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => mockedOs.homeDir };
});
import { runCli } from "../../../src/cli/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setupWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "skill-sync-agent-config-contract-"));
  const homeDir = join(root, "home");
  const projectRoot = join(root, "project");
  mockedOs.homeDir = homeDir;
  await mkdir(homeDir, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  roots.push(root);
  return { homeDir, projectRoot };
}

async function writeAllFiles(projectRoot: string, homeDir: string) {
  for (const spec of AGENT_CONFIG_FILE_SPECS) {
    const filePath = join(spec.scope === "global" ? homeDir : projectRoot, spec.relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `# ${spec.id}\n`, "utf8");
  }
}

describe("agent-config CLI contract", () => {
  beforeAll(() => {
    expect(typeof runCli).toBe("function");
  });

  it("provides machine-readable capture, validation, drift, and restore behavior", async () => {
    const { homeDir, projectRoot } = await setupWorkspace();
    await writeAllFiles(projectRoot, homeDir);

    const capture = await runCli([
      "agent-config",
      "capture",
      "--json",
      "--project",
      projectRoot,
    ]);
    expect(capture.exitCode).toBe(0);
    expect(JSON.parse(capture.stdout!)).toMatchObject({
      applied: true,
      dryRun: false,
      snapshot: { files: expect.arrayContaining([expect.objectContaining({ id: "global.claude" })]) },
    });

    const clean = await runCli(["agent-config", "validate", "--json", "--project", projectRoot]);
    expect(clean.exitCode).toBe(0);
    expect(JSON.parse(clean.stdout!)).toMatchObject({ ok: true });

    const projectClaude = join(projectRoot, "CLAUDE.md");
    await writeFile(projectClaude, "# Changed\n", "utf8");
    const drift = await runCli(["agent-config", "validate", "--json", "--project", projectRoot]);
    expect(drift.exitCode).toBe(1);
    expect(JSON.parse(drift.stdout!)).toMatchObject({
      ok: false,
      entries: expect.arrayContaining([expect.objectContaining({ id: "project.claude", status: "modified" })]),
    });

    const blocked = await runCli([
      "agent-config",
      "restore",
      "--json",
      "--project",
      projectRoot,
    ]);
    expect(blocked.exitCode).toBe(1);
    expect(JSON.parse(blocked.stdout!)).toMatchObject({
      conflicts: expect.arrayContaining([expect.objectContaining({ id: "project.claude", reason: "modified" })]),
    });
    expect(await readFile(projectClaude, "utf8")).toBe("# Changed\n");

    const forced = await runCli([
      "agent-config",
      "restore",
      "--force",
      "--json",
      "--project",
      projectRoot,
    ]);
    expect(forced.exitCode).toBe(0);
    expect(JSON.parse(forced.stdout!)).toMatchObject({ forced: ["project.claude"] });
    expect(await readFile(projectClaude, "utf8")).toBe("# project.claude\n");
  });

  it("reports capture dry-run without creating a snapshot", async () => {
    const { homeDir, projectRoot } = await setupWorkspace();
    await writeAllFiles(projectRoot, homeDir);
    const result = await runCli([
      "agent-config",
      "capture",
      "--dry-run",
      "--json",
      "--project",
      projectRoot,
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout!)).toMatchObject({ applied: false, dryRun: true });
    await expect(readFile(join(projectRoot, ".skill-sync", "agent-config", "snapshot.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
