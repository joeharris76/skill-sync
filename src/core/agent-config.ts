import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sha256 } from "./hasher.js";

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_RELATIVE_DIR = ".skill-sync/agent-config";
const SNAPSHOT_METADATA_FILE = "snapshot.json";
const SNAPSHOT_GITIGNORE_FILE = ".gitignore";
const SNAPSHOT_GITIGNORE_MARKER = "# skill-sync agent-config snapshot files are local payloads";
const SNAPSHOT_GITIGNORE_CONTENT = "*\n!.gitignore\n!snapshot.json\n";
const OPERATION_LOCK_FILE = ".skill-sync/agent-config.lock";
const CAPTURE_JOURNAL_FILE = ".skill-sync/agent-config-capture.json";
const RESTORE_JOURNAL_FILE = ".restore-journal.json";
const JOURNAL_SCHEMA_VERSION = 1;

export type AgentConfigScope = "global" | "project";
export type AgentConfigPresence = "present" | "missing";

export interface AgentConfigFileSpec {
  id: string;
  agent: "claude" | "codex" | "gemini";
  scope: AgentConfigScope;
  sourcePath: string;
  snapshotPath: string;
  relativePath: string;
}

/** The only instruction files captured by this MVP. Keep this list explicit. */
export const AGENT_CONFIG_FILE_SPECS: readonly AgentConfigFileSpec[] = [
  {
    id: "global.claude",
    agent: "claude",
    scope: "global",
    sourcePath: "~/.claude/CLAUDE.md",
    snapshotPath: "global/claude/CLAUDE.md",
    relativePath: ".claude/CLAUDE.md",
  },
  {
    id: "global.codex",
    agent: "codex",
    scope: "global",
    sourcePath: "~/.codex/AGENTS.md",
    snapshotPath: "global/codex/AGENTS.md",
    relativePath: ".codex/AGENTS.md",
  },
  {
    id: "global.gemini",
    agent: "gemini",
    scope: "global",
    sourcePath: "~/.gemini/GEMINI.md",
    snapshotPath: "global/gemini/GEMINI.md",
    relativePath: ".gemini/GEMINI.md",
  },
  {
    id: "project.claude",
    agent: "claude",
    scope: "project",
    sourcePath: "CLAUDE.md",
    snapshotPath: "project/CLAUDE.md",
    relativePath: "CLAUDE.md",
  },
  {
    id: "project.codex",
    agent: "codex",
    scope: "project",
    sourcePath: "AGENTS.md",
    snapshotPath: "project/AGENTS.md",
    relativePath: "AGENTS.md",
  },
  {
    id: "project.gemini",
    agent: "gemini",
    scope: "project",
    sourcePath: "GEMINI.md",
    snapshotPath: "project/GEMINI.md",
    relativePath: "GEMINI.md",
  },
];

export interface AgentConfigSnapshotEntry {
  id: string;
  agent: AgentConfigFileSpec["agent"];
  scope: AgentConfigScope;
  sourcePath: string;
  snapshotPath: string;
  state: AgentConfigPresence;
  sha256?: string;
  size?: number;
}

export interface AgentConfigSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  capturedAt: string;
  files: AgentConfigSnapshotEntry[];
}

export interface AgentConfigOptions {
  projectRoot: string;
  /** Test and embedding seam; the CLI uses the process home by default. */
  homeDir?: string;
}

export interface AgentConfigCaptureOptions extends AgentConfigOptions {
  dryRun?: boolean;
}

export interface AgentConfigCaptureResult {
  snapshotPath: string;
  dryRun: boolean;
  applied: boolean;
  snapshot: AgentConfigSnapshot;
}

export type AgentConfigDriftStatus = "unchanged" | "modified" | "missing" | "added";

export interface AgentConfigValidationEntry {
  id: string;
  agent: AgentConfigFileSpec["agent"];
  scope: AgentConfigScope;
  sourcePath: string;
  expectedState: AgentConfigPresence;
  actualState: AgentConfigPresence;
  expectedSha256?: string;
  actualSha256?: string;
  status: AgentConfigDriftStatus;
}

export interface AgentConfigValidationReport {
  snapshotPath: string;
  ok: boolean;
  entries: AgentConfigValidationEntry[];
}

export type AgentConfigRestoreAction = "unchanged" | "restore" | "conflict";

export interface AgentConfigRestoreEntry extends AgentConfigValidationEntry {
  action: AgentConfigRestoreAction;
  reason?: string;
}

