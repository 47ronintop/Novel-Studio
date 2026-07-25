import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

/** A candidate task not yet authorized by the user. */
export interface ProjectTaskCandidate {
  readonly candidateId: string;
  readonly displayName: string;
  readonly launcherTemplate: string;
  readonly argvTemplate: readonly string[];
  readonly cwd: string;
  readonly fileProfile: "workspace_read_only" | "scratch_output";
  readonly resourceQuota: {
    readonly maxCpuMs: number;
    readonly maxMemoryBytes: number;
    readonly maxWallClockMs: number;
    readonly maxProcesses: number;
    readonly maxScratchBytes: number;
  };
  readonly timeout: number;
  readonly taskSourceDigest: string;
  readonly networkMode: "none";
}

/** A task that has been authorized by the user for use in runs. */
export interface AuthorizedTask extends ProjectTaskCandidate {
  readonly taskId: string;
  readonly catalogRevision: string;
  readonly authorizedAt: string;
}

interface Catalog {
  readonly schemaVersion: "1.0";
  readonly projectId: string;
  readonly updatedAt: string;
  readonly tasks: readonly AuthorizedTask[];
}

type ResourceQuota = ProjectTaskCandidate["resourceQuota"];

const CATALOG_SCHEMA_VERSION = "1.0";
const MAX_PROJECT_ID_LENGTH = 512;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_LAUNCHER_LENGTH = 128;
const MAX_ARGV_ENTRIES = 32;
const MAX_ARGV_ENTRY_LENGTH = 4096;
const MAX_ARGV_TOTAL_LENGTH = 16 * 1024;
const MAX_TIMEOUT_MS = 3_600_000;
const MAX_MEMORY_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_SCRATCH_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_PROCESSES = 64;

const CANDIDATE_KEYS = [
  "candidateId",
  "displayName",
  "launcherTemplate",
  "argvTemplate",
  "cwd",
  "fileProfile",
  "resourceQuota",
  "timeout",
  "taskSourceDigest",
  "networkMode"
] as const;

const AUTHORIZED_TASK_KEYS = [
  "taskId",
  ...CANDIDATE_KEYS,
  "catalogRevision",
  "authorizedAt"
] as const;

const RESOURCE_QUOTA_KEYS = [
  "maxCpuMs",
  "maxMemoryBytes",
  "maxWallClockMs",
  "maxProcesses",
  "maxScratchBytes"
] as const;

/**
 * App-local (not project-local) task authorization store.
 *
 * The catalog is a security boundary: persisted records are parsed as untrusted
 * input and reconstructed only after strict schema validation.
 */
export class ProjectTaskCatalogRepository {
  private readonly catalogRoot: string;

  constructor(options: { readonly userDataRoot: string }) {
    this.catalogRoot = resolve(join(options.userDataRoot, "agent-task-catalog"));
  }

  private catalogPath(projectId: string): string {
    // A digest avoids collisions introduced by filename sanitization or truncation.
    const projectDigest = createHash("sha256").update(projectId, "utf8").digest("hex");
    return join(this.catalogRoot, `project-${projectDigest}.json`);
  }

  /** List all authorized tasks for a project. */
  async listAuthorizedTasks(
    projectId: string
  ): Promise<Result<readonly AuthorizedTask[], UnifiedError>> {
    const projectError = validateProjectId(projectId);
    if (projectError !== undefined) return err(projectError);

    try {
      const content = await readFile(this.catalogPath(projectId), "utf8");
      const parsed: unknown = JSON.parse(content);
      const catalog = parseCatalog(parsed, projectId);
      if (!catalog.ok) return catalog;
      return ok(Object.freeze([...catalog.value.tasks]));
    } catch (error: unknown) {
      if (hasErrorCode(error, "ENOENT")) return ok(Object.freeze([]));
      if (error instanceof SyntaxError)
        return err(invalidCatalogError("Task catalog JSON is malformed."));
      return err(readCatalogError());
    }
  }

  /** Get a specific authorized task by taskId. */
  async getAuthorizedTask(
    projectId: string,
    taskId: string
  ): Promise<Result<AuthorizedTask | undefined, UnifiedError>> {
    const list = await this.listAuthorizedTasks(projectId);
    if (!list.ok) return list;
    return ok(list.value.find((task) => task.taskId === taskId));
  }

