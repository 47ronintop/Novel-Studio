import { contextBridge, ipcRenderer } from "electron";
import type {
  ApplicationCommand,
  ApplicationIpcChannel,
  AiWritingSuggestion,
  AiWritingSuggestionRequest,
  ChapterEditorSnapshot,
  ChapterSuggestionDiffPreview,
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetSnapshot,
  ConfigAssetType,
  ConfigVersionSummary,
  CreateProjectInput,
  DesktopShellState,
  MemoryRecord,
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi,
  ProjectWorkspaceSnapshot,
  StoryBibleAsset,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleSnapshot
} from "@novel-studio/application";
import type {
  ChapterSummary,
  ChapterVersionContent,
  ChapterVersionSummary,
  CreateChapterInput,
  Result,
  UnifiedError
} from "@novel-studio/shared";

const api: NovelStudioApi = {
  getShellState: () => invokeTyped<DesktopShellState>("application:get-shell-state"),
  commands: {
    list: () => invokeTyped<readonly ApplicationCommand[]>("application:list-commands"),
    execute: (commandId: string) =>
      invokeTyped<Result<DesktopShellState, UnifiedError>>("application:execute-command", commandId)
  },
  project: {
    open: (projectRoot: string) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:open",
        projectRoot
      ),
    create: (input: CreateProjectInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:create",
        input
      ),
    listChapters: () =>
      invokeTyped<Result<readonly ChapterSummary[], UnifiedError>>(
        "application:project:list-chapters"
      ),
    createChapter: (input: CreateChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:create-chapter",
        input
      ),
    selectChapter: (chapterId: string) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:select-chapter",
        chapterId
      )
  },
  ai: {
    generateChapterSuggestion: (request: AiWritingSuggestionRequest) =>
      invokeTyped<Result<AiWritingSuggestion, UnifiedError>>(
        "application:ai:generate-chapter-suggestion",
        request
      ),
    applyChapterSuggestion: (suggestionId: string) =>
      invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
        "application:ai:apply-chapter-suggestion",
        suggestionId
      )
  },
  chapter: {
    load: () =>
      invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>("application:chapter:load"),
    edit: (nextBody: string) =>
      invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
        "application:chapter:edit",
        nextBody
      ),
    save: () =>
      invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>("application:chapter:save"),
    listVersions: () =>
      invokeTyped<Result<readonly ChapterVersionSummary[], UnifiedError>>(
        "application:chapter:list-versions"
      ),
    previewVersion: (versionId: string) =>
      invokeTyped<Result<ChapterVersionContent, UnifiedError>>(
        "application:chapter:preview-version",
        versionId
      ),
    restoreVersion: (versionId: string) =>
      invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
        "application:chapter:restore-version",
        versionId
      ),
    previewSuggestionDiff: (nextBody: string) =>
      invokeTyped<Result<ChapterSuggestionDiffPreview, UnifiedError>>(
        "application:chapter:preview-suggestion-diff",
        nextBody
      )
  },
  settings: {
    listModelProfiles: () =>
      invokeTyped<Result<ModelSettingsSnapshot, UnifiedError>>(
        "application:settings:list-model-profiles"
      ),
    saveModelProfile: (profile: ModelProfile, options?: { readonly makeDefault?: boolean }) =>
      invokeTyped<Result<ModelSettingsSnapshot, UnifiedError>>(
        "application:settings:save-model-profile",
        profile,
        options
      ),
    testModelProfileConnection: (profileId: string) =>
      invokeTyped<Result<ModelConnectionResult, UnifiedError>>(
        "application:settings:test-model-profile",
        profileId
      )
  },
  storyBible: {
    load: () =>
      invokeTyped<Result<StoryBibleSnapshot, UnifiedError>>("application:story-bible:load"),
    saveAsset: (asset: StoryBibleAsset) =>
      invokeTyped<Result<StoryBibleAsset, UnifiedError>>(
        "application:story-bible:save-asset",
        asset
      ),
    saveMemory: (memory: MemoryRecord) =>
      invokeTyped<Result<MemoryRecord, UnifiedError>>(
        "application:story-bible:save-memory",
        memory
      ),
    buildContextCandidates: (options?: StoryBibleContextCandidateOptions) =>
      invokeTyped<Result<readonly StoryBibleContextCandidate[], UnifiedError>>(
        "application:story-bible:build-context-candidates",
        options
      )
  },
  studio: {
    loadConfigAsset: (assetType: ConfigAssetType, assetId: string) =>
      invokeTyped<Result<ConfigAssetSnapshot, UnifiedError>>(
        "application:studio:load-config-asset",
        assetType,
        assetId
      ),
    saveConfigAsset: (input: ConfigAssetSaveInput) =>
      invokeTyped<Result<ConfigVersionSummary, UnifiedError>>(
        "application:studio:save-config-asset",
        input
      ),
    restoreConfigAssetVersion: (input: ConfigAssetRestoreInput) =>
      invokeTyped<Result<ConfigAssetSnapshot, UnifiedError>>(
        "application:studio:restore-config-version",
        input
      )
  }
};

contextBridge.exposeInMainWorld("novelStudio", api);

async function invokeTyped<T>(
  channel: ApplicationIpcChannel,
  ...args: readonly unknown[]
): Promise<T> {
  return (await ipcRenderer.invoke(channel, ...args)) as T;
}
