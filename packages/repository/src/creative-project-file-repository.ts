import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { createProjectPathGuard, writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import {
  noFollowMkdir,
  noFollowRename,
  noFollowRmdir,
  noFollowUnlink,
  noFollowWriteFile,
  type NoFollowNativeFileOperationPort
} from "./no-follow-file-operations.js";

export const CREATIVE_PROJECT_FILE_POLICY_VERSION = "1.0" as const;
export const CREATIVE_PROJECT_FILE_TREE_SNAPSHOT_VERSION = "1.1" as const;
export const CREATIVE_PROJECT_FILE_LIFECYCLE_VERSION = "1.0" as const;

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ITEMS = 300;
const DEFAULT_MAX_TEXT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_PATH_LENGTH = 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CHECKSUM = /^[a-f0-9]{64}$/u;
const DEVICE_NAME = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/iu;

const DEFAULT_ALLOWED_TEXT_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv"
] as const;
const DEFAULT_MANAGED_FILE_NAMES = ["project.json", "settings.json"] as const;
const DEFAULT_MANAGED_PATH_SEGMENTS = [
  "chapters",
  "characters",
  "world",
  "outline",
  "timeline",
  "foreshadows",
  "memories",
  "prompts",
  "agents",
  "workflow",
  "workflows",
  "agent-model-sharing",
  "plugins",
  "history",
  "cache",
  ".novel-studio"
] as const;
const DEFAULT_IGNORED_PATH_SEGMENTS = [
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "release",
  "build",
  "out",
  "coverage",
  ".cache",
  "__pycache__"
] as const;

export interface CreativeProjectFilePolicy {
  readonly schemaVersion: typeof CREATIVE_PROJECT_FILE_POLICY_VERSION;
  readonly allowedTextExtensions: readonly string[];
  readonly managedFileNames: readonly string[];
  readonly managedPathSegments: readonly string[];
  readonly ignoredPathSegments: readonly string[];
  readonly maxDepth: number;
  readonly maxItems: number;
  readonly maxTextBytes: number;
  readonly maxPathLength: number;
}

export const DEFAULT_CREATIVE_PROJECT_FILE_POLICY: CreativeProjectFilePolicy = Object.freeze({
  schemaVersion: CREATIVE_PROJECT_FILE_POLICY_VERSION,
  allowedTextExtensions: Object.freeze([...DEFAULT_ALLOWED_TEXT_EXTENSIONS]),
  managedFileNames: Object.freeze([...DEFAULT_MANAGED_FILE_NAMES]),
  managedPathSegments: Object.freeze([...DEFAULT_MANAGED_PATH_SEGMENTS]),
  ignoredPathSegments: Object.freeze([...DEFAULT_IGNORED_PATH_SEGMENTS]),
  maxDepth: DEFAULT_MAX_DEPTH,
  maxItems: DEFAULT_MAX_ITEMS,
  maxTextBytes: DEFAULT_MAX_TEXT_BYTES,
  maxPathLength: DEFAULT_MAX_PATH_LENGTH
});

export interface CreativeProjectFileTreeNode {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly path: string;
  /** Opaque Main-generated identity used to reject stale move/delete requests. */
  readonly nodeRevision: string;
  /** Present when this node originates outside the managed project workspace. */
  readonly readOnlyReason?: string;
  readonly children?: readonly CreativeProjectFileTreeNode[];
}

export type CreativeProjectFileTreeTruncationReason = "max_depth" | "max_items";

export interface CreativeProjectFileTreeSnapshot {
  readonly schemaVersion: typeof CREATIVE_PROJECT_FILE_TREE_SNAPSHOT_VERSION;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly policyVersion: typeof CREATIVE_PROJECT_FILE_POLICY_VERSION;
  readonly workspaceLayout: "standalone" | "nested-folder";
  readonly mutationMode: "read-write" | "read-only";
  /** Structure-only revision. Saving file contents must not change this value. */
  readonly treeRevision: string;
  readonly nodes: readonly CreativeProjectFileTreeNode[];
  readonly truncated: boolean;
  readonly truncationReasons: readonly CreativeProjectFileTreeTruncationReason[];
  /** Checksum of visible relative paths, node kinds, truncation state, and policy version. */
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

interface CreativeProjectFileLifecycleCommandBase {
  readonly schemaVersion: typeof CREATIVE_PROJECT_FILE_LIFECYCLE_VERSION;
  readonly commandId: string;
  readonly projectId: string;
  readonly workspaceId: string;
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

export interface CreativeProjectFileLifecycleReceipt {
  readonly schemaVersion: typeof CREATIVE_PROJECT_FILE_LIFECYCLE_VERSION;
  readonly commandId: string;
  readonly commandKind: CreativeProjectFileLifecycleCommand["kind"];
  readonly commandFingerprint: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly treeRevision: string;
  readonly affectedPaths: readonly string[];
}

/**
 * Main supplies this value rather than trusting a renderer field. Agent-originated
 * lifecycle requests must only reach this repository after Change Set approval.
 */
export type CreativeProjectFileMutationOrigin = "user" | "approved_agent_change_set";

/** Optional durable receipt backing. The in-memory fallback preserves same-runtime retries. */
export interface CreativeProjectFileReceiptStore {
  readReceipt(
    commandId: string
  ): Promise<Result<CreativeProjectFileLifecycleReceipt | undefined, UnifiedError>>;
  writeReceipt(
    receipt: CreativeProjectFileLifecycleReceipt
  ): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>>;
}

export interface CreativeProjectFileRepositoryOptions {
  /** Main-derived canonical candidate root. It is never returned by this repository. */
  readonly projectRoot: string;
  /** Main-derived display root for nested projects. Never returned to renderer callers. */
  readonly displayRoot?: string;
  /** Defaults to the legacy standalone project layout. */
  readonly workspaceLayout?: "standalone" | "nested-folder";
  readonly projectId: string;
  readonly workspaceId: string;
  readonly policy?: CreativeProjectFilePolicy;
  readonly traceId?: string;
  readonly atomicWriter?: typeof writeTextAtomically;
  readonly receiptStore?: CreativeProjectFileReceiptStore;
  /**
   * Optional hardened mutation provider. When absent, lifecycle mutations retain
   * the standard-trusted app-managed workspace semantics described below.
   */
  readonly noFollowNativeOperations?: NoFollowNativeFileOperationPort;
  /**
   * Deterministic race seam for lifecycle tests. Production composition must omit it.
   * It runs immediately before the repository repeats its final path validation.
   */
  readonly beforeFinalLifecycleValidation?: (input: {
    readonly kind: CreativeProjectFileLifecycleCommand["kind"];
    readonly paths: readonly string[];
  }) => Promise<void>;
  /**
   * Deterministic race seam for lifecycle tests. It runs after repository-level
   * validation and before the final no-follow/native or standard-trusted action.
   */
  readonly beforeLifecycleMutation?: (input: {
    readonly kind: CreativeProjectFileLifecycleCommand["kind"];
    readonly paths: readonly string[];
  }) => Promise<void>;
}

interface RootBinding {
  readonly rootPath: string;
  readonly canonicalRoot: string;
  readonly device: bigint;
  readonly inode: bigint;
}

interface ExistingNode {
  readonly path: string;
  readonly absolutePath: string;
  readonly kind: "directory" | "file";
  readonly nodeRevision: string;
}

interface TraversalBudget {
  remaining: number;
  readonly reasons: Set<CreativeProjectFileTreeTruncationReason>;
}

/**
 * Standard-trusted creative workspace repository. Without noFollowNativeOperations,
 * lifecycle mutations use Node pathname APIs plus repeated identity/containment checks.
 * That preserves app-managed workspace behavior but cannot close a hostile same-user
 * reparse-point race; hardened hosts must supply the native handle-based provider.
 */
export class CreativeProjectFileRepository {
  private readonly policy: CreativeProjectFilePolicy;
  private readonly traceId: string;
  private readonly atomicWriter: typeof writeTextAtomically;
  private readonly workspaceLayout: "standalone" | "nested-folder";
  private readonly rootPath: string;
  private readonly rootBinding: Promise<Result<RootBinding, UnifiedError>>;
  private readonly receiptCache = new Map<string, CreativeProjectFileLifecycleReceipt>();
  private operationTail: Promise<void> = Promise.resolve();

