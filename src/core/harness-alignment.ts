import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { expandTilde, toTildePath } from "./paths.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_CANONICAL_INSTRUCTIONS_SOURCE = "~/.agents/AGENTS.md";

export type HarnessTargetKind = "symlink" | "claude-import";

export interface HarnessTarget {
  id: string;
  path: string;
  kind: HarnessTargetKind;
  expectedContent?: string;
}

export interface HarnessSpec {
  id: string;
  name: string;
  binaryCandidates: string[];
  versionArgs: string[];
  versionRegex: RegExp;
  knownVersion: string;
  minVersion: string;
  maxVersion: string;
  targets: HarnessTarget[];
}

export const KNOWN_HARNESS_SPECS: readonly HarnessSpec[] = [
  {
    id: "claude",
    name: "Claude Code",
    binaryCandidates: ["claude", "/opt/homebrew/bin/claude"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "2.1.259",
    minVersion: "2.0.0",
    maxVersion: "2.3.0",
    targets: [
      {
        id: "claude.global",
        path: "~/.claude/CLAUDE.md",
        kind: "claude-import",
        expectedContent: "@~/.agents/AGENTS.md",
      },
    ],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    binaryCandidates: ["codex", "/opt/homebrew/bin/codex"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "0.153.0",
    minVersion: "0.150.0",
    maxVersion: "0.160.0",
    targets: [
      {
        id: "codex.global",
        path: "~/.codex/AGENTS.md",
        kind: "symlink",
      },
    ],
  },
  {
    id: "agy",
    name: "Antigravity CLI",
    binaryCandidates: ["agy", "/opt/homebrew/bin/agy"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "1.1.25",
    minVersion: "1.0.0",
    maxVersion: "1.3.0",
    targets: [
      {
        id: "agy.gemini.agents",
        path: "~/.gemini/AGENTS.md",
        kind: "symlink",
      },
      {
        id: "agy.antigravity.agents",
        path: "~/.gemini/antigravity-cli/ANTIGRAVITY.md",
        kind: "symlink",
      },
    ],
  },
  {
    id: "pi",
    name: "Pi",
    binaryCandidates: ["pi", "/opt/homebrew/bin/pi"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "0.84.3",
    minVersion: "0.80.0",
    maxVersion: "0.90.0",
    targets: [
      {
        id: "pi.global",
        path: "~/.pi/agent/AGENTS.md",
        kind: "symlink",
      },
    ],
  },
  {
    id: "jcode",
    name: "JCode",
    binaryCandidates: ["jcode", "/opt/homebrew/bin/jcode"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "0.81.1",
    minVersion: "0.80.0",
    maxVersion: "0.90.0",
    targets: [
      {
        id: "jcode.global",
        path: "~/AGENTS.md",
        kind: "symlink",
      },
    ],
  },
  {
    id: "grok",
    name: "Grok Build",
    binaryCandidates: ["grok", "~/.grok/bin/grok", "/opt/homebrew/bin/grok"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "1.0.13",
    minVersion: "1.0.0",
    maxVersion: "1.2.0",
    targets: [
      {
        id: "grok.global",
        path: "~/.grok/AGENTS.md",
        kind: "symlink",
      },
    ],
  },
  {
    id: "muse",
    name: "Muse Code",
    binaryCandidates: ["muse", "~/.local/bin/muse", "/opt/homebrew/bin/muse"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "1.0.2",
    minVersion: "1.0.0",
    maxVersion: "1.2.0",
    targets: [
      {
        id: "muse.global",
        path: "~/.config/muse/AGENTS.md",
        kind: "symlink",
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    binaryCandidates: ["opencode", "/opt/homebrew/bin/opencode"],
    versionArgs: ["--version"],
    versionRegex: /(?:^|\s|v)(\d+\.\d+\.\d+)/,
    knownVersion: "1.18.25",
    minVersion: "1.15.0",
    maxVersion: "1.25.0",
    targets: [
      {
        id: "opencode.global",
        path: "~/.config/opencode/AGENTS.md",
        kind: "symlink",
      },
    ],
  },
];

export interface SemverTuple {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(version: string): SemverTuple | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
  };
}

export function compareSemver(a: string, b: string): number | null {
  const sa = parseSemver(a);
  const sb = parseSemver(b);
  if (!sa || !sb) return null;
  if (sa.major !== sb.major) return sa.major < sb.major ? -1 : 1;
  if (sa.minor !== sb.minor) return sa.minor < sb.minor ? -1 : 1;
  if (sa.patch !== sb.patch) return sa.patch < sb.patch ? -1 : 1;
  return 0;
}

export function isVersionInBounds(
  version: string,
  minVersion: string,
  maxVersion: string,
): boolean {
  const cmpMin = compareSemver(version, minVersion);
  const cmpMax = compareSemver(version, maxVersion);
  if (cmpMin === null || cmpMax === null) return false;
  return cmpMin >= 0 && cmpMax <= 0;
}

export interface HarnessVersionCheck {
  harnessId: string;
  name: string;
  binaryPath: string | null;
  installed: boolean;
  rawVersionOutput?: string;
  detectedVersion?: string;
  knownVersion: string;
  minVersion: string;
  maxVersion: string;
  inBounds: boolean;
  status: "in-bounds" | "out-of-bounds" | "not-installed" | "version-error";
  message: string;
}

export interface TargetAlignmentStatus {
  targetId: string;
  path: string;
  resolvedPath: string;
  kind: HarnessTargetKind;
  aligned: boolean;
  wouldAlign?: boolean;
  blocked?: boolean;
  actionTaken?: "none" | "created-symlink" | "recreated-symlink" | "updated-import";
  message: string;
}

export interface HarnessAlignmentItem {
  harness: HarnessSpec;
  version: HarnessVersionCheck;
  targets: TargetAlignmentStatus[];
  ok: boolean;
}

export interface HarnessAlignmentReport {
  ok: boolean;
  canonicalSource: string;
  checkedAt: string;
  harnesses: HarnessAlignmentItem[];
  outOfBounds: HarnessVersionCheck[];
  actions: string[];
  summary: string;
}

export interface HarnessAlignmentDependencies {
  resolveBinary?: (candidate: string) => Promise<string | null>;
  runVersion?: (binaryPath: string, args: string[]) => Promise<string>;
}

export interface HarnessAlignmentOptions extends HarnessAlignmentDependencies {
  dryRun?: boolean;
  force?: boolean;
  canonicalSource?: string;
  alignAllTargets?: boolean;
}

export async function defaultResolveBinary(candidate: string): Promise<string | null> {
  const expanded = expandTilde(candidate);
  if (isAbsolute(expanded)) {
    try {
      await access(expanded, fsConstants.X_OK);
      return expanded;
    } catch {
      return null;
    }
  }

  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(":");
  for (const dir of dirs) {
    if (!dir) continue;
    const full = join(dir, candidate);
    try {
      await access(full, fsConstants.X_OK);
      return full;
    } catch {
      // Continue searching
    }
  }
  return null;
}

export async function defaultRunVersion(binaryPath: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(binaryPath, args, {
    timeout: 4000,
    encoding: "utf8",
  });
  return stdout.trim() || stderr.trim();
}

export async function checkHarnessVersion(
  spec: HarnessSpec,
  deps: HarnessAlignmentDependencies = {},
): Promise<HarnessVersionCheck> {
  const resolveBin = deps.resolveBinary ?? defaultResolveBinary;
  const runVer = deps.runVersion ?? defaultRunVersion;

  let binaryPath: string | null = null;
  for (const cand of spec.binaryCandidates) {
    const resolved = await resolveBin(cand);
    if (resolved) {
      binaryPath = resolved;
      break;
    }
  }

  if (!binaryPath) {
    return {
      harnessId: spec.id,
      name: spec.name,
      binaryPath: null,
      installed: false,
      knownVersion: spec.knownVersion,
      minVersion: spec.minVersion,
      maxVersion: spec.maxVersion,
      inBounds: true,
      status: "not-installed",
      message: `${spec.name} is not installed (binary candidates: ${spec.binaryCandidates.join(", ")})`,
    };
  }

  let rawOutput = "";
  try {
    rawOutput = await runVer(binaryPath, spec.versionArgs);
  } catch (error) {
    const errStr = error instanceof Error ? error.message : String(error);
    return {
      harnessId: spec.id,
      name: spec.name,
      binaryPath,
      installed: true,
      rawVersionOutput: rawOutput,
      knownVersion: spec.knownVersion,
      minVersion: spec.minVersion,
      maxVersion: spec.maxVersion,
      inBounds: false,
      status: "version-error",
      message: `Failed to execute ${binaryPath} ${spec.versionArgs.join(" ")}: ${errStr}`,
    };
  }

  const match = rawOutput.match(spec.versionRegex);
  const detectedVersion = match ? match[1] : undefined;

  if (!detectedVersion) {
    return {
      harnessId: spec.id,
      name: spec.name,
      binaryPath,
      installed: true,
      rawVersionOutput: rawOutput,
      knownVersion: spec.knownVersion,
      minVersion: spec.minVersion,
      maxVersion: spec.maxVersion,
      inBounds: false,
      status: "version-error",
      message: `Could not parse version from "${rawOutput}" using regex ${spec.versionRegex}`,
    };
  }

  const inBounds = isVersionInBounds(detectedVersion, spec.minVersion, spec.maxVersion);
  if (!inBounds) {
    return {
      harnessId: spec.id,
      name: spec.name,
      binaryPath,
      installed: true,
      rawVersionOutput: rawOutput,
      detectedVersion,
      knownVersion: spec.knownVersion,
      minVersion: spec.minVersion,
      maxVersion: spec.maxVersion,
      inBounds: false,
      status: "out-of-bounds",
      message: `${spec.name} version ${detectedVersion} is outside known bounds [${spec.minVersion}, ${spec.maxVersion}] (baseline: ${spec.knownVersion}). Instructions discovery rules may have changed. Re-confirm configuration and update version bounds.`,
    };
  }

  return {
    harnessId: spec.id,
    name: spec.name,
    binaryPath,
    installed: true,
    rawVersionOutput: rawOutput,
    detectedVersion,
    knownVersion: spec.knownVersion,
    minVersion: spec.minVersion,
    maxVersion: spec.maxVersion,
    inBounds: true,
    status: "in-bounds",
    message: `${spec.name} version ${detectedVersion} is within allowed bounds [${spec.minVersion}, ${spec.maxVersion}].`,
  };
}

export async function alignTarget(
  target: HarnessTarget,
  canonicalSource: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): Promise<TargetAlignmentStatus> {
  const resolvedTarget = expandTilde(target.path);
  const resolvedCanonical = expandTilde(canonicalSource);

  // Validate that canonical source exists before attempting alignment
  try {
    await access(resolvedCanonical, fsConstants.R_OK);
  } catch {
    return {
      targetId: target.id,
      path: target.path,
      resolvedPath: resolvedTarget,
      kind: target.kind,
      aligned: false,
      wouldAlign: false,
      blocked: true,
      actionTaken: "none",
      message: `Canonical instructions file ${canonicalSource} does not exist or is unreadable.`,
    };
  }

  if (target.kind === "symlink") {
    const expectedCanonicalRealpath = await realpath(resolvedCanonical);
    const targetParent = dirname(resolvedTarget);
    const relativeTarget = relative(targetParent, resolvedCanonical);

    try {
      const stat = await lstat(resolvedTarget);
      if (stat.isSymbolicLink()) {
        try {
          const actualTargetRealpath = await realpath(resolvedTarget);
          if (actualTargetRealpath === expectedCanonicalRealpath) {
            return {
              targetId: target.id,
              path: target.path,
              resolvedPath: resolvedTarget,
              kind: target.kind,
              aligned: true,
              wouldAlign: true,
              blocked: false,
              actionTaken: "none",
              message: `Symlink already correctly points to ${canonicalSource}`,
            };
          }
        } catch {
          // Dangling or broken symlink
        }

        // Broken or incorrect symlink
        if (options.dryRun) {
          return {
            targetId: target.id,
            path: target.path,
            resolvedPath: resolvedTarget,
            kind: target.kind,
            aligned: false,
            wouldAlign: true,
            blocked: false,
            actionTaken: "none",
            message: `Would recreate symlink ${target.path} -> ${relativeTarget}`,
          };
        }

        await unlink(resolvedTarget);
        await symlink(relativeTarget, resolvedTarget);
        return {
          targetId: target.id,
          path: target.path,
          resolvedPath: resolvedTarget,
          kind: target.kind,
          aligned: true,
          wouldAlign: true,
          blocked: false,
          actionTaken: "recreated-symlink",
          message: `Recreated symlink ${target.path} -> ${relativeTarget}`,
        };
      }

      // Existing regular file
      const currentContent = await readFile(resolvedTarget, "utf8");
      const canonicalContent = await readFile(resolvedCanonical, "utf8");

      if (currentContent === canonicalContent) {
        if (options.dryRun) {
          return {
            targetId: target.id,
            path: target.path,
            resolvedPath: resolvedTarget,
            kind: target.kind,
            aligned: false,
            wouldAlign: true,
            blocked: false,
            actionTaken: "none",
            message: `Would replace identical regular file with symlink ${target.path} -> ${relativeTarget}`,
          };
        }
        await unlink(resolvedTarget);
        await symlink(relativeTarget, resolvedTarget);
        return {
          targetId: target.id,
          path: target.path,
          resolvedPath: resolvedTarget,
          kind: target.kind,
          aligned: true,
          wouldAlign: true,
          blocked: false,
          actionTaken: "recreated-symlink",
          message: `Replaced identical regular file with symlink ${target.path} -> ${relativeTarget}`,
        };
      }

      if (!options.force) {
        return {
          targetId: target.id,
          path: target.path,
          resolvedPath: resolvedTarget,
          kind: target.kind,
          aligned: false,
          wouldAlign: false,
          blocked: true,
          actionTaken: "none",
          message: `Target ${target.path} is an existing regular file with differing content; use --force to replace with symlink.`,
        };
      }

      if (options.dryRun) {
        return {
          targetId: target.id,
          path: target.path,
          resolvedPath: resolvedTarget,
          kind: target.kind,
          aligned: false,
          wouldAlign: true,
          blocked: false,
          actionTaken: "none",
          message: `Would force-backup differing file to ${target.path}.bak and create symlink`,
        };
      }

      await rename(resolvedTarget, `${resolvedTarget}.bak`);
      await symlink(relativeTarget, resolvedTarget);
      return {
        targetId: target.id,
        path: target.path,
        resolvedPath: resolvedTarget,
        kind: target.kind,
        aligned: true,
        wouldAlign: true,
        blocked: false,
        actionTaken: "recreated-symlink",
        message: `Backed up differing regular file to ${target.path}.bak and created symlink -> ${relativeTarget}`,
      };
    } catch {
      // File does not exist
      if (options.dryRun) {
        return {
          targetId: target.id,
          path: target.path,
          resolvedPath: resolvedTarget,
          kind: target.kind,
          aligned: false,
          wouldAlign: true,
          blocked: false,
          actionTaken: "none",
          message: `Would create symlink ${target.path} -> ${relativeTarget}`,
        };
      }

      await mkdir(targetParent, { recursive: true });
      await symlink(relativeTarget, resolvedTarget);
      return {
        targetId: target.id,
        path: target.path,
        resolvedPath: resolvedTarget,
        kind: target.kind,
        aligned: true,
        wouldAlign: true,
        blocked: false,
        actionTaken: "created-symlink",
        message: `Created symlink ${target.path} -> ${relativeTarget}`,
      };
    }
  }

  // target.kind === "claude-import"
  const expectedImport = target.expectedContent ?? `@${toTildePath(resolvedCanonical)}`;
  try {
    const content = await readFile(resolvedTarget, "utf8");
    if (content.includes(expectedImport)) {
      return {
        targetId: target.id,
        path: target.path,
        resolvedPath: resolvedTarget,
        kind: target.kind,
        aligned: true,
        wouldAlign: true,
        blocked: false,
        actionTaken: "none",
        message: `${target.path} already includes import ${expectedImport}`,
      };
    }

    if (options.dryRun) {
      return {
        targetId: target.id,
        path: target.path,
        resolvedPath: resolvedTarget,
        kind: target.kind,
        aligned: false,
        wouldAlign: true,
        blocked: false,
        actionTaken: "none",
        message: `Would append import ${expectedImport} to ${target.path}`,
      };
    }

    const updated = content.endsWith("\n")
      ? `${content}${expectedImport}\n`
      : `${content}\n${expectedImport}\n`;
    await writeFile(resolvedTarget, updated, "utf8");
    return {
      targetId: target.id,
      path: target.path,
      resolvedPath: resolvedTarget,
      kind: target.kind,
      aligned: true,
      wouldAlign: true,
      blocked: false,
      actionTaken: "updated-import",
      message: `Appended import ${expectedImport} to ${target.path}`,
    };
  } catch {
    // File does not exist
    if (options.dryRun) {
      return {
        targetId: target.id,
        path: target.path,
        resolvedPath: resolvedTarget,
        kind: target.kind,
        aligned: false,
        wouldAlign: true,
        blocked: false,
        actionTaken: "none",
        message: `Would create ${target.path} with import ${expectedImport}`,
      };
    }

    await mkdir(dirname(resolvedTarget), { recursive: true });
    await writeFile(resolvedTarget, `${expectedImport}\n`, "utf8");
    return {
      targetId: target.id,
      path: target.path,
      resolvedPath: resolvedTarget,
      kind: target.kind,
      aligned: true,
      wouldAlign: true,
      blocked: false,
      actionTaken: "updated-import",
      message: `Created ${target.path} with import ${expectedImport}`,
    };
  }
}

/**
 * Encapsulated process to verify agent harness versions and maintain global instructions alignment.
 *
 * Requirements:
 * 1. Check current version of each agent harness.
 * 2. If any installed harness version is outside its reasonable bounds, FAIL and do not silently apply changes.
 *    Requires re-confirmation of configurations and update of the version checker.
 * 3. When versions are within bounds, check and re-apply alignment as needed.
 */
export async function ensureHarnessAlignment(
  options: HarnessAlignmentOptions = {},
): Promise<HarnessAlignmentReport> {
  const canonicalSource = options.canonicalSource ?? DEFAULT_CANONICAL_INSTRUCTIONS_SOURCE;
  const canonicalResolved = expandTilde(canonicalSource);

  try {
    await access(canonicalResolved, fsConstants.R_OK);
  } catch {
    return {
      ok: false,
      canonicalSource,
      checkedAt: new Date().toISOString(),
      harnesses: [],
      outOfBounds: [],
      actions: [],
      summary: `Alignment failed: Canonical instructions source ${canonicalSource} does not exist or is unreadable.`,
    };
  }

  // 1. Run version checks across all known harnesses
  const versionChecks = await Promise.all(
    KNOWN_HARNESS_SPECS.map((spec) => checkHarnessVersion(spec, options)),
  );

  const outOfBounds = versionChecks.filter((vc) => vc.status === "out-of-bounds");

  // If any installed harness version is out of bounds, fail immediately
  if (outOfBounds.length > 0) {
    const errorMessages = outOfBounds.map((o) => `  - ${o.message}`).join("\n");
    return {
      ok: false,
      canonicalSource,
      checkedAt: new Date().toISOString(),
      harnesses: KNOWN_HARNESS_SPECS.map((spec, i) => ({
        harness: spec,
        version: versionChecks[i]!,
        targets: [],
        ok: false,
      })),
      outOfBounds,
      actions: [],
      summary: `Alignment check FAILED: ${outOfBounds.length} harness version(s) out of known bounds:\n${errorMessages}\nManual re-confirmation of configuration and update of version checker required.`,
    };
  }

  // 2. For all harnesses, verify and apply target alignments
  const actions: string[] = [];
  const harnessReports: HarnessAlignmentItem[] = [];

  for (let i = 0; i < KNOWN_HARNESS_SPECS.length; i++) {
    const spec = KNOWN_HARNESS_SPECS[i]!;
    const version = versionChecks[i]!;

    if (!version.installed && !options.alignAllTargets) {
      harnessReports.push({
        harness: spec,
        version,
        targets: [],
        ok: true,
      });
      continue;
    }

    const targetStatuses: TargetAlignmentStatus[] = [];
    for (const target of spec.targets) {
      const status = await alignTarget(target, canonicalSource, options);
      targetStatuses.push(status);
      if (status.actionTaken && status.actionTaken !== "none") {
        actions.push(status.message);
      }
    }

    const allTargetsOk = targetStatuses.every((t) =>
      options.dryRun ? (t.aligned || t.wouldAlign) && !t.blocked : t.aligned,
    );
    harnessReports.push({
      harness: spec,
      version,
      targets: targetStatuses,
      ok: allTargetsOk && version.status !== "version-error",
    });
  }

  const allOk = harnessReports.every((hr) => hr.ok);
  const installedCount = versionChecks.filter((v) => v.installed).length;

  let summary: string;
  if (!allOk) {
    summary = `Alignment incomplete: one or more targets could not be aligned.`;
  } else if (actions.length > 0) {
    summary = `Successfully aligned ${actions.length} target(s) across ${installedCount} detected harness(es) (all within known version bounds).`;
  } else if (installedCount === 0) {
    summary = `No agent harnesses detected on system; all version bounds checked against ${canonicalSource}.`;
  } else {
    summary = `All ${installedCount} detected agent harness(es) are within version bounds and aligned with ${canonicalSource}.`;
  }

  return {
    ok: allOk,
    canonicalSource,
    checkedAt: new Date().toISOString(),
    harnesses: harnessReports,
    outOfBounds: [],
    actions,
    summary,
  };
}
