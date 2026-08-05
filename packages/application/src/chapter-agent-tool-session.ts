import {
  createUnifiedError,
  err,
  ok,
  type ChapterAgentRead,
  type ChapterCatalogListInput,
  type ChapterCatalogPage,
  type ChapterCatalogRepositoryPort,
  type ChapterOrderMigrationPreview,
  type ChapterStatus,
  type CreateAgentChapterInput,
  type CreateAgentChapterResult,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import { validateChapterOrderMigrationPreview } from "./chapter-order-migration.js";

export interface ChapterAgentToolSessionOptions {
  readonly repository: ChapterCatalogRepositoryPort;
  readonly traceId?: string;
}

export type ChapterOrderMigrationApplyInput = ChapterOrderMigrationPreview;

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

  return {
    listChapters,
    list: listChapters,
    readChapter,
    read: readChapter,
    prepareCreate,
    prepareCreateChapter: prepareCreate,
    previewChapterOrderMigration,
    previewOrderMigration: previewChapterOrderMigration,
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
    if (
      input.volumeId !== undefined &&
      (typeof input.volumeId !== "string" || input.volumeId.trim() === "")
    ) {
      return err(
        argumentError(
          "CHAPTER_AGENT_CREATE_ARGUMENTS_INVALID",
          "create_chapter volumeId is invalid."
        )
      );
    }
    return ok({
      title: input.title,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.volumeId === undefined ? {} : { volumeId: input.volumeId })
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
}

function parseChapterStableRef(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("chapter:")) return undefined;
  const chapterId = value.slice("chapter:".length);
  return /^[A-Za-z0-9_-]{1,128}$/u.test(chapterId) ? chapterId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
