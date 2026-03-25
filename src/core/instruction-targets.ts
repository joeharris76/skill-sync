import type { InstructionAgent, InstructionTargetConfig } from "./instruction-types.js";

export const INSTRUCTION_TARGETS: Record<InstructionAgent, InstructionTargetConfig> = {
  claude: {
    label: "Claude Code",
    globalFiles: ["~/.claude/CLAUDE.md"],
    projectFiles: ["CLAUDE.md", ".claude/CLAUDE.md"],
    overrideFiles: [],
    globalAvailableRemotely: false,
    agentTargetKey: "claude",
  },
  codex: {
    label: "OpenAI Codex",
    globalFiles: ["~/.codex/AGENTS.md"],
    projectFiles: ["AGENTS.md"],
    overrideFiles: ["AGENTS.override.md"],
    globalAvailableRemotely: false,
    agentTargetKey: "codex",
  },
  gemini: {
    label: "Gemini CLI",
    globalFiles: ["~/.gemini/GEMINI.md"],
    projectFiles: ["GEMINI.md", ".gemini/GEMINI.md"],
    overrideFiles: [],
    globalAvailableRemotely: false,
    agentTargetKey: "gemini",
  },
  cursor: {
    label: "Cursor",
    globalFiles: [],
    projectFiles: [".cursor/rules/*.mdc"],
    overrideFiles: [],
    globalAvailableRemotely: true,
    agentTargetKey: "cursor",
  },
  copilot: {
    label: "GitHub Copilot",
    globalFiles: [],
    projectFiles: [".github/copilot-instructions.md"],
    overrideFiles: [],
    globalAvailableRemotely: true,
    agentTargetKey: "copilot",
  },
};

export function isInstructionAgent(value: string): value is InstructionAgent {
  return value in INSTRUCTION_TARGETS;
}