  public constructor(private readonly options: CreativeProjectFileRepositoryOptions) {
    const policy = normalizeCreativeProjectFilePolicy(
      options.policy ?? DEFAULT_CREATIVE_PROJECT_FILE_POLICY
    );
    if (!policy.ok) {
      throw new Error("CreativeProjectFileRepository requires a supported file policy.");
    }
    this.policy = policy.value;
    this.workspaceLayout = options.workspaceLayout ?? "standalone";
    this.rootPath =
      this.workspaceLayout === "nested-folder" ? (options.displayRoot ?? "") : options.projectRoot;
    this.traceId = options.traceId ?? "creative-project-file-repository";
    this.atomicWriter = options.atomicWriter ?? writeTextAtomically;
    this.rootBinding = this.bindRoot();
  }

  public getPolicy(): CreativeProjectFilePolicy {
    return this.policy;
  }

  public getTreeSnapshot(): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>> {
    return this.serialize(() => this.buildTreeSnapshot());
  }

  public readTextFile(path: string): Promise<Result<CreativeProjectFileDocument, UnifiedError>> {
    return this.serialize(async () => {
      const normalized = this.normalizePath(path, "file");
      if (!normalized.ok) return normalized;
      const node = await this.resolveExistingNode(normalized.value, "file");
      if (!node.ok) return node;
      return this.readDocument(node.value);
    });
  }

  public saveTextFile(input: {
    readonly projectId: string;
    readonly workspaceId: string;
    readonly path: string;
    readonly content: string;
    readonly expectedTreeRevision: string;
    readonly expectedNodeRevision: string;
    readonly expectedChecksum: string;
  }): Promise<Result<CreativeProjectFileSaveResult, UnifiedError>> {
    return this.serialize(() => this.saveTextFileInternal(input));
  }

  public executeLifecycleCommand(
    command: CreativeProjectFileLifecycleCommand,
    origin: CreativeProjectFileMutationOrigin = "user"
  ): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>> {
    return this.serialize(() => this.executeLifecycleCommandInternal(command, origin));
  }

  private async saveTextFileInternal(input: {
    readonly projectId: string;
    readonly workspaceId: string;
    readonly path: string;
    readonly content: string;
    readonly expectedTreeRevision: string;
    readonly expectedNodeRevision: string;
    readonly expectedChecksum: string;
  }): Promise<Result<CreativeProjectFileSaveResult, UnifiedError>> {
    if (this.workspaceLayout === "nested-folder") return this.readOnlyFailure(input.path);
    const identity = this.assertIdentity(input.projectId, input.workspaceId);
    if (!identity.ok) return identity;
    const normalized = this.normalizePath(input.path, "file");
    if (!normalized.ok) return normalized;
    if (
      !isOpaqueRevision(input.expectedTreeRevision) ||
      !isChecksum(input.expectedChecksum) ||
      !isOpaqueRevision(input.expectedNodeRevision)
    ) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_SAVE_INPUT_INVALID", normalized.value);
    }
    const content = validateTextContent(
      input.content,
      this.policy.maxTextBytes,
      this.traceId,
      normalized.value
    );
    if (!content.ok) return content;

    const tree = await this.buildTreeSnapshot();
    if (!tree.ok) return tree;
    if (tree.value.treeRevision !== input.expectedTreeRevision) {
      return ok({
        kind: "conflict",
        conflictKind: "tree_revision",
        attemptedContent: input.content,
        treeRevision: tree.value.treeRevision
      });
    }

    const node = await this.resolveExistingNode(normalized.value, "file");
    if (!node.ok) return node;
    const current = await this.readDocument(node.value);
    if (!current.ok) return current;
    if (current.value.nodeRevision !== input.expectedNodeRevision) {
      return ok({
        kind: "conflict",
        conflictKind: "node_revision",
        attemptedContent: input.content,
        treeRevision: tree.value.treeRevision,
        current: current.value
      });
    }
    if (current.value.checksum !== input.expectedChecksum) {
      return ok({
        kind: "conflict",
        conflictKind: "checksum",
        attemptedContent: input.content,
        treeRevision: tree.value.treeRevision,
        current: current.value
      });
    }

    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    let raced: CreativeProjectFileSaveResult | undefined;
    const write = await this.atomicWriter({
      targetPath: node.value.absolutePath,
      content: input.content,
      traceId: this.traceId,
      pathGuard: this.createPathGuard(binding.value),
      beforeReplace: async () => {
        const latestTree = await this.buildTreeSnapshot();
        if (!latestTree.ok) return latestTree;
        if (latestTree.value.treeRevision !== input.expectedTreeRevision) {
          raced = {
            kind: "conflict",
            conflictKind: "tree_revision",
            attemptedContent: input.content,
            treeRevision: latestTree.value.treeRevision
          };
          return err(this.atomicConflictError());
        }
        const latestNode = await this.resolveExistingNode(normalized.value, "file");
        if (!latestNode.ok) return latestNode;
        const latest = await this.readDocument(latestNode.value);
        if (!latest.ok) return latest;
        if (latest.value.nodeRevision !== input.expectedNodeRevision) {
          raced = {
            kind: "conflict",
            conflictKind: "node_revision",
            attemptedContent: input.content,
            treeRevision: latestTree.value.treeRevision,
            current: latest.value
          };
          return err(this.atomicConflictError());
        }
        if (latest.value.checksum !== input.expectedChecksum) {
          raced = {
            kind: "conflict",
            conflictKind: "checksum",
            attemptedContent: input.content,
            treeRevision: latestTree.value.treeRevision,
            current: latest.value
          };
          return err(this.atomicConflictError());
        }
        return ok(undefined);
      }
    });
    if (!write.ok) {
      return raced === undefined
        ? this.storageFailure("CREATIVE_PROJECT_FILE_SAVE_FAILED", normalized.value)
        : ok(raced);
    }

    const savedNode = await this.resolveExistingNode(normalized.value, "file");
    if (!savedNode.ok) return savedNode;
    const saved = await this.readDocument(savedNode.value);
    if (!saved.ok) return saved;
    const finalTree = await this.buildTreeSnapshot();
    if (!finalTree.ok) return finalTree;
    return ok({
      kind: "saved",
      document: saved.value,
      treeRevision: finalTree.value.treeRevision
    });
  }

  private async executeLifecycleCommandInternal(
    command: CreativeProjectFileLifecycleCommand,
    origin: CreativeProjectFileMutationOrigin
  ): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>> {
    if (this.workspaceLayout === "nested-folder") return this.readOnlyFailure(command.commandId);
    const commandValidation = validateLifecycleCommand(command);
    if (!commandValidation.ok) return commandValidation;
    const fingerprint = fingerprintCommand(command);
    const previous = await this.findReceipt(command.commandId);
    if (!previous.ok) return previous;
    if (previous.value !== undefined) {
      return previous.value.commandFingerprint === fingerprint &&
        previous.value.projectId === command.projectId &&
        previous.value.workspaceId === command.workspaceId
        ? ok(previous.value)
        : this.validationFailure("CREATIVE_PROJECT_FILE_COMMAND_ID_CONFLICT", command.commandId);
    }
    const identity = this.assertIdentity(command.projectId, command.workspaceId);
    if (!identity.ok) return identity;
    if (origin !== "user" && origin !== "approved_agent_change_set") {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_MUTATION_ORIGIN_REJECTED",
        command.commandId
      );
    }

