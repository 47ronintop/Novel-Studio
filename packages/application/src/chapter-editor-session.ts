import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterFrontmatter,
  ChapterHistoryRepositoryPort,
  ChapterVersionContent,
  ChapterVersionSummary
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
  readonly now?: () => string;
}

export interface ChapterEditorSession {
  getState(): ChapterEditorState | undefined;
  load(): Promise<Result<ChapterEditorState, UnifiedError>>;
  edit(nextBody: string): Result<ChapterEditorState, UnifiedError>;
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
    edit(nextBody: string) {
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

      return ok(state);
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

      return ok(state);
    },
    previewSuggestionDiff(nextBody: string) {
      return buildSuggestionDiff(state?.chapter.body ?? "", nextBody);
    }
  };
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
