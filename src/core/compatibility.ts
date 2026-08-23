import type { SkillPackage, TargetConfig, ValidationDiagnostic } from "./types.js";

// ---------------------------------------------------------------------------
// Agent Target Definitions
// ---------------------------------------------------------------------------

/** Known agent targets and their directory conventions. */
export type AgentTarget = "claude" | "codex" | "gemini" | "antigravity" | "agents" | "generic-mcp";

export interface AgentTargetConfig {
  /** Human-readable name. */
  label: string;
  /** Default skill directory relative to project root. */
  defaultSkillDir: string;
  /** Whether this target reads SKILL.md frontmatter. */
  readsFrontmatter: boolean;
  /** Whether this target supports AGENTS.md discovery. */
  supportsAgentsMd: boolean;
  /** Features this target cannot use (will produce warnings). */
  unsupportedFeatures: string[];
}

export const AGENT_TARGETS: Record<AgentTarget, AgentTargetConfig> = {
  claude: {
    label: "Claude Code",
    defaultSkillDir: ".claude/skills",
    readsFrontmatter: true,
    supportsAgentsMd: false,
    unsupportedFeatures: [],
  },
  codex: {
    label: "OpenAI Codex",
    defaultSkillDir: ".codex/skills",
    readsFrontmatter: true,
    supportsAgentsMd: true,
    unsupportedFeatures: ["allowed-tools"],
  },
  gemini: {
    label: "Gemini CLI",
    defaultSkillDir: ".gemini/skills",
    readsFrontmatter: true, // assumed parity with Claude/Codex; verify against Gemini CLI docs
    supportsAgentsMd: false,
    unsupportedFeatures: ["allowed-tools", "nested-skills"],
  },
  antigravity: {
    label: "Antigravity CLI",
    defaultSkillDir: ".agents/skills",
    readsFrontmatter: true,
    supportsAgentsMd: false,
    unsupportedFeatures: ["allowed-tools"],
  },
  agents: {
    label: "Shared Agents Directory (.agents/skills)",
    defaultSkillDir: ".agents/skills",
    readsFrontmatter: true,
    supportsAgentsMd: true,
    unsupportedFeatures: ["allowed-tools"],
  },
  "generic-mcp": {
    label: "Generic MCP Client",
    defaultSkillDir: ".agent/skills",
    readsFrontmatter: false,
    supportsAgentsMd: false,
    unsupportedFeatures: ["allowed-tools", "scripts/"],
  },
};

/** Resolve an AgentTarget from a target key and/or directory path. */
export function resolveAgentTarget(targetKey: string, dir?: string): AgentTarget | null {
  if (targetKey in AGENT_TARGETS) return targetKey as AgentTarget;
  if (!dir) return null;
  const normalized = dir.replace(/\\/g, "/");
  if (normalized.includes(".claude")) return "claude";
  if (normalized.includes(".codex")) return "codex";
  if (normalized.includes(".gemini")) return "gemini";
  if (normalized.includes(".agents")) return "agents";
  if (normalized.includes(".agent")) return "generic-mcp";
  return null;
}

// ---------------------------------------------------------------------------
// Compatibility Checking
// ---------------------------------------------------------------------------

/**
 * Check a skill package's compatibility with a specific agent target.
 * Returns diagnostics for unsupported features or missing metadata.
 */
export function checkCompatibility(
  pkg: SkillPackage,
  target: AgentTarget,
  skillPath?: string,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const config = AGENT_TARGETS[target];
  const effectiveSkillName = skillPath ?? pkg.name;

  // Check declared target compatibility
  if (pkg.meta?.targets && pkg.meta.targets[target] === false) {
    diagnostics.push({
      rule: "target-declared-incompatible",
      severity: "error",
      message: `Skill "${effectiveSkillName}" declares itself incompatible with ${config.label}`,
      skill: effectiveSkillName,
    });
  }

  // Check for unsupported features
  for (const feature of config.unsupportedFeatures) {
    if (feature === "allowed-tools" && pkg.skillMd.allowedTools?.length) {
      diagnostics.push({
        rule: "unsupported-feature",
        severity: "warning",
        message: `"allowed-tools" in SKILL.md is not supported by ${config.label} and will be ignored`,
        skill: effectiveSkillName,
      });
    }
    if (feature === "scripts/") {
      const hasScripts = pkg.files.some((f) => f.relativePath.startsWith("scripts/"));
      if (hasScripts) {
        diagnostics.push({
          rule: "unsupported-feature",
          severity: "warning",
          message: `scripts/ directory is not executable by ${config.label} — scripts will be available as resources only`,
          skill: effectiveSkillName,
        });
      }
    }
    if (feature === "nested-skills" && effectiveSkillName.includes("/")) {
      diagnostics.push({
        rule: "unsupported-feature",
        severity: "warning",
        message: `Nested skill directory "${effectiveSkillName}" is not discovered by ${config.label} (supports 1-level depth only)`,
        skill: effectiveSkillName,
      });
    }
  }

  // Check frontmatter requirements
  if (config.readsFrontmatter) {
    if (!pkg.skillMd.name) {
      diagnostics.push({
        rule: "missing-frontmatter-name",
        severity: "warning",
        message: `${config.label} expects "name" in SKILL.md frontmatter for discovery`,
        skill: effectiveSkillName,
      });
    }
    if (!pkg.skillMd.description) {
      diagnostics.push({
        rule: "missing-frontmatter-description",
        severity: "warning",
        message: `${config.label} expects "description" in SKILL.md frontmatter for routing`,
        skill: effectiveSkillName,
      });
    }
  }

  return diagnostics;
}

/**
 * Check compatibility of a skill against all configured targets in a manifest.
 */
export function checkAllTargetCompatibility(
  pkg: SkillPackage,
  targets: Record<string, TargetConfig>,
  skillPath?: string,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  for (const [targetKey, targetCfg] of Object.entries(targets)) {
    const resolved = resolveAgentTarget(targetKey, targetCfg.dir);
    if (resolved) {
      diagnostics.push(...checkCompatibility(pkg, resolved, skillPath));
    }
  }
  return diagnostics;
}