    const tree = await this.buildTreeSnapshot();
    if (!tree.ok) return tree;
    if (tree.value.treeRevision !== command.expectedTreeRevision) {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_TREE_REVISION_CONFLICT",
        command.commandId
      );
    }

    let mutation: Result<readonly string[], UnifiedError>;
    switch (command.kind) {
      case "createTextFile":
        mutation = await this.createTextFile(command);
        break;
      case "createDirectory":
        mutation = await this.createDirectory(command);
        break;
      case "renamePath":
        mutation = await this.renamePath(command);
        break;
      case "deleteFile":
        mutation = await this.deleteFile(command);
        break;
      case "deleteEmptyDirectory":
        mutation = await this.deleteEmptyDirectory(command);
        break;
    }
    if (!mutation.ok) return mutation;

    const nextTree = await this.buildTreeSnapshot();
    if (!nextTree.ok) return nextTree;
    const receipt: CreativeProjectFileLifecycleReceipt = Object.freeze({
      schemaVersion: CREATIVE_PROJECT_FILE_LIFECYCLE_VERSION,
      commandId: command.commandId,
      commandKind: command.kind,
      commandFingerprint: fingerprint,
      projectId: this.options.projectId,
      workspaceId: this.options.workspaceId,
      treeRevision: nextTree.value.treeRevision,
      affectedPaths: Object.freeze([...mutation.value])
    });
    return this.storeReceipt(receipt);
  }

  private async createTextFile(
    command: Extract<CreativeProjectFileLifecycleCommand, { readonly kind: "createTextFile" }>
  ): Promise<Result<readonly string[], UnifiedError>> {
    const path = this.normalizePath(command.path, "file");
    if (!path.ok) return path;
    const content = validateTextContent(
      command.content,
      this.policy.maxTextBytes,
      this.traceId,
      path.value
    );
    if (!content.ok) return content;
    const target = await this.resolveMissingTarget(path.value);
    if (!target.ok) return target;
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;

    const finalValidation = await this.beforeFinalLifecycleValidation(command, [path.value]);
    if (!finalValidation.ok) return finalValidation;
    const latestTarget = await this.resolveMissingTarget(path.value);
    if (!latestTarget.ok) return latestTarget;
    const beforeMutation = await this.beforeLifecycleMutation(command, [path.value]);
    if (!beforeMutation.ok) return beforeMutation;

    if (this.options.noFollowNativeOperations !== undefined) {
      const write = await noFollowWriteFile(
        binding.value.rootPath,
        path.value,
        command.content,
        { createOnly: true },
        this.options.noFollowNativeOperations
      );
      if (!write.ok) return write;
      const created = await this.resolveExistingNode(path.value, "file");
      return created.ok
        ? ok([path.value])
        : this.storageFailure("CREATIVE_PROJECT_FILE_CREATE_FAILED", path.value);
    }

    let finalFailure: UnifiedError | undefined;
    const write = await this.atomicWriter({
      targetPath: latestTarget.value,
      content: command.content,
      traceId: this.traceId,
      pathGuard: this.createPathGuard(binding.value),
      beforeReplace: async () => {
        const latest = await this.resolveMissingTarget(path.value);
        if (!latest.ok) {
          finalFailure = latest.error;
          return err(this.atomicConflictError());
        }
        return ok(undefined);
      }
    });
    if (!write.ok) {
      return finalFailure === undefined
        ? this.storageFailure("CREATIVE_PROJECT_FILE_CREATE_FAILED", path.value)
        : err(finalFailure);
    }
    const created = await this.resolveExistingNode(path.value, "file");
    return created.ok
      ? ok([path.value])
      : this.storageFailure("CREATIVE_PROJECT_FILE_CREATE_FAILED", path.value);
  }

  private async createDirectory(
    command: Extract<CreativeProjectFileLifecycleCommand, { readonly kind: "createDirectory" }>
  ): Promise<Result<readonly string[], UnifiedError>> {
    const path = this.normalizePath(command.path, "directory");
    if (!path.ok) return path;
    const target = await this.resolveMissingTarget(path.value);
    if (!target.ok) return target;
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    const finalValidation = await this.beforeFinalLifecycleValidation(command, [path.value]);
    if (!finalValidation.ok) return finalValidation;
    const latestTarget = await this.resolveMissingTarget(path.value);
    if (!latestTarget.ok) return latestTarget;
    const beforeMutation = await this.beforeLifecycleMutation(command, [path.value]);
    if (!beforeMutation.ok) return beforeMutation;
    if (this.options.noFollowNativeOperations !== undefined) {
      const created = await noFollowMkdir(
        binding.value.rootPath,
        path.value,
        this.options.noFollowNativeOperations
      );
      if (!created.ok) return created;
    } else {
      const finalTarget = await this.resolveMissingTarget(path.value);
      if (!finalTarget.ok) return finalTarget;
      try {
        await mkdir(finalTarget.value);
      } catch {
        return this.storageFailure("CREATIVE_PROJECT_FILE_CREATE_DIRECTORY_FAILED", path.value);
      }
    }
    const created = await this.resolveExistingNode(path.value, "directory");
    return created.ok
      ? ok([path.value])
      : this.storageFailure("CREATIVE_PROJECT_FILE_CREATE_DIRECTORY_FAILED", path.value);
  }

  private async renamePath(
    command: Extract<CreativeProjectFileLifecycleCommand, { readonly kind: "renamePath" }>
  ): Promise<Result<readonly string[], UnifiedError>> {
    const sourcePath = this.normalizePath(command.sourcePath, "any");
    if (!sourcePath.ok) return sourcePath;
    const source = await this.resolveExistingNode(sourcePath.value);
    if (!source.ok) return source;
    const allowedSourcePath = this.normalizePath(sourcePath.value, source.value.kind);
    if (!allowedSourcePath.ok) return allowedSourcePath;
    if (source.value.nodeRevision !== command.expectedSourceRevision) {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT",
        allowedSourcePath.value
      );
    }
    const targetPath = this.normalizePath(command.targetPath, source.value.kind);
    if (!targetPath.ok) return targetPath;
    if (allowedSourcePath.value === targetPath.value) {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_RENAME_INPUT_INVALID",
        allowedSourcePath.value
      );
    }
    const target = await this.resolveMissingTarget(targetPath.value);
    if (!target.ok) return target;
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    const finalValidation = await this.beforeFinalLifecycleValidation(command, [
      allowedSourcePath.value,
      targetPath.value
    ]);
    if (!finalValidation.ok) return finalValidation;
    if (source.value.kind === "directory") {
      const subtree = await this.assertRenameableDirectory(allowedSourcePath.value);
      if (!subtree.ok) return subtree;
    }
    const latestSource = await this.resolveExistingNode(allowedSourcePath.value, source.value.kind);
    if (!latestSource.ok) return latestSource;
    if (latestSource.value.nodeRevision !== command.expectedSourceRevision) {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT",
        allowedSourcePath.value
      );
    }
    const latestTarget = await this.resolveMissingTarget(targetPath.value);
    if (!latestTarget.ok) return latestTarget;
    const beforeMutation = await this.beforeLifecycleMutation(command, [
      allowedSourcePath.value,
      targetPath.value
    ]);
    if (!beforeMutation.ok) return beforeMutation;
    if (this.options.noFollowNativeOperations !== undefined) {
      const renamed = await noFollowRename(
        binding.value.rootPath,
        allowedSourcePath.value,
        targetPath.value,
        this.options.noFollowNativeOperations
      );
      if (!renamed.ok) return renamed;
    } else {
      const finalSource = await this.resolveExistingNode(
        allowedSourcePath.value,
        source.value.kind
      );
      if (!finalSource.ok) return finalSource;
      if (finalSource.value.nodeRevision !== command.expectedSourceRevision) {
        return this.validationFailure(
          "CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT",
          allowedSourcePath.value
        );
      }
      const finalTarget = await this.resolveMissingTarget(targetPath.value);
      if (!finalTarget.ok) return finalTarget;
      try {
        await rename(finalSource.value.absolutePath, finalTarget.value);
      } catch {
        return this.storageFailure("CREATIVE_PROJECT_FILE_RENAME_FAILED", allowedSourcePath.value);
      }
    }
    const moved = await this.resolveExistingNode(targetPath.value, source.value.kind);
    return moved.ok
      ? ok([allowedSourcePath.value, targetPath.value])
      : this.storageFailure("CREATIVE_PROJECT_FILE_RENAME_FAILED", targetPath.value);
  }

  private async deleteFile(
    command: Extract<CreativeProjectFileLifecycleCommand, { readonly kind: "deleteFile" }>
  ): Promise<Result<readonly string[], UnifiedError>> {
    if (command.confirmed !== true) {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_DELETE_CONFIRMATION_REQUIRED",
        command.path
      );
    }
    const path = this.normalizePath(command.path, "file");
    if (!path.ok) return path;
    const source = await this.resolveExistingNode(path.value, "file");
    if (!source.ok) return source;
    if (source.value.nodeRevision !== command.expectedSourceRevision) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", path.value);
    }
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    const finalValidation = await this.beforeFinalLifecycleValidation(command, [path.value]);
    if (!finalValidation.ok) return finalValidation;
    const latest = await this.resolveExistingNode(path.value, "file");
    if (!latest.ok) return latest;
    if (latest.value.nodeRevision !== command.expectedSourceRevision) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", path.value);
    }
    const beforeMutation = await this.beforeLifecycleMutation(command, [path.value]);
    if (!beforeMutation.ok) return beforeMutation;
    if (this.options.noFollowNativeOperations !== undefined) {
      const deleted = await noFollowUnlink(
        binding.value.rootPath,
        path.value,
        this.options.noFollowNativeOperations
      );
      if (!deleted.ok) return deleted;
    } else {
      const finalNode = await this.resolveExistingNode(path.value, "file");
      if (!finalNode.ok) return finalNode;
      if (finalNode.value.nodeRevision !== command.expectedSourceRevision) {
        return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", path.value);
      }
      try {
        await unlink(finalNode.value.absolutePath);
      } catch {
        return this.storageFailure("CREATIVE_PROJECT_FILE_DELETE_FAILED", path.value);
      }
    }
    const removed = await this.resolveMissingTarget(path.value);
    if (!removed.ok) return removed;
    return ok([path.value]);
  }

  private async deleteEmptyDirectory(
    command: Extract<CreativeProjectFileLifecycleCommand, { readonly kind: "deleteEmptyDirectory" }>
  ): Promise<Result<readonly string[], UnifiedError>> {
    if (command.confirmed !== true) {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_DELETE_CONFIRMATION_REQUIRED",
        command.path
      );
    }
    const path = this.normalizePath(command.path, "directory");
    if (!path.ok) return path;
    const source = await this.resolveExistingNode(path.value, "directory");
    if (!source.ok) return source;
    if (source.value.nodeRevision !== command.expectedSourceRevision) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", path.value);
    }
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    let entries: readonly string[];
    try {
      entries = await readdir(source.value.absolutePath);
    } catch {
      return this.storageFailure("CREATIVE_PROJECT_FILE_DELETE_DIRECTORY_FAILED", path.value);
    }
    if (entries.length > 0) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_DIRECTORY_NOT_EMPTY", path.value);
    }
    const finalValidation = await this.beforeFinalLifecycleValidation(command, [path.value]);
    if (!finalValidation.ok) return finalValidation;
    const latest = await this.resolveExistingNode(path.value, "directory");
    if (!latest.ok) return latest;
    if (latest.value.nodeRevision !== command.expectedSourceRevision) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", path.value);
    }
    let finalEntries: readonly string[];
    try {
      finalEntries = await readdir(latest.value.absolutePath);
    } catch {
      return this.storageFailure("CREATIVE_PROJECT_FILE_DELETE_DIRECTORY_FAILED", path.value);
    }
    if (finalEntries.length > 0) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_DIRECTORY_NOT_EMPTY", path.value);
    }
    const finalSource = await this.resolveExistingNode(path.value, "directory");
    if (!finalSource.ok) return finalSource;
    if (finalSource.value.nodeRevision !== command.expectedSourceRevision) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", path.value);
    }
    const beforeMutation = await this.beforeLifecycleMutation(command, [path.value]);
    if (!beforeMutation.ok) return beforeMutation;
    if (this.options.noFollowNativeOperations !== undefined) {
      const deleted = await noFollowRmdir(
        binding.value.rootPath,
        path.value,
        this.options.noFollowNativeOperations
      );
      if (!deleted.ok) return deleted;
    } else {
      const current = await this.resolveExistingNode(path.value, "directory");
      if (!current.ok) return current;
      if (current.value.nodeRevision !== command.expectedSourceRevision) {
        return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", path.value);
      }
      let currentEntries: readonly string[];
      try {
        currentEntries = await readdir(current.value.absolutePath);
      } catch {
        return this.storageFailure("CREATIVE_PROJECT_FILE_DELETE_DIRECTORY_FAILED", path.value);
      }
      if (currentEntries.length > 0) {
        return this.validationFailure("CREATIVE_PROJECT_FILE_DIRECTORY_NOT_EMPTY", path.value);
      }
      try {
        await rmdir(current.value.absolutePath);
      } catch {
        return this.storageFailure("CREATIVE_PROJECT_FILE_DELETE_DIRECTORY_FAILED", path.value);
      }
    }
    const removed = await this.resolveMissingTarget(path.value);
    if (!removed.ok) return removed;
    return ok([path.value]);
  }

  private async buildTreeSnapshot(): Promise<
    Result<CreativeProjectFileTreeSnapshot, UnifiedError>
  > {
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    const budget: TraversalBudget = {
      remaining: this.policy.maxItems,
      reasons: new Set<CreativeProjectFileTreeTruncationReason>()
    };
    try {
      const nodes = await this.readDirectory(
        binding.value,
        binding.value.canonicalRoot,
        "",
        0,
        budget
      );
      const truncationReasons = [...budget.reasons].sort();
      const manifest = flattenTree(nodes).map((node) => ({ path: node.path, kind: node.kind }));
      const dependencyManifestChecksum = checksum(
        JSON.stringify({
          policyVersion: this.policy.schemaVersion,
          workspaceLayout: this.workspaceLayout,
          mutationMode: this.workspaceLayout === "nested-folder" ? "read-only" : "read-write",
          truncated: truncationReasons.length > 0,
          truncationReasons,
          nodes: manifest
        })
      );
      return ok(
        Object.freeze({
          schemaVersion: CREATIVE_PROJECT_FILE_TREE_SNAPSHOT_VERSION,
          projectId: this.options.projectId,
          workspaceId: this.options.workspaceId,
          policyVersion: this.policy.schemaVersion,
          workspaceLayout: this.workspaceLayout,
          mutationMode: this.workspaceLayout === "nested-folder" ? "read-only" : "read-write",
          treeRevision: `tree:${dependencyManifestChecksum}`,
          nodes: Object.freeze(nodes),
          truncated: truncationReasons.length > 0,
          truncationReasons: Object.freeze(truncationReasons),
          dependencyManifestChecksum
        })
      );
    } catch {
      return this.storageFailure("CREATIVE_PROJECT_FILE_TREE_READ_FAILED", "tree");
    }
  }

  private async readDirectory(
    binding: RootBinding,
    absoluteDirectory: string,
    relativeDirectory: string,
    depth: number,
    budget: TraversalBudget
  ): Promise<readonly CreativeProjectFileTreeNode[]> {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    const nodes: CreativeProjectFileTreeNode[] = [];
    for (const entry of entries) {
      const path =
        relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const genericPath = this.normalizePath(path, "any");
      if (!genericPath.ok || budget.remaining <= 0) {
        if (genericPath.ok) budget.reasons.add("max_items");
        continue;
      }
      const absolutePath = join(absoluteDirectory, entry.name);
      let stats: Awaited<ReturnType<typeof lstat>>;
      let canonicalPath: string;
      try {
        stats = await lstat(absolutePath);
        if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) continue;
        canonicalPath = await realpath(absolutePath);
        if (!isContained(relative(binding.canonicalRoot, canonicalPath))) continue;
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        const allowedDirectory = this.normalizePath(path, "directory");
        if (!allowedDirectory.ok) continue;
        budget.remaining -= 1;
        const atDepthBoundary = depth + 1 >= this.policy.maxDepth;
        const node: CreativeProjectFileTreeNode = {
          id: `creative-directory:${allowedDirectory.value}`,
          name: entry.name,
          kind: "directory",
          path: allowedDirectory.value,
          nodeRevision: nodeRevision(allowedDirectory.value, "directory", stats),
          ...(this.workspaceLayout === "nested-folder" ? { readOnlyReason: "来源文件，只读" } : {}),
          ...(!atDepthBoundary
            ? {
                children: await this.readDirectory(
                  binding,
                  canonicalPath,
                  allowedDirectory.value,
                  depth + 1,
                  budget
                )
              }
            : {})
        };
        if (
          atDepthBoundary &&
          (await this.hasVisibleChild(binding, canonicalPath, allowedDirectory.value))
        ) {
          budget.reasons.add("max_depth");
        }
        nodes.push(Object.freeze(node));
        continue;
      }
      const allowedFile = this.normalizePath(path, "file");
      if (!allowedFile.ok) continue;
      budget.remaining -= 1;
      nodes.push(
        Object.freeze({
          id: `creative-file:${allowedFile.value}`,
          name: entry.name,
          kind: "file",
          path: allowedFile.value,
          nodeRevision: nodeRevision(allowedFile.value, "file", stats),
          ...(this.workspaceLayout === "nested-folder" ? { readOnlyReason: "来源文件，只读" } : {})
        })
      );
    }
    return Object.freeze(nodes);
  }

  private async hasVisibleChild(
    binding: RootBinding,
    absoluteDirectory: string,
    relativeDirectory: string
  ): Promise<boolean> {
    try {
      const entries = await readdir(absoluteDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const path = `${relativeDirectory}/${entry.name}`;
        const generic = this.normalizePath(path, "any");
        if (!generic.ok) continue;
        const absolutePath = join(absoluteDirectory, entry.name);
        const stats = await lstat(absolutePath);
        if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) continue;
        const canonical = await realpath(absolutePath);
        if (!isContained(relative(binding.canonicalRoot, canonical))) continue;
        const expectedKind = stats.isDirectory() ? "directory" : "file";
        if (this.normalizePath(path, expectedKind).ok) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  private async resolveExistingNode(
    path: string,
    expectedKind?: "directory" | "file"
  ): Promise<Result<ExistingNode, UnifiedError>> {
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    try {
      let current = binding.value.canonicalRoot;
      const segments = path.split("/");
      let finalStats: Awaited<ReturnType<typeof lstat>> | undefined;
      for (const [index, segment] of segments.entries()) {
        current = join(current, segment);
        const stats = await lstat(current);
        if (stats.isSymbolicLink()) throw new Error("reparse point");
        const canonical = await realpath(current);
        if (!isContained(relative(binding.value.canonicalRoot, canonical)))
          throw new Error("escaped root");
        if (index < segments.length - 1 && !stats.isDirectory())
          throw new Error("parent not directory");
        finalStats = stats;
        current = canonical;
      }
      if (finalStats === undefined) throw new Error("missing target");
      const kind = finalStats.isDirectory()
        ? "directory"
        : finalStats.isFile()
          ? "file"
          : undefined;
      if (kind === undefined || (expectedKind !== undefined && kind !== expectedKind)) {
        throw new Error("unexpected target kind");
      }
      const normalized = this.normalizePath(path, kind);
      if (!normalized.ok) return normalized;
      return ok({
        path: normalized.value,
        absolutePath: current,
        kind,
        nodeRevision: nodeRevision(normalized.value, kind, finalStats)
      });
    } catch {
      return this.validationFailure("CREATIVE_PROJECT_FILE_PATH_REJECTED", path);
    }
  }

  private async resolveMissingTarget(path: string): Promise<Result<string, UnifiedError>> {
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    const segments = path.split("/");
    const name = segments.at(-1);
    if (name === undefined)
      return this.validationFailure("CREATIVE_PROJECT_FILE_PATH_REJECTED", path);
    try {
      let parent = binding.value.canonicalRoot;
      for (const segment of segments.slice(0, -1)) {
        parent = join(parent, segment);
        const stats = await lstat(parent);
        if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("unsafe parent");
        const canonical = await realpath(parent);
        if (!isContained(relative(binding.value.canonicalRoot, canonical)))
          throw new Error("escaped root");
        parent = canonical;
      }
      const target = join(parent, name);
      try {
        await lstat(target);
        return this.validationFailure("CREATIVE_PROJECT_FILE_TARGET_EXISTS", path);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      return ok(target);
    } catch {
      return this.validationFailure("CREATIVE_PROJECT_FILE_PATH_REJECTED", path);
    }
  }

  private async readDocument(
    node: Extract<ExistingNode, { readonly kind: "file" }> | ExistingNode
  ): Promise<Result<CreativeProjectFileDocument, UnifiedError>> {
    if (node.kind !== "file")
      return this.validationFailure("CREATIVE_PROJECT_FILE_PATH_REJECTED", node.path);
    let handle: FileHandle | undefined;
    try {
      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      handle = await open(node.absolutePath, constants.O_RDONLY | noFollow);
      const opened = await handle.stat();
      if (!hasVerifiedFileIdentity(opened)) {
        return this.validationFailure("CREATIVE_PROJECT_FILE_PATH_REJECTED", node.path);
      }
      if (opened.size > this.policy.maxTextBytes) return this.tooLarge(node.path);
      const binding = await this.assertRootBinding();
      if (!binding.ok) return binding;
      const [pathStats, canonicalPath] = await Promise.all([
        lstat(node.absolutePath),
        realpath(node.absolutePath)
      ]);
      if (
        !hasSameFileIdentity(opened, pathStats) ||
        !isContained(relative(binding.value.canonicalRoot, canonicalPath))
      ) {
        return this.validationFailure("CREATIVE_PROJECT_FILE_PATH_REJECTED", node.path);
      }

      const bytes = await readBoundedFile(handle, opened.size, this.policy.maxTextBytes);
      if (bytes === undefined) {
        return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", node.path);
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return this.storageFailure("CREATIVE_PROJECT_FILE_TEXT_READ_FAILED", node.path);
      }
      if (content.includes("\0"))
        return this.storageFailure("CREATIVE_PROJECT_FILE_TEXT_READ_FAILED", node.path);
      const after = await handle.stat();
      if (!sameNode(opened, after) || !hasSameFileIdentity(opened, after)) {
        return this.validationFailure("CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT", node.path);
      }
      return ok(
        Object.freeze({
          schemaVersion: "1.0",
          projectId: this.options.projectId,
          workspaceId: this.options.workspaceId,
          path: node.path,
          content,
          checksum: checksum(bytes),
          byteLength: bytes.byteLength,
          nodeRevision: nodeRevision(node.path, "file", after),
          ...(this.workspaceLayout === "nested-folder" ? { readOnlyReason: "来源文件，只读" } : {})
        })
      );
    } catch {
      return this.storageFailure("CREATIVE_PROJECT_FILE_TEXT_READ_FAILED", node.path);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async assertRenameableDirectory(path: string): Promise<Result<void, UnifiedError>> {
    const root = await this.resolveExistingNode(path, "directory");
    if (!root.ok) return root;
    const binding = await this.assertRootBinding();
    if (!binding.ok) return binding;
    const budget = { remaining: this.policy.maxItems, maxDepth: this.policy.maxDepth };
    return this.assertRenameableDirectoryChildren(
      binding.value,
      root.value.absolutePath,
      path,
      0,
      budget
    );
  }

  private async assertRenameableDirectoryChildren(
    binding: RootBinding,
    absoluteDirectory: string,
    relativeDirectory: string,
    depth: number,
    budget: { remaining: number; readonly maxDepth: number }
  ): Promise<Result<void, UnifiedError>> {
    let entries: readonly { readonly name: string }[];
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return this.validationFailure(
        "CREATIVE_PROJECT_FILE_DIRECTORY_RENAME_REJECTED",
        relativeDirectory
      );
    }
    for (const entry of entries) {
      if (budget.remaining <= 0 || depth + 1 > budget.maxDepth) {
        return this.validationFailure(
          "CREATIVE_PROJECT_FILE_DIRECTORY_RENAME_REJECTED",
          relativeDirectory
        );
      }
      budget.remaining -= 1;
      const path = `${relativeDirectory}/${entry.name}`;
      const absolutePath = join(absoluteDirectory, entry.name);
      try {
        const stats = await lstat(absolutePath);
        if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
          return this.validationFailure("CREATIVE_PROJECT_FILE_DIRECTORY_RENAME_REJECTED", path);
        }
        const canonical = await realpath(absolutePath);
        if (!isContained(relative(binding.canonicalRoot, canonical))) {
          return this.validationFailure("CREATIVE_PROJECT_FILE_DIRECTORY_RENAME_REJECTED", path);
        }
        const kind = stats.isDirectory() ? "directory" : "file";
        const allowed = this.normalizePath(path, kind);
        if (!allowed.ok) {
          return this.validationFailure("CREATIVE_PROJECT_FILE_DIRECTORY_RENAME_REJECTED", path);
        }
        if (kind === "directory") {
          const nested = await this.assertRenameableDirectoryChildren(
            binding,
            canonical,
            allowed.value,
            depth + 1,
            budget
          );
          if (!nested.ok) return nested;
        }
      } catch {
        return this.validationFailure("CREATIVE_PROJECT_FILE_DIRECTORY_RENAME_REJECTED", path);
      }
    }
    return ok(undefined);
  }

  private async beforeFinalLifecycleValidation(
    command: CreativeProjectFileLifecycleCommand,
    paths: readonly string[]
  ): Promise<Result<void, UnifiedError>> {
    if (this.options.beforeFinalLifecycleValidation === undefined) return ok(undefined);
    try {
      await this.options.beforeFinalLifecycleValidation({
        kind: command.kind,
        paths: Object.freeze([...paths])
      });
      return ok(undefined);
    } catch {
      return this.storageFailure(
        "CREATIVE_PROJECT_FILE_LIFECYCLE_FINAL_VALIDATION_FAILED",
        command.commandId
      );
    }
  }

  private async beforeLifecycleMutation(
    command: CreativeProjectFileLifecycleCommand,
    paths: readonly string[]
  ): Promise<Result<void, UnifiedError>> {
    if (this.options.beforeLifecycleMutation === undefined) return ok(undefined);
    try {
      await this.options.beforeLifecycleMutation({
        kind: command.kind,
        paths: Object.freeze([...paths])
      });
      return ok(undefined);
    } catch {
      return this.storageFailure(
        "CREATIVE_PROJECT_FILE_LIFECYCLE_FINAL_VALIDATION_FAILED",
        command.commandId
      );
    }
  }

  private createPathGuard(binding: RootBinding) {
    return createProjectPathGuard(binding.canonicalRoot, {
      device: binding.device,
      inode: binding.inode
    });
  }

  private normalizePath(
    path: string,
    expectedKind: "file" | "directory" | "any"
  ): Result<string, UnifiedError> {
    const normalized = normalizeCreativeProjectFilePath(path, expectedKind, this.policy, {
      allowManagedPaths: this.workspaceLayout === "nested-folder"
    });
    if (!normalized.ok) return normalized;
    if (
      this.workspaceLayout === "nested-folder" &&
      segmentForPolicy(normalized.value.split("/")[0] ?? "") === ".shanhai"
    ) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_PATH_REJECTED", path);
    }
    return normalized;
  }

  private readOnlyFailure<T>(path: string): Result<T, UnifiedError> {
    return err(
      validationError({
        code: "CREATIVE_PROJECT_FILE_READ_ONLY",
        message: "Source files are read-only in a nested project workspace.",
        suggestedAction: "Edit project chapters or copy this source file into the project first.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path) }
      })
    );
  }

  private async bindRoot(): Promise<Result<RootBinding, UnifiedError>> {
    if (
      !isSafeId(this.options.projectId) ||
      !isSafeId(this.options.workspaceId) ||
      !isAbsolute(this.options.projectRoot) ||
      !isAbsolute(this.rootPath) ||
      (this.workspaceLayout !== "standalone" && this.workspaceLayout !== "nested-folder")
    ) {
      return this.validationFailure("CREATIVE_PROJECT_FILE_ROOT_REJECTED", "root");
    }
    try {
      const rootPath = resolve(this.rootPath);
      const stats = await lstat(rootPath, { bigint: true });
      const canonicalRoot = await realpath(rootPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("unsafe root");
      return ok({
        rootPath,
        canonicalRoot,
        device: stats.dev,
        inode: stats.ino
      });
    } catch {
      return this.validationFailure("CREATIVE_PROJECT_FILE_ROOT_REJECTED", "root");
    }
  }

  private async assertRootBinding(): Promise<Result<RootBinding, UnifiedError>> {
    const binding = await this.rootBinding;
    if (!binding.ok) return binding;
    try {
      const stats = await lstat(binding.value.rootPath, { bigint: true });
      const canonical = await realpath(binding.value.rootPath);
      if (
        stats.isSymbolicLink() ||
        !stats.isDirectory() ||
        stats.dev !== binding.value.device ||
        stats.ino !== binding.value.inode ||
        !samePath(canonical, binding.value.canonicalRoot)
      ) {
        throw new Error("root changed");
      }
      return binding;
    } catch {
      return this.validationFailure("CREATIVE_PROJECT_FILE_ROOT_REJECTED", "root");
    }
  }

  private assertIdentity(projectId: string, workspaceId: string): Result<void, UnifiedError> {
    return projectId === this.options.projectId && workspaceId === this.options.workspaceId
      ? ok(undefined)
      : this.validationFailure("CREATIVE_PROJECT_FILE_IDENTITY_REJECTED", "identity");
  }

  private async findReceipt(
    commandId: string
  ): Promise<Result<CreativeProjectFileLifecycleReceipt | undefined, UnifiedError>> {
    const cached = this.receiptCache.get(commandId);
    if (cached !== undefined) return ok(cached);
    if (this.options.receiptStore === undefined) return ok(undefined);
    const persisted = await this.options.receiptStore.readReceipt(commandId);
    if (!persisted.ok) return persisted;
    if (persisted.value !== undefined && !isReceipt(persisted.value)) {
      return this.storageFailure("CREATIVE_PROJECT_FILE_RECEIPT_INVALID", commandId);
    }
    if (persisted.value !== undefined) this.receiptCache.set(commandId, persisted.value);
    return persisted;
  }

  private async storeReceipt(
    receipt: CreativeProjectFileLifecycleReceipt
  ): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>> {
    this.receiptCache.set(receipt.commandId, receipt);
    if (this.options.receiptStore === undefined) return ok(receipt);
    const persisted = await this.options.receiptStore.writeReceipt(receipt);
    return persisted.ok ? ok(persisted.value) : persisted;
  }

  private serialize<T>(
    task: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    return new Promise<Result<T, UnifiedError>>((resolveResult) => {
      const prior = this.operationTail;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolveGate) => {
        release = resolveGate;
      });
      this.operationTail = prior.catch(() => undefined).then(() => gate);
      void prior
        .catch(() => undefined)
        .then(task)
        .then(resolveResult)
        .catch(() =>
          resolveResult(this.storageFailure("CREATIVE_PROJECT_FILE_OPERATION_FAILED", "operation"))
        )
        .finally(() => release?.());
    });
  }

  private validationFailure<T>(code: string, path: string): Result<T, UnifiedError> {
    return err(
      validationError({
        code,
        message: "The creative project file request was rejected.",
        suggestedAction:
          "Refresh the project files and retry with a current project-relative path.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path) }
      })
    );
  }

  private storageFailure<T>(code: string, path: string): Result<T, UnifiedError> {
    return err(
      storageError({
        code,
        message: "The creative project file operation could not be completed.",
        suggestedAction: "Refresh the project files and verify the file is valid UTF-8 text.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path) }
      })
    );
  }

  private tooLarge<T>(path: string): Result<T, UnifiedError> {
    return err(
      storageError({
        code: "CREATIVE_PROJECT_FILE_TOO_LARGE",
        message: "The creative project file is too large to open in the editor.",
        suggestedAction: "Choose a smaller UTF-8 text file.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path), maxBytes: this.policy.maxTextBytes }
      })
    );
  }

  private atomicConflictError(): UnifiedError {
    return storageError({
      code: "CREATIVE_PROJECT_FILE_ATOMIC_CONFLICT",
      message: "The project file changed while the operation was being applied.",
      suggestedAction: "Refresh the project files and retry.",
      traceId: this.traceId
    });
  }
}