export interface AgentConfigRestoreConflict {
  id: string;
  sourcePath: string;
  reason: "modified" | "snapshot-missing";
  message: string;
}

export interface AgentConfigRestoreOptions extends AgentConfigOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface AgentConfigRestoreResult {
  snapshotPath: string;
  dryRun: boolean;
  force: boolean;
  applied: boolean;
  entries: AgentConfigRestoreEntry[];
  restored: string[];
  forced: string[];
  conflicts: AgentConfigRestoreConflict[];
}

interface ResolvedFile extends AgentConfigFileSpec {
  absolutePath: string;
}

interface ObservedFile {
  file: ResolvedFile;
  state: AgentConfigPresence;
  content?: Buffer;
}

interface LoadedSnapshot {
  metadata: AgentConfigSnapshot;
  payloads: Map<string, Buffer>;
}

interface CaptureJournal {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  phase: "prepared" | "old-moved" | "new-installed";
  snapshotPath: string;
  tempPath: string;
  oldPath: string;
}

interface RestoreJournalEntry {
  id: string;
  destination: string;
  stagePath: string;
  expectedSha256: string;
  existed: boolean;
  backupPath?: string;
  backupMoved: boolean;
  installed: boolean;
}

interface RestoreJournal {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  phase: "applying" | "committed";
  createdAt: string;
  entries: RestoreJournalEntry[];
}

type AgentConfigFileHandle = Awaited<ReturnType<typeof fs.open>>;

interface AgentConfigLock {
  handle: AgentConfigFileHandle;
  ownerToken: string;
  path: string;
  parentPath: string;
  parentCreated: boolean;
}

const HEX_SHA256 = /^[a-f0-9]{64}$/;

export function agentConfigSnapshotPath(projectRoot: string): string {
  return join(resolve(projectRoot), SNAPSHOT_RELATIVE_DIR);
}

export function resolveAgentConfigFiles(
  projectRoot: string,
  homeDirectory = homedir(),
): ResolvedFile[] {
  const root = resolve(projectRoot);
  const home = resolve(homeDirectory);
  return AGENT_CONFIG_FILE_SPECS.map((spec) => ({
    ...spec,
    absolutePath:
      spec.scope === "global" ? join(home, spec.relativePath) : join(root, spec.relativePath),
  }));
}

/** Capture the six files, or only report the capture when dryRun is true. */
export async function captureAgentConfig(
  options: AgentConfigCaptureOptions,
): Promise<AgentConfigCaptureResult> {
  return withAgentConfigLock(options.projectRoot, options.homeDir, !options.dryRun, async () => {
    const files = resolveAgentConfigFiles(options.projectRoot, options.homeDir);
    const observed = await observeFiles(files);
    const snapshot = createSnapshot(observed);
    const snapshotPath = agentConfigSnapshotPath(options.projectRoot);

    if (!options.dryRun) {
      await writeSnapshotAtomically(snapshotPath, snapshot, observed);
    }

    return {
      snapshotPath,
      dryRun: options.dryRun ?? false,
      applied: !(options.dryRun ?? false),
      snapshot,
    };
  });
}

/** Compare every live allowlisted file with the captured snapshot. */
export async function validateAgentConfig(
  options: AgentConfigOptions,
): Promise<AgentConfigValidationReport> {
  return withAgentConfigLock(options.projectRoot, options.homeDir, true, async () => {
    const loaded = await readSnapshot(options.projectRoot);
    const observed = await observeFiles(
      resolveAgentConfigFiles(options.projectRoot, options.homeDir),
    );
    const entries = compareFiles(loaded.metadata.files, observed);

    return {
      snapshotPath: agentConfigSnapshotPath(options.projectRoot),
      ok: entries.every((entry) => entry.status === "unchanged"),
      entries,
    };
  });
}

/**
 * Restore captured payloads without deleting paths that were missing at
 * capture. All payloads are staged before the first destination is changed.
 */
