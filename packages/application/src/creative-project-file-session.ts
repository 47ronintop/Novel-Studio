import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export const CREATIVE_PROJECT_FILE_SESSION_VERSION = "1.0" as const;

export interface CreativeProjectFileSessionIdentity {
  readonly projectId: string;
  readonly workspaceId: string;
}

/** Main-only activation input. Renderer commands never receive or submit projectRoot. */
export interface CreativeProjectFileSessionActivation extends CreativeProjectFileSessionIdentity {
  readonly projectRoot: string;
  /** Main-only visible source root for nested-folder projects. */
  readonly displayRoot?: string;
  readonly workspaceLayout?: "standalone" | "nested-folder";
  /** Main-owned workspace state root for durable lifecycle receipts. */
  readonly stateRoot?: string;
}

export interface CreativeProjectFileTreeNode {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly nodeRevision: string;
  readonly readOnlyReason?: string;
  readonly children?: readonly CreativeProjectFileTreeNode[];
}

export interface CreativeProjectFileTreeSnapshot {
  readonly schemaVersion: "1.1";
  readonly projectId: string;
  readonly workspaceId: string;
  readonly policyVersion: "1.0";
  readonly workspaceLayout: "standalone" | "nested-folder";
  readonly mutationMode: "read-write" | "read-only";
  readonly treeRevision: string;
  readonly nodes: readonly CreativeProjectFileTreeNode[];
  readonly truncated: boolean;
  readonly truncationReasons: readonly ("max_depth" | "max_items")[];
  readonly dependencyManifestChecksum: string;
}

export interface CreativeProjectFileDocument {
  readonly schemaVersion: "1.0";
  readonly projectId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly content: string;
  readonly checksum: string;
  readonly byteLength: number;
  readonly nodeRevision: string;
  readonly readOnlyReason?: string;
}

export type CreativeProjectFileSaveResult =
  | {
      readonly kind: "saved";
      readonly document: CreativeProjectFileDocument;
      readonly treeRevision: string;
    }
  | {
      readonly kind: "conflict";
      readonly conflictKind: "tree_revision" | "node_revision" | "checksum";
      readonly attemptedContent: string;
      readonly treeRevision: string;
      readonly current?: CreativeProjectFileDocument;
    };

interface CreativeProjectFileLifecycleCommandBase extends CreativeProjectFileSessionIdentity {
  readonly schemaVersion: "1.0";
  readonly commandId: string;
  readonly expectedTreeRevision: string;
}

export type CreativeProjectFileLifecycleCommand =
  | (CreativeProjectFileLifecycleCommandBase & {
      readonly kind: "createTextFile";
      readonly path: string;
      readonly content: string;
    })
  | (CreativeProjectFileLifecycleCommandBase & {
      readonly kind: "createDirectory";
      readonly path: string;
    })
  | (CreativeProjectFileLifecycleCommandBase & {
      readonly kind: "renamePath";
      readonly sourcePath: string;
      readonly targetPath: string;
      readonly expectedSourceRevision: string;
    })
  | (CreativeProjectFileLifecycleCommandBase & {
      readonly kind: "deleteFile";
      readonly path: string;
      readonly expectedSourceRevision: string;
      readonly confirmed: true;
    })
  | (CreativeProjectFileLifecycleCommandBase & {
      readonly kind: "deleteEmptyDirectory";
      readonly path: string;
      readonly expectedSourceRevision: string;
      readonly confirmed: true;
    });

export interface CreativeProjectFileLifecycleReceipt extends CreativeProjectFileSessionIdentity {
  readonly schemaVersion: "1.0";
  readonly commandId: string;
  readonly commandKind: CreativeProjectFileLifecycleCommand["kind"];
  readonly commandFingerprint: string;
  readonly treeRevision: string;
  readonly affectedPaths: readonly string[];
}

export type CreativeProjectFileMutationOrigin = "user" | "approved_agent_change_set";

/**
 * Application-owned port. Repository implementations bind their root internally;
 * this port intentionally has no root-bearing renderer operation.
 */
export interface CreativeProjectFileRepositoryPort {
  getTreeSnapshot(): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>>;
  readTextFile(path: string): Promise<Result<CreativeProjectFileDocument, UnifiedError>>;
  saveTextFile(input: {
    readonly projectId: string;
    readonly workspaceId: string;
    readonly path: string;
    readonly content: string;
    readonly expectedTreeRevision: string;
    readonly expectedNodeRevision: string;
    readonly expectedChecksum: string;
  }): Promise<Result<CreativeProjectFileSaveResult, UnifiedError>>;
  executeLifecycleCommand(
    command: CreativeProjectFileLifecycleCommand,
    origin?: CreativeProjectFileMutationOrigin
  ): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>>;
}