/**
 * Normalizes separators and dot segments before applying the exact-segment policy.
 * It is public so outline readers and Agent mutation adapters can use the same gate.
 */
export function normalizeCreativeProjectFilePath(
  input: string,
  expectedKind: "file" | "directory" | "any",
  policyInput: CreativeProjectFilePolicy = DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  options: { readonly allowManagedPaths?: boolean } = {}
): Result<string, UnifiedError> {
  const policy = normalizeCreativeProjectFilePolicy(policyInput);
  if (!policy.ok) return policy;
  const value = typeof input === "string" ? input : "";
  const normalizedSeparators = value.replace(/\\/gu, "/");
  if (
    value.length === 0 ||
    value.length > policy.value.maxPathLength ||
    value.includes("\0") ||
    normalizedSeparators.startsWith("/") ||
    normalizedSeparators.startsWith("//") ||
    /^[A-Za-z]:/u.test(normalizedSeparators)
  ) {
    return pathValidationFailure(value);
  }
  const segments: string[] = [];
  for (const segment of normalizedSeparators.split("/")) {
    if (segment === ".") continue;
    if (
      segment.length === 0 ||
      segment === ".." ||
      segment.includes(":") ||
      /[. ]$/u.test(segment) ||
      DEVICE_NAME.test(segment)
    ) {
      return pathValidationFailure(value);
    }
    const comparison = segmentForPolicy(segment);
    if (
      (!options.allowManagedPaths &&
        policy.value.managedFileNames.some((name) => comparison === segmentForPolicy(name))) ||
      (!options.allowManagedPaths &&
        policy.value.managedPathSegments.some((name) => comparison === segmentForPolicy(name))) ||
      policy.value.ignoredPathSegments.some((name) => comparison === segmentForPolicy(name))
    ) {
      return pathValidationFailure(value);
    }
    segments.push(segment);
  }
  if (segments.length === 0) return pathValidationFailure(value);
  const path = (process.platform === "win32" ? segments.map(segmentForPolicy) : segments).join("/");
  if (expectedKind === "file") {
    const extension = extname(path).toLocaleLowerCase();
    if (!policy.value.allowedTextExtensions.includes(extension))
      return pathValidationFailure(value);
  }
  return ok(path);
}