export async function restoreAgentConfig(
  options: AgentConfigRestoreOptions,
): Promise<AgentConfigRestoreResult> {
  return withAgentConfigLock(options.projectRoot, options.homeDir, !options.dryRun, async () => {
    const loaded = await readSnapshot(options.projectRoot);
    const files = resolveAgentConfigFiles(options.projectRoot, options.homeDir);
    const observed = await observeFiles(files);
    const validationEntries = compareFiles(loaded.metadata.files, observed);
    const force = options.force ?? false;
    const { entries, conflicts } = planRestore(validationEntries, force);
    const snapshotPath = agentConfigSnapshotPath(options.projectRoot);

    const result: AgentConfigRestoreResult = {
      snapshotPath,
      dryRun: options.dryRun ?? false,
      force,
      applied: false,
      entries,
      restored: entries.filter((entry) => entry.action === "restore").map((entry) => entry.id),
      forced: entries
        .filter((entry) => entry.action === "restore" && entry.status === "modified")
        .map((entry) => entry.id),
      conflicts,
    };

    // A conflict blocks the whole transaction. In particular, do not restore a
    // different missing file while another destination would be overwritten.
    if (conflicts.length > 0 || options.dryRun) {
      return result;
    }

    await ensureSnapshotGitignore(snapshotPath);
    const payloads = new Map(
      loaded.metadata.files
        .filter((entry) => entry.state === "present")
        .map((entry) => [entry.id, loaded.payloads.get(entry.id)!]),
    );
    await applyRestoreTransaction(entries, files, payloads, force, snapshotPath);
    result.applied = true;
    return result;
  });
}

async function withAgentConfigLock<T>(
  projectRoot: string,
  homeDirectory: string | undefined,
  recover: boolean,
  action: () => Promise<T>,
): Promise<T> {
  const lock = await acquireAgentConfigLock(projectRoot);
  try {
    if (recover) {
      await recoverPendingOperations(projectRoot, homeDirectory);
    } else if (await hasPendingOperation(projectRoot)) {
      throw new Error(
        "An interrupted agent-config operation is pending; run a non-dry-run command to recover it first.",
      );
    }
    return await action();
  } finally {
    await releaseAgentConfigLock(lock);
  }
}

async function acquireAgentConfigLock(projectRoot: string): Promise<AgentConfigLock> {
  const lockPath = join(resolve(projectRoot), OPERATION_LOCK_FILE);
  const parentPath = dirname(lockPath);
  const parentCreated = !(await pathExists(parentPath));
  await fs.mkdir(parentPath, { recursive: true });
  let handle: AgentConfigFileHandle | undefined;
  const ownerToken = randomUUID();

  try {
    handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ownerToken })}\n`,
      "utf8",
    );
    await handle.sync();
    return { handle, ownerToken, path: lockPath, parentPath, parentCreated };
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Another agent-config operation is using ${resolve(projectRoot)}; ` +
          `the lock is fail-closed and must not be removed until its owner is confirmed stopped.`,
      );
    }
    throw error;
  }
}

async function removeOwnedAgentConfigLock(lock: AgentConfigLock): Promise<void> {
  let ownerToken: unknown;
  try {
    const lockContent = await fs.readFile(lock.path, "utf8");
    ownerToken = (JSON.parse(lockContent) as { ownerToken?: unknown }).ownerToken;
  } catch {
    return;
  }
  if (ownerToken === lock.ownerToken) {
    await fs.rm(lock.path, { force: true });
  }
}

