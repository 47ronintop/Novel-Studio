/**
 * Task B.3 — Agent File Operation Session.
 * Handles the 6 lifecycle tools by generating ChangeSetOperation records.
 * Does NOT directly mutate files — all mutations go through the Change Set approval workflow.
 *
 * NOTE: ChangeSetOperation types are defined locally here to avoid cross-package
 * TypeScript resolution issues in the worktree composite build.
 */
import { randomUUID } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

// ── Local operation type definitions (match packages/agent-engine/src/change-set.ts v1.1) ──

export type ChangeSetOperationKind =
  | "modify"
  | "create_file"
  | "move_file"
  | "delete_file"
  | "create_directory";

interface ChangeSetOperationBase {
  readonly operationId: string;
  readonly dependsOn?: readonly string[];
  readonly toolCallIdempotencyKey: string;
}

export interface ChangeSetModifyOperation extends ChangeSetOperationBase {
  readonly kind: "modify";
  readonly relativePath: string;
}

export interface ChangeSetCreateFileOperation extends ChangeSetOperationBase {
  readonly kind: "create_file";
  readonly relativePath: string;
  readonly content: string;
}

export interface ChangeSetMoveFileOperation extends ChangeSetOperationBase {
  readonly kind: "move_file";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceChecksum: string;
}

export interface ChangeSetDeleteFileOperation extends ChangeSetOperationBase {
  readonly kind: "delete_file";
  readonly relativePath: string;
  readonly baseChecksum: string;
}

export interface ChangeSetCreateDirectoryOperation extends ChangeSetOperationBase {
  readonly kind: "create_directory";
  readonly relativePath: string;
}

export type ChangeSetOperation =
  | ChangeSetModifyOperation
  | ChangeSetCreateFileOperation
  | ChangeSetMoveFileOperation
  | ChangeSetDeleteFileOperation
  | ChangeSetCreateDirectoryOperation;

// ── Preflight DAG validation ──

function preflightOperations(
  operations: readonly ChangeSetOperation[]
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  const ids = new Set<string>();
  for (const op of operations) {
    if (ids.has(op.operationId))
      return { ok: false, error: `Duplicate operation IDs: ${op.operationId}` };
    ids.add(op.operationId);
  }
  for (const op of operations) {
    for (const dep of op.dependsOn ?? []) {
      if (!ids.has(dep))
        return { ok: false, error: `Operation ${op.operationId} depends on unknown ID: ${dep}` };
    }
  }
  // Detect cycles via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adjacency = new Map<string, readonly string[]>(
    operations.map((op) => [op.operationId, op.dependsOn ?? []])
  );
  function hasCycle(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const dep of adjacency.get(nodeId) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }
  for (const op of operations) {
    if (hasCycle(op.operationId))
      return {
        ok: false,
        error: `Cycle detected in operation dependencies involving: ${op.operationId}`
      };
  }
  // Path conflict check
  const createPaths = new Set<string>();
  const deletePaths = new Set<string>();
  for (const op of operations) {
    if (op.kind === "create_file" || op.kind === "create_directory") {
      if (createPaths.has(op.relativePath))
        return { ok: false, error: `Path conflict: multiple creates for ${op.relativePath}` };
      if (deletePaths.has(op.relativePath))
        return { ok: false, error: `Path conflict: create+delete for ${op.relativePath}` };
      createPaths.add(op.relativePath);
    }
    if (op.kind === "delete_file") {
      if (deletePaths.has(op.relativePath))
        return { ok: false, error: `Path conflict: multiple deletes for ${op.relativePath}` };
      if (createPaths.has(op.relativePath))
        return { ok: false, error: `Path conflict: create+delete for ${op.relativePath}` };
      deletePaths.add(op.relativePath);
    }
  }
  return { ok: true };
}

// ── Session interface ──

export interface FileOperationSessionOptions {
  readonly createOperationId?: () => string;
  readonly traceId?: string;
}