  /** Authorize a candidate after freezing its complete, validated definition. */
  async authorizeTask(
    projectId: string,
    candidate: ProjectTaskCandidate
  ): Promise<Result<AuthorizedTask, UnifiedError>> {
    const projectError = validateProjectId(projectId);
    if (projectError !== undefined) return err(projectError);

    const validatedCandidate = parseCandidate(candidate);
    if (!validatedCandidate.ok) return validatedCandidate;

    const list = await this.listAuthorizedTasks(projectId);
    if (!list.ok) return list;

    const now = new Date().toISOString();
    const taskId = `task_${createHash("sha256")
      .update(`${projectId}:${validatedCandidate.value.candidateId}:${now}`)
      .digest("hex")
      .slice(0, 16)}`;
    const catalogRevision = createHash("sha256")
      .update(`${projectId}:${taskId}:${now}`)
      .digest("hex")
      .slice(0, 16);

    const authorized = freezeAuthorizedTask({
      taskId,
      ...validatedCandidate.value,
      catalogRevision,
      authorizedAt: now
    });
    const updated = Object.freeze([...list.value, authorized]);
    const saved = await this.saveCatalog(projectId, updated);
    if (!saved.ok) return saved;
    return ok(authorized);
  }

  /** Revoke an authorized task. */
  async revokeTask(projectId: string, taskId: string): Promise<Result<void, UnifiedError>> {
    const list = await this.listAuthorizedTasks(projectId);
    if (!list.ok) return list;
    return this.saveCatalog(
      projectId,
      Object.freeze(list.value.filter((task) => task.taskId !== taskId))
    );
  }

  private async saveCatalog(
    projectId: string,
    tasks: readonly AuthorizedTask[]
  ): Promise<Result<void, UnifiedError>> {
    try {
      await mkdir(this.catalogRoot, { recursive: true });
      const data: Catalog = {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        projectId,
        updatedAt: new Date().toISOString(),
        tasks: Object.freeze(tasks.map((task) => freezeAuthorizedTask(task)))
      };
      await writeFile(this.catalogPath(projectId), JSON.stringify(data, null, 2), "utf8");
      return ok(undefined);
    } catch {
      return err(
        createUnifiedError({
          code: "AGENT_TASK_CATALOG_WRITE_FAILED",
          category: "StorageError",
          message: "Could not persist the task catalog.",
          recoverability: "user-action",
          suggestedAction: "Check app user-data directory permissions.",
          traceId: "project-task-catalog-repository"
        })
      );
    }
  }
}

function parseCatalog(value: unknown, expectedProjectId: string): Result<Catalog, UnifiedError> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "projectId", "updatedAt", "tasks"])
  ) {
    return err(invalidCatalogError("Task catalog has an unsupported schema."));
  }
  if (value.schemaVersion !== CATALOG_SCHEMA_VERSION || value.projectId !== expectedProjectId) {
    return err(invalidCatalogError("Task catalog does not match this project."));
  }
  if (!isCanonicalIsoDate(value.updatedAt) || !Array.isArray(value.tasks)) {
    return err(invalidCatalogError("Task catalog has invalid metadata."));
  }

  const tasks: AuthorizedTask[] = [];
  for (const task of value.tasks) {
    const parsedTask = parseAuthorizedTask(task);
    if (!parsedTask.ok) return parsedTask;
    tasks.push(parsedTask.value);
  }

  return ok(
    Object.freeze({
      schemaVersion: CATALOG_SCHEMA_VERSION,
      projectId: expectedProjectId,
      updatedAt: value.updatedAt,
      tasks: Object.freeze(tasks)
    })
  );
}

function parseAuthorizedTask(value: unknown): Result<AuthorizedTask, UnifiedError> {
  if (!isRecord(value) || !hasExactKeys(value, AUTHORIZED_TASK_KEYS)) {
    return err(invalidCatalogError("Task catalog contains an unsupported task record."));
  }
  if (
    !isTaskId(value.taskId) ||
    !isCatalogRevision(value.catalogRevision) ||
    !isCanonicalIsoDate(value.authorizedAt)
  ) {
    return err(invalidCatalogError("Task catalog contains invalid task metadata."));
  }

  const candidate = parseCandidate({
    candidateId: value.candidateId,
    displayName: value.displayName,
    launcherTemplate: value.launcherTemplate,
    argvTemplate: value.argvTemplate,
    cwd: value.cwd,
    fileProfile: value.fileProfile,
    resourceQuota: value.resourceQuota,
    timeout: value.timeout,
    taskSourceDigest: value.taskSourceDigest,
    networkMode: value.networkMode
  });
  if (!candidate.ok)
    return err(invalidCatalogError("Task catalog contains an invalid task definition."));
  return ok(
    freezeAuthorizedTask({
      taskId: value.taskId,
      ...candidate.value,
      catalogRevision: value.catalogRevision,
      authorizedAt: value.authorizedAt
    })
  );
}

