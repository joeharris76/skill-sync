import type { SkillPackage, ValidationDiagnostic } from "./types.js";

// ---------------------------------------------------------------------------
// Agent Target Definitions
// ---------------------------------------------------------------------------

/** Known agent targets and their directory conventions. */
export type AgentTarget = "claude" | "codex" | "gemini" | "generic-mcp";

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
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const config = AGENT_TARGETS[target];

  // Check declared target compatibility
  if (pkg.meta?.targets && pkg.meta.targets[target] === false) {
    diagnostics.push({
      rule: "target-declared-incompatible",
      severity: "error",
      message: `Skill "${pkg.name}" declares itself incompatible with ${config.label}`,
      skill: pkg.name,
    });
  }

  // Check for unsupported features
  for (const feature of config.unsupportedFeatures) {
    if (feature === "allowed-tools" && pkg.skillMd.allowedTools?.length) {
      diagnostics.push({
        rule: "unsupported-feature",
        severity: "warning",
        message: `"allowed-tools" in SKILL.md is not supported by ${config.label} and will be ignored`,
        skill: pkg.name,
      });
    }
    if (feature === "scripts/") {
      const hasScripts = pkg.files.some((f) =>
        f.relativePath.startsWith("scripts/"),
      );
      if (hasScripts) {
        diagnostics.push({
          rule: "unsupported-feature",
          severity: "warning",
          message: `scripts/ directory is not executable by ${config.label} — scripts will be available as resources only`,
          skill: pkg.name,
        });
      }
    }
  }

  // Check frontmatter requirements
  if (config.readsFrontmatter) {
    if (!pkg.skillMd.name) {
      diagnostics.push({
        rule: "missing-frontmatter-name",
        severity: "warning",
        message: `${config.label} expects "name" in SKILL.md frontmatter for discovery`,
        skill: pkg.name,
      });
    }
    if (!pkg.skillMd.description) {
      diagnostics.push({
        rule: "missing-frontmatter-description",
        severity: "warning",
        message: `${config.label} expects "description" in SKILL.md frontmatter for routing`,
        skill: pkg.name,
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
  targets: Record<string, string>,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  for (const targetKey of Object.keys(targets)) {
    if (targetKey in AGENT_TARGETS) {
      diagnostics.push(
        ...checkCompatibility(pkg, targetKey as AgentTarget),
      );
    }
  }
  return diagnostics;
}