/** Validates a persisted or IPC-provided policy and rejects unknown policy versions. */
export function normalizeCreativeProjectFilePolicy(
  input: unknown
): Result<CreativeProjectFilePolicy, UnifiedError> {
  if (!isRecord(input) || input.schemaVersion !== CREATIVE_PROJECT_FILE_POLICY_VERSION) {
    return err(
      validationError({
        code: "CREATIVE_PROJECT_FILE_POLICY_VERSION_UNSUPPORTED",
        message: "The creative project file policy version is not supported.",
        suggestedAction: "更新山海后再打开此项目文件视图。",
        traceId: "creative-project-file-policy"
      })
    );
  }
  const allowedTextExtensions = normalizeStringArray(input.allowedTextExtensions);
  const managedFileNames = normalizeStringArray(input.managedFileNames);
  const managedPathSegments = normalizeStringArray(input.managedPathSegments);
  const ignoredPathSegments = normalizeStringArray(input.ignoredPathSegments);
  const maxDepth = input.maxDepth;
  const maxItems = input.maxItems;
  const maxTextBytes = input.maxTextBytes;
  const maxPathLength = input.maxPathLength;
  if (
    allowedTextExtensions === undefined ||
    managedFileNames === undefined ||
    managedPathSegments === undefined ||
    ignoredPathSegments === undefined ||
    !isPositiveSafeInteger(maxDepth) ||
    !isPositiveSafeInteger(maxItems) ||
    !isPositiveSafeInteger(maxTextBytes) ||
    !isPositiveSafeInteger(maxPathLength) ||
    maxDepth > DEFAULT_MAX_DEPTH ||
    maxItems > DEFAULT_MAX_ITEMS ||
    maxTextBytes > DEFAULT_MAX_TEXT_BYTES ||
    maxPathLength > DEFAULT_MAX_PATH_LENGTH ||
    allowedTextExtensions.length === 0 ||
    !allowedTextExtensions.every((value) =>
      (DEFAULT_ALLOWED_TEXT_EXTENSIONS as readonly string[]).includes(value.toLowerCase())
    ) ||
    !containsAll(managedFileNames, DEFAULT_MANAGED_FILE_NAMES) ||
    !containsAll(managedPathSegments, DEFAULT_MANAGED_PATH_SEGMENTS) ||
    !containsAll(ignoredPathSegments, DEFAULT_IGNORED_PATH_SEGMENTS)
  ) {
    return err(
      validationError({
        code: "CREATIVE_PROJECT_FILE_POLICY_INVALID",
        message:
          "The creative project file policy is invalid or weakens required path protections.",
        suggestedAction: "Use the current built-in creative project file policy.",
        traceId: "creative-project-file-policy"
      })
    );
  }
  return ok(
    Object.freeze({
      schemaVersion: CREATIVE_PROJECT_FILE_POLICY_VERSION,
      allowedTextExtensions: Object.freeze([
        ...new Set(allowedTextExtensions.map((value) => value.toLowerCase()))
      ]),
      managedFileNames: Object.freeze([...new Set(managedFileNames.map(segmentForPolicy))]),
      managedPathSegments: Object.freeze([...new Set(managedPathSegments.map(segmentForPolicy))]),
      ignoredPathSegments: Object.freeze([...new Set(ignoredPathSegments.map(segmentForPolicy))]),
      maxDepth,
      maxItems,
      maxTextBytes,
      maxPathLength
    })
  );
}

