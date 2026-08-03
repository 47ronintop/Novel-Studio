/**
 * Task 0.1 — server-generated capability snapshot that gates which tools are visible in a run.
 * Main builds this from the qualification store and feature-flag state; renderer/model/project
 * content cannot construct or modify it.
 */

export type AgentWorkspaceKind = "creativeProject" | "engineeringWorkspace";

export type ProviderVisibleWorkspaceFileOperation =
  "replace_file" | "create_file" | "move_file" | "delete_file" | "create_directory";

export type ProviderVisibleWritingOperation =
  | "chapter_replace"
  | "chapter_create"
  | "chapter_rename"
  | "chapter_reorder"
  | "chapter_status"
  | "chapter_restore"
  | "story_bible_create"
  | "story_bible_patch"
  | "story_bible_status"
  | "story_bible_restore";

export type ProviderVisibleWriteOperation =
  ProviderVisibleWorkspaceFileOperation | ProviderVisibleWritingOperation;

export const WORKSPACE_FILE_OPERATION_ORDER = Object.freeze([
  "replace_file",
  "create_file",
  "move_file",
  "delete_file",
  "create_directory"
] as const satisfies readonly ProviderVisibleWorkspaceFileOperation[]);

export const WRITING_OPERATION_ORDER = Object.freeze([
  "chapter_replace",
  "chapter_create",
  "chapter_rename",
  "chapter_reorder",
  "chapter_status",
  "chapter_restore",
  "story_bible_create",
  "story_bible_patch",
  "story_bible_status",
  "story_bible_restore"
] as const satisfies readonly ProviderVisibleWritingOperation[]);

export const WRITE_OPERATION_ORDER = Object.freeze([
  ...WORKSPACE_FILE_OPERATION_ORDER,
  ...WRITING_OPERATION_ORDER
] as const satisfies readonly ProviderVisibleWriteOperation[]);

/**
 * Snapshot of which tool categories are currently available in this workspace + session.
 * All Phase flags default to false; Phase 0 (foundation) is implied by the presence of the object.
 * Attestation IDs are opaque references to Main's qualification store; callers never construct them.
 */
export interface AgentToolCapabilitySnapshot {
  /** Immutable once a run begins — workspace kind drives read-tool availability. */
  readonly workspaceKind: AgentWorkspaceKind;
  /** Phase A: search_project_text + find_project_references */
  readonly searchEnabled: boolean;
  /** Phase B: file create/move/delete/mkdir + Change Set v1.1 */
  readonly fileLifecycleEnabled: boolean;
  /**
   * Catalog 2.0 mutation qualifications. These are already intersected with the Main-owned
   * feature, backend, trusted-surface, and release-evidence gates. The legacy lifecycle flag above
   * never implies any member of either operation list.
   */
  readonly writingOperations?: readonly ProviderVisibleWritingOperation[];
  readonly workspaceFileOperations?: readonly ProviderVisibleWorkspaceFileOperation[];
  /** Story Bible v1.1: schema discovery, stable listing, references, and structured CRUD. */
  readonly storyBibleStructuredToolsEnabled?: boolean;
  /** Phase C: run_project_task — only when sandbox attestation is verified. */
  readonly controlledExecutionEnabled: boolean;
  /** Opaque attestation ID from Main's qualification store; absent when C is off. */
  readonly sandboxAttestationId?: string;
  /** Phase C Git: git_status + git_diff. Requires same read-only sandbox attestation. */
  readonly gitReadEnabled: boolean;
  /** Phase D: web_search + fetch_url */
  readonly networkReadEnabled: boolean;
  /** Phase E: plugin/<pluginId>/<toolId> dynamic tools */
  readonly pluginToolsEnabled: boolean;
  /** Phase E: mcp:<serverId>/<toolId> dynamic tools */
  readonly mcpToolsEnabled: boolean;
  /**
   * Monotonically-increasing revision of the feature-flag snapshot used to build this object.
   * Changes when any flag flips; included in Permission Summary and drift detection.
   */
  readonly featureFlagRevision: string;
}

/**
 * Validate and detach a capability snapshot before it is associated with a run.  The snapshot is
 * an authorization fact, so retaining a caller-owned object would allow a later mutation to widen
 * a run after its Permission Summary has been generated.
 */
