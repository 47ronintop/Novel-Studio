import type {
  ApplicationCommand,
  ApplicationIpcChannel,
  AiWritingSuggestion,
  AiWritingSelectionPreview,
  AiWritingSelectionPreviewRequest,
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
  DesktopShellState,
  ModelConnectionResult,
  ModelDiscoverySnapshot,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi,
  PluginSettingsSnapshot,
  ProjectRecoveryApplyResult,
  ProjectRecoveryDraftPreview,
  ProjectDirectorySelection,
  ProjectDirectoryTreeItem,
  ProjectTextFileReadResult,
  ProjectTextFileWriteResult,
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults,
  ProjectWorkspaceSnapshot,
  CreateProjectInput,
  MemoryRecord,
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
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
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
      readDirectory: (projectRoot: string) =>
        invokeTyped<Result<ProjectDirectoryTreeItem[], UnifiedError>>(
          ipc,
          "application:project:read-directory",
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
      renameChapter: (input: RenameChapterInput) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:rename-chapter",
          input
        ),
      duplicateChapter: (input: DuplicateChapterInput) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:duplicate-chapter",
          input
        ),
      deleteChapter: (input: DeleteChapterInput) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:delete-chapter",
          input
        ),
      selectChapter: (chapterId: string) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:select-chapter",
          chapterId
        ),
      previewRecoveryDraft: (sessionId: string) =>
        invokeTyped<Result<ProjectRecoveryDraftPreview, UnifiedError>>(
          ipc,
          "application:project:preview-recovery-draft",
          sessionId
        ),
      applyRecoveryDraft: (sessionId: string) =>
        invokeTyped<Result<ProjectRecoveryApplyResult, UnifiedError>>(
          ipc,
          "application:project:apply-recovery-draft",
          sessionId
        ),
      discardRecoveryDraft: (sessionId: string) =>
        invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
          ipc,
          "application:project:discard-recovery-draft",
          sessionId
        )
    },
    file: {
      readText: (projectRoot: string, path: string) =>
        invokeTyped<Result<ProjectTextFileReadResult, UnifiedError>>(
          ipc,
          "application:file:read-text",
          projectRoot,
          path
        ),
      writeText: (projectRoot: string, path: string, content: string) =>
        invokeTyped<Result<ProjectTextFileWriteResult, UnifiedError>>(
          ipc,
          "application:file:write-text",
          projectRoot,
          path,
          content
        )
    },
    ai: {
      generateChapterSuggestion: (request: AiWritingSuggestionRequest) =>
        invokeTyped<Result<AiWritingSuggestion, UnifiedError>>(
          ipc,
          "application:ai:generate-chapter-suggestion",
          request
        ),
      streamChapterSuggestion: (
        request: AiWritingSuggestionRequest,
        options?: AiWritingSuggestionStreamOptions
      ) => streamChapterSuggestionViaIpc(ipc, request, options),
      generateSelectionPreview: (request: AiWritingSelectionPreviewRequest) =>
        invokeTyped<Result<AiWritingSelectionPreview, UnifiedError>>(
          ipc,
          "application:ai:generate-selection-preview",
          request
        ),
      applySelectionPreview: (previewId: string) =>
        invokeTyped<Result<ChapterEditorSnapshot, UnifiedError>>(
          ipc,
          "application:ai:apply-selection-preview",
          previewId
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
      discoverModelOptions: (profileId: string) =>
        invokeTyped<Result<ModelDiscoverySnapshot, UnifiedError>>(
          ipc,
          "application:settings:discover-models",
          profileId
        ),
      saveModelProfile: (profile: ModelProfile, options?: { readonly makeDefault?: boolean }) =>
        invokeTyped<Result<ModelSettingsSnapshot, UnifiedError>>(
          ipc,
          "application:settings:save-model-profile",
          profile,
          options
        ),
      saveModelSecret: (secretRef: string, secret: string) =>
        invokeTyped<Result<void, UnifiedError>>(
          ipc,
          "application:settings:save-model-secret",
          secretRef,
          secret
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
        ),
      setEnabled: (pluginId: string, enabled: boolean) =>
        invokeTyped<Result<PluginSettingsSnapshot, UnifiedError>>(
          ipc,
          "application:plugins:set-enabled",
          pluginId,
          enabled
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
      buildConsistencyReport: () =>
        invokeTyped<Result<StoryBibleConsistencyReport, UnifiedError>>(
          ipc,
          "application:story-bible:build-consistency-report"
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
    },
    preferences: {
      load: () =>
        invokeTyped<Result<UserPreferencesSnapshot, UnifiedError>>(
          ipc,
          "application:preferences:load"
        ),
      save: (input: UserPreferencesSaveInput) =>
        invokeTyped<Result<UserPreferencesSnapshot, UnifiedError>>(
          ipc,
          "application:preferences:save",
          input
        )
    }
  };
}

function streamChapterSuggestionViaIpc(
  ipc: IpcInvoker,
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
          ipc,
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
          ipc,
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
            ipc,
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
  ipc: IpcInvoker,
  channel: ApplicationIpcChannel,
  ...args: readonly unknown[]
): Promise<T> {
  return (await ipc.invoke(channel, ...args)) as T;
}