function parseCandidate(value: unknown): Result<ProjectTaskCandidate, UnifiedError> {
  if (!isRecord(value) || !hasExactKeys(value, CANDIDATE_KEYS)) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_CANDIDATE_INVALID",
        "Task candidate has an unsupported schema."
      )
    );
  }
  if (!isIdentifier(value.candidateId) || !isDisplayName(value.displayName)) {
    return err(
      catalogError("AGENT_TASK_CATALOG_CANDIDATE_INVALID", "Task candidate identity is invalid.")
    );
  }
  if (!isSafeLauncher(value.launcherTemplate)) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_LAUNCHER_INVALID",
        "Task launcher must be a canonical executable name."
      )
    );
  }
  const argv = parseArgvTemplate(value.argvTemplate);
  if (!argv.ok) return argv;
  const cwd = parseCanonicalRelativeCwd(value.cwd);
  if (!cwd.ok) return cwd;
  if (value.fileProfile !== "workspace_read_only" && value.fileProfile !== "scratch_output") {
    return err(
      catalogError("AGENT_TASK_CATALOG_FILE_PROFILE_INVALID", "Task file profile is invalid.")
    );
  }
  const quota = parseResourceQuota(value.resourceQuota);
  if (!quota.ok) return quota;
  if (
    !isBoundedInteger(value.timeout, 1, MAX_TIMEOUT_MS) ||
    value.timeout > quota.value.maxWallClockMs
  ) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_TIMEOUT_INVALID",
        "Task timeout must not exceed its wall-clock quota."
      )
    );
  }
  if (
    typeof value.taskSourceDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.taskSourceDigest)
  ) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_DIGEST_INVALID",
        "Task source digest must be a lowercase SHA-256 digest."
      )
    );
  }
  if (value.networkMode !== "none") {
    return err(
      catalogError("AGENT_TASK_CATALOG_NETWORK_FORBIDDEN", "Tasks must have networkMode: none.")
    );
  }

  return ok(
    freezeCandidate({
      candidateId: value.candidateId,
      displayName: value.displayName,
      launcherTemplate: value.launcherTemplate,
      argvTemplate: argv.value,
      cwd: cwd.value,
      fileProfile: value.fileProfile,
      resourceQuota: quota.value,
      timeout: value.timeout,
      taskSourceDigest: value.taskSourceDigest,
      networkMode: "none"
    })
  );
}

function parseArgvTemplate(value: unknown): Result<readonly string[], UnifiedError> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARGV_ENTRIES) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_ARGV_INVALID",
        "Task argv template has an invalid entry count."
      )
    );
  }
  let totalLength = 0;
  const argv: string[] = [];
  for (const arg of value) {
    if (typeof arg !== "string" || arg.length === 0 || arg.length > MAX_ARGV_ENTRY_LENGTH) {
      return err(
        catalogError(
          "AGENT_TASK_CATALOG_ARGV_INVALID",
          "Task argv template contains an invalid argument."
        )
      );
    }
    totalLength += arg.length;
    if (totalLength > MAX_ARGV_TOTAL_LENGTH || !isSafeArgument(arg)) {
      return err(
        catalogError(
          "AGENT_TASK_CATALOG_ARGV_INVALID",
          "Task argv template contains an unsafe argument."
        )
      );
    }
    argv.push(arg);
  }
  return ok(Object.freeze(argv));
}

function parseCanonicalRelativeCwd(value: unknown): Result<string, UnifiedError> {
  if (typeof value !== "string" || !isCanonicalRelativePath(value, true)) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_PATH_INVALID",
        "Task cwd must be a canonical relative workspace path."
      )
    );
  }
  return ok(value);
}