function validateLifecycleCommand(
  command: CreativeProjectFileLifecycleCommand
): Result<void, UnifiedError> {
  if (
    !isRecord(command) ||
    command.schemaVersion !== CREATIVE_PROJECT_FILE_LIFECYCLE_VERSION ||
    !isSafeId(command.commandId) ||
    !isSafeId(command.projectId) ||
    !isSafeId(command.workspaceId) ||
    !isOpaqueRevision(command.expectedTreeRevision)
  ) {
    return lifecycleValidationFailure("CREATIVE_PROJECT_FILE_COMMAND_INVALID");
  }
  switch (command.kind) {
    case "createTextFile":
      return typeof command.path === "string" && typeof command.content === "string"
        ? ok(undefined)
        : lifecycleValidationFailure("CREATIVE_PROJECT_FILE_COMMAND_INVALID");
    case "createDirectory":
      return typeof command.path === "string"
        ? ok(undefined)
        : lifecycleValidationFailure("CREATIVE_PROJECT_FILE_COMMAND_INVALID");
    case "renamePath":
      return typeof command.sourcePath === "string" &&
        typeof command.targetPath === "string" &&
        isOpaqueRevision(command.expectedSourceRevision)
        ? ok(undefined)
        : lifecycleValidationFailure("CREATIVE_PROJECT_FILE_COMMAND_INVALID");
    case "deleteFile":
    case "deleteEmptyDirectory":
      return typeof command.path === "string" &&
        command.confirmed === true &&
        isOpaqueRevision(command.expectedSourceRevision)
        ? ok(undefined)
        : lifecycleValidationFailure("CREATIVE_PROJECT_FILE_COMMAND_INVALID");
    default:
      return lifecycleValidationFailure("CREATIVE_PROJECT_FILE_COMMAND_INVALID");
  }
}

