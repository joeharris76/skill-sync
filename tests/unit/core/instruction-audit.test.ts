import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type {
  InstructionAgent,
  InstructionAgentAudit,
  InstructionAuditReport,
} from "../../../src/core/instruction-types.js";

const mockedOs = vi.hoisted(() => ({ homeDir: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockedOs.homeDir,
  };
});

import {
  auditAgentInstructions,
  auditInstructions,
} from "../../../src/core/instruction-audit.js";
import * as core from "../../../src/core/index.js";
import { instructionAuditOperation } from "../../../src/core/operations.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setupAuditWorkspace() {
  const baseRoot = await mkdtemp(join(tmpdir(), "skill-sync-instruction-audit-"));
  const projectRoot = join(baseRoot, "project");
  const homeRoot = join(baseRoot, "home");
  tempRoots.push(baseRoot);
  mockedOs.homeDir = homeRoot;
  await mkdir(projectRoot, { recursive: true });
  await mkdir(homeRoot, { recursive: true });
  return { projectRoot, homeRoot };
}

async function writeText(root: string, relativePath: string, content: string) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function getAgent(
  report: InstructionAuditReport,
  agent: InstructionAgent,
): InstructionAgentAudit {
  const entry = report.agents.find((item) => item.agent === agent);
  if (!entry) {
    throw new Error(`Missing audit entry for ${agent}`);
  }
  return entry;
}