export interface CreateCreativeProjectFileSessionOptions {
  /** Called only by Main while a creativeProject activation is current. */
  readonly createRepository: (
    activation: CreativeProjectFileSessionActivation
  ) => CreativeProjectFileRepositoryPort;
}

export interface CreativeProjectFileSession {
  getActiveIdentity(): CreativeProjectFileSessionIdentity | undefined;
  getSnapshot(): CreativeProjectFileTreeSnapshot | undefined;
  activate(
    activation: CreativeProjectFileSessionActivation
  ): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>>;
  deactivate(): void;
  refresh(
    identity: CreativeProjectFileSessionIdentity
  ): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>>;
  readTextFile(
    input: CreativeProjectFileSessionIdentity & { readonly path: string }
  ): Promise<Result<CreativeProjectFileDocument, UnifiedError>>;
  saveTextFile(
    input: CreativeProjectFileSessionIdentity & {
      readonly path: string;
      readonly content: string;
      readonly expectedTreeRevision: string;
      readonly expectedNodeRevision: string;
      readonly expectedChecksum: string;
    }
  ): Promise<Result<CreativeProjectFileSaveResult, UnifiedError>>;
  executeLifecycleCommand(
    command: CreativeProjectFileLifecycleCommand,
    origin?: CreativeProjectFileMutationOrigin
  ): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>>;
}

interface ActiveCreativeProjectFileSession {
  readonly identity: CreativeProjectFileSessionIdentity;
  readonly repository: CreativeProjectFileRepositoryPort;
  readonly generation: number;
  readonly mutationMode: "read-write" | "read-only";
  snapshot: CreativeProjectFileTreeSnapshot;
}

/**
 * Binds file operations to the active creative project. Every renderer-facing
 * request carries only project/workspace identity and project-relative paths; a
 * stale request cannot be retargeted when Main switches projects.
 */