function lifecycleValidationFailure<T>(code: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "The creative project file lifecycle command is invalid.",
      suggestedAction: "Refresh the project files and retry the requested action.",
      traceId: "creative-project-file-repository"
    })
  );
}

function validateTextContent(
  content: string,
  maxTextBytes: number,
  traceId: string,
  path: string
): Result<void, UnifiedError> {
  if (typeof content !== "string" || content.includes("\0")) {
    return err(
      validationError({
        code: "CREATIVE_PROJECT_FILE_TEXT_WRITE_REJECTED",
        message: "The creative project file content contains an unsupported null character.",
        suggestedAction: "Remove unsupported characters and try saving again.",
        traceId,
        redactedDetail: { path: redact(path) }
      })
    );
  }
  if (Buffer.byteLength(content, "utf8") > maxTextBytes) {
    return err(
      storageError({
        code: "CREATIVE_PROJECT_FILE_TOO_LARGE",
        message: "The creative project file is too large to save.",
        suggestedAction: "Reduce the file size and try again.",
        traceId,
        redactedDetail: { path: redact(path), maxBytes: maxTextBytes }
      })
    );
  }
  return ok(undefined);
}

function fingerprintCommand(command: CreativeProjectFileLifecycleCommand): string {
  const shared = [
    command.schemaVersion,
    command.commandId,
    command.projectId,
    command.workspaceId,
    command.expectedTreeRevision,
    command.kind
  ];
  switch (command.kind) {
    case "createTextFile":
      return checksum(shared.concat(command.path, command.content).join("\0"));
    case "createDirectory":
      return checksum(shared.concat(command.path).join("\0"));
    case "renamePath":
      return checksum(
        shared
          .concat(command.sourcePath, command.targetPath, command.expectedSourceRevision)
          .join("\0")
      );
    case "deleteFile":
    case "deleteEmptyDirectory":
      return checksum(
        shared.concat(command.path, command.expectedSourceRevision, "confirmed").join("\0")
      );
  }
}

