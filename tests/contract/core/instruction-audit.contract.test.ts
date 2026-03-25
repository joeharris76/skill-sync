import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleExists } from "../../helpers/module-availability.js";

const mockedOs = vi.hoisted(() => ({ homeDir: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockedOs.homeDir,
  };
});

type InstructionAuditModule = {
  auditInstructions: (projectRoot: string, configuredTargets?: string[]) => Promise<{
    projectRoot: string;
    agents: Array<{ agent: string; projectFiles: Array<{ path: string; state: string }> }>;
    diagnostics: Array<{ rule: string; agent: string }>;
  }>;
  instructionAuditOperation?: (opts: { projectRoot: string }) => Promise<{
    projectRoot: string;
    agents: Array<{ agent: string; projectFiles: Array<{ path: string; state: string }> }>;
    diagnostics: Array<{ rule: string; agent: string }>;
  }>;
};

const describeInstructionAudit = moduleExists("src/core/instruction-audit.ts") ? describe : describe.skip;
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeText(root: string, relativePath: string, content: string) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

describeInstructionAudit("core instruction audit contract", () => {
  let auditModule: InstructionAuditModule;

  beforeAll(async () => {
    auditModule = (await import("../../../src/core/index.js")) as InstructionAuditModule;
  });

  it("exports the audit entrypoints", () => {
    expect(typeof auditModule.auditInstructions).toBe("function");
    expect(typeof auditModule.instructionAuditOperation).toBe("function");
  });

  it("returns a parseable report with expected state classifications", async () => {
    const baseRoot = await mkdtemp(join(tmpdir(), "skill-sync-instruction-contract-"));
    const projectRoot = join(baseRoot, "project");
    const homeRoot = join(baseRoot, "home");
    tempRoots.push(baseRoot);
    mockedOs.homeDir = homeRoot;

    await mkdir(projectRoot, { recursive: true });
    await mkdir(homeRoot, { recursive: true });
    await writeText(homeRoot, ".claude/CLAUDE.md", "# Shared\nKeep this line.\n");
    await writeText(projectRoot, "CLAUDE.md", "# Shared\nKeep this line.\n");
    await writeText(
      projectRoot,
      "skill-sync.yaml",
      [
        "version: 1",
        "sources: []",
        "skills: []",
        "targets:",
        "  claude: .claude/skills",
        "  codex: .codex/skills",
        "",
      ].join("\n"),
    );

    const report = await auditModule.instructionAuditOperation!({ projectRoot });
    const claude = report.agents.find((item) => item.agent === "claude");
    const codex = report.agents.find((item) => item.agent === "codex");

    expect(report.projectRoot).toBe(projectRoot);
    expect(claude?.projectFiles.find((item) => item.path === "CLAUDE.md")?.state).toBe("mirror-of-global");
    expect(codex?.projectFiles[0]?.state).toBe("missing");
    expect(report.diagnostics.some((item) => item.rule === "instruction-mirror-of-global")).toBe(true);
    expect(report.diagnostics.some((item) => item.rule === "instruction-missing-project-file" && item.agent === "codex")).toBe(true);
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      projectRoot,
      agents: expect.any(Array),
      diagnostics: expect.any(Array),
    });
  });
});
