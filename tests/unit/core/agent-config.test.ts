import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENT_CONFIG_FILE_SPECS,
  agentConfigSnapshotPath,
  captureAgentConfig,
  restoreAgentConfig,
  validateAgentConfig,
} from "../../../src/core/agent-config.js";
import { sha256 } from "../../../src/core/hasher.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setupWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "skill-sync-agent-config-"));
  const homeDir = join(root, "home");
  const projectRoot = join(root, "project");
  await mkdir(homeDir, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  roots.push(root);
  return { homeDir, projectRoot };
}

function destination(projectRoot: string, homeDir: string, specId: string): string {
  const spec = AGENT_CONFIG_FILE_SPECS.find((entry) => entry.id === specId)!;
  return join(spec.scope === "global" ? homeDir : projectRoot, spec.relativePath);
}

async function writeFixture(
  projectRoot: string,
  homeDir: string,
  values: Partial<Record<string, string>> = {},
) {
  for (const spec of AGENT_CONFIG_FILE_SPECS) {
    const filePath = destination(projectRoot, homeDir, spec.id);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, values[spec.id] ?? `# ${spec.id}\n`, "utf8");
  }
}

describe("agent-config snapshot model", () => {
  it("captures all six paths with exact payloads and SHA-256 metadata", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    const values = Object.fromEntries(
      AGENT_CONFIG_FILE_SPECS.map((spec) => [spec.id, `# ${spec.id}\nExact bytes.\n`]),
    );
    await writeFixture(projectRoot, homeDir, values);

    const result = await captureAgentConfig({ projectRoot, homeDir });
    expect(result.applied).toBe(true);
    expect(result.snapshot.files).toHaveLength(6);
    expect(result.snapshot.files.every((entry) => entry.state === "present")).toBe(true);

    for (const entry of result.snapshot.files) {
      const payload = await readFile(join(agentConfigSnapshotPath(projectRoot), entry.snapshotPath));
      expect(payload.toString("utf8")).toBe(values[entry.id]);
      expect(entry.sha256).toBe(sha256(payload));
      expect(entry.size).toBe(payload.byteLength);
    }
    expect(await readFile(join(agentConfigSnapshotPath(projectRoot), "snapshot.json"), "utf8")).toContain(
      '"schemaVersion": 1',
    );
    expect(await readFile(join(agentConfigSnapshotPath(projectRoot), ".gitignore"), "utf8")).toBe(
      "*\n!.gitignore\n!snapshot.json\n",
    );

    await writeFile(
      join(agentConfigSnapshotPath(projectRoot), ".gitignore"),
      "# keep local snapshot policy\n",
      "utf8",
    );
    await captureAgentConfig({ projectRoot, homeDir });
    const protectedGitignore = await readFile(
      join(agentConfigSnapshotPath(projectRoot), ".gitignore"),
      "utf8",
    );
    expect(protectedGitignore).toContain("# keep local snapshot policy\n");
    expect(protectedGitignore).toContain("*\n!.gitignore\n!snapshot.json\n");
  });

  it("rejects a modified raw snapshot payload", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir, { "project.claude": "# Original\n" });
    const result = await captureAgentConfig({ projectRoot, homeDir });
    const entry = result.snapshot.files.find((file) => file.id === "project.claude")!;
    await writeFile(join(agentConfigSnapshotPath(projectRoot), entry.snapshotPath), "# Tampered\n", "utf8");

    await expect(validateAgentConfig({ projectRoot, homeDir })).rejects.toThrow(
      "snapshot payload is corrupt",
    );

    await captureAgentConfig({ projectRoot, homeDir });
    await rm(join(agentConfigSnapshotPath(projectRoot), entry.snapshotPath));
    await expect(validateAgentConfig({ projectRoot, homeDir })).rejects.toThrow(
      "snapshot payload is corrupt",
    );
  });

  it("captures global-only and project-only files while preserving missing state", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await mkdir(dirname(destination(projectRoot, homeDir, "global.claude")), { recursive: true });
    await writeFile(destination(projectRoot, homeDir, "global.claude"), "# Global\n", "utf8");
    const globalOnly = await captureAgentConfig({ projectRoot, homeDir });
    expect(globalOnly.snapshot.files.filter((entry) => entry.scope === "global" && entry.state === "present")).toHaveLength(1);
    expect(globalOnly.snapshot.files.filter((entry) => entry.scope === "project" && entry.state === "missing")).toHaveLength(3);
    expect((await validateAgentConfig({ projectRoot, homeDir })).ok).toBe(true);

    await writeFile(destination(projectRoot, homeDir, "project.gemini"), "# Project\n", "utf8");
    const projectOnly = await captureAgentConfig({ projectRoot, homeDir });
    expect(projectOnly.snapshot.files.find((entry) => entry.id === "project.gemini")?.state).toBe("present");
    expect(projectOnly.snapshot.files.filter((entry) => entry.scope === "global" && entry.state === "missing")).toHaveLength(2);
  });

  it("reports identical content as clean and changed content as drift", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    const identical = "# Shared\nSame exact bytes.\n";
    await writeFixture(projectRoot, homeDir, {
      "global.claude": identical,
      "project.claude": identical,
    });
    await captureAgentConfig({ projectRoot, homeDir });
    expect((await validateAgentConfig({ projectRoot, homeDir })).ok).toBe(true);

    await writeFile(destination(projectRoot, homeDir, "project.claude"), "# Changed\n", "utf8");
    await rm(destination(projectRoot, homeDir, "global.codex"));
    const report = await validateAgentConfig({ projectRoot, homeDir });
    expect(report.ok).toBe(false);
    expect(report.entries.find((entry) => entry.id === "project.claude")?.status).toBe("modified");
    expect(report.entries.find((entry) => entry.id === "global.codex")?.status).toBe("missing");
  });

  it("restores a missing file and leaves unchanged files alone", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir, { "project.codex": "# Codex project\n" });
    await captureAgentConfig({ projectRoot, homeDir });
    await rm(destination(projectRoot, homeDir, "project.codex"));

    const result = await restoreAgentConfig({ projectRoot, homeDir });
    expect(result.conflicts).toEqual([]);
    expect(result.restored).toContain("project.codex");
    expect(await readFile(destination(projectRoot, homeDir, "project.codex"), "utf8")).toBe(
      "# Codex project\n",
    );
    expect((await validateAgentConfig({ projectRoot, homeDir })).ok).toBe(true);
  });

  it("refuses a modified destination and force restores it explicitly", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir, { "global.gemini": "# Original\n" });
    await captureAgentConfig({ projectRoot, homeDir });
    const filePath = destination(projectRoot, homeDir, "global.gemini");
    await writeFile(filePath, "# User edit\n", "utf8");

    const blocked = await restoreAgentConfig({ projectRoot, homeDir });
    expect(blocked.applied).toBe(false);
    expect(blocked.conflicts[0]?.reason).toBe("modified");
    expect(await readFile(filePath, "utf8")).toBe("# User edit\n");

    const forced = await restoreAgentConfig({ projectRoot, homeDir, force: true });
    expect(forced.conflicts).toEqual([]);
    expect(forced.forced).toContain("global.gemini");
    expect(await readFile(filePath, "utf8")).toBe("# Original\n");
  });

  it("does not delete a file that was missing at capture", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await captureAgentConfig({ projectRoot, homeDir });
    const filePath = destination(projectRoot, homeDir, "project.claude");
    await writeFile(filePath, "# Added later\n", "utf8");

    const result = await restoreAgentConfig({ projectRoot, homeDir, force: true });
    expect(result.conflicts[0]?.reason).toBe("snapshot-missing");
    expect(await readFile(filePath, "utf8")).toBe("# Added later\n");
  });

  it("dry-runs capture and restore without writing destinations", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir, { "project.claude": "# Project\n" });
    const capture = await captureAgentConfig({ projectRoot, homeDir, dryRun: true });
    expect(capture.applied).toBe(false);
    await expect(readFile(join(agentConfigSnapshotPath(projectRoot), "snapshot.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(projectRoot, ".skill-sync"))).rejects.toMatchObject({ code: "ENOENT" });

    await captureAgentConfig({ projectRoot, homeDir });
    await rm(destination(projectRoot, homeDir, "project.claude"));
    const restore = await restoreAgentConfig({ projectRoot, homeDir, dryRun: true });
    expect(restore.applied).toBe(false);
    await expect(readFile(destination(projectRoot, homeDir, "project.claude"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stages every payload before apply so a staging failure changes no destination", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir, { "global.claude": "# Claude\n" });
    await captureAgentConfig({ projectRoot, homeDir });
    await rm(destination(projectRoot, homeDir, "global.claude"));
    await rm(join(homeDir, ".codex"), { recursive: true, force: true });
    await writeFile(join(homeDir, ".codex"), "not a directory", "utf8");
    await expect(restoreAgentConfig({ projectRoot, homeDir })).rejects.toThrow(
      "no destinations were changed",
    );
    await expect(readFile(destination(projectRoot, homeDir, "global.claude"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects overlapping operations while another process owns the lock", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir);
    const lockPath = join(projectRoot, ".skill-sync", "agent-config.lock");
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

    await expect(captureAgentConfig({ projectRoot, homeDir })).rejects.toThrow(
      "Another agent-config operation",
    );
  });

  it("recovers an interrupted restore journal before validating", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir, { "project.claude": "# Project\n" });
    await captureAgentConfig({ projectRoot, homeDir });

    const destinationPath = destination(projectRoot, homeDir, "project.claude");
    const stagePath = join(projectRoot, ".CLAUDE.md.agent-config-00000000.tmp");
    const journalPath = join(agentConfigSnapshotPath(projectRoot), ".restore-journal.json");
    const expected = Buffer.from("# Project\n", "utf8");
    await writeFile(
      journalPath,
      `${JSON.stringify({
        schemaVersion: 1,
        phase: "applying",
        createdAt: new Date().toISOString(),
        entries: [
          {
            id: "project.claude",
            destination: destinationPath,
            stagePath,
            expectedSha256: sha256(expected),
            existed: false,
            backupMoved: false,
            installed: true,
          },
        ],
      })}\n`,
      "utf8",
    );

    const report = await validateAgentConfig({ projectRoot, homeDir });
    expect(report.entries.find((entry) => entry.id === "project.claude")?.status).toBe("missing");
    await expect(readFile(destinationPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a restore journal that points outside the allowlist", async () => {
    const { projectRoot, homeDir } = await setupWorkspace();
    await writeFixture(projectRoot, homeDir, { "project.claude": "# Project\n" });
    await captureAgentConfig({ projectRoot, homeDir });

    const destinationPath = destination(projectRoot, homeDir, "project.claude");
    const journalPath = join(agentConfigSnapshotPath(projectRoot), ".restore-journal.json");
    await writeFile(
      journalPath,
      `${JSON.stringify({
        schemaVersion: 1,
        phase: "applying",
        createdAt: new Date().toISOString(),
        entries: [
          {
            id: "project.claude",
            destination: join(projectRoot, "outside.md"),
            stagePath: join(projectRoot, ".outside.md.agent-config-00000000.tmp"),
            expectedSha256: sha256(Buffer.from("# Project\n", "utf8")),
            existed: false,
            backupMoved: false,
            installed: true,
          },
        ],
      })}\n`,
      "utf8",
    );

    await expect(validateAgentConfig({ projectRoot, homeDir })).rejects.toThrow(
      "Invalid agent-config restore journal destination",
    );
    expect(await readFile(destinationPath, "utf8")).toBe("# Project\n");
  });
});
