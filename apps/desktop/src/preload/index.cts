import { contextBridge, ipcRenderer } from "electron";
import type {
  ApplicationCommand,
  ApplicationIpcChannel,
  AiWritingSelectionPreview,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestion,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamEvent,
  AiWritingSuggestionStreamHandle,
  AiWritingSuggestionStreamNext,
  AiWritingSuggestionStreamOptions,
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
  ModelDiscoverySnapshot,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi,
  PluginSettingsSnapshot,
  ProjectDirectorySelection,
  ProjectRecoveryApplyResult,
  ProjectRecoveryDraftPreview,
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults,
  ProjectWorkspaceSnapshot,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleSnapshot,
  UserPreferencesSaveInput,
  UserPreferencesSnapshot,
  WorkflowRunRecord,
  WorkflowRunSummary
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
    chooseOpenDirectory: () =>
      invokeTyped<Result<ProjectDirectorySelection, UnifiedError>>(
        "application:project:choose-open-directory"
      ),
    chooseCreateDirectory: () =>
      invokeTyped<Result<ProjectDirectorySelection, UnifiedError>>(
        "application:project:choose-create-directory"
      ),
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
      ),
    previewRecoveryDraft: (sessionId: string) =>
      invokeTyped<Result<ProjectRecoveryDraftPreview, UnifiedError>>(
        "application:project:preview-recovery-draft",
        sessionId
      ),
    applyRecoveryDraft: (sessionId: string) =>
      invokeTyped<Result<ProjectRecoveryApplyResult, UnifiedError>>(
        "application:project:apply-recovery-draft",
        sessionId
      ),
    discardRecoveryDraft: (sessionId: string) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:discard-recovery-draft",
        sessionId
      )
  },
  ai: {
    generateChapterSuggestion: (request: AiWritingSuggestionRequest) =>
      invokeTyped<Result<AiWritingSuggestion, UnifiedError>>(
        "application:ai:generate-chapter-suggestion",
        request
      ),
    streamChapterSuggestion: (
      request: AiWritingSuggestionRequest,
      options?: AiWritingSuggestionStreamOptions
    ) => streamChapterSuggestionViaIpc(request, options),
    generateSelectionPreview: (request: AiWritingSelectionPreviewRequest) =>
      invokeTyped<Result<AiWritingSelectionPreview, UnifiedError>>(
        "application:ai:generate-selection-preview",
        request
      ),
    applySelectionPreview: (previewId: string) =>
      invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
        "application:ai:apply-selection-preview",
        previewId
      ),
    applyChapterSuggestion: (suggestionId: string) =>
      invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
        "application:ai:apply-chapter-suggestion",
        suggestionId
      ),
    listWorkflowRuns: () =>
      invokeTyped<Result<WorkflowRunSummary[], UnifiedError>>("application:ai:list-workflow-runs"),
    readWorkflowRun: (workflowRunId: string) =>
      invokeTyped<Result<WorkflowRunRecord, UnifiedError>>(
        "application:ai:read-workflow-run",
        workflowRunId
      )
  },
  search: {
    rebuildIndex: () =>
      invokeTyped<Result<ProjectSearchIndex, UnifiedError>>("application:search:rebuild-index"),
    query: (input: ProjectSearchQuery) =>
      invokeTyped<Result<ProjectSearchResults, UnifiedError>>("application:search:query", input)
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
    discoverModelOptions: (profileId: string) =>
      invokeTyped<Result<ModelDiscoverySnapshot, UnifiedError>>(
        "application:settings:discover-models",
        profileId
      ),
    saveModelProfile: (profile: ModelProfile, options?: { readonly makeDefault?: boolean }) =>
      invokeTyped<Result<ModelSettingsSnapshot, UnifiedError>>(
        "application:settings:save-model-profile",
        profile,
        options
      ),
    saveModelSecret: (secretRef: string, secret: string) =>
      invokeTyped<Result<void, UnifiedError>>(
        "application:settings:save-model-secret",
        secretRef,
        secret
      ),
    testModelProfileConnection: (profileId: string) =>
      invokeTyped<Result<ModelConnectionResult, UnifiedError>>(
        "application:settings:test-model-profile",
        profileId
      )
  },
  plugins: {
    loadRegistry: () =>
      invokeTyped<Result<PluginSettingsSnapshot, UnifiedError>>(
        "application:plugins:load-registry"
      ),
    setEnabled: (pluginId: string, enabled: boolean) =>
      invokeTyped<Result<PluginSettingsSnapshot, UnifiedError>>(
        "application:plugins:set-enabled",
        pluginId,
        enabled
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
    buildConsistencyReport: () =>
      invokeTyped<Result<StoryBibleConsistencyReport, UnifiedError>>(
        "application:story-bible:build-consistency-report"
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
  },
  preferences: {
    load: () =>
      invokeTyped<Result<UserPreferencesSnapshot, UnifiedError>>("application:preferences:load"),
    save: (input: UserPreferencesSaveInput) =>
      invokeTyped<Result<UserPreferencesSnapshot, UnifiedError>>(
        "application:preferences:save",
        input
      )
  }
};

contextBridge.exposeInMainWorld("novelStudio", api);

function streamChapterSuggestionViaIpc(
  request: AiWritingSuggestionRequest,
  options: AiWritingSuggestionStreamOptions | undefined
): AsyncIterable<Result<AiWritingSuggestionStreamEvent, UnifiedError>> {
  return {
    async *[Symbol.asyncIterator]() {
      let streamId: string | undefined;
      let finished = false;
      let cancelPromise: Promise<unknown> | undefined;
      const cancel = () => {
        if (streamId === undefined || cancelPromise !== undefined) {
          return;
        }
        cancelPromise = invokeTyped<Result<void, UnifiedError>>(
          "application:ai:cancel-chapter-suggestion-stream",
          streamId
        ).catch(() => undefined);
      };
      const signal = options?.signal;
      const onAbort = () => {
        cancel();
      };

      if (signal?.aborted === true) {
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const started = await invokeTyped<Result<AiWritingSuggestionStreamHandle, UnifiedError>>(
          "application:ai:start-chapter-suggestion-stream",
          request
        );
        if (!started.ok) {
          yield { ok: false, error: started.error };
          return;
        }
        streamId = started.value.streamId;
        if (isAbortSignalAborted(signal)) {
          cancel();
          return;
        }

        while (true) {
          const next = await invokeTyped<Result<AiWritingSuggestionStreamNext, UnifiedError>>(
            "application:ai:next-chapter-suggestion-stream",
            streamId
          );
          if (isAbortSignalAborted(signal)) {
            cancel();
            return;
          }
          if (!next.ok) {
            yield { ok: false, error: next.error };
            return;
          }
          if (next.value.done) {
            finished = true;
            return;
          }

          yield { ok: true, value: next.value.event };
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (!finished) {
          cancel();
          await cancelPromise;
        }
      }
    }
  };
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function invokeTyped<T>(
  channel: ApplicationIpcChannel,
  ...args: readonly unknown[]
): Promise<T> {
  return (await ipcRenderer.invoke(channel, ...args)) as T;
}
