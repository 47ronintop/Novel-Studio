import {
  createUnifiedError,
  err,
  ok,
  type ChapterAgentRead,
  type ChapterCatalogListInput,
  type ChapterCatalogPage,
  type ChapterCatalogRepositoryPort,
  type ChapterOrderMigrationPreview,
  type ChapterOrderMigrationPlan,
  type ChapterStatus,
  type CreateAgentChapterInput,
  type CreateAgentChapterResult,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import {
  checksumChangeSetText,
  isChapterStatusTransitionProof,
  type ChangeSet,
  type ChapterStatusTransitionProof
} from "@novel-studio/agent-engine";

import { validateChapterOrderMigrationPreview } from "./chapter-order-migration.js";
import type { ChangeSetSession } from "./change-set-session.js";

export interface ChapterAgentToolSessionOptions {
  readonly repository: ChapterCatalogRepositoryPort;
  readonly changeSetSession?: Pick<ChangeSetSession, "proposePreparedFileBatch">;
  /**
   * Main-owned lifecycle preparation. It must only read current domain state and return complete,
   * serialized candidates; this session never writes a chapter or outline directly.
   */
  readonly lifecyclePreparation?: ChapterLifecyclePreparationPort;
  readonly traceId?: string;
}

export type ChapterOrderMigrationApplyInput = ChapterOrderMigrationPreview;

export interface ProposeChapterOrderMigrationInput {
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly preview: ChapterOrderMigrationPreview;
}

export type ChapterLifecycleToolName =
  "rename_chapter" | "reorder_chapter" | "set_chapter_status" | "restore_chapter";

export type ChapterLifecycleOperation = "rename" | "reorder" | "status" | "delete" | "restore";

/** Opaque, one-shot reference to a durable Main lifecycle preparation proof. */
export interface ChapterLifecyclePreparationProofRef {
  readonly proofId: string;
  readonly proofChecksum: string;
}

/** A serialized domain file which the caller can stage in one atomic Change Set group. */
export interface PreparedChapterLifecycleFile {
  readonly stableRef: string;
  readonly assetId: string;
  readonly relativePath: string;
  readonly baseContent: string;
  readonly candidateContent: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
}

/**
 * Read-only lifecycle preparation result. Chapter files and an optional outline file are returned
 * together so the Agent Run layer cannot accidentally stage only part of a domain mutation.
 */
export interface PreparedChapterLifecycleChange {
  readonly operation: ChapterLifecycleOperation;
  readonly targetChapterId: string;
  readonly consistencyGroupId: string;
  readonly chapters: readonly PreparedChapterLifecycleFile[];
  readonly outline?: PreparedChapterLifecycleFile;
  readonly proof?: ChapterStatusTransitionProof;
  readonly referenceImpactChecksum?: string;
  /** Present only when Desktop Main durably persisted the exact prepared mutation. */
  readonly preparationProof?: ChapterLifecyclePreparationProofRef;
}

export interface PrepareChapterRenameInput {
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly title: string;
}

export interface PrepareChapterReorderInput {
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly beforeChapterRef?: string | null;
  readonly afterChapterRef?: string | null;
  readonly targetVolumeRef?: string | null;
}

export interface PrepareChapterStatusInput {
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly status: Exclude<ChapterStatus, "deleted">;
}

export interface PrepareChapterDeleteInput {
  readonly chapterId: string;
  readonly baseRevision: number;
}

export interface PrepareChapterRestoreInput {
  readonly chapterId: string;
  readonly baseRevision: number;
}

/**
 * Injection boundary implemented by Main/repository composition. Delete and restore must return
 * authenticated lifecycle proofs; the application layer rechecks their binding before exposing
 * the candidates to AgentRunSession.
 */
export interface ChapterLifecyclePreparationPort {
  prepareRename(
    input: PrepareChapterRenameInput
  ): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>>;
  prepareReorder(
    input: PrepareChapterReorderInput
  ): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>>;
  prepareStatus(
    input: PrepareChapterStatusInput
  ): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>>;
  prepareDelete(
    input: PrepareChapterDeleteInput
  ): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>>;
  prepareRestore(
    input: PrepareChapterRestoreInput
  ): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>>;
}

export interface PrepareChapterLifecycleToolInput {
  readonly toolName: ChapterLifecycleToolName;
  readonly arguments: unknown;
}

export interface ChapterAgentToolSession {
  listChapters(input?: ChapterCatalogListInput): Promise<Result<ChapterCatalogPage, UnifiedError>>;
  list(input?: ChapterCatalogListInput): Promise<Result<ChapterCatalogPage, UnifiedError>>;
  readChapter(
    input: string | { readonly stableRef: string }
  ): Promise<Result<ChapterAgentRead, UnifiedError>>;
  read(
    input: string | { readonly stableRef: string }
  ): Promise<Result<ChapterAgentRead, UnifiedError>>;
  prepareCreate(
    input: CreateAgentChapterInput
  ): Promise<Result<CreateAgentChapterResult, UnifiedError>>;
  prepareCreateChapter(
    input: CreateAgentChapterInput
  ): Promise<Result<CreateAgentChapterResult, UnifiedError>>;
  previewChapterOrderMigration(): Promise<Result<ChapterOrderMigrationPreview, UnifiedError>>;
  previewOrderMigration(): Promise<Result<ChapterOrderMigrationPreview, UnifiedError>>;
  prepareChapterOrderMigration(
    input: ChapterOrderMigrationPreview
  ): Promise<Result<ChapterOrderMigrationPlan, UnifiedError>>;
  prepareOrderMigration(
    input: ChapterOrderMigrationPreview
  ): Promise<Result<ChapterOrderMigrationPlan, UnifiedError>>;
  proposeChapterOrderMigration(
    input: ProposeChapterOrderMigrationInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  proposeOrderMigration(
    input: ProposeChapterOrderMigrationInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  applyChapterOrderMigration(
    input: ChapterOrderMigrationApplyInput
  ): Promise<Result<void, UnifiedError>>;
  applyOrderMigration(input: ChapterOrderMigrationApplyInput): Promise<Result<void, UnifiedError>>;
  prepareLifecycle(
    input: PrepareChapterLifecycleToolInput
  ): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>>;
}

/**
 * Application boundary for the read-only chapter catalog and formal Agent chapter creation.
 * Identity, ordering, timestamps, Markdown serialization and persistence remain repository-owned.
 */
export function createChapterAgentToolSession(
  options: ChapterAgentToolSessionOptions
): ChapterAgentToolSession {
  const traceId = options.traceId ?? "chapter-agent-tool-session";

  async function listChapters(
    input?: ChapterCatalogListInput
  ): Promise<Result<ChapterCatalogPage, UnifiedError>> {
    const repositoryMethod = options.repository.listChapterCatalog;
    if (repositoryMethod === undefined) {
      return err(
        unavailableError(
          "CHAPTER_AGENT_CATALOG_UNAVAILABLE",
          "The chapter Agent catalog is not available for this repository."
        )
      );
    }
    const normalized = normalizeListInput(input);
    if (!normalized.ok) return normalized;
    return repositoryMethod.call(options.repository, normalized.value);
  }

  async function readChapter(
    input: string | { readonly stableRef: string }
  ): Promise<Result<ChapterAgentRead, UnifiedError>> {
    const repositoryMethod = options.repository.readChapterForAgent;
    if (repositoryMethod === undefined) {
      return err(
        unavailableError(
          "CHAPTER_AGENT_READ_UNAVAILABLE",
          "The chapter Agent read is not available for this repository."
        )
      );
    }
    const stableRef = typeof input === "string" ? input : input?.stableRef;
    const chapterId = parseChapterStableRef(stableRef);
    if (chapterId === undefined) {
      return err(
        argumentError(
          "CHAPTER_AGENT_STABLE_REF_INVALID",
          "read_chapter requires a stable chapter reference in the form chapter:<id>."
        )
      );
    }
    const result = await repositoryMethod.call(options.repository, chapterId);
    if (!result.ok) return result;
    return result;
  }

  async function prepareCreate(
    input: CreateAgentChapterInput
  ): Promise<Result<CreateAgentChapterResult, UnifiedError>> {
    const repositoryMethod = options.repository.prepareAgentChapterCreate;
    if (repositoryMethod === undefined) {
      return err(
        unavailableError(
          "CHAPTER_AGENT_CREATE_PREPARE_UNAVAILABLE",
          "Formal Agent chapter proposal preparation is not available for this repository."
        )
      );
    }
    const normalized = normalizeCreateInput(input);
    if (!normalized.ok) return normalized;
    return repositoryMethod.call(options.repository, normalized.value);
  }

  async function previewChapterOrderMigration(): Promise<
    Result<ChapterOrderMigrationPreview, UnifiedError>
  > {
    const repositoryMethod = options.repository.previewChapterOrderMigration;
    if (repositoryMethod === undefined) {
      return err(
        unavailableError(
          "CHAPTER_ORDER_MIGRATION_PREVIEW_UNAVAILABLE",
          "The chapter order migration preview is not available for this repository."
        )
      );
    }
    const result = await repositoryMethod.call(options.repository);
    if (!result.ok) return result;
    return validateChapterOrderMigrationPreview(result.value, traceId);
  }

  async function applyChapterOrderMigration(
    input: ChapterOrderMigrationApplyInput
  ): Promise<Result<void, UnifiedError>> {
    const validated = validateChapterOrderMigrationPreview(input, traceId);
    if (!validated.ok) return validated;
    return err(
      unavailableError(
        "CHAPTER_ORDER_MIGRATION_APPLY_UNAVAILABLE",
        "Applying a chapter order migration requires an approved atomic transaction port."
      )
    );
  }

  async function prepareChapterOrderMigration(
    input: ChapterOrderMigrationPreview
  ): Promise<Result<ChapterOrderMigrationPlan, UnifiedError>> {
    const validated = validateChapterOrderMigrationPreview(input, traceId);
    if (!validated.ok) return validated;
    if (!validated.value.required) {
      return err(
        argumentError(
          "CHAPTER_ORDER_MIGRATION_NOT_REQUIRED",
          "The current chapter catalog does not require an order migration."
        )
      );
    }
    const repositoryMethod = options.repository.prepareChapterOrderMigration;
    if (repositoryMethod === undefined) {
      return err(
        unavailableError(
          "CHAPTER_ORDER_MIGRATION_PREPARE_UNAVAILABLE",
          "Repository-backed chapter order migration preparation is unavailable."
        )
      );
    }
    const prepared = await repositoryMethod.call(options.repository, {
      catalogRevision: validated.value.catalogRevision,
      previewChecksum: validated.value.checksum
    });
    if (!prepared.ok) return prepared;
    return validatePreparedMigrationPlan(prepared.value, validated.value);
  }

  async function proposeChapterOrderMigration(
    input: ProposeChapterOrderMigrationInput
  ): Promise<Result<ChangeSet, UnifiedError>> {
    if (
      !isRecord(input) ||
      !isNonEmptyString(input.runId) ||
      !isNonEmptyString(input.projectId) ||
      !isNonEmptyString(input.checkpointId) ||
      !isNonEmptyString(input.contextSnapshotId)
    ) {
      return err(
        argumentError(
          "CHAPTER_ORDER_MIGRATION_ARGUMENTS_INVALID",
          "The migration proposal binding is incomplete."
        )
      );
    }
    if (options.changeSetSession === undefined) {
      return err(
        unavailableError(
          "CHAPTER_ORDER_MIGRATION_CHANGE_SET_UNAVAILABLE",
          "The approved Change Set boundary for chapter migrations is unavailable."
        )
      );
    }
    const prepared = await prepareChapterOrderMigration(input.preview);
    if (!prepared.ok) return prepared;
    return options.changeSetSession.proposePreparedFileBatch({
      runId: input.runId,
      projectId: input.projectId,
      checkpointId: input.checkpointId,
      contextSnapshotId: input.contextSnapshotId,
      consistencyGroupId: prepared.value.consistencyGroupId,
      files: prepared.value.files.map((file) => ({
        relativePath: file.relativePath,
        assetType: "chapter" as const,
        assetId: file.chapterId,
        baseContent: file.baseContent,
        candidateContent: file.candidateContent,
        baseChecksum: file.baseChecksum,
        candidateChecksum: file.candidateChecksum
      }))
    });
  }

  async function prepareLifecycle(
    input: PrepareChapterLifecycleToolInput
  ): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>> {
    const port = options.lifecyclePreparation;
    if (port === undefined) {
      return err(
        unavailableError(
          "CHAPTER_AGENT_LIFECYCLE_UNAVAILABLE",
          "Chapter lifecycle preparation is unavailable without a Main-owned domain port."
        )
      );
    }
    if (!isRecord(input) || !isChapterLifecycleToolName(input.toolName)) {
      return err(
        argumentError(
          "CHAPTER_AGENT_LIFECYCLE_TOOL_INVALID",
          "The requested chapter lifecycle tool is not supported."
        )
      );
    }
    const parsed = parseLifecycleToolArguments(input.toolName, input.arguments, traceId);
    if (!parsed.ok) return parsed;
    const prepared = await callLifecyclePreparation(port, parsed.value);
    if (!prepared.ok) return prepared;
    return validatePreparedLifecycleChange(prepared.value, parsed.value, traceId);
  }

  return {
    listChapters,
    list: listChapters,
    readChapter,
    read: readChapter,
    prepareCreate,
    prepareCreateChapter: prepareCreate,
    previewChapterOrderMigration,
    previewOrderMigration: previewChapterOrderMigration,
    prepareChapterOrderMigration,
    prepareOrderMigration: prepareChapterOrderMigration,
    proposeChapterOrderMigration,
    proposeOrderMigration: proposeChapterOrderMigration,
    applyChapterOrderMigration,
    applyOrderMigration: applyChapterOrderMigration,
    prepareLifecycle
  };

  function normalizeListInput(
    input: ChapterCatalogListInput | undefined
  ): Result<ChapterCatalogListInput, UnifiedError> {
    if (input === undefined) return ok({});
    if (!isRecord(input)) {
      return err(
        argumentError(
          "CHAPTER_AGENT_LIST_ARGUMENTS_INVALID",
          "Chapter catalog filters are invalid."
        )
      );
    }
    const candidate = input as Record<string, unknown>;
    const statuses = candidate["statuses"];
    const cursor = candidate["cursor"];
    const limit = candidate["limit"];
    const includeDeleted = candidate["includeDeleted"];
    if (
      statuses !== undefined &&
      (!Array.isArray(statuses) || statuses.some((status) => !isChapterStatus(status)))
    ) {
      return err(
        argumentError(
          "CHAPTER_AGENT_LIST_ARGUMENTS_INVALID",
          "Chapter catalog statuses are invalid."
        )
      );
    }
    if (cursor !== undefined && typeof cursor !== "string") {
      return err(
        argumentError("CHAPTER_AGENT_LIST_ARGUMENTS_INVALID", "Chapter catalog cursor is invalid.")
      );
    }
    if (
      limit !== undefined &&
      (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1)
    ) {
      return err(
        argumentError("CHAPTER_AGENT_LIST_ARGUMENTS_INVALID", "Chapter catalog limit is invalid.")
      );
    }
    if (includeDeleted !== undefined && typeof includeDeleted !== "boolean") {
      return err(
        argumentError(
          "CHAPTER_AGENT_LIST_ARGUMENTS_INVALID",
          "Chapter catalog includeDeleted is invalid."
        )
      );
    }
    return ok({
      ...(statuses === undefined ? {} : { statuses: statuses.filter(isChapterStatus) }),
      ...(cursor === undefined ? {} : { cursor: cursor as string }),
      ...(typeof limit === "number" ? { limit } : {}),
      ...(includeDeleted === undefined ? {} : { includeDeleted: includeDeleted as boolean })
    });
  }

  function normalizeCreateInput(
    input: CreateAgentChapterInput
  ): Result<CreateAgentChapterInput, UnifiedError> {
    if (!isRecord(input) || typeof input.title !== "string" || input.title.trim().length === 0) {
      return err(
        argumentError(
          "CHAPTER_AGENT_CREATE_ARGUMENTS_INVALID",
          "create_chapter requires a non-empty title."
        )
      );
    }
    if (input.title.length > 512) {
      return err(
        argumentError(
          "CHAPTER_AGENT_CREATE_ARGUMENTS_INVALID",
          "create_chapter title must contain at most 512 characters."
        )
      );
    }
    if (input.body !== undefined && typeof input.body !== "string") {
      return err(
        argumentError("CHAPTER_AGENT_CREATE_ARGUMENTS_INVALID", "create_chapter body is invalid.")
      );
    }
    if (input.volumeId !== undefined) {
      return err(
        argumentError(
          "CHAPTER_AGENT_CREATE_ARGUMENTS_INVALID",
          "create_chapter volume assignment requires an atomic outline transaction."
        )
      );
    }
    return ok({
      title: input.title,
      ...(input.body === undefined ? {} : { body: input.body })
    });
  }

  function argumentError(code: string, message: string): UnifiedError {
    return createUnifiedError({
      code,
      category: "ValidationError",
      message,
      recoverability: "user-action",
      suggestedAction: "Review the chapter tool arguments and retry.",
      traceId
    });
  }

  function unavailableError(code: string, message: string): UnifiedError {
    return createUnifiedError({
      code,
      category: "UserError",
      message,
      recoverability: "user-action",
      suggestedAction: "Use a repository that implements the formal chapter Agent methods.",
      traceId
    });
  }

  function validatePreparedMigrationPlan(
    plan: ChapterOrderMigrationPlan,
    preview: ChapterOrderMigrationPreview
  ): Result<ChapterOrderMigrationPlan, UnifiedError> {
    const planPreview = validateChapterOrderMigrationPreview(plan?.preview, traceId);
    if (
      !isRecord(plan) ||
      !planPreview.ok ||
      JSON.stringify(planPreview.value) !== JSON.stringify(preview) ||
      plan.consistencyGroupId !== `chapter-order-migration-${preview.checksum}` ||
      !Array.isArray(plan.files) ||
      plan.files.length !== preview.affected.length ||
      plan.files.length !== preview.inverse.length
    ) {
      return err(
        argumentError(
          "CHAPTER_ORDER_MIGRATION_PLAN_INVALID",
          "The repository returned an inconsistent chapter migration plan."
        )
      );
    }
    const paths = new Set<string>();
    for (let index = 0; index < plan.files.length; index += 1) {
      const file = plan.files[index];
      const affected = preview.affected[index];
      const inverse = preview.inverse[index];
      if (
        file === undefined ||
        affected === undefined ||
        inverse === undefined ||
        file.stableRef !== affected.stableRef ||
        file.chapterId !== affected.chapterId ||
        file.relativePath !== affected.relativePath ||
        file.relativePath !== `chapters/${file.chapterId}.md` ||
        file.status !== affected.status ||
        !Object.is(file.fromOrder, affected.order) ||
        !Object.is(file.fromOrder, inverse.from) ||
        file.toOrder !== inverse.to ||
        typeof file.baseContent !== "string" ||
        typeof file.candidateContent !== "string" ||
        file.baseContent.length === 0 ||
        checksumChangeSetText(file.baseContent) !== file.baseChecksum ||
        checksumChangeSetText(file.candidateContent) !== file.candidateChecksum ||
        paths.has(file.relativePath)
      ) {
        return err(
          argumentError(
            "CHAPTER_ORDER_MIGRATION_PLAN_INVALID",
            "The repository returned an inconsistent chapter migration file."
          )
        );
      }
      paths.add(file.relativePath);
    }
    return ok(plan);
  }
}

type ParsedLifecycleToolCall =
  | {
      readonly operation: "rename";
      readonly chapterId: string;
      readonly baseRevision: number;
      readonly title: string;
    }
  | {
      readonly operation: "reorder";
      readonly chapterId: string;
      readonly baseRevision: number;
      readonly beforeChapterRef?: string | null;
      readonly afterChapterRef?: string | null;
      readonly targetVolumeRef?: string | null;
    }
  | {
      readonly operation: "status";
      readonly chapterId: string;
      readonly baseRevision: number;
      readonly status: Exclude<ChapterStatus, "deleted">;
    }
  | {
      readonly operation: "delete";
      readonly chapterId: string;
      readonly baseRevision: number;
    }
  | {
      readonly operation: "restore";
      readonly chapterId: string;
      readonly baseRevision: number;
    };

function isChapterLifecycleToolName(value: unknown): value is ChapterLifecycleToolName {
  return (
    value === "rename_chapter" ||
    value === "reorder_chapter" ||
    value === "set_chapter_status" ||
    value === "restore_chapter"
  );
}

function parseLifecycleToolArguments(
  toolName: ChapterLifecycleToolName,
  value: unknown,
  traceId: string
): Result<ParsedLifecycleToolCall, UnifiedError> {
  if (!isRecord(value)) return lifecycleArgumentsInvalid(traceId);
  const chapterId = parseChapterStableRef(value["chapterRef"]);
  const baseRevision = value["baseRevision"];
  if (
    chapterId === undefined ||
    typeof baseRevision !== "number" ||
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 1
  ) {
    return lifecycleArgumentsInvalid(traceId);
  }
  if (toolName === "rename_chapter") {
    const title = value["title"];
    if (
      !hasOnlyKeys(value, ["chapterRef", "baseRevision", "title"]) ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 512
    ) {
      return lifecycleArgumentsInvalid(traceId);
    }
    return ok({ operation: "rename", chapterId, baseRevision, title });
  }
  if (toolName === "reorder_chapter") {
    if (
      !hasOnlyKeys(value, [
        "chapterRef",
        "baseRevision",
        "beforeChapterRef",
        "afterChapterRef",
        "targetVolumeRef"
      ])
    ) {
      return lifecycleArgumentsInvalid(traceId);
    }
    const beforeChapterRef = parseOptionalChapterRef(value["beforeChapterRef"]);
    const afterChapterRef = parseOptionalChapterRef(value["afterChapterRef"]);
    const targetVolumeRef = parseOptionalVolumeRef(value["targetVolumeRef"]);
    if (
      beforeChapterRef === undefined ||
      afterChapterRef === undefined ||
      targetVolumeRef === undefined
    ) {
      return lifecycleArgumentsInvalid(traceId);
    }
    return ok({
      operation: "reorder",
      chapterId,
      baseRevision,
      ...(beforeChapterRef.value === undefined ? {} : { beforeChapterRef: beforeChapterRef.value }),
      ...(afterChapterRef.value === undefined ? {} : { afterChapterRef: afterChapterRef.value }),
      ...(targetVolumeRef.value === undefined ? {} : { targetVolumeRef: targetVolumeRef.value })
    });
  }
  if (toolName === "set_chapter_status") {
    const status = value["status"];
    if (!hasOnlyKeys(value, ["chapterRef", "baseRevision", "status"]) || !isChapterStatus(status)) {
      return lifecycleArgumentsInvalid(traceId);
    }
    return status === "deleted"
      ? ok({ operation: "delete", chapterId, baseRevision })
      : ok({ operation: "status", chapterId, baseRevision, status });
  }
  if (!hasOnlyKeys(value, ["chapterRef", "baseRevision"]))
    return lifecycleArgumentsInvalid(traceId);
  return ok({ operation: "restore", chapterId, baseRevision });
}

async function callLifecyclePreparation(
  port: ChapterLifecyclePreparationPort,
  input: ParsedLifecycleToolCall
): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>> {
  switch (input.operation) {
    case "rename": {
      return port.prepareRename({
        chapterId: input.chapterId,
        baseRevision: input.baseRevision,
        title: input.title
      });
    }
    case "reorder": {
      return port.prepareReorder({
        chapterId: input.chapterId,
        baseRevision: input.baseRevision,
        ...(input.beforeChapterRef === undefined
          ? {}
          : { beforeChapterRef: input.beforeChapterRef }),
        ...(input.afterChapterRef === undefined ? {} : { afterChapterRef: input.afterChapterRef }),
        ...(input.targetVolumeRef === undefined ? {} : { targetVolumeRef: input.targetVolumeRef })
      });
    }
    case "status": {
      return port.prepareStatus({
        chapterId: input.chapterId,
        baseRevision: input.baseRevision,
        status: input.status
      });
    }
    case "delete": {
      return port.prepareDelete({ chapterId: input.chapterId, baseRevision: input.baseRevision });
    }
    case "restore": {
      return port.prepareRestore({ chapterId: input.chapterId, baseRevision: input.baseRevision });
    }
  }
}

function validatePreparedLifecycleChange(
  value: PreparedChapterLifecycleChange,
  input: ParsedLifecycleToolCall,
  traceId: string
): Result<PreparedChapterLifecycleChange, UnifiedError> {
  if (
    !isRecord(value) ||
    value.operation !== input.operation ||
    value.targetChapterId !== input.chapterId ||
    !isConsistencyGroupId(value.consistencyGroupId) ||
    !Array.isArray(value.chapters) ||
    value.chapters.length === 0
  ) {
    return invalidPreparedLifecycleChange(traceId);
  }
  const paths = new Set<string>();
  const assets = new Set<string>();
  for (const file of value.chapters) {
    if (!isValidPreparedChapterFile(file, paths, assets)) {
      return invalidPreparedLifecycleChange(traceId);
    }
  }
  if (!assets.has(input.chapterId)) return invalidPreparedLifecycleChange(traceId);
  if (value.outline !== undefined && !isValidPreparedOutlineFile(value.outline, paths)) {
    return invalidPreparedLifecycleChange(traceId);
  }
  if (value.referenceImpactChecksum !== undefined && !isChecksum(value.referenceImpactChecksum)) {
    return invalidPreparedLifecycleChange(traceId);
  }
  if (input.operation === "delete" || input.operation === "restore") {
    if (!hasBoundLifecycleProof(value.proof, input)) return invalidPreparedLifecycleChange(traceId);
  } else if (value.proof !== undefined) {
    // Rename, reorder and ordinary status changes have no tombstone proof. Keeping this closed
    // prevents a proof from silently changing the approval semantics of an unrelated operation.
    return invalidPreparedLifecycleChange(traceId);
  }
  return ok(value);
}

function isValidPreparedChapterFile(
  file: unknown,
  paths: Set<string>,
  assets: Set<string>
): file is PreparedChapterLifecycleFile {
  if (!isRecord(file) || typeof file.assetId !== "string") return false;
  return (
    parseChapterStableRef(file.stableRef) === file.assetId &&
    /^[A-Za-z0-9_-]{1,128}$/u.test(file.assetId) &&
    file.relativePath === `chapters/${file.assetId}.md` &&
    isPreparedFileContentValid(file) &&
    !paths.has(file.relativePath) &&
    !assets.has(file.assetId) &&
    (paths.add(file.relativePath), assets.add(file.assetId), true)
  );
}

function isValidPreparedOutlineFile(file: unknown, paths: Set<string>): boolean {
  if (!isRecord(file) || typeof file.stableRef !== "string" || typeof file.assetId !== "string") {
    return false;
  }
  return (
    file.stableRef.startsWith("story_bible:") &&
    file.stableRef.length <= 1036 &&
    /^[A-Za-z0-9_-]{1,128}$/u.test(file.assetId) &&
    typeof file.relativePath === "string" &&
    file.relativePath.length > 0 &&
    isPreparedFileContentValid(file) &&
    !paths.has(file.relativePath) &&
    (paths.add(file.relativePath), true)
  );
}

function isPreparedFileContentValid(file: Record<string, unknown>): boolean {
  return (
    typeof file.baseContent === "string" &&
    typeof file.candidateContent === "string" &&
    typeof file.baseChecksum === "string" &&
    typeof file.candidateChecksum === "string" &&
    isChecksum(file.baseChecksum) &&
    isChecksum(file.candidateChecksum) &&
    checksumChangeSetText(file.baseContent) === file.baseChecksum &&
    checksumChangeSetText(file.candidateContent) === file.candidateChecksum
  );
}

function hasBoundLifecycleProof(
  proof: ChapterStatusTransitionProof | undefined,
  input: Extract<ParsedLifecycleToolCall, { readonly operation: "delete" | "restore" }>
): boolean {
  if (!isChapterStatusTransitionProof(proof)) return false;
  return (
    proof.action === input.operation &&
    proof.chapterId === input.chapterId &&
    proof.stableRef === `chapter:${input.chapterId}` &&
    proof.beforeRevision === input.baseRevision &&
    (input.operation !== "delete" || proof.afterStatus === "deleted") &&
    (input.operation !== "restore" || proof.beforeStatus === "deleted")
  );
}

function parseOptionalChapterRef(
  value: unknown
): { readonly value: string | null | undefined } | undefined {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  return parseChapterStableRef(value) === undefined ? undefined : { value: value as string };
}

function parseOptionalVolumeRef(
  value: unknown
): { readonly value: string | null | undefined } | undefined {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  return typeof value === "string" && /^story_bible:[^\s]+$/u.test(value) && value.length <= 1036
    ? { value }
    : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isConsistencyGroupId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function lifecycleArgumentsInvalid(traceId: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CHAPTER_AGENT_LIFECYCLE_ARGUMENTS_INVALID",
      category: "ValidationError",
      message: "Chapter lifecycle tool arguments are invalid.",
      recoverability: "user-action",
      suggestedAction:
        "Refresh the chapter and retry with the exact stable reference and revision.",
      traceId
    })
  );
}

function invalidPreparedLifecycleChange(traceId: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CHAPTER_AGENT_LIFECYCLE_PREPARE_INVALID",
      category: "ValidationError",
      message: "The lifecycle preparation result is incomplete, stale, or not authenticated.",
      recoverability: "user-action",
      suggestedAction: "Refresh the chapter lifecycle proposal and retry.",
      traceId
    })
  );
}

function parseChapterStableRef(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("chapter:")) return undefined;
  const chapterId = value.slice("chapter:".length);
  return /^[A-Za-z0-9_-]{1,128}$/u.test(chapterId) ? chapterId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isChapterStatus(value: unknown): value is ChapterStatus {
  return (
    value === "draft" ||
    value === "revision" ||
    value === "review" ||
    value === "done" ||
    value === "archived" ||
    value === "deleted"
  );
}
