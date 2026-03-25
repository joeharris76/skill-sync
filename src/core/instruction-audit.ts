import { access, constants, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { sha256 } from "./hasher.js";
import { INSTRUCTION_TARGETS } from "./instruction-targets.js";
import type {
  InstructionAgent,
  InstructionAgentAudit,
  InstructionAuditDiagnostic,
  InstructionAuditEntry,
  InstructionAuditReport,
  InstructionFileScope,
  InstructionFileState,
  OverlapDetail,
} from "./instruction-types.js";

const CURSOR_RULES_GLOB = ".cursor/rules/*.mdc";
const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n?/;

export async function auditInstructions(
  projectRoot: string,
  configuredTargets: InstructionAgent[] = [],
): Promise<InstructionAuditReport> {
  const root = resolve(projectRoot);
  const configuredSet = new Set(configuredTargets);
  const agents = await Promise.all(
    (Object.keys(INSTRUCTION_TARGETS) as InstructionAgent[]).map((agent) =>
      auditAgentInstructions(agent, root, configuredSet.has(agent))
    ),
  );

  return {
    projectRoot: root,
    configuredTargets: [...configuredSet],
    agents,
    diagnostics: generateDiagnostics(agents),
  };
}

export async function auditAgentInstructions(
  agent: InstructionAgent,
  projectRoot: string,
  isConfiguredTarget: boolean,
): Promise<InstructionAgentAudit> {
  const target = INSTRUCTION_TARGETS[agent];
  const globalFiles = await Promise.all(
    target.globalFiles.map((pathSpec) =>
      discoverFile(agent, "global", pathSpec, projectRoot),
    ),
  );

  let projectFiles =
    agent === "cursor"
      ? await discoverCursorRules(projectRoot)
      : await Promise.all(
          target.projectFiles.map((pathSpec) =>
            discoverFile(agent, "project", pathSpec, projectRoot),
          ),
        );

  let overrideFiles = await Promise.all(
    target.overrideFiles.map((pathSpec) =>
      discoverFile(agent, "override", pathSpec, projectRoot),
    ),
  );

  const globalEntry = globalFiles.find((entry) => entry.state !== "missing");
  const globalContent = globalEntry
    ? await readExistingText(globalEntry.resolvedPath)
    : undefined;

  if (globalEntry && typeof globalContent === "string") {
    projectFiles = await Promise.all(
      projectFiles.map((entry) =>
        classifyAgainstGlobal(entry, globalEntry, globalContent),
      ),
    );
    overrideFiles = await Promise.all(
      overrideFiles.map((entry) =>
        classifyAgainstGlobal(entry, globalEntry, globalContent),
      ),
    );
  }

  return {
    agent,
    label: target.label,
    configured: isConfiguredTarget,
    globalAvailableRemotely: target.globalAvailableRemotely,
    expectedGlobalFiles: [...target.globalFiles],
    expectedProjectFiles: [...target.projectFiles],
    expectedOverrideFiles: [...target.overrideFiles],
    globalFiles,
    projectFiles,
    overrideFiles,
  };
}

async function classifyAgainstGlobal(
  entry: InstructionAuditEntry,
  globalEntry: InstructionAuditEntry,
  globalContent: string,
): Promise<InstructionAuditEntry> {
  if (entry.state === "missing") {
    return entry;
  }

  const projectContent = await readExistingText(entry.resolvedPath);
  if (typeof projectContent !== "string") {
    return entry;
  }

  const overlapDetail = detectOverlap(projectContent, globalContent);
  const state = classifyState(entry, globalEntry, projectContent, globalContent);

  return {
    ...entry,
    state,
    overlapDetail:
      state === "mirror-of-global" || state === "overlaps-global"
        ? overlapDetail
        : undefined,
  };
}

async function discoverFile(
  agent: InstructionAgent,
  scope: InstructionFileScope,
  pathSpec: string,
  projectRoot: string,
): Promise<InstructionAuditEntry> {
  const resolvedPath = resolveInstructionPath(pathSpec, projectRoot);

  try {
    await access(resolvedPath, constants.R_OK);
    const content = await readFile(resolvedPath, "utf8");
    return {
      agent,
      scope,
      path: pathSpec,
      resolvedPath,
      state: "present",
      sha256: sha256(content),
    };
  } catch {
    return {
      agent,
      scope,
      path: pathSpec,
      resolvedPath,
      state: "missing",
    };
  }
}

function resolveInstructionPath(pathSpec: string, projectRoot: string): string {
  if (pathSpec.startsWith("~/")) {
    return join(homedir(), pathSpec.slice(2));
  }
  return resolve(projectRoot, pathSpec);
}

async function readExistingText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export function classifyState(
  projectEntry: InstructionAuditEntry,
  globalEntry: InstructionAuditEntry | undefined,
  projectContent: string,
  globalContent: string | undefined,
): InstructionFileState {
  if (projectEntry.state === "missing") {
    return "missing";
  }
  if (
    !globalEntry ||
    globalEntry.state === "missing" ||
    typeof globalContent !== "string"
  ) {
    return "present";
  }
  if (projectEntry.sha256 && globalEntry.sha256 && projectEntry.sha256 === globalEntry.sha256) {
    return "mirror-of-global";
  }

  const overlap = detectOverlap(projectContent, globalContent);
  if (overlap.overlapPercent >= 20) {
    return "overlaps-global";
  }

  return "present";
}

export function detectOverlap(
  projectContent: string,
  globalContent: string,
): OverlapDetail {
  const projectLines = normalizedLineSet(projectContent);
  const globalLines = new Set(normalizedLineSet(globalContent));
  const overlappingLines = projectLines.filter((line) => globalLines.has(line));
  const totalLines = projectLines.length;
  const overlapPercent =
    totalLines === 0 ? 0 : Number(((overlappingLines.length / totalLines) * 100).toFixed(1));

  const projectSections = parseMarkdownSections(projectContent);
  const globalSections = parseMarkdownSections(globalContent);
  const overlappingSections: string[] = [];

  for (const [section, projectSection] of projectSections) {
    const globalSection = globalSections.get(section);
    if (!globalSection) {
      continue;
    }
    const projectSectionLines = normalizedLineSet(projectSection);
    const globalSectionLineSet = new Set(normalizedLineSet(globalSection));
    if (projectSectionLines.some((line) => globalSectionLineSet.has(line))) {
      overlappingSections.push(section);
    }
  }

  return {
    totalLines,
    overlappingLines: overlappingLines.length,
    overlapPercent,
    overlappingSections,
  };
}

export function parseMarkdownSections(content: string): Map<string, string> {
  const stripped = stripFrontmatter(content);
  const sections = new Map<string, string>();
  const lines = stripped.split(/\r?\n/);
  let currentHeading = "(document)";
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0 || !sections.has(currentHeading)) {
      sections.set(currentHeading, buffer.join("\n"));
    }
  };

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      currentHeading = line.replace(/^#{1,6}\s+/, "").trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections;
}

