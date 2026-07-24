/**
 * Task C.1 — Immutable TaskExecutionSnapshot.
 * Created before every sandbox launch; survives crash/reload as the approval checkpoint.
 */

/** Describes one file in the workspace projection. */
export interface ProjectionFile {
  readonly relativePath: string;
  readonly sourceChecksum: string;
  readonly projectedPath: string;
}

/** Manifest of all files copied into the disposable workspace projection. */
export interface ProjectionManifest {
  readonly manifestId: string;
  readonly taskId: string;
  readonly snapshotId: string;
  readonly files: readonly ProjectionFile[];
  readonly manifestDigest: string;
}

/**
 * Immutable execution snapshot frozen before a task is launched.
 * Must be Object.freeze'd so no code path can mutate it after creation.
 */
export interface TaskExecutionSnapshot {
  readonly snapshotId: string;
  readonly taskId: string;
  /** SHA-256 of the launcher executable as seen at snapshot time. */
  readonly canonicalExecutable: string;
  /** Fully-resolved argument array (no shell interpolation). */
  readonly normalizedArgv: readonly string[];
  /** SHA-256 of the structured parameters JSON. */
  readonly parametersDigest: string;
  /** Stable workspace identity string (e.g. content-root SHA-256). */
  readonly workspaceIdentity: string;
  /** Catalog revision at the time of authorization. */
  readonly catalogRevision: string;
  /** Opaque attestation ID from Main's qualification store. */
  readonly attestationRef: string;
  /** File access profile: which paths the task may read/write. */
  readonly fileProfile: "workspace_read_only" | "scratch_output";
  /** Resource quota descriptor (serialized for persistence). */
  readonly resourceQuota: Readonly<{
    maxCpuMs: number;
    maxMemoryBytes: number;
    maxWallClockMs: number;
    maxProcesses: number;
    maxScratchBytes: number;
  }>;
  /** Workspace projection built before launch. */
  readonly projectionManifest: ProjectionManifest | null;
  readonly createdAt: string;
}

export interface CreateTaskExecutionSnapshotInput {
  readonly snapshotId: string;
  readonly taskId: string;
  readonly canonicalExecutable: string;
  readonly normalizedArgv: readonly string[];
  readonly parametersDigest: string;
  readonly workspaceIdentity: string;
  readonly catalogRevision: string;
  readonly attestationRef: string;
  readonly fileProfile: TaskExecutionSnapshot["fileProfile"];
  readonly resourceQuota: TaskExecutionSnapshot["resourceQuota"];
  readonly projectionManifest?: ProjectionManifest | null;
}

/** Factory for immutable TaskExecutionSnapshot. Object.freeze prevents post-creation mutation. */
export function createTaskExecutionSnapshot(
  input: CreateTaskExecutionSnapshotInput
): TaskExecutionSnapshot {
  const snapshot: TaskExecutionSnapshot = Object.freeze({
    snapshotId: input.snapshotId,
    taskId: input.taskId,
    canonicalExecutable: input.canonicalExecutable,
    normalizedArgv: Object.freeze([...input.normalizedArgv]),
    parametersDigest: input.parametersDigest,
    workspaceIdentity: input.workspaceIdentity,
    catalogRevision: input.catalogRevision,
    attestationRef: input.attestationRef,
    fileProfile: input.fileProfile,
    resourceQuota: Object.freeze({ ...input.resourceQuota }),
    projectionManifest: input.projectionManifest ?? null,
    createdAt: new Date().toISOString()
  });
  return snapshot;
}