export interface ProposeFileCreateInput {
  readonly toolCallId: string;
  readonly relativePath: string;
  readonly content: string;
  readonly dependsOn?: readonly string[];
}

export interface ProposeFileMoveInput {
  readonly toolCallId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceChecksum: string;
  readonly dependsOn?: readonly string[];
}

export interface ProposeFileDeleteInput {
  readonly toolCallId: string;
  readonly relativePath: string;
  readonly baseChecksum: string;
  readonly dependsOn?: readonly string[];
}

export interface ProposeDirectoryCreateInput {
  readonly toolCallId: string;
  readonly relativePath: string;
  readonly dependsOn?: readonly string[];
}

export interface ProposeChapterCreateInput {
  readonly toolCallId: string;
  readonly title: string;
  readonly content?: string;
  readonly dependsOn?: readonly string[];
}

export interface ProposeStoryBibleWriteInput {
  readonly toolCallId: string;
  readonly assetType: string;
  readonly content: string;
  readonly dependsOn?: readonly string[];
}

export interface FileOperationProposal {
  readonly operation: ChangeSetOperation;
  readonly operationId: string;
  readonly toolCallId: string;
}

export interface AgentFileOperationSession {
  proposeFileCreate(input: ProposeFileCreateInput): Result<FileOperationProposal, UnifiedError>;
  proposeFileMove(input: ProposeFileMoveInput): Result<FileOperationProposal, UnifiedError>;
  proposeFileDelete(input: ProposeFileDeleteInput): Result<FileOperationProposal, UnifiedError>;
  proposeDirectoryCreate(
    input: ProposeDirectoryCreateInput
  ): Result<FileOperationProposal, UnifiedError>;
  proposeChapterCreate(input: ProposeChapterCreateInput): Result<FileOperationProposal, UnifiedError>;
  proposeStoryBibleWrite(
    input: ProposeStoryBibleWriteInput
  ): Result<FileOperationProposal, UnifiedError>;
  listPendingOperations(): readonly ChangeSetOperation[];
  validateOperationDAG(): Result<void, UnifiedError>;
}