async function releaseAgentConfigLock(lock: AgentConfigLock): Promise<void> {
  await lock.handle.close();
  await removeOwnedAgentConfigLock(lock);
  if (lock.parentCreated) {
    try {
      await fs.rmdir(lock.parentPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }
}

function captureJournalPath(projectRoot: string): string {
  return join(resolve(projectRoot), CAPTURE_JOURNAL_FILE);
}

function restoreJournalPath(projectRoot: string): string {
  return join(agentConfigSnapshotPath(projectRoot), RESTORE_JOURNAL_FILE);
}

async function hasPendingOperation(projectRoot: string): Promise<boolean> {
  const paths = [captureJournalPath(projectRoot), restoreJournalPath(projectRoot)];
  for (const path of paths) {
    try {
      await fs.access(path);
      return true;
    } catch {
      // No pending journal at this path.
    }
  }
  return false;
}

async function recoverPendingOperations(
  projectRoot: string,
  homeDirectory?: string,
): Promise<void> {
  await recoverCaptureJournal(projectRoot);
  await recoverRestoreJournal(projectRoot, homeDirectory);
}

async function recoverCaptureJournal(projectRoot: string): Promise<void> {
  const journalPath = captureJournalPath(projectRoot);
  const journal = await readJsonIfPresent<CaptureJournal>(journalPath);
  if (!journal) return;
  if (
    journal.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
    (journal.phase !== "prepared" &&
      journal.phase !== "old-moved" &&
      journal.phase !== "new-installed") ||
    journal.snapshotPath !== agentConfigSnapshotPath(projectRoot) ||
    typeof journal.tempPath !== "string" ||
    typeof journal.oldPath !== "string"
  ) {
    throw new Error(`Invalid agent-config capture journal at ${journalPath}.`);
  }
  const snapshotParent = dirname(journal.snapshotPath);
  if (
    !isPathInside(snapshotParent, journal.tempPath) ||
    !isPathInside(snapshotParent, journal.oldPath) ||
    !basename(journal.tempPath).startsWith(".agent-config-") ||
    !basename(journal.tempPath).endsWith(".tmp") ||
    !basename(journal.oldPath).startsWith(".agent-config-old-") ||
    !basename(journal.oldPath).endsWith(".tmp")
  ) {
    throw new Error(`Invalid agent-config capture journal paths at ${journalPath}.`);
  }

  const snapshotExists = await pathExists(journal.snapshotPath);
  const oldExists = await pathExists(journal.oldPath);
  if (journal.phase === "prepared") {
    await fs.rm(journal.tempPath, { recursive: true, force: true });
  } else if (!snapshotExists && oldExists) {
    await fs.rename(journal.oldPath, journal.snapshotPath);
  } else if (!snapshotExists && !oldExists) {
    throw new Error(
      `Agent-config capture recovery cannot find either snapshot or recovery copy; inspect ${journalPath}.`,
    );
  }
  await fs.rm(journal.tempPath, { recursive: true, force: true });
  await fs.rm(journal.oldPath, { recursive: true, force: true });
  await fs.rm(journalPath, { force: true });
}

async function recoverRestoreJournal(projectRoot: string, homeDirectory?: string): Promise<void> {
  const journalPath = restoreJournalPath(projectRoot);
  const journal = await readJsonIfPresent<RestoreJournal>(journalPath);
  if (!journal) return;
  validateRestoreJournal(journal, journalPath, projectRoot, homeDirectory);

  if (journal.phase === "committed") {
    await cleanupRestoreArtifacts(journal);
    await fs.rm(journalPath, { force: true });
    return;
  }

  const conflicts = await rollbackRestoreJournal(journal);
  if (conflicts.length > 0) {
    throw new Error(
      `Interrupted agent-config restore needs manual conflict resolution: ${conflicts.join(", ")}. Journal: ${journalPath}`,
    );
  }
  await cleanupRestoreArtifacts(journal);
  await fs.rm(journalPath, { force: true });
}

function validateRestoreJournal(
  journal: RestoreJournal,
  journalPath: string,
  projectRoot: string,
  homeDirectory?: string,
): void {
  if (
    journal.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
    (journal.phase !== "applying" && journal.phase !== "committed") ||
    typeof journal.createdAt !== "string" ||
    !Array.isArray(journal.entries) ||
    journal.entries.length > AGENT_CONFIG_FILE_SPECS.length
  ) {
    throw new Error(`Invalid agent-config restore journal at ${journalPath}.`);
  }
  const filesById = new Map(
    resolveAgentConfigFiles(projectRoot, homeDirectory).map((file) => [file.id, file]),
  );
  const ids = new Set<string>();
  for (const entry of journal.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.destination !== "string" ||
      typeof entry.stagePath !== "string" ||
      typeof entry.expectedSha256 !== "string" ||
      !HEX_SHA256.test(entry.expectedSha256) ||
      typeof entry.existed !== "boolean" ||
      typeof entry.backupMoved !== "boolean" ||
      typeof entry.installed !== "boolean" ||
      (entry.backupPath !== undefined && typeof entry.backupPath !== "string")
    ) {
      throw new Error(`Invalid agent-config restore journal entry at ${journalPath}.`);
    }
    const file = filesById.get(entry.id);
    if (!file || ids.has(entry.id) || resolve(entry.destination) !== file.absolutePath) {
      throw new Error(`Invalid agent-config restore journal destination at ${journalPath}.`);
    }
    ids.add(entry.id);
    const destinationDir = dirname(entry.destination);
    const artifactPrefix = `.${basename(entry.destination)}.agent-config-`;
    if (
      !isArtifactPath(entry.stagePath, destinationDir, artifactPrefix, ".tmp") ||
      (entry.backupPath !== undefined &&
        !isArtifactPath(entry.backupPath, destinationDir, artifactPrefix, ".bak")) ||
      (entry.backupMoved && entry.backupPath === undefined)
    ) {
      throw new Error(`Invalid agent-config restore journal artifact path at ${journalPath}.`);
    }
  }
}

function isArtifactPath(
  artifactPath: string,
  destinationDir: string,
  prefix: string,
  suffix: string,
): boolean {
  const name = basename(artifactPath);
  return (
    isPathInside(destinationDir, artifactPath) &&
    name.startsWith(prefix) &&
    name.endsWith(suffix) &&
    name.length > prefix.length + suffix.length
  );
}

function isPathInside(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeDurableJson(path: string, value: unknown): Promise<void> {
  await writeDurableFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeDurableFile(path: string, content: string | Buffer): Promise<void> {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  let handle: AgentConfigFileHandle | undefined;
  try {
    handle = await fs.open(tempPath, "w", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, path);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function createSnapshot(observed: ObservedFile[]): AgentConfigSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    files: observed.map(({ file, state, content }) => ({
      id: file.id,
      agent: file.agent,
      scope: file.scope,
      sourcePath: file.sourcePath,
      snapshotPath: file.snapshotPath,
      state,
      ...(state === "present" ? { sha256: sha256(content!), size: content!.byteLength } : {}),
    })),
  };
}

async function observeFiles(files: ResolvedFile[]): Promise<ObservedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const content = await readOptionalFile(file.absolutePath);
      return content === undefined
        ? { file, state: "missing" as const }
        : { file, state: "present" as const, content };
    }),
  );
}

