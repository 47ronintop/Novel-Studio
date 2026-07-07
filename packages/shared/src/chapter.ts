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