async function discoverCursorRules(projectRoot: string): Promise<InstructionAuditEntry[]> {
  const rulesRoot = resolve(projectRoot, ".cursor/rules");
  try {
    const entries = await readdir(rulesRoot, { withFileTypes: true });
    const rules = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mdc"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    if (rules.length === 0) {
      return [
        {
          agent: "cursor",
          scope: "project",
          path: CURSOR_RULES_GLOB,
          resolvedPath: resolve(projectRoot, CURSOR_RULES_GLOB),
          state: "missing",
        },
      ];
    }

    return Promise.all(
      rules.map((fileName) =>
        discoverFile("cursor", "project", `.cursor/rules/${fileName}`, projectRoot),
      ),
    );
  } catch {
    return [
      {
        agent: "cursor",
        scope: "project",
        path: CURSOR_RULES_GLOB,
        resolvedPath: resolve(projectRoot, CURSOR_RULES_GLOB),
        state: "missing",
      },
    ];
  }
}

function generateDiagnostics(
  agents: InstructionAgentAudit[],
): InstructionAuditDiagnostic[] {
  const diagnostics: InstructionAuditDiagnostic[] = [];

  for (const agent of agents) {
    const localEntries = getLocalEntries(agent);
    const presentLocalEntries = localEntries.filter((entry) => entry.state !== "missing");
    const globalEntry = agent.globalFiles.find((entry) => entry.state !== "missing");

    if (agent.configured && presentLocalEntries.length === 0) {
      if (globalEntry && !agent.globalAvailableRemotely) {
        diagnostics.push({
          rule: "instruction-global-only",
          severity: "warning",
          message: `Global instruction file ${globalEntry.path} exists for ${agent.label}, but no project instruction file (${formatExpectedLocalFiles(agent)}) was found.`,
          agent: agent.agent,
          file: globalEntry.path,
        });
      } else {
        diagnostics.push({
          rule: "instruction-missing-project-file",
          severity: "warning",
          message: `Configured ${agent.label} target is missing a project instruction file (${formatExpectedLocalFiles(agent)}).`,
          agent: agent.agent,
          file: agent.expectedProjectFiles[0] ?? agent.expectedOverrideFiles[0],
        });
      }
    }

    if (!globalEntry) {
      continue;
    }

    for (const entry of presentLocalEntries) {
      if (entry.state === "mirror-of-global") {
        diagnostics.push({
          rule: "instruction-mirror-of-global",
          severity: "warning",
          message: `Project instruction file ${entry.path} is identical to global ${globalEntry.path}; personal content may leak into the repository.`,
          agent: agent.agent,
          file: entry.path,
        });
      } else if (entry.state === "overlaps-global") {
        const overlapPercent = entry.overlapDetail?.overlapPercent ?? 0;
        diagnostics.push({
          rule: "instruction-overlaps-global",
          severity: "warning",
          message: `Project instruction file ${entry.path} overlaps global ${globalEntry.path} by ${overlapPercent}%.`,
          agent: agent.agent,
          file: entry.path,
        });
      }
    }
  }

  return diagnostics;
}

function getLocalEntries(agent: InstructionAgentAudit): InstructionAuditEntry[] {
  return [...agent.projectFiles, ...agent.overrideFiles];
}

function formatExpectedLocalFiles(agent: InstructionAgentAudit): string {
  const expected = [...agent.expectedProjectFiles, ...agent.expectedOverrideFiles];
  return expected.join(", ");
}

function normalizedLineSet(content: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const rawLine of stripFrontmatter(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    lines.push(line);
  }

  return lines;
}

function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "");
}