async function readOptionalFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

function compareFiles(
  snapshotEntries: AgentConfigSnapshotEntry[],
  observed: ObservedFile[],
): AgentConfigValidationEntry[] {
  const snapshotById = new Map(snapshotEntries.map((entry) => [entry.id, entry]));
  return observed.map(({ file, state, content }) => {
    const expected = snapshotById.get(file.id)!;
    const actualSha256 = content === undefined ? undefined : sha256(content);
    let status: AgentConfigDriftStatus;

    if (expected.state === "missing") {
      status = state === "missing" ? "unchanged" : "added";
    } else if (state === "missing") {
      status = "missing";
    } else {
      status = actualSha256 === expected.sha256 ? "unchanged" : "modified";
    }

    return {
      id: file.id,
      agent: file.agent,
      scope: file.scope,
      sourcePath: file.sourcePath,
      expectedState: expected.state,
      actualState: state,
      expectedSha256: expected.sha256,
      actualSha256,
      status,
    };
  });
}

function planRestore(
  validationEntries: AgentConfigValidationEntry[],
  force: boolean,
): { entries: AgentConfigRestoreEntry[]; conflicts: AgentConfigRestoreConflict[] } {
  const conflicts: AgentConfigRestoreConflict[] = [];
  const entries = validationEntries.map((entry) => {
    if (entry.status === "unchanged") {
      return { ...entry, action: "unchanged" as const };
    }
    if (entry.status === "missing") {
      return { ...entry, action: "restore" as const };
    }
    if (entry.status === "modified" && force) {
      return { ...entry, action: "restore" as const, reason: "forced" };
    }

    const reason = entry.status === "modified" ? "modified" : "snapshot-missing";
    const message =
      reason === "modified"
        ? `Refusing to overwrite modified ${entry.sourcePath}; re-run restore with --force to replace it.`
        : `The snapshot recorded ${entry.sourcePath} as missing; restore will not delete the current file.`;
    conflicts.push({ id: entry.id, sourcePath: entry.sourcePath, reason, message });
    return { ...entry, action: "conflict" as const, reason: message };
  });
  return { entries, conflicts };
}