function parseResourceQuota(value: unknown): Result<ResourceQuota, UnifiedError> {
  if (!isRecord(value) || !hasExactKeys(value, RESOURCE_QUOTA_KEYS)) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_QUOTA_INVALID",
        "Task resource quota has an unsupported schema."
      )
    );
  }
  if (
    !isBoundedInteger(value.maxCpuMs, 1, MAX_TIMEOUT_MS) ||
    !isBoundedInteger(value.maxMemoryBytes, 1, MAX_MEMORY_BYTES) ||
    !isBoundedInteger(value.maxWallClockMs, 1, MAX_TIMEOUT_MS) ||
    !isBoundedInteger(value.maxProcesses, 1, MAX_PROCESSES) ||
    !isBoundedInteger(value.maxScratchBytes, 0, MAX_SCRATCH_BYTES)
  ) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_QUOTA_INVALID",
        "Task resource quota must contain bounded integers."
      )
    );
  }
  if (value.maxCpuMs > value.maxWallClockMs * value.maxProcesses) {
    return err(
      catalogError(
        "AGENT_TASK_CATALOG_QUOTA_INVALID",
        "Task CPU quota is inconsistent with process and wall-clock limits."
      )
    );
  }
  return ok(
    Object.freeze({
      maxCpuMs: value.maxCpuMs,
      maxMemoryBytes: value.maxMemoryBytes,
      maxWallClockMs: value.maxWallClockMs,
      maxProcesses: value.maxProcesses,
      maxScratchBytes: value.maxScratchBytes
    })
  );
}

function freezeCandidate(candidate: ProjectTaskCandidate): ProjectTaskCandidate {
  return Object.freeze({
    ...candidate,
    argvTemplate: Object.freeze([...candidate.argvTemplate]),
    resourceQuota: Object.freeze({ ...candidate.resourceQuota })
  });
}

function freezeAuthorizedTask(task: AuthorizedTask): AuthorizedTask {
  return Object.freeze({
    ...task,
    argvTemplate: Object.freeze([...task.argvTemplate]),
    resourceQuota: Object.freeze({ ...task.resourceQuota })
  });
}

function isSafeLauncher(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_LAUNCHER_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  );
}

function isSafeArgument(value: string): boolean {
  if (
    hasControlCharacter(value) ||
    isAbsoluteOrDevicePath(value) ||
    hasPathTraversal(value) ||
    value.includes(":")
  ) {
    return false;
  }
  const remainder = value.replace(/\{\{[A-Za-z][A-Za-z0-9_]{0,63}\}\}/g, "");
  return !/[{}]/.test(remainder);
}

function isCanonicalRelativePath(value: string, allowCurrentDirectory: boolean): boolean {
  if (
    value.length === 0 ||
    value.length > 1024 ||
    hasControlCharacter(value) ||
    isAbsoluteOrDevicePath(value)
  ) {
    return false;
  }
  if (value === ".") return allowCurrentDirectory;
  if (
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("//") ||
    hasPathTraversal(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isAbsoluteOrDevicePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("//") ||
    /^[A-Za-z]:/.test(value) ||
    /^\\[?.]/.test(value) ||
    /^\\\.\\/.test(value)
  );
}

function hasPathTraversal(value: string): boolean {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  );
}

function isTaskId(value: unknown): value is string {
  return typeof value === "string" && /^task_[a-f0-9]{16}$/.test(value);
}

function isCatalogRevision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
}

function isDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DISPLAY_NAME_LENGTH &&
    !hasControlCharacter(value)
  );
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validateProjectId(projectId: string): UnifiedError | undefined {
  if (
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    projectId.length > MAX_PROJECT_ID_LENGTH ||
    hasControlCharacter(projectId)
  ) {
    return catalogError("AGENT_TASK_CATALOG_PROJECT_ID_INVALID", "Project ID is invalid.");
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function invalidCatalogError(message: string): UnifiedError {
  return catalogError("AGENT_TASK_CATALOG_INVALID", message);
}

function readCatalogError(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_TASK_CATALOG_READ_FAILED",
    category: "StorageError",
    message: "Could not read the task catalog.",
    recoverability: "user-action",
    suggestedAction: "Check app user-data directory permissions.",
    traceId: "project-task-catalog-repository"
  });
}

function catalogError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the task configuration before authorizing.",
    traceId: "project-task-catalog-repository"
  });
}