export function createCreativeProjectFileSession(
  options: CreateCreativeProjectFileSessionOptions
): CreativeProjectFileSession {
  let active: ActiveCreativeProjectFileSession | undefined;
  let generation = 0;
  let mutationLeaseTail: Promise<void> = Promise.resolve();

  return {
    getActiveIdentity: () => active?.identity,
    getSnapshot: () => active?.snapshot,

    activate(activation) {
      return withMutationLease(async () => {
        if (
          !isIdentity(activation) ||
          typeof activation.projectRoot !== "string" ||
          activation.projectRoot.length === 0 ||
          (activation.workspaceLayout !== undefined &&
            activation.workspaceLayout !== "standalone" &&
            activation.workspaceLayout !== "nested-folder") ||
          (activation.workspaceLayout === "nested-folder" &&
            (typeof activation.displayRoot !== "string" || activation.displayRoot.length === 0))
        ) {
          return activationFailure("CREATIVE_PROJECT_FILE_SESSION_ACTIVATION_INVALID");
        }
        let repository: CreativeProjectFileRepositoryPort;
        try {
          repository = options.createRepository(activation);
        } catch {
          return activationFailure("CREATIVE_PROJECT_FILE_SESSION_ACTIVATION_FAILED");
        }
        const snapshot = await safelyReadTree(repository);
        if (!snapshot.ok) return snapshot;
        if (
          !matchesIdentity(snapshot.value, activation) ||
          snapshot.value.workspaceLayout !== (activation.workspaceLayout ?? "standalone")
        ) {
          return activationFailure("CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED");
        }
        generation += 1;
        active = {
          identity: { projectId: activation.projectId, workspaceId: activation.workspaceId },
          repository,
          generation,
          mutationMode: snapshot.value.mutationMode,
          snapshot: snapshot.value
        };
        return ok(snapshot.value);
      });
    },

    deactivate() {
      void withMutationLease(async () => {
        generation += 1;
        active = undefined;
        return ok(undefined);
      }, "CREATIVE_PROJECT_FILE_SESSION_DEACTIVATION_FAILED");
    },

    refresh(identity) {
      return withMutationLease(async () => {
        const candidate = requireActive(identity);
        if (!candidate.ok) return candidate;
        const snapshot = await safelyReadTree(candidate.value.repository);
        if (!snapshot.ok) return snapshot;
        if (
          !isCurrent(candidate.value) ||
          !matchesIdentity(snapshot.value, candidate.value.identity)
        ) {
          return activationFailure("CREATIVE_PROJECT_FILE_SESSION_STALE");
        }
        candidate.value.snapshot = snapshot.value;
        return ok(snapshot.value);
      }, "CREATIVE_PROJECT_FILE_SESSION_REFRESH_FAILED");
    },

    async readTextFile(input) {
      const candidate = requireActive(input);
      if (!candidate.ok) return candidate;
      const read = await safelyReadFile(candidate.value.repository, input.path);
      if (!read.ok) return read;
      return isCurrent(candidate.value) && matchesIdentity(read.value, candidate.value.identity)
        ? read
        : activationFailure("CREATIVE_PROJECT_FILE_SESSION_STALE");
    },

    saveTextFile(input) {
      return withMutationLease(async () => {
        const candidate = requireActive(input);
        if (!candidate.ok) return candidate;
        if (candidate.value.mutationMode === "read-only") return readOnlyFailure();
        const saved = await safelySave(candidate.value.repository, input);
        if (!saved.ok) return saved;
        if (
          !isCurrent(candidate.value) ||
          !matchesSaveIdentity(saved.value, candidate.value.identity)
        ) {
          return activationFailure("CREATIVE_PROJECT_FILE_SESSION_STALE");
        }
        if (saved.value.kind === "saved") {
          const snapshot = await safelyReadTree(candidate.value.repository);
          if (!snapshot.ok) return snapshot;
          if (
            !isCurrent(candidate.value) ||
            !matchesIdentity(snapshot.value, candidate.value.identity)
          ) {
            return activationFailure("CREATIVE_PROJECT_FILE_SESSION_STALE");
          }
          candidate.value.snapshot = snapshot.value;
        }
        return saved;
      }, "CREATIVE_PROJECT_FILE_SESSION_SAVE_FAILED");
    },

    executeLifecycleCommand(command, origin = "user") {
      return withMutationLease(async () => {
        const candidate = requireActive(command);
        if (!candidate.ok) return candidate;
        if (candidate.value.mutationMode === "read-only") return readOnlyFailure();
        const receipt = await safelyExecute(candidate.value.repository, command, origin);
        if (!receipt.ok) return receipt;
        if (
          !isCurrent(candidate.value) ||
          !matchesIdentity(receipt.value, candidate.value.identity)
        ) {
          return activationFailure("CREATIVE_PROJECT_FILE_SESSION_STALE");
        }
        const snapshot = await safelyReadTree(candidate.value.repository);
        if (!snapshot.ok) return snapshot;
        if (
          !isCurrent(candidate.value) ||
          !matchesIdentity(snapshot.value, candidate.value.identity)
        ) {
          return activationFailure("CREATIVE_PROJECT_FILE_SESSION_STALE");
        }
        candidate.value.snapshot = snapshot.value;
        return receipt;
      }, "CREATIVE_PROJECT_FILE_SESSION_LIFECYCLE_FAILED");
    }
  };

  function requireActive(
    identity: CreativeProjectFileSessionIdentity
  ): Result<ActiveCreativeProjectFileSession, UnifiedError> {
    if (active === undefined) return activationFailure("CREATIVE_PROJECT_FILE_SESSION_UNAVAILABLE");
    return isIdentity(identity) && matchesIdentity(identity, active.identity)
      ? ok(active)
      : activationFailure("CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED");
  }

  function isCurrent(candidate: ActiveCreativeProjectFileSession): boolean {
    return active === candidate && candidate.generation === generation;
  }

  function withMutationLease<T>(
    operation: () => Promise<Result<T, UnifiedError>>,
    failureCode = "CREATIVE_PROJECT_FILE_SESSION_OPERATION_FAILED"
  ): Promise<Result<T, UnifiedError>> {
    return new Promise<Result<T, UnifiedError>>((resolveResult) => {
      const prior = mutationLeaseTail;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolveGate) => {
        release = resolveGate;
      });
      mutationLeaseTail = prior.catch(() => undefined).then(() => gate);
      void prior
        .catch(() => undefined)
        .then(operation)
        .then(resolveResult)
        .catch(() => resolveResult(activationFailure(failureCode)))
        .finally(() => release?.());
    });
  }
}

async function safelyReadTree(
  repository: CreativeProjectFileRepositoryPort
): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>> {
  try {
    const tree = await repository.getTreeSnapshot();
    if (!tree.ok) return tree;
    return isTreeSnapshot(tree.value)
      ? ok(projectTreeSnapshot(tree.value))
      : activationFailure("CREATIVE_PROJECT_FILE_SESSION_TREE_INVALID");
  } catch {
    return activationFailure("CREATIVE_PROJECT_FILE_SESSION_TREE_FAILED");
  }
}

