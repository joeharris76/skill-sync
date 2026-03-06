import type {
  SourceConfig,
  SourceProvenance,
  ValidationDiagnostic,
} from "./types.js";

/**
 * Trust policy for controlling which sources are allowed.
 *
 * In v0, trust is opt-in: all sources in the manifest are trusted by default.
 * The policy can restrict to an explicit allowlist or block specific sources.
 */
export interface TrustPolicy {
  /** If set, only sources matching these patterns are allowed. */
  allowedSources?: SourcePattern[];
  /** Sources matching these patterns are blocked even if in the allowlist. */
  blockedSources?: SourcePattern[];
  /** Whether to require provenance tracking for all installed skills. */
  requireProvenance?: boolean;
  /** Whether to allow executable scripts in skill packages. */
  allowScripts?: boolean;
}

export interface SourcePattern {
  /** Match by source type. */
  type?: string;
  /** Match by source name (exact). */
  name?: string;
  /** Match by URL prefix (git sources). */
  urlPrefix?: string;
}

/** Default trust policy: allow everything, warn on scripts. */
export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  requireProvenance: false,
  allowScripts: true,
};

/**
 * Check whether a source is trusted under the given policy.
 */
export function checkSourceTrust(
  source: SourceConfig,
  policy: TrustPolicy,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  // Check blocklist first
  if (policy.blockedSources) {
    for (const pattern of policy.blockedSources) {
      if (matchesSourcePattern(source, pattern)) {
        diagnostics.push({
          rule: "blocked-source",
          severity: "error",
          message: `Source "${source.name}" (type: ${source.type}) is blocked by trust policy`,
        });
        return diagnostics;
      }
    }
  }

  // Check allowlist (if present, only allowed sources pass)
  if (policy.allowedSources && policy.allowedSources.length > 0) {
    const allowed = policy.allowedSources.some((pattern) =>
      matchesSourcePattern(source, pattern),
    );
    if (!allowed) {
      diagnostics.push({
        rule: "untrusted-source",
        severity: "error",
        message: `Source "${source.name}" (type: ${source.type}) is not in the trust allowlist`,
      });
    }
  }

  return diagnostics;
}

/**
 * Validate that all installed skills have provenance tracking.
 */
export function checkProvenanceRequired(
  skillName: string,
  provenance: SourceProvenance | undefined,
  policy: TrustPolicy,
): ValidationDiagnostic[] {
  if (!policy.requireProvenance) return [];
  if (!provenance) {
    return [{
      rule: "missing-provenance",
      severity: "error",
      message: `Skill "${skillName}" is missing source provenance (required by trust policy)`,
      skill: skillName,
    }];
  }
  return [];
}

/**
 * Generate a provenance report for installed skills.
 */
export function formatProvenanceReport(
  skills: Array<{ name: string; provenance?: SourceProvenance }>,
): Array<{
  skill: string;
  sourceType: string;
  sourceName: string;
  location: string;
  fetchedAt: string;
}> {
  return skills.map((s) => ({
    skill: s.name,
    sourceType: s.provenance?.type ?? "unknown",
    sourceName: s.provenance?.name ?? "unknown",
    location: s.provenance?.path ?? s.provenance?.url ?? "unknown",
    fetchedAt: s.provenance?.fetchedAt ?? "unknown",
  }));
}

function matchesSourcePattern(
  source: SourceConfig,
  pattern: SourcePattern,
): boolean {
  if (pattern.type && source.type !== pattern.type) return false;
  if (pattern.name && source.name !== pattern.name) return false;
  if (pattern.urlPrefix && source.url && !source.url.startsWith(pattern.urlPrefix)) return false;
  if (pattern.urlPrefix && !source.url) return false;
  return true;
}
