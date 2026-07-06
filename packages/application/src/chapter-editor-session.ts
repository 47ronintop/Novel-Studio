import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterFrontmatter,
  ChapterHistoryRepositoryPort,
  ChapterVersionContent,
  ChapterVersionSummary,
  RecoveryRepositoryPort
} from "@novel-studio/shared";

export type ChapterEditorSaveStatus = "Saved" | "Saving" | "Unsaved" | "Recovery available";

export interface ChapterEditorState {
  readonly chapter: ChapterDocument;
  readonly dirty: boolean;
  readonly saveStatus: ChapterEditorSaveStatus;
}

export interface ChapterEditorSnapshot {
  readonly state: ChapterEditorState;
  readonly versions: readonly ChapterVersionSummary[];
}

export interface ChapterEditorSessionOptions {
  readonly chapterId: string;
  readonly repository: ChapterDraftRepositoryPort;
  readonly historyRepository?: ChapterHistoryRepositoryPort;
  readonly recoveryRepository?: RecoveryRepositoryPort;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly now?: () => string;
}

export interface ChapterEditorSession {
  getState(): ChapterEditorState | undefined;
  load(): Promise<Result<ChapterEditorState, UnifiedError>>;
  edit(nextBody: string): Promise<Result<ChapterEditorState, UnifiedError>>;
  applyAiEdit(nextBody: string): Promise<Result<ChapterEditorState, UnifiedError>>;
  save(): Promise<Result<ChapterEditorState, UnifiedError>>;
  listVersions(): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
  previewVersion(versionId: string): Promise<Result<ChapterVersionContent, UnifiedError>>;
  restoreVersion(versionId: string): Promise<Result<ChapterEditorState, UnifiedError>>;
  previewSuggestionDiff(nextBody: string): ChapterSuggestionDiffPreview;
}

export interface ChapterSuggestionDiffPreview {
  readonly title: string;
  readonly changes: readonly ChapterSuggestionDiffChange[];
}

export interface ChapterSuggestionDiffChange {
  readonly kind: "insert" | "delete" | "replace";
  readonly value: string;
}

export type { ChapterDraftRepositoryPort } from "@novel-studio/shared";