async function safelyReadFile(
  repository: CreativeProjectFileRepositoryPort,
  path: string
): Promise<Result<CreativeProjectFileDocument, UnifiedError>> {
  try {
    const document = await repository.readTextFile(path);
    if (!document.ok) return document;
    return isDocument(document.value)
      ? ok(projectDocument(document.value))
      : activationFailure("CREATIVE_PROJECT_FILE_SESSION_DOCUMENT_INVALID");
  } catch {
    return activationFailure("CREATIVE_PROJECT_FILE_SESSION_READ_FAILED");
  }
}

async function safelySave(
  repository: CreativeProjectFileRepositoryPort,
  input: {
    readonly projectId: string;
    readonly workspaceId: string;
    readonly path: string;
    readonly content: string;
    readonly expectedTreeRevision: string;
    readonly expectedNodeRevision: string;
    readonly expectedChecksum: string;
  }
): Promise<Result<CreativeProjectFileSaveResult, UnifiedError>> {
  try {
    const saved = await repository.saveTextFile(input);
    if (!saved.ok) return saved;
    return isSaveResult(saved.value)
      ? ok(projectSaveResult(saved.value))
      : activationFailure("CREATIVE_PROJECT_FILE_SESSION_SAVE_INVALID");
  } catch {
    return activationFailure("CREATIVE_PROJECT_FILE_SESSION_SAVE_FAILED");
  }
}

async function safelyExecute(
  repository: CreativeProjectFileRepositoryPort,
  command: CreativeProjectFileLifecycleCommand,
  origin: CreativeProjectFileMutationOrigin
): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>> {
  try {
    const receipt = await repository.executeLifecycleCommand(command, origin);
    if (!receipt.ok) return receipt;
    return isLifecycleReceipt(receipt.value)
      ? ok(projectReceipt(receipt.value))
      : activationFailure("CREATIVE_PROJECT_FILE_SESSION_RECEIPT_INVALID");
  } catch {
    return activationFailure("CREATIVE_PROJECT_FILE_SESSION_LIFECYCLE_FAILED");
  }
}

function isIdentity(value: unknown): value is CreativeProjectFileSessionIdentity {
  if (!isRecord(value)) return false;
  const projectId = value["projectId"];
  const workspaceId = value["workspaceId"];
  return (
    typeof projectId === "string" &&
    typeof workspaceId === "string" &&
    projectId.length > 0 &&
    workspaceId.length > 0
  );
}

function matchesIdentity(
  value: CreativeProjectFileSessionIdentity,
  expected: CreativeProjectFileSessionIdentity
): boolean {
  return value.projectId === expected.projectId && value.workspaceId === expected.workspaceId;
}

function matchesSaveIdentity(
  result: CreativeProjectFileSaveResult,
  expected: CreativeProjectFileSessionIdentity
): boolean {
  return result.kind === "saved"
    ? matchesIdentity(result.document, expected)
    : result.current === undefined || matchesIdentity(result.current, expected);
}

function isTreeSnapshot(value: unknown): value is CreativeProjectFileTreeSnapshot {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === "1.1" &&
    value["policyVersion"] === "1.0" &&
    isIdentity(value) &&
    (value["workspaceLayout"] === "standalone" || value["workspaceLayout"] === "nested-folder") &&
    (value["mutationMode"] === "read-write" || value["mutationMode"] === "read-only") &&
    typeof value["treeRevision"] === "string" &&
    Array.isArray(value["nodes"]) &&
    value["nodes"].every(isTreeNode) &&
    typeof value["truncated"] === "boolean" &&
    Array.isArray(value["truncationReasons"]) &&
    value["truncationReasons"].every(
      (reason: unknown) => reason === "max_depth" || reason === "max_items"
    ) &&
    typeof value["dependencyManifestChecksum"] === "string"
  );
}

function isTreeNode(value: unknown): value is CreativeProjectFileTreeNode {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["path"] === "string" &&
    (value["kind"] === "directory" || value["kind"] === "file") &&
    typeof value["nodeRevision"] === "string" &&
    (value["readOnlyReason"] === undefined || typeof value["readOnlyReason"] === "string") &&
    (value["children"] === undefined ||
      (Array.isArray(value["children"]) && value["children"].every(isTreeNode)))
  );
}

function isDocument(value: unknown): value is CreativeProjectFileDocument {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === "1.0" &&
    isIdentity(value) &&
    typeof value["path"] === "string" &&
    typeof value["content"] === "string" &&
    typeof value["checksum"] === "string" &&
    typeof value["byteLength"] === "number" &&
    typeof value["nodeRevision"] === "string" &&
    (value["readOnlyReason"] === undefined || typeof value["readOnlyReason"] === "string")
  );
}

