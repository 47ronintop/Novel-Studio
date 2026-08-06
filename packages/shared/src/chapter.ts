import type { JsonObject } from "./errors.js";
import type { Result } from "./result.js";
import type { UnifiedError } from "./errors.js";

export type SnapshotReason =
  | "manual-save"
  | "autosave-snapshot"
  | "interval-snapshot"
  | "before-ai-apply"
  | "before-rollback"
  | "migration";

export type CreatedBy = "user" | "system" | "migration";

export type ChapterStatus = "draft" | "revision" | "review" | "done" | "archived" | "deleted";

export interface ChapterFrontmatter extends JsonObject {
  schemaVersion: "1.0";
  id: string;
  type: "chapter";
  title: string;
  order: number;
  status: ChapterStatus;
  volumeId?: string;
  povCharacterIds?: string[];
  locationIds?: string[];
  timelineEventIds?: string[];
  tags?: string[];
  wordCount?: number;
  /** Optional application-owned metadata revision. Legacy files may omit it. */
  revision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterDocument {
  frontmatter: ChapterFrontmatter;
  body: string;
}

export interface ChapterSummary extends JsonObject {
  id: string;
  title: string;
  order: number;
  status: ChapterStatus;
  updatedAt: string;
  wordCount?: number;
}

/**
 * Main-owned, stable chapter catalog query.  The legacy `listChapters()` port remains the
 * compact UI projection; Agent callers use this query so tombstones, revisions and pagination
 * cannot be confused with the outline summary.
 */
export interface ChapterCatalogListInput {
  statuses?: readonly ChapterStatus[];
  cursor?: string;
  limit?: number;
  includeDeleted?: boolean;
}

/** Complete, provider-safe chapter projection returned by the Agent catalog. */
export interface ChapterAgentCatalogItem {
  stableRef: string;
  chapterId: string;
  id: string;
  title: string;
  order: number;
  status: ChapterStatus;
  updatedAt: string;
  frontmatter: ChapterFrontmatter;
  resourceRevision: string;
  /** Numeric metadata revision used by lifecycle tools; legacy files default to 1. */
  revision: number;
  /** Hash of the chapter body, kept separate from the persisted-byte revision. */
  bodyChecksum: string;
  /** Backward-compatible short name for bodyChecksum. */
  checksum: string;
  /** Hash of the exact persisted Markdown bytes. */
  persistedChecksum: string;
  relativePath: string;
  /** Volume assignment derived from the Story Bible outline, which is the ownership truth. */
  effectiveVolumeId?: string;
  /** Hash of the exact persisted outline bytes used to derive effectiveVolumeId. */
  effectiveOutlineRevision?: string;
  volumeId?: string;
  wordCount?: number;
  catalogRevision: string;
}

export interface ChapterCatalogPage {
  items: readonly ChapterAgentCatalogItem[];
  catalogRevision: string;
  nextCursor: string | null;
}

/** Full chapter read used by Agent tools and stale-base checks. */
export interface ChapterAgentRead extends ChapterAgentCatalogItem {
  body: string;
}

/** Application-owned chapter creation input.  ID, path, order and timestamps are not model input. */
export interface CreateAgentChapterInput {
  title: string;
  body?: string;
  volumeId?: string;
}

export interface CreateAgentChapterResult {
  chapter: ChapterDocument;
  item: ChapterAgentCatalogItem;
  /** Exact Markdown bytes that the Change Set should create. */
  serializedContent: string;
  relativePath: string;
}

export interface ChapterOrderMigrationAffectedItem {
  stableRef: string;
  chapterId: string;
  order: number;
  status: ChapterStatus;
  relativePath: string;
  reason: "duplicate" | "non_positive" | "non_integer" | "non_finite";
}

export interface ChapterOrderMigrationPreview {
  required: boolean;
  catalogRevision: string;
  checksum: string;
  affected: readonly ChapterOrderMigrationAffectedItem[];
  /** Deterministic inverse/repair suggestions; no files are changed by preview. */
  inverse: readonly { readonly stableRef: string; readonly from: number; readonly to: number }[];
}

/** Exact repository-owned bytes for one chapter in an order migration plan. */
export interface ChapterOrderMigrationPreparedFile {
  readonly stableRef: string;
  readonly chapterId: string;
  readonly relativePath: string;
  readonly status: ChapterStatus;
  readonly fromOrder: number;
  readonly toOrder: number;
  /** Complete Markdown bytes read from disk before the migration. */
  readonly baseContent: string;
  /** Complete Markdown bytes serialized by the repository for the target order. */
  readonly candidateContent: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
}

/** Immutable, no-write preparation result for an approved chapter order migration. */
export interface ChapterOrderMigrationPlan {
  readonly preview: ChapterOrderMigrationPreview;
  readonly files: readonly ChapterOrderMigrationPreparedFile[];
  readonly consistencyGroupId: string;
}

export interface CreateChapterInput extends JsonObject {
  chapterId: string;
  title: string;
  body?: string;
  order?: number;
  status?: ChapterStatus;
}

export interface RenameChapterInput extends JsonObject {
  chapterId: string;
  title: string;
}

export interface DuplicateChapterInput extends JsonObject {
  sourceChapterId: string;
  chapterId: string;
  title: string;
}

export interface DeleteChapterInput extends JsonObject {
  chapterId: string;
}

export interface ChapterDraftRepositoryPort {
  readChapter(chapterId: string): Promise<Result<ChapterDocument, UnifiedError>>;
  writeChapter(chapter: ChapterDocument): Promise<Result<ChapterDocument, UnifiedError>>;
}

export interface ChapterCatalogRepositoryPort {
  listChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>>;
  createChapter(input: CreateChapterInput): Promise<Result<ChapterDocument, UnifiedError>>;
  /** Agent-only catalog; optional to preserve lightweight test and UI adapters. */
  listChapterCatalog?(
    input?: ChapterCatalogListInput
  ): Promise<Result<ChapterCatalogPage, UnifiedError>>;
  readChapterForAgent?(chapterId: string): Promise<Result<ChapterAgentRead, UnifiedError>>;
  createAgentChapter?(
    input: CreateAgentChapterInput
  ): Promise<Result<CreateAgentChapterResult, UnifiedError>>;
  /** Prepare a create proposal without touching project files. */
  prepareAgentChapterCreate?(
    input: CreateAgentChapterInput
  ): Promise<Result<CreateAgentChapterResult, UnifiedError>>;
  previewChapterOrderMigration?(): Promise<Result<ChapterOrderMigrationPreview, UnifiedError>>;
  /** Prepare complete chapter bytes for an order migration without touching project files. */
  prepareChapterOrderMigration?(input: {
    readonly catalogRevision: string;
    readonly previewChecksum: string;
  }): Promise<Result<ChapterOrderMigrationPlan, UnifiedError>>;
}

export interface ChapterMaintenanceRepositoryPort {
  renameChapter(input: RenameChapterInput): Promise<Result<ChapterDocument, UnifiedError>>;
  duplicateChapter(input: DuplicateChapterInput): Promise<Result<ChapterDocument, UnifiedError>>;
  deleteChapter(input: DeleteChapterInput): Promise<Result<ChapterDocument, UnifiedError>>;
}

export interface ChapterVersionSummary extends JsonObject {
  versionId: string;
  reason: SnapshotReason;
  createdBy: CreatedBy;
  createdAt: string;
  parentVersionId?: string | null;
}

export interface ChapterVersionContent extends JsonObject {
  versionId: string;
  body: string;
  content?: string;
}

export interface ChapterVersionSnapshotInput extends JsonObject {
  chapterId: string;
  body: string;
  reason: SnapshotReason;
  createdBy?: CreatedBy;
  parentVersionId?: string | null;
}

export interface ChapterHistoryRepositoryPort {
  snapshotChapterVersion(
    input: ChapterVersionSnapshotInput
  ): Promise<Result<ChapterVersionSummary, UnifiedError>>;
  listChapterVersions(
    chapterId: string
  ): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
  readChapterVersion(
    chapterId: string,
    versionId: string
  ): Promise<Result<ChapterVersionContent, UnifiedError>>;
}
