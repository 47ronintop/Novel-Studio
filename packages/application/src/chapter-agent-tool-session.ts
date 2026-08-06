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
import { checksumChangeSetText, type ChangeSet } from "@novel-studio/agent-engine";

import { validateChapterOrderMigrationPreview } from "./chapter-order-migration.js";
import type { ChangeSetSession } from "./change-set-session.js";

export interface ChapterAgentToolSessionOptions {
  readonly repository: ChapterCatalogRepositoryPort;
  readonly changeSetSession?: Pick<ChangeSetSession, "proposePreparedFileBatch">;
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
    applyOrderMigration: applyChapterOrderMigration
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
