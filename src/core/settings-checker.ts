/**
 * Pure comparison logic for agent settings requirements.
 *
 * skill-sync does not own or write settings files — it only reads them
 * to surface gaps between what installed skills declare they need and what
 * the project's settings file currently allows.
 */

import type { SkillSyncMeta } from "./types.js";

/** Minimal representation of an agent settings file (e.g. .claude/settings.json). */
export interface AgentSettingsFile {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

/** A gap between a skill's declared requirements and the actual settings file. */
export interface SettingsGap {
  skillName: string;
  agent: string;
  missingAllows: string[];
}

/**
 * Compare installed skills' settings_requirements against an agent settings file.
 *
 * Matching uses exact string comparison. For example, "Bash(git:*)" is only
 * satisfied if "Bash(git:*)" appears verbatim in the allow list. A broader
 * wildcard like "Bash(*)" does NOT satisfy "Bash(git:*)" in v0 — this is
 * intentionally conservative to avoid depending on Claude Code's permission
 * matching semantics.
 */
export function checkSettingsRequirements(
  installedSkills: Array<{ name: string; meta: SkillSyncMeta | null }>,
  agent: string,
  settingsFile: AgentSettingsFile,
): SettingsGap[] {
  const existingAllows = new Set(settingsFile.permissions?.allow ?? []);
  const gaps: SettingsGap[] = [];

  for (const skill of installedSkills) {
    const required = skill.meta?.settingsRequirements?.[agent]?.permissions?.allow;
    if (!required || required.length === 0) continue;

    const missing = required.filter((entry) => !existingAllows.has(entry));
    if (missing.length > 0) {
      gaps.push({ skillName: skill.name, agent, missingAllows: missing });
    }
  }

  return gaps;
}

/**
 * Collect the union of all required allow entries across all installed skills
 * for a specific agent, deduplicated.
 */
export function collectRequiredAllows(
  installedSkills: Array<{ name: string; meta: SkillSyncMeta | null }>,
  agent: string,
): string[] {
  const seen = new Set<string>();
  for (const skill of installedSkills) {
    const required = skill.meta?.settingsRequirements?.[agent]?.permissions?.allow;
    if (!required) continue;
    for (const entry of required) seen.add(entry);
  }
  return [...seen];
}

/**
 * Build the minimal permissions fragment needed to satisfy all requirements
 * that are not already present in the existing settings file.
 */
export function buildSuggestedPermissions(
  installedSkills: Array<{ name: string; meta: SkillSyncMeta | null }>,
  agent: string,
  existingSettingsFile: AgentSettingsFile,
): AgentSettingsFile {
  const existingAllows = new Set(existingSettingsFile.permissions?.allow ?? []);
  const allRequired = collectRequiredAllows(installedSkills, agent);
  const missing = allRequired.filter((entry) => !existingAllows.has(entry));

  if (missing.length === 0) return {};

  return { permissions: { allow: missing } };
}
