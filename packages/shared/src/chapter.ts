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

export interface ChapterDraftRepositoryPort {
  readChapter(chapterId: string): Promise<Result<ChapterDocument, UnifiedError>>;
  writeChapter(chapter: ChapterDocument): Promise<Result<ChapterDocument, UnifiedError>>;
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