describe("instruction audit", () => {
  it("reports all instruction files as missing in an empty project", async () => {
    const { projectRoot } = await setupAuditWorkspace();

    const report = await auditInstructions(projectRoot);

    expect(report.diagnostics).toEqual([]);
    expect(getAgent(report, "claude").globalFiles[0]?.state).toBe("missing");
    expect(getAgent(report, "claude").projectFiles[0]?.state).toBe("missing");
    expect(getAgent(report, "codex").projectFiles[0]?.state).toBe("missing");
    expect(getAgent(report, "cursor").projectFiles[0]?.path).toBe(".cursor/rules/*.mdc");
    expect(getAgent(report, "copilot").projectFiles[0]?.state).toBe("missing");
  });

  it("reports a configured Claude target as global-only when only the home file exists", async () => {
    const { projectRoot, homeRoot } = await setupAuditWorkspace();
    await writeText(homeRoot, ".claude/CLAUDE.md", "# Personal\n");

    const report = await auditInstructions(projectRoot, ["claude"]);

    expect(getAgent(report, "claude").globalFiles[0]?.state).toBe("present");
    expect(
      report.diagnostics.some(
        (item) => item.rule === "instruction-global-only" && item.agent === "claude",
      ),
    ).toBe(true);
  });

  it("classifies identical project and global Claude files as mirrors", async () => {
    const { projectRoot, homeRoot } = await setupAuditWorkspace();
    const content = "# Shared\nFollow the repo conventions.\n";
    await writeText(homeRoot, ".claude/CLAUDE.md", content);
    await writeText(projectRoot, "CLAUDE.md", content);

    const report = await auditInstructions(projectRoot, ["claude"]);
    const entry = getAgent(report, "claude").projectFiles.find((item) => item.path === "CLAUDE.md");

    expect(entry?.state).toBe("mirror-of-global");
    expect(entry?.overlapDetail?.overlapPercent).toBe(100);
    expect(
      report.diagnostics.some(
        (item) => item.rule === "instruction-mirror-of-global" && item.agent === "claude",
      ),
    ).toBe(true);
  });

  it("detects overlapping Claude instruction content and section names", async () => {
    const { projectRoot, homeRoot } = await setupAuditWorkspace();
    await writeText(
      homeRoot,
      ".claude/CLAUDE.md",
      ["# Shared", "Keep the same opening line.", "# Notes", "Retain naming guidance."].join("\n"),
    );
    await writeText(
      projectRoot,
      "CLAUDE.md",
      ["# Shared", "Keep the same opening line.", "# Notes", "Local-only implementation details."].join("\n"),
    );

    const report = await auditInstructions(projectRoot, ["claude"]);
    const entry = getAgent(report, "claude").projectFiles.find((item) => item.path === "CLAUDE.md");

    expect(entry?.state).toBe("overlaps-global");
    expect((entry?.overlapDetail?.overlapPercent ?? 0) >= 20).toBe(true);
    expect(entry?.overlapDetail?.overlappingSections).toContain("Shared");
    expect(
      report.diagnostics.some(
        (item) => item.rule === "instruction-overlaps-global" && item.agent === "claude",
      ),
    ).toBe(true);
  });

  it("reports project-only Claude instructions as present without diagnostics", async () => {
    const { projectRoot } = await setupAuditWorkspace();
    await writeText(projectRoot, "CLAUDE.md", "# Repo\n");

    const report = await auditInstructions(projectRoot, ["claude"]);
    const entry = getAgent(report, "claude").projectFiles.find((item) => item.path === "CLAUDE.md");

    expect(entry?.state).toBe("present");
    expect(report.diagnostics).toEqual([]);
  });

  it("discovers multiple Cursor rule files", async () => {
    const { projectRoot } = await setupAuditWorkspace();
    await writeText(projectRoot, ".cursor/rules/one.mdc", "rule one");
    await writeText(projectRoot, ".cursor/rules/two.mdc", "rule two");

    const report = await auditInstructions(projectRoot, ["cursor"]);
    const cursor = getAgent(report, "cursor");

    expect(cursor.projectFiles.map((entry) => entry.path)).toEqual([
      ".cursor/rules/one.mdc",
      ".cursor/rules/two.mdc",
    ]);
    expect(cursor.projectFiles.every((entry) => entry.state === "present")).toBe(true);
  });

  it("discovers the Copilot instruction file", async () => {
    const { projectRoot } = await setupAuditWorkspace();
    await writeText(projectRoot, ".github/copilot-instructions.md", "# Copilot\n");

    const report = await auditInstructions(projectRoot, ["copilot"]);

    expect(getAgent(report, "copilot").projectFiles[0]?.state).toBe("present");
  });

  it("treats AGENTS.override.md as a valid Codex local instruction file", async () => {
    const { projectRoot } = await setupAuditWorkspace();
    await writeText(projectRoot, "AGENTS.override.md", "# Override\n");

    const report = await auditInstructions(projectRoot, ["codex"]);
    const codex = getAgent(report, "codex");

    expect(codex.overrideFiles[0]?.state).toBe("present");
    expect(
      report.diagnostics.some(
        (item) => item.rule === "instruction-missing-project-file" && item.agent === "codex",
      ),
    ).toBe(false);
  });

  it("only emits missing-project-file diagnostics for configured targets", async () => {
    const { projectRoot } = await setupAuditWorkspace();
    await writeText(
      projectRoot,
      "skill-sync.yaml",
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  codex: .codex/skills",
        "",
      ].join("\n"),
    );

    const report = await instructionAuditOperation({ projectRoot });

    expect(report.configuredTargets).toEqual(["codex"]);
    expect(
      report.diagnostics.some(
        (item) => item.rule === "instruction-missing-project-file" && item.agent === "codex",
      ),
    ).toBe(true);
    expect(
      report.diagnostics.some(
        (item) => item.rule === "instruction-missing-project-file" && item.agent === "claude",
      ),
    ).toBe(false);
  });

  it("classifies identical empty files as mirrors", async () => {
    const { projectRoot, homeRoot } = await setupAuditWorkspace();
    await writeText(homeRoot, ".claude/CLAUDE.md", "");
    await writeText(projectRoot, "CLAUDE.md", "");

    const report = await auditInstructions(projectRoot, ["claude"]);
    const entry = getAgent(report, "claude").projectFiles.find((item) => item.path === "CLAUDE.md");

    expect(entry?.state).toBe("mirror-of-global");
  });

  it("ignores frontmatter when computing overlap", async () => {
    const { projectRoot, homeRoot } = await setupAuditWorkspace();
    await writeText(
      homeRoot,
      ".claude/CLAUDE.md",
      ["---", "owner: personal", "---", "# Shared", "Keep this line.", "# Notes", "Reference global guidance."].join("\n"),
    );
    await writeText(
      projectRoot,
      "CLAUDE.md",
      ["---", "owner: project", "---", "# Shared", "Keep this line.", "# Notes", "Reference local guidance."].join("\n"),
    );

    const report = await auditInstructions(projectRoot, ["claude"]);
    const entry = getAgent(report, "claude").projectFiles.find((item) => item.path === "CLAUDE.md");

    expect(entry?.state).toBe("overlaps-global");
    expect(entry?.overlapDetail?.overlappingSections).toContain("Shared");
  });

  it("exports instruction audit functions from the public core barrel", () => {
    expect(typeof core.auditInstructions).toBe("function");
    expect(typeof core.auditAgentInstructions).toBe("function");
    expect(typeof core.instructionAuditOperation).toBe("function");
    expect(core.INSTRUCTION_TARGETS.codex.projectFiles).toContain("AGENTS.md");
  });

  it("supports direct per-agent audits for configured targets", async () => {
    const { projectRoot } = await setupAuditWorkspace();
    await writeText(projectRoot, ".github/copilot-instructions.md", "# Copilot\n");

    const agentReport = await auditAgentInstructions("copilot", projectRoot, true);

    expect(agentReport.configured).toBe(true);
    expect(agentReport.projectFiles[0]?.state).toBe("present");
  });
});
