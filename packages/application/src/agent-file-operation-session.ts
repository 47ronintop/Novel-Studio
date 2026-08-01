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

import type { StoryBibleAssetType } from "./story-bible-session.js";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CLOCK$",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

// ── Local operation type definitions (match packages/agent-engine/src/change-set.ts v1.1) ──

export type ChangeSetOperationKind =
  "modify" | "create_file" | "move_file" | "delete_file" | "create_directory";

interface ChangeSetOperationBase {
  readonly operationId: string;
  readonly dependsOn?: readonly string[];
  readonly toolCallIdempotencyKey: string;
  readonly consistencyGroupId?: string;
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
  readonly createChapterId?: () => string;
  readonly now?: () => string;
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
  readonly consistencyGroupId?: string;
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
  proposeChapterCreate(
    input: ProposeChapterCreateInput
  ): Result<FileOperationProposal, UnifiedError>;
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
  const createChapterId =
    options.createChapterId ?? (() => `ch_${randomUUID().replaceAll("-", "")}`);
  const now = options.now ?? (() => new Date().toISOString());
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
    const proposal: FileOperationProposal = {
      operation,
      operationId: operation.operationId,
      toolCallId
    };
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
    if (typeof p !== "string" || p.length === 0 || p.length > 1024) return false;
    // Accept one canonical form so later filesystem layers never need to normalize user input.
    if (p.includes("\\") || p.includes("\0") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
      return false;
    }
    return p.split("/").every((segment) => {
      if (segment.length === 0 || segment === "." || segment === "..") return false;
      // ':' selects an NTFS alternate data stream and also covers drive-relative paths.
      if (segment.includes(":") || /[. ]$/.test(segment)) return false;
      const deviceName = segment.split(".", 1)[0]?.toUpperCase();
      return deviceName !== undefined && !WINDOWS_RESERVED_NAMES.has(deviceName);
    });
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
      const chapterId = createChapterId();
      const createdAt = now();
      if (!/^ch_[A-Za-z0-9_-]+$/u.test(chapterId) || !Number.isFinite(Date.parse(createdAt))) {
        return err(
          operationError(
            "FILE_OP_CHAPTER_ID_INVALID",
            "The generated chapter identity or timestamp is invalid."
          )
        );
      }
      const body = input.content ?? "";
      const operation: ChangeSetCreateFileOperation = {
        kind: "create_file",
        operationId: createOperationId(),
        relativePath: `chapters/${chapterId}.md`,
        content: formatCreatedChapter(chapterId, input.title, body, createdAt),
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
      };
      return ok(store(input.toolCallId, operation));
    },

    proposeStoryBibleWrite(input) {
      if (!isStoryBibleAssetType(input.assetType))
        return err(
          operationError("FILE_OP_ASSET_TYPE_INVALID", `Unknown asset type: ${input.assetType}`)
        );
      if (input.content.length === 0 || input.content.length > 1024 * 1024)
        return err(
          operationError("FILE_OP_CONTENT_INVALID", "Content must be non-empty and ≤1 MB.")
        );
      let parsed: Record<string, unknown>;
      try {
        const candidate = JSON.parse(input.content) as unknown;
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
          throw new Error("Story Bible asset must be an object.");
        }
        parsed = candidate as Record<string, unknown>;
      } catch {
        return err(
          operationError("FILE_OP_CONTENT_INVALID", "Story Bible content must be valid JSON.")
        );
      }
      const assetId = parsed["id"];
      if (
        typeof assetId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(assetId) ||
        parsed["type"] !== input.assetType
      ) {
        return err(
          operationError(
            "FILE_OP_CONTENT_INVALID",
            "Story Bible content must contain a stable ID and the requested asset type."
          )
        );
      }
      const relativePath = storyBibleAssetRelativePath(input.assetType, assetId);
      if (relativePath === undefined || !isValidRelativePath(relativePath)) {
        return err(operationError("FILE_OP_PATH_INVALID", "Story Bible asset path is invalid."));
      }
      const existing = proposals.get(input.toolCallId);
      if (existing !== undefined) return ok(existing);
      const operation: ChangeSetCreateFileOperation = {
        kind: "create_file",
        operationId: createOperationId(),
        relativePath,
        content: input.content,
        toolCallIdempotencyKey: input.toolCallId,
        ...(input.consistencyGroupId === undefined
          ? {}
          : { consistencyGroupId: input.consistencyGroupId }),
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

const STORY_BIBLE_ASSET_PATH_RESOLVERS = {
  character: (assetId: string) => `characters/${assetId}.json`,
  "world.location": (assetId: string) => `world/${assetId}.json`,
  "world.faction": (assetId: string) => `world/${assetId}.json`,
  "world.rule": (assetId: string) => `world/${assetId}.json`,
  "world.glossary": (assetId: string) => `world/${assetId}.json`,
  "world.item": (assetId: string) => `world/${assetId}.json`,
  "world.lore": (assetId: string) => `world/${assetId}.json`,
  outline: () => "outline/outline.json",
  "timeline.events": () => "timeline/events.json",
  foreshadow: (assetId: string) => `foreshadows/${assetId}.json`
} satisfies Readonly<Record<StoryBibleAssetType, (assetId: string) => string>>;

export function isStoryBibleAssetType(value: string): value is StoryBibleAssetType {
  return Object.hasOwn(STORY_BIBLE_ASSET_PATH_RESOLVERS, value);
}

export function storyBibleAssetRelativePath(
  assetType: StoryBibleAssetType,
  assetId: string
): string;
export function storyBibleAssetRelativePath(assetType: string, assetId: string): string | undefined;
export function storyBibleAssetRelativePath(
  assetType: string,
  assetId: string
): string | undefined {
  if (!isStoryBibleAssetType(assetType)) return undefined;
  return STORY_BIBLE_ASSET_PATH_RESOLVERS[assetType](assetId);
}

function formatCreatedChapter(
  chapterId: string,
  title: string,
  body: string,
  createdAt: string
): string {
  const wordCount = body.trim().length === 0 ? 0 : body.trim().split(/\s+/u).length;
  return [
    "---",
    'schemaVersion: "1.0"',
    `id: ${chapterId}`,
    "type: chapter",
    `title: ${JSON.stringify(title)}`,
    "order: 1",
    "status: draft",
    `wordCount: ${wordCount}`,
    `createdAt: ${JSON.stringify(createdAt)}`,
    `updatedAt: ${JSON.stringify(createdAt)}`,
    "---",
    "",
    body.replace(/\s*$/u, ""),
    ""
  ].join("\n");
}