export function freezeAgentToolCapabilitySnapshot(
  snapshot: AgentToolCapabilitySnapshot
): AgentToolCapabilitySnapshot {
  const writingOperations = canonicalWritingOperations(snapshot.writingOperations ?? []);
  const workspaceFileOperations = canonicalWorkspaceFileOperations(
    snapshot.workspaceFileOperations ?? []
  );
  if (
    (snapshot.workspaceKind !== "creativeProject" &&
      snapshot.workspaceKind !== "engineeringWorkspace") ||
    typeof snapshot.searchEnabled !== "boolean" ||
    typeof snapshot.fileLifecycleEnabled !== "boolean" ||
    (snapshot.storyBibleStructuredToolsEnabled !== undefined &&
      typeof snapshot.storyBibleStructuredToolsEnabled !== "boolean") ||
    typeof snapshot.controlledExecutionEnabled !== "boolean" ||
    typeof snapshot.gitReadEnabled !== "boolean" ||
    typeof snapshot.networkReadEnabled !== "boolean" ||
    typeof snapshot.pluginToolsEnabled !== "boolean" ||
    typeof snapshot.mcpToolsEnabled !== "boolean" ||
    typeof snapshot.featureFlagRevision !== "string" ||
    snapshot.featureFlagRevision.length === 0 ||
    (snapshot.sandboxAttestationId !== undefined &&
      typeof snapshot.sandboxAttestationId !== "string")
  ) {
    throw new Error("Invalid Agent tool capability snapshot.");
  }
  if (snapshot.controlledExecutionEnabled && !snapshot.sandboxAttestationId) {
    throw new Error("Controlled execution requires a sandbox attestation.");
  }
  return Object.freeze({
    workspaceKind: snapshot.workspaceKind,
    searchEnabled: snapshot.searchEnabled,
    fileLifecycleEnabled: snapshot.fileLifecycleEnabled,
    writingOperations,
    workspaceFileOperations,
    storyBibleStructuredToolsEnabled: snapshot.storyBibleStructuredToolsEnabled ?? false,
    controlledExecutionEnabled: snapshot.controlledExecutionEnabled,
    ...(snapshot.sandboxAttestationId === undefined
      ? {}
      : { sandboxAttestationId: snapshot.sandboxAttestationId }),
    gitReadEnabled: snapshot.gitReadEnabled,
    networkReadEnabled: snapshot.networkReadEnabled,
    pluginToolsEnabled: snapshot.pluginToolsEnabled,
    mcpToolsEnabled: snapshot.mcpToolsEnabled,
    featureFlagRevision: snapshot.featureFlagRevision
  });
}

/** The minimum capability snapshot that reproduces Stage-5 v1.0 behaviour (9 static tools only). */
export function createDefaultCapabilitySnapshot(
  workspaceKind: AgentWorkspaceKind = "creativeProject"
): AgentToolCapabilitySnapshot {
  return freezeAgentToolCapabilitySnapshot({
    workspaceKind,
    searchEnabled: false,
    fileLifecycleEnabled: false,
    writingOperations: [],
    workspaceFileOperations: [],
    storyBibleStructuredToolsEnabled: false,
    controlledExecutionEnabled: false,
    gitReadEnabled: false,
    networkReadEnabled: false,
    pluginToolsEnabled: false,
    mcpToolsEnabled: false,
    featureFlagRevision: "v1.0-default"
  });
}

export function qualifiedWritingOperations(
  snapshot: AgentToolCapabilitySnapshot
): readonly ProviderVisibleWritingOperation[] {
  return canonicalWritingOperations(snapshot.writingOperations ?? []);
}

export function qualifiedWorkspaceFileOperations(
  snapshot: AgentToolCapabilitySnapshot
): readonly ProviderVisibleWorkspaceFileOperation[] {
  return canonicalWorkspaceFileOperations(snapshot.workspaceFileOperations ?? []);
}

export function isProviderVisibleWritingOperation(
  value: unknown
): value is ProviderVisibleWritingOperation {
  return WRITING_OPERATION_ORDER.some((operation) => operation === value);
}

export function isProviderVisibleWorkspaceFileOperation(
  value: unknown
): value is ProviderVisibleWorkspaceFileOperation {
  return WORKSPACE_FILE_OPERATION_ORDER.some((operation) => operation === value);
}

export function isProviderVisibleWriteOperation(
  value: unknown
): value is ProviderVisibleWriteOperation {
  return isProviderVisibleWritingOperation(value) || isProviderVisibleWorkspaceFileOperation(value);
}

function canonicalWritingOperations(
  operations: readonly ProviderVisibleWritingOperation[]
): readonly ProviderVisibleWritingOperation[] {
  return canonicalOperations(
    operations,
    WRITING_OPERATION_ORDER,
    isProviderVisibleWritingOperation
  );
}

function canonicalWorkspaceFileOperations(
  operations: readonly ProviderVisibleWorkspaceFileOperation[]
): readonly ProviderVisibleWorkspaceFileOperation[] {
  return canonicalOperations(
    operations,
    WORKSPACE_FILE_OPERATION_ORDER,
    isProviderVisibleWorkspaceFileOperation
  );
}

function canonicalOperations<T extends ProviderVisibleWriteOperation>(
  operations: readonly T[],
  order: readonly T[],
  predicate: (value: unknown) => value is T
): readonly T[] {
  if (!Array.isArray(operations) || operations.some((operation) => !predicate(operation))) {
    throw new Error("Invalid Agent operation capability snapshot.");
  }
  const unique = new Set<T>(operations);
  if (unique.size !== operations.length) {
    throw new Error("Invalid Agent operation capability snapshot.");
  }
  return Object.freeze(order.filter((operation) => unique.has(operation)));
}