export function createAgentFileOperationSession(
  options: FileOperationSessionOptions = {}
): AgentFileOperationSession {
  const createOperationId =
    options.createOperationId ?? (() => `op_${randomUUID().replaceAll("-", "")}`);
  const traceId = options.traceId ?? "agent-file-operation-session";

  const proposals = new Map<string, FileOperationProposal>();
  const operations: ChangeSetOperation[] = [];

  function operationError(code: string, message: string): UnifiedError {
    return createUnifiedError({
      code,
      category: "ValidationError",
      message,
      recoverability: "user-action",
      suggestedAction: "Review the file operation parameters and retry.",
      traceId
    });
  }

  function store(toolCallId: string, operation: ChangeSetOperation): FileOperationProposal {
    const proposal: FileOperationProposal = { operation, operationId: operation.operationId, toolCallId };
    proposals.set(toolCallId, proposal);
    operations.push(operation);
    return proposal;
  }

  function existingOrNew<T extends ChangeSetOperation>(
    toolCallId: string,
    create: () => T
  ): Result<FileOperationProposal, UnifiedError> {
    const existing = proposals.get(toolCallId);
    if (existing !== undefined) return ok(existing);
    return ok(store(toolCallId, create()));
  }

  function isValidRelativePath(p: string): boolean {
    return (
      p.length > 0 &&
      p.length <= 1024 &&
      !p.includes("..") &&
      !p.includes("\\") &&
      !p.startsWith("/") &&
      !p.startsWith("//")
    );
  }

  return {
    proposeFileCreate(input) {
      if (!isValidRelativePath(input.relativePath))
        return err(operationError("FILE_OP_PATH_INVALID", "File path is invalid."));
      if (input.content.length > 10 * 1024 * 1024)
        return err(operationError("FILE_OP_CONTENT_TOO_LARGE", "Content exceeds 10 MB."));
      return existingOrNew(input.toolCallId, () => ({
        kind: "create_file" as const,
        operationId: createOperationId(),
        relativePath: input.relativePath,
        content: input.content,
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
      }));
    },

    proposeFileMove(input) {
      if (!isValidRelativePath(input.sourcePath) || !isValidRelativePath(input.targetPath))
        return err(operationError("FILE_OP_PATH_INVALID", "File path is invalid."));
      if (input.sourcePath === input.targetPath)
        return err(operationError("FILE_OP_SAME_PATH", "Source and target paths are the same."));
      if (!/^[a-f0-9]{64}$/.test(input.sourceChecksum))
        return err(operationError("FILE_OP_CHECKSUM_INVALID", "Source checksum is invalid."));
      return existingOrNew(input.toolCallId, () => ({
        kind: "move_file" as const,
        operationId: createOperationId(),
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        sourceChecksum: input.sourceChecksum,
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
      }));
    },

    proposeFileDelete(input) {
      if (!isValidRelativePath(input.relativePath))
        return err(operationError("FILE_OP_PATH_INVALID", "File path is invalid."));
      if (!/^[a-f0-9]{64}$/.test(input.baseChecksum))
        return err(operationError("FILE_OP_CHECKSUM_INVALID", "Base checksum is invalid."));
      return existingOrNew(input.toolCallId, () => ({
        kind: "delete_file" as const,
        operationId: createOperationId(),
        relativePath: input.relativePath,
        baseChecksum: input.baseChecksum,
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
      }));
    },

    proposeDirectoryCreate(input) {
      if (!isValidRelativePath(input.relativePath))
        return err(operationError("FILE_OP_PATH_INVALID", "Directory path is invalid."));
      return existingOrNew(input.toolCallId, () => ({
        kind: "create_directory" as const,
        operationId: createOperationId(),
        relativePath: input.relativePath,
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
      }));
    },

    proposeChapterCreate(input) {
      if (input.title.length === 0 || input.title.length > 512)
        return err(operationError("FILE_OP_TITLE_INVALID", "Chapter title must be 1–512 chars."));
      const existing = proposals.get(input.toolCallId);
      if (existing !== undefined) return ok(existing);
      const safeName = input.title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 64);
      const operation: ChangeSetCreateFileOperation = {
        kind: "create_file",
        operationId: createOperationId(),
        relativePath: `chapters/${safeName}.md`,
        content: input.content ?? `---\ntitle: "${input.title}"\n---\n\n`,
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
      };
      return ok(store(input.toolCallId, operation));
    },

    proposeStoryBibleWrite(input) {
      const validAssetTypes = [
        "character",
        "world.location",
        "world.faction",
        "world.rule",
        "world.glossary",
        "outline",
        "timeline.events"
      ];
      if (!validAssetTypes.includes(input.assetType))
        return err(operationError("FILE_OP_ASSET_TYPE_INVALID", `Unknown asset type: ${input.assetType}`));
      if (input.content.length === 0 || input.content.length > 1024 * 1024)
        return err(operationError("FILE_OP_CONTENT_INVALID", "Content must be non-empty and ≤1 MB."));
      try {
        JSON.parse(input.content);
      } catch {
        return err(operationError("FILE_OP_CONTENT_INVALID", "Story Bible content must be valid JSON."));
      }
      const existing = proposals.get(input.toolCallId);
      if (existing !== undefined) return ok(existing);
      const operation: ChangeSetCreateFileOperation = {
        kind: "create_file",
        operationId: createOperationId(),
        relativePath: `story-bible/${input.assetType.replace(".", "/")}.json`,
        content: input.content,
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
      };
      return ok(store(input.toolCallId, operation));
    },

    listPendingOperations() {
      return [...operations];
    },

    validateOperationDAG() {
      const result = preflightOperations(operations);
      if (result.ok) return ok(undefined);
      return err(operationError("FILE_OP_DAG_INVALID", result.error));
    }
  };
}
