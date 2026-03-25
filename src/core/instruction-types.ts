import type { ValidationSeverity } from "./types.js";

export type InstructionAgent = "claude" | "codex" | "gemini" | "cursor" | "copilot";

export type InstructionFileScope = "global" | "project" | "override";

export type InstructionFileState =
  | "missing"
  | "present"
  | "mirror-of-global"
  | "overlaps-global";

export interface OverlapDetail {
  totalLines: number;
  overlappingLines: number;
  overlapPercent: number;
  overlappingSections: string[];
}

export interface InstructionAuditEntry {
  agent: InstructionAgent;
  scope: InstructionFileScope;
  path: string;
  resolvedPath: string;
  state: InstructionFileState;
  sha256?: string;
  overlapDetail?: OverlapDetail;
}

export interface InstructionTargetConfig {
  label: string;
  globalFiles: string[];
  projectFiles: string[];
  overrideFiles: string[];
  globalAvailableRemotely: boolean;
  agentTargetKey?: string;
}

export interface InstructionAgentAudit {
  agent: InstructionAgent;
  label: string;
  configured: boolean;
  globalAvailableRemotely: boolean;
  expectedGlobalFiles: string[];
  expectedProjectFiles: string[];
  expectedOverrideFiles: string[];
  globalFiles: InstructionAuditEntry[];
  projectFiles: InstructionAuditEntry[];
  overrideFiles: InstructionAuditEntry[];
}

export interface InstructionAuditDiagnostic {
  rule: string;
  severity: ValidationSeverity;
  message: string;
  agent: InstructionAgent;
  file?: string;
}

export interface InstructionAuditReport {
  projectRoot: string;
  configuredTargets: InstructionAgent[];
  agents: InstructionAgentAudit[];
  diagnostics: InstructionAuditDiagnostic[];
}
