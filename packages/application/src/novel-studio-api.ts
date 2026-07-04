import type {
  ChapterVersionContent,
  ChapterVersionSummary,
  Result,
  UnifiedError
} from "@novel-studio/shared";

import type { ApplicationCommand } from "./command-registry.js";
import type {
  ChapterEditorSnapshot,
  ChapterSuggestionDiffPreview
} from "./chapter-editor-session.js";
import type { DesktopShellState } from "./desktop-application.js";

export interface NovelStudioApi {
  getShellState(): Promise<DesktopShellState>;
  commands: {
    list(): Promise<readonly ApplicationCommand[]>;
    execute(commandId: string): Promise<Result<DesktopShellState, UnifiedError>>;
  };
  chapter: {
    load(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    edit(nextBody: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    save(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    listVersions(): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
    previewVersion(versionId: string): Promise<Result<ChapterVersionContent, UnifiedError>>;
    restoreVersion(versionId: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    previewSuggestionDiff(
      nextBody: string
    ): Promise<Result<ChapterSuggestionDiffPreview, UnifiedError>>;
  };
}