function isReceipt(value: unknown): value is CreativeProjectFileLifecycleReceipt {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === CREATIVE_PROJECT_FILE_LIFECYCLE_VERSION &&
    isSafeId(value["commandId"]) &&
    isSafeId(value["projectId"]) &&
    isSafeId(value["workspaceId"]) &&
    isLifecycleKind(value["commandKind"]) &&
    isOpaqueRevision(value["treeRevision"]) &&
    typeof value["commandFingerprint"] === "string" &&
    CHECKSUM.test(value["commandFingerprint"]) &&
    Array.isArray(value["affectedPaths"]) &&
    value["affectedPaths"].every((path: unknown) => typeof path === "string")
  );
}

function isLifecycleKind(value: unknown): value is CreativeProjectFileLifecycleCommand["kind"] {
  return (
    value === "createTextFile" ||
    value === "createDirectory" ||
    value === "renamePath" ||
    value === "deleteFile" ||
    value === "deleteEmptyDirectory"
  );
}

function flattenTree(
  nodes: readonly CreativeProjectFileTreeNode[]
): readonly Pick<CreativeProjectFileTreeNode, "path" | "kind">[] {
  return nodes.flatMap((node) => [
    { path: node.path, kind: node.kind },
    ...flattenTree(node.children ?? [])
  ]);
}

function nodeRevision(
  path: string,
  kind: "directory" | "file",
  stats: Awaited<ReturnType<typeof lstat>>
): string {
  return `node:${checksum(
    [
      CREATIVE_PROJECT_FILE_POLICY_VERSION,
      path,
      kind,
      String(stats.dev),
      String(stats.ino),
      String(stats.size),
      String(stats.mtimeMs),
      String(stats.ctimeMs)
    ].join("\0")
  )}`;
}

function sameNode(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>
): boolean {
  return (
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function hasVerifiedFileIdentity(stats: Stats): boolean {
  return stats.dev !== 0 && stats.ino !== 0 && stats.isFile();
}

function hasSameFileIdentity(left: Stats, right: Stats): boolean {
  return (
    hasVerifiedFileIdentity(left) &&
    hasVerifiedFileIdentity(right) &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

async function readBoundedFile(
  handle: FileHandle,
  expectedSize: number,
  maxReadBytes: number
): Promise<Uint8Array | undefined> {
  if (expectedSize < 0 || expectedSize > maxReadBytes) return undefined;
  const bytes = Buffer.allocUnsafe(expectedSize);
  let bytesRead = 0;
  while (bytesRead < bytes.length) {
    const result = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
    if (result.bytesRead === 0) return undefined;
    bytesRead += result.bytesRead;
  }
  return bytes;
}

function checksum(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isContained(value: string): boolean {
  return (
    value !== ".." &&
    !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(value)
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && CHECKSUM.test(value);
}

function isOpaqueRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
    ? value
    : undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function containsAll(values: readonly string[], required: readonly string[]): boolean {
  const normalized = new Set(values.map(segmentForPolicy));
  return required.every((value) => normalized.has(segmentForPolicy(value)));
}

function segmentForPolicy(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase() : value.toLocaleLowerCase();
}

function pathValidationFailure(path: string): Result<never, UnifiedError> {
  return err(
    validationError({
      code: "CREATIVE_PROJECT_FILE_PATH_REJECTED",
      message: "The creative project file path was rejected by the current file policy.",
      suggestedAction: "Use a supported text file path inside the project files area.",
      traceId: "creative-project-file-policy",
      redactedDetail: { path: redact(path) }
    })
  );
}

function redact(value: string): string {
  return value.replace(/\\/gu, "/").split("/").filter(Boolean).slice(-2).join("/");
}