async function writeSnapshotAtomically(
  snapshotPath: string,
  snapshot: AgentConfigSnapshot,
  observed: ObservedFile[],
): Promise<void> {
  const parent = dirname(snapshotPath);
  await fs.mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.agent-config-${randomUUID()}.tmp`);
  const oldPath = join(parent, `.agent-config-old-${randomUUID()}.tmp`);
  const journalPath = captureJournalPath(dirname(parent));
  const existingGitignore = await readOptionalFile(join(snapshotPath, SNAPSHOT_GITIGNORE_FILE));
  const gitignore = protectSnapshotGitignore(existingGitignore);
  const journal: CaptureJournal = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    phase: "prepared",
    snapshotPath,
    tempPath,
    oldPath,
  };

  try {
    await fs.mkdir(tempPath, { recursive: true });
    for (const { file, state, content } of observed) {
      if (state !== "present") continue;
      const payloadPath = join(tempPath, file.snapshotPath);
      await fs.mkdir(dirname(payloadPath), { recursive: true });
      await fs.writeFile(payloadPath, content!);
    }
    await fs.writeFile(join(tempPath, SNAPSHOT_GITIGNORE_FILE), gitignore);
    await fs.writeFile(
      join(tempPath, SNAPSHOT_METADATA_FILE),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    await writeDurableJson(journalPath, journal);

    try {
      await fs.rename(snapshotPath, oldPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    journal.phase = "old-moved";
    await writeDurableJson(journalPath, journal);
    await fs.rename(tempPath, snapshotPath);
    journal.phase = "new-installed";
    await writeDurableJson(journalPath, journal);
    await fs.rm(oldPath, { recursive: true, force: true });
    await fs.rm(journalPath, { force: true });
  } catch (error) {
    await fs.rm(tempPath, { recursive: true, force: true });
    throw error;
  }
}

async function readSnapshot(projectRoot: string): Promise<LoadedSnapshot> {
  const snapshotPath = agentConfigSnapshotPath(projectRoot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(join(snapshotPath, SNAPSHOT_METADATA_FILE), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No agent-config snapshot found at ${snapshotPath}; run capture first.`);
    }
    throw error;
  }

  const metadata = parseSnapshotMetadata(parsed);
  const payloads = new Map<string, Buffer>();
  for (const entry of metadata.files) {
    if (entry.state !== "present") continue;
    let content: Buffer;
    try {
      content = await fs.readFile(join(snapshotPath, entry.snapshotPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Agent-config snapshot payload is corrupt for ${entry.sourcePath}.`);
      }
      throw error;
    }
    if (content.byteLength !== entry.size || sha256(content) !== entry.sha256) {
      throw new Error(`Agent-config snapshot payload is corrupt for ${entry.sourcePath}.`);
    }
    payloads.set(entry.id, content);
  }
  return { metadata, payloads };
}

async function ensureSnapshotGitignore(snapshotPath: string): Promise<void> {
  const guardPath = join(snapshotPath, SNAPSHOT_GITIGNORE_FILE);
  const existing = await readOptionalFile(guardPath);
  const protectedContent = protectSnapshotGitignore(existing);
  if (existing?.equals(protectedContent)) return;
  if (existing === undefined) {
    await fs.writeFile(guardPath, protectedContent, { flag: "wx" });
    return;
  }
  await writeDurableFile(guardPath, protectedContent);
}

function protectSnapshotGitignore(existing: Buffer | undefined): Buffer {
  if (existing === undefined) return Buffer.from(SNAPSHOT_GITIGNORE_CONTENT, "utf8");
  const current = existing.toString("utf8");
  if (current.includes(SNAPSHOT_GITIGNORE_MARKER)) return existing;
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  return Buffer.from(
    `${current}${separator}${SNAPSHOT_GITIGNORE_MARKER}\n${SNAPSHOT_GITIGNORE_CONTENT}`,
    "utf8",
  );
}

function parseSnapshotMetadata(value: unknown): AgentConfigSnapshot {
  if (!isRecord(value) || value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported agent-config snapshot schema; expected version ${SNAPSHOT_SCHEMA_VERSION}.`,
    );
  }
  if (typeof value.capturedAt !== "string" || !Array.isArray(value.files)) {
    throw new Error("Invalid agent-config snapshot metadata.");
  }
  if (value.files.length !== AGENT_CONFIG_FILE_SPECS.length) {
    throw new Error("Invalid agent-config snapshot metadata: the six-file allowlist is required.");
  }

  const expected = new Map(AGENT_CONFIG_FILE_SPECS.map((spec) => [spec.id, spec]));
  const files: AgentConfigSnapshotEntry[] = [];
  for (const rawEntry of value.files) {
    if (!isRecord(rawEntry) || typeof rawEntry.id !== "string") {
      throw new Error("Invalid agent-config snapshot file entry.");
    }
    const spec = expected.get(rawEntry.id);
    if (
      !spec ||
      rawEntry.agent !== spec.agent ||
      rawEntry.scope !== spec.scope ||
      rawEntry.sourcePath !== spec.sourcePath ||
      rawEntry.snapshotPath !== spec.snapshotPath ||
      (rawEntry.state !== "present" && rawEntry.state !== "missing")
    ) {
      throw new Error(`Invalid agent-config snapshot file entry: ${rawEntry.id}.`);
    }
    const state = rawEntry.state;
    const rawSha256 = rawEntry.sha256;
    const rawSize = rawEntry.size;
    if (state === "present") {
      if (
        typeof rawSha256 !== "string" ||
        !HEX_SHA256.test(rawSha256) ||
        typeof rawSize !== "number" ||
        !Number.isSafeInteger(rawSize) ||
        rawSize < 0
      ) {
        throw new Error(`Invalid agent-config snapshot metadata for ${rawEntry.id}.`);
      }
    }
    const entry: AgentConfigSnapshotEntry = {
      id: spec.id,
      agent: spec.agent,
      scope: spec.scope,
      sourcePath: spec.sourcePath,
      snapshotPath: spec.snapshotPath,
      state,
    };
    if (state === "present") {
      entry.sha256 = rawSha256 as string;
      entry.size = rawSize as number;
    }
    files.push(entry);
    expected.delete(rawEntry.id);
  }
  if (expected.size > 0) {
    throw new Error("Invalid agent-config snapshot metadata: duplicate or missing file entries.");
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: value.capturedAt,
    files,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface RestoreStage {
  file: ResolvedFile;
  stagePath: string;
  expected: AgentConfigValidationEntry;
}

async function applyRestoreTransaction(
  entries: AgentConfigRestoreEntry[],
  files: ResolvedFile[],
  payloads: Map<string, Buffer>,
  force: boolean,
  snapshotPath: string,
): Promise<void> {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const stages: RestoreStage[] = [];
  const restoreEntries = entries.filter((entry) => entry.action === "restore");
  for (const entry of restoreEntries) {
    if (!entry.expectedSha256) {
      throw new Error(`Missing expected hash for ${entry.sourcePath}.`);
    }
  }

  // Prepare every replacement before any destination is renamed. A failure
  // here cannot leave a destination partially restored.
  try {
    for (const entry of restoreEntries) {
      const file = filesById.get(entry.id)!;
      const content = payloads.get(entry.id);
      if (!content) throw new Error(`Missing snapshot payload for ${entry.sourcePath}.`);
      await fs.mkdir(dirname(file.absolutePath), { recursive: true });
      const stagePath = join(
        dirname(file.absolutePath),
        `.${basename(file.absolutePath)}.agent-config-${randomUUID()}.tmp`,
      );
      await fs.writeFile(stagePath, content, { flag: "wx" });
      stages.push({ file, stagePath, expected: entry });
    }
  } catch (error) {
    await Promise.all(stages.map((stage) => fs.rm(stage.stagePath, { force: true })));
    throw new Error(
      `Agent-config restore could not stage all files; no destinations were changed: ${formatError(error)}`,
    );
  }

  const journalPath = join(snapshotPath, RESTORE_JOURNAL_FILE);
  const journal: RestoreJournal = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    phase: "applying",
    createdAt: new Date().toISOString(),
    entries: stages.map((stage) => ({
      id: stage.expected.id,
      destination: stage.file.absolutePath,
      stagePath: stage.stagePath,
      expectedSha256: stage.expected.expectedSha256!,
      existed: false,
      backupMoved: false,
      installed: false,
    })),
  };
  try {
    await writeDurableJson(journalPath, journal);
  } catch (error) {
    await Promise.all(stages.map((stage) => fs.rm(stage.stagePath, { force: true })));
    throw new Error(
      `Agent-config restore could not prepare its recovery journal; no destinations were changed: ${formatError(error)}`,
    );
  }

  try {
    for (const stage of stages) {
      const journalEntry = journal.entries.find((entry) => entry.id === stage.expected.id)!;
      const current = await readOptionalFile(stage.file.absolutePath);
      if (current !== undefined && sha256(current) !== journalEntry.expectedSha256 && !force) {
        throw new Error(`Destination changed during restore: ${stage.expected.sourcePath}.`);
      }

      journalEntry.existed = current !== undefined;
      if (current !== undefined) {
        journalEntry.backupPath = join(
          dirname(stage.file.absolutePath),
          `.${basename(stage.file.absolutePath)}.agent-config-${randomUUID()}.bak`,
        );
      }
      await writeDurableJson(journalPath, journal);

      if (journalEntry.backupPath) {
        await fs.rename(stage.file.absolutePath, journalEntry.backupPath);
        journalEntry.backupMoved = true;
        const movedContent = await readOptionalFile(journalEntry.backupPath);
        if (
          movedContent === undefined ||
          (!force && sha256(movedContent) !== journalEntry.expectedSha256)
        ) {
          throw new Error(`Destination changed during restore: ${stage.expected.sourcePath}.`);
        }
        await writeDurableJson(journalPath, journal);
      }

      await installStagedFile(
        stage.stagePath,
        stage.file.absolutePath,
        journalEntry.expectedSha256,
        stage.expected.sourcePath,
      );
      journalEntry.installed = true;
      await writeDurableJson(journalPath, journal);
    }

    journal.phase = "committed";
    await writeDurableJson(journalPath, journal);
    await cleanupRestoreArtifacts(journal);
    await fs.rm(journalPath, { force: true });
  } catch (error) {
    if (journal.phase === "committed") {
      throw new Error(
        `Agent-config restore applied but cleanup remains pending at ${journalPath}: ${formatError(error)}`,
      );
    }
    try {
      const conflicts = await rollbackRestoreJournal(journal);
      if (conflicts.length > 0) {
        throw new Error(`rollback conflicts: ${conflicts.join(", ")}`);
      }
      await cleanupRestoreArtifacts(journal);
      await fs.rm(journalPath, { force: true });
    } catch (rollbackError) {
      throw new Error(
        `Agent-config restore failed; recovery remains pending at ${journalPath}: ${formatError(rollbackError)}`,
      );
    }
    throw new Error(`Agent-config restore failed and was rolled back: ${formatError(error)}`);
  }
}

async function installStagedFile(
  stagePath: string,
  destination: string,
  expectedSha256: string,
  sourcePath: string,
): Promise<void> {
  const staged = await readOptionalFile(stagePath);
  if (staged === undefined || sha256(staged) !== expectedSha256) {
    throw new Error(`Staged payload changed during restore: ${sourcePath}.`);
  }

  try {
    // The stage is created in the destination directory. link() is an atomic,
    // no-overwrite create; EEXIST preserves a concurrent writer's file.
    await fs.link(stagePath, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    // Defensive fallback for unusual filesystems. COPYFILE_EXCL retains the
    // no-overwrite rule, although this fallback is not crash-atomic.
    await fs.copyFile(stagePath, destination, fsConstants.COPYFILE_EXCL);
  }

  const installed = await readOptionalFile(destination);
  if (installed === undefined || sha256(installed) !== expectedSha256) {
    throw new Error(`Installed payload changed during restore: ${sourcePath}.`);
  }
  await fs.rm(stagePath, { force: true });
}

async function rollbackRestoreJournal(journal: RestoreJournal): Promise<string[]> {
  const conflicts: string[] = [];
  for (const entry of [...journal.entries].reverse()) {
    const destination = await readOptionalFile(entry.destination);
    const stageExists = await pathExists(entry.stagePath);
    const backup = entry.backupPath ? await readOptionalFile(entry.backupPath) : undefined;

    if (backup !== undefined) {
      if (destination === undefined) {
        if (entry.installed) {
          conflicts.push(entry.destination);
        } else {
          await fs.rename(entry.backupPath!, entry.destination);
        }
      } else if (sha256(destination) === entry.expectedSha256) {
        await fs.rm(entry.destination, { force: true });
        await fs.rename(entry.backupPath!, entry.destination);
      } else {
        conflicts.push(entry.destination);
      }
    } else if (entry.existed) {
      if (
        entry.backupMoved ||
        destination === undefined ||
        sha256(destination) !== entry.expectedSha256
      ) {
        conflicts.push(entry.destination);
      }
    } else if (!entry.installed && destination !== undefined) {
      if (!stageExists && sha256(destination) === entry.expectedSha256) {
        await fs.rm(entry.destination, { force: true });
      } else {
        conflicts.push(entry.destination);
      }
    } else if (entry.installed && !stageExists) {
      if (destination === undefined) {
        // Already rolled back or never installed.
      } else if (sha256(destination) === entry.expectedSha256) {
        await fs.rm(entry.destination, { force: true });
      } else {
        conflicts.push(entry.destination);
      }
    }

    await fs.rm(entry.stagePath, { force: true });
  }
  return conflicts;
}

async function cleanupRestoreArtifacts(journal: RestoreJournal): Promise<void> {
  await Promise.all(
    journal.entries.flatMap((entry) => {
      const paths = [entry.stagePath];
      if (entry.backupPath) paths.push(entry.backupPath);
      return paths.map((path) => fs.rm(path, { force: true }));
    }),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
