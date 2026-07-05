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
  DesktopShellState,
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi,
  PluginSettingsSnapshot,
  ProjectDirectorySelection,
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults,
  ProjectWorkspaceSnapshot,
  CreateProjectInput,
  MemoryRecord,
  StoryBibleAsset,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleSnapshot,
  WorkflowRunRecord,
  WorkflowRunSummary
} from "@novel-studio/application";
import type {
  ChapterSummary,
  CreateChapterInput,
  ChapterVersionContent,
  ChapterVersionSummary,
  Result,
  UnifiedError
} from "@novel-studio/shared";

export interface IpcInvoker {
  invoke(channel: ApplicationIpcChannel, ...args: readonly unknown[]): Promise<unknown>;
}

export function createNovelStudioApi(ipc: IpcInvoker): NovelStudioApi {
  return {
    getShellState: () => invokeTyped<DesktopShellState>(ipc, "application:get-shell-state"),
    commands: {
      list: () => invokeTyped<readonly ApplicationCommand[]>(ipc, "application:list-commands"),
      execute: (commandId: string) =>
        invokeTyped<Result<DesktopShellState, UnifiedError>>(
          ipc,
          "application:execute-command",
          commandId
        )
    },
    project: {
      chooseOpenDirectory: () =>
        invokeTyped<Result<ProjectDirectorySelection, UnifiedError>>(
          ipc,
          "application:project:choose-open-directory"
        ),
      chooseCreateDirectory: () =>
        invokeTyped<Result<ProjectDirectorySelection, UnifiedError>>(
          ipc,
          "application:project:choose-create-directory"
        ),
      open: (projectRoot: string) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:open",
          projectRoot
        ),
      create: (input: CreateProjectInput) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:create",
          input
        ),
      listChapters: () =>
        invokeTyped<Result<readonly ChapterSummary[], UnifiedError>>(
          ipc,
          "application:project:list-chapters"
        ),
      createChapter: (input: CreateChapterInput) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:create-chapter",
          input
        ),
      selectChapter: (chapterId: string) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:select-chapter",
          chapterId
        )
    },
    ai: {
      generateChapterSuggestion: (request: AiWritingSuggestionRequest) =>
        invokeTyped<Result<AiWritingSuggestion, UnifiedError>>(
          ipc,
          "application:ai:generate-chapter-suggestion",
          request
        ),
      applyChapterSuggestion: (suggestionId: string) =>
        invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
          ipc,
          "application:ai:apply-chapter-suggestion",
          suggestionId
        ),
      listWorkflowRuns: () =>
        invokeTyped<Result<WorkflowRunSummary[], UnifiedError>>(
          ipc,
          "application:ai:list-workflow-runs"
        ),
      readWorkflowRun: (workflowRunId: string) =>
        invokeTyped<Result<WorkflowRunRecord, UnifiedError>>(
          ipc,
          "application:ai:read-workflow-run",
          workflowRunId
        )
    },
    search: {
      rebuildIndex: () =>
        invokeTyped<Result<ProjectSearchIndex, UnifiedError>>(
          ipc,
          "application:search:rebuild-index"
        ),
      query: (input: ProjectSearchQuery) =>
        invokeTyped<Result<ProjectSearchResults, UnifiedError>>(
          ipc,
          "application:search:query",
          input
        )
    },
    chapter: {
      load: () =>
        invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(ipc, "application:chapter:load"),
      edit: (nextBody: string) =>
        invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
          ipc,
          "application:chapter:edit",
          nextBody
        ),
      save: () =>
        invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(ipc, "application:chapter:save"),
      listVersions: () =>
        invokeTyped<Result<readonly ChapterVersionSummary[], UnifiedError>>(
          ipc,
          "application:chapter:list-versions"
        ),
      previewVersion: (versionId: string) =>
        invokeTyped<Result<ChapterVersionContent, UnifiedError>>(
          ipc,
          "application:chapter:preview-version",
          versionId
        ),
      restoreVersion: (versionId: string) =>
        invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
          ipc,
          "application:chapter:restore-version",
          versionId
        ),
      previewSuggestionDiff: (nextBody: string) =>
        invokeTyped<Result<ChapterSuggestionDiffPreview, UnifiedError>>(
          ipc,
          "application:chapter:preview-suggestion-diff",
          nextBody
        )
    },
    settings: {
      listModelProfiles: () =>
        invokeTyped<Result<ModelSettingsSnapshot, UnifiedError>>(
          ipc,
          "application:settings:list-model-profiles"
        ),
      saveModelProfile: (profile: ModelProfile, options?: { readonly makeDefault?: boolean }) =>
        invokeTyped<Result<ModelSettingsSnapshot, UnifiedError>>(
          ipc,
          "application:settings:save-model-profile",
          profile,
          options
        ),
      testModelProfileConnection: (profileId: string) =>
        invokeTyped<Result<ModelConnectionResult, UnifiedError>>(
          ipc,
          "application:settings:test-model-profile",
          profileId
        )
    },
    plugins: {
      loadRegistry: () =>
        invokeTyped<Result<PluginSettingsSnapshot, UnifiedError>>(
          ipc,
          "application:plugins:load-registry"
        )
    },
    storyBible: {
      load: () =>
        invokeTyped<Result<StoryBibleSnapshot, UnifiedError>>(ipc, "application:story-bible:load"),
      saveAsset: (asset: StoryBibleAsset) =>
        invokeTyped<Result<StoryBibleAsset, UnifiedError>>(
          ipc,
          "application:story-bible:save-asset",
          asset
        ),
      saveMemory: (memory: MemoryRecord) =>
        invokeTyped<Result<MemoryRecord, UnifiedError>>(
          ipc,
          "application:story-bible:save-memory",
          memory
        ),
      buildContextCandidates: (options?: StoryBibleContextCandidateOptions) =>
        invokeTyped<Result<readonly StoryBibleContextCandidate[], UnifiedError>>(
          ipc,
          "application:story-bible:build-context-candidates",
          options
        )
    },
    studio: {
      loadConfigAsset: (assetType: ConfigAssetType, assetId: string) =>
        invokeTyped<Result<ConfigAssetSnapshot, UnifiedError>>(
          ipc,
          "application:studio:load-config-asset",
          assetType,
          assetId
        ),
      saveConfigAsset: (input: ConfigAssetSaveInput) =>
        invokeTyped<Result<ConfigVersionSummary, UnifiedError>>(
          ipc,
          "application:studio:save-config-asset",
          input
        ),
      restoreConfigAssetVersion: (input: ConfigAssetRestoreInput) =>
        invokeTyped<Result<ConfigAssetSnapshot, UnifiedError>>(
          ipc,
          "application:studio:restore-config-version",
          input
        )
    }
  };
}

async function invokeTyped<T>(
  ipc: IpcInvoker,
  channel: ApplicationIpcChannel,
  ...args: readonly unknown[]
): Promise<T> {
  return (await ipc.invoke(channel, ...args)) as T;
}