export function createChapterEditorSession(
  options: ChapterEditorSessionOptions
): ChapterEditorSession {
  const now = options.now ?? (() => new Date().toISOString());
  const sessionId =
    options.sessionId ??
    `session_${sanitizeRecoveryId(options.projectId ?? "project")}_${sanitizeRecoveryId(options.chapterId)}`;
  let state: ChapterEditorState | undefined;
  let persistedBody = "";

  return {
    getState: () => state,
    async load() {
      const result = await options.repository.readChapter(options.chapterId);
      if (!result.ok) {
        return result;
      }

      state = {
        chapter: result.value,
        dirty: false,
        saveStatus: "Saved"
      };
      persistedBody = result.value.body;

      return ok(state);
    },
    async edit(nextBody: string) {
      if (state === undefined) {
        return err(createChapterSessionError("CHAPTER_SESSION_NOT_LOADED"));
      }

      const nextChapter: ChapterDocument = {
        ...state.chapter,
        body: nextBody
      };
      const dirty = nextBody !== persistedBody;

      state = {
        chapter: nextChapter,
        dirty,
        saveStatus: dirty ? "Unsaved" : "Saved"
      };

      const recoveryResult = await writeRecoveryRecord(true);
      if (!recoveryResult.ok) {
        return recoveryResult;
      }

      return ok(state);
    },
    async applyAiEdit(nextBody: string) {
      if (state === undefined) {
        return err(createChapterSessionError("CHAPTER_SESSION_NOT_LOADED"));
      }

      if (options.historyRepository !== undefined) {
        const snapshotResult = await options.historyRepository.snapshotChapterVersion({
          chapterId: options.chapterId,
          body: state.chapter.body,
          reason: "before-ai-apply",
          createdBy: "user",
          parentVersionId: null
        });

        if (!snapshotResult.ok) {
          return snapshotResult;
        }
      }

      return this.edit(nextBody);
    },
    async save() {
      if (state === undefined) {
        return err(createChapterSessionError("CHAPTER_SESSION_NOT_LOADED"));
      }

      if (!state.dirty) {
        return ok(state);
      }

      const savingState: ChapterEditorState = {
        ...state,
        saveStatus: "Saving"
      };
      state = savingState;

      const chapterToPersist: ChapterDocument = {
        body: savingState.chapter.body,
        frontmatter: updateChapterFrontmatter(savingState.chapter.frontmatter, now())
      };

      const writeResult = await options.repository.writeChapter(chapterToPersist);
      if (!writeResult.ok) {
        state = {
          ...savingState,
          saveStatus: "Unsaved"
        };
        return writeResult;
      }

      persistedBody = chapterToPersist.body;
      state = {
        chapter: chapterToPersist,
        dirty: false,
        saveStatus: "Saved"
      };

      if (options.historyRepository !== undefined) {
        const snapshotResult = await options.historyRepository.snapshotChapterVersion({
          chapterId: options.chapterId,
          body: chapterToPersist.body,
          reason: "manual-save",
          createdBy: "user",
          parentVersionId: null
        });

        if (!snapshotResult.ok) {
          return snapshotResult;
        }
      }

      const recoveryResult = await writeRecoveryRecord(false);
      if (!recoveryResult.ok) {
        return recoveryResult;
      }

      return ok(state);
    },
    async listVersions() {
      if (options.historyRepository === undefined) {
        return ok([]);
      }

      return options.historyRepository.listChapterVersions(options.chapterId);
    },
    async previewVersion(versionId: string) {
      if (options.historyRepository === undefined) {
        return err(createChapterSessionError("CHAPTER_HISTORY_UNAVAILABLE"));
      }

      return options.historyRepository.readChapterVersion(options.chapterId, versionId);
    },
    async restoreVersion(versionId: string) {
      if (state === undefined) {
        return err(createChapterSessionError("CHAPTER_SESSION_NOT_LOADED"));
      }
      if (options.historyRepository === undefined) {
        return err(createChapterSessionError("CHAPTER_HISTORY_UNAVAILABLE"));
      }

      const snapshotResult = await options.historyRepository.snapshotChapterVersion({
        chapterId: options.chapterId,
        body: state.chapter.body,
        reason: "before-rollback",
        createdBy: "user",
        parentVersionId: null
      });
      if (!snapshotResult.ok) {
        return snapshotResult;
      }

      const previewResult = await options.historyRepository.readChapterVersion(
        options.chapterId,
        versionId
      );
      if (!previewResult.ok) {
        return previewResult;
      }

      const restoredChapter: ChapterDocument = {
        frontmatter: updateChapterFrontmatter(state.chapter.frontmatter, now()),
        body: previewResult.value.body
      };
      const writeResult = await options.repository.writeChapter(restoredChapter);
      if (!writeResult.ok) {
        return writeResult;
      }

      state = {
        chapter: restoredChapter,
        dirty: false,
        saveStatus: "Saved"
      };
      persistedBody = restoredChapter.body;

      const recoveryResult = await writeRecoveryRecord(false);
      if (!recoveryResult.ok) {
        return recoveryResult;
      }

      return ok(state);
    },
    previewSuggestionDiff(nextBody: string) {
      return buildSuggestionDiff(state?.chapter.body ?? "", nextBody);
    }
  };

  async function writeRecoveryRecord(dirty: boolean): Promise<Result<void, UnifiedError>> {
    if (
      options.recoveryRepository === undefined ||
      options.projectId === undefined ||
      state === undefined
    ) {
      return ok(undefined);
    }

    const result = await options.recoveryRepository.writeRecoveryRecord({
      schemaVersion: "1.0",
      sessionId,
      projectId: options.projectId,
      openAssetId: options.chapterId,
      assetType: "chapter",
      dirty,
      draftContentRef: {
        strategy: "inline",
        content: state.chapter.body
      },
      updatedAt: now()
    });

    if (!result.ok) {
      return result;
    }

    return ok(undefined);
  }
}

function updateChapterFrontmatter(
  frontmatter: ChapterFrontmatter,
  updatedAt: string
): ChapterFrontmatter {
  return {
    ...frontmatter,
    updatedAt
  };
}

function createChapterSessionError(code: string): UnifiedError {
  return {
    schemaVersion: "1.0",
    errorId: `err_${code.toLowerCase()}`,
    code,
    category: "UserError",
    message: "Chapter editor session is not loaded.",
    recoverability: "user-action",
    suggestedAction: "Open a chapter before editing or saving it.",
    traceId: "chapter-editor-session",
    createdAt: new Date().toISOString()
  };
}

function sanitizeRecoveryId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length === 0 ? "unknown" : sanitized;
}

function buildSuggestionDiff(currentBody: string, nextBody: string): ChapterSuggestionDiffPreview {
  if (currentBody === nextBody) {
    return {
      title: "AI suggestion",
      changes: []
    };
  }

  return {
    title: "AI suggestion",
    changes: [
      {
        kind: "replace",
        value: nextBody
      }
    ]
  };
}