function isSaveResult(value: unknown): value is CreativeProjectFileSaveResult {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false;
  if (value["kind"] === "saved") {
    return isDocument(value["document"]) && typeof value["treeRevision"] === "string";
  }
  return (
    value["kind"] === "conflict" &&
    (value["conflictKind"] === "tree_revision" ||
      value["conflictKind"] === "node_revision" ||
      value["conflictKind"] === "checksum") &&
    typeof value["attemptedContent"] === "string" &&
    typeof value["treeRevision"] === "string" &&
    (value["current"] === undefined || isDocument(value["current"]))
  );
}

function isLifecycleReceipt(value: unknown): value is CreativeProjectFileLifecycleReceipt {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === "1.0" &&
    isIdentity(value) &&
    typeof value["commandId"] === "string" &&
    (value["commandKind"] === "createTextFile" ||
      value["commandKind"] === "createDirectory" ||
      value["commandKind"] === "renamePath" ||
      value["commandKind"] === "deleteFile" ||
      value["commandKind"] === "deleteEmptyDirectory") &&
    typeof value["commandFingerprint"] === "string" &&
    typeof value["treeRevision"] === "string" &&
    Array.isArray(value["affectedPaths"]) &&
    value["affectedPaths"].every((path: unknown) => typeof path === "string")
  );
}

function projectTreeSnapshot(
  value: CreativeProjectFileTreeSnapshot
): CreativeProjectFileTreeSnapshot {
  return Object.freeze({
    schemaVersion: "1.1",
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    policyVersion: "1.0",
    workspaceLayout: value.workspaceLayout,
    mutationMode: value.mutationMode,
    treeRevision: value.treeRevision,
    nodes: Object.freeze(value.nodes.map(projectTreeNode)),
    truncated: value.truncated,
    truncationReasons: Object.freeze([...value.truncationReasons]),
    dependencyManifestChecksum: value.dependencyManifestChecksum
  });
}

function projectTreeNode(value: CreativeProjectFileTreeNode): CreativeProjectFileTreeNode {
  return Object.freeze({
    id: value.id,
    name: value.name,
    kind: value.kind,
    path: value.path,
    nodeRevision: value.nodeRevision,
    ...(value.readOnlyReason === undefined ? {} : { readOnlyReason: value.readOnlyReason }),
    ...(value.children === undefined
      ? {}
      : { children: Object.freeze(value.children.map(projectTreeNode)) })
  });
}

function projectDocument(value: CreativeProjectFileDocument): CreativeProjectFileDocument {
  return Object.freeze({
    schemaVersion: "1.0",
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    path: value.path,
    content: value.content,
    checksum: value.checksum,
    byteLength: value.byteLength,
    nodeRevision: value.nodeRevision,
    ...(value.readOnlyReason === undefined ? {} : { readOnlyReason: value.readOnlyReason })
  });
}

function projectSaveResult(value: CreativeProjectFileSaveResult): CreativeProjectFileSaveResult {
  return value.kind === "saved"
    ? Object.freeze({
        kind: "saved",
        document: projectDocument(value.document),
        treeRevision: value.treeRevision
      })
    : Object.freeze({
        kind: "conflict",
        conflictKind: value.conflictKind,
        attemptedContent: value.attemptedContent,
        treeRevision: value.treeRevision,
        ...(value.current === undefined ? {} : { current: projectDocument(value.current) })
      });
}

function projectReceipt(
  value: CreativeProjectFileLifecycleReceipt
): CreativeProjectFileLifecycleReceipt {
  return Object.freeze({
    schemaVersion: "1.0",
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    commandId: value.commandId,
    commandKind: value.commandKind,
    commandFingerprint: value.commandFingerprint,
    treeRevision: value.treeRevision,
    affectedPaths: Object.freeze([...value.affectedPaths])
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function activationFailure<T>(code: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "UserError",
      message: "The creative project file session is not available for this project.",
      recoverability: "user-action",
      suggestedAction: "Open or refresh the current creative project before retrying.",
      traceId: "creative-project-file-session"
    })
  );
}

function readOnlyFailure<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CREATIVE_PROJECT_FILE_READ_ONLY",
      category: "UserError",
      message: "Source files are read-only in this project workspace.",
      recoverability: "user-action",
      suggestedAction: "Edit a project chapter or copy the source file into the project first.",
      traceId: "creative-project-file-session"
    })
  );
}
