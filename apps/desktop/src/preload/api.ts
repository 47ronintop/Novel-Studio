import type {
  ApplicationCommand,
  ApplicationIpcChannel,
  ApplicationIpcEventChannel,
  AiWritingSuggestion,
  AiWritingSelectionPreview,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamHandle,
  AiWritingSuggestionStreamPushEvent,
  AiWritingSuggestionStreamStartRequest,
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
  AgentRunCommandResult,
  AgentRunEvent,
  AgentRunSnapshot,
  DecideChangeSetCommand,
  DecideAgentPlanCommand,
  RefreshAgentContextCommand,
  ResumeAgentRunCommand,
  RetryAgentRunStepCommand,
  StartAgentRunCommand,
  StopAgentRunCommand,
  UndoRunCommand
} from "@novel-studio/agent-engine";
import type { AgentRunReadResult, AnswerAgentUserInputCommand } from "@novel-studio/application";
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
  on?(channel: ApplicationIpcEventChannel, listener: (payload: unknown) => void): () => void;
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
      startChapterSuggestionStream: (request: AiWritingSuggestionStreamStartRequest) =>
        invokeTyped<Result<AiWritingSuggestionStreamHandle, UnifiedError>>(
          ipc,
          "application:ai:start-chapter-suggestion-push-stream",
          request
        ),
      onChapterSuggestionStreamEvent: (listener) => {
        if (ipc.on === undefined) {
          return () => undefined;
        }
        return ipc.on("application:ai:chapter-suggestion-push-event", (payload) => {
          if (isAiWritingSuggestionStreamPushEvent(payload)) {
            listener(payload);
          }
        });
      },
      cancelChapterSuggestionStream: (streamId: string) =>
        invokeTyped<Result<void, UnifiedError>>(
          ipc,
          "application:ai:cancel-chapter-suggestion-push-stream",
          streamId
        ),
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
    agentRuns: {
      start: (command: StartAgentRunCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:start", command),
      stop: (command: StopAgentRunCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:stop", command),
      answerUserInput: (command: AnswerAgentUserInputCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:answer-user-input", command),
      resume: (command: ResumeAgentRunCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:resume", command),
      retryStep: (command: RetryAgentRunStepCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:retry-step", command),
      decidePlan: (command: DecideAgentPlanCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:decide-plan", command),
      refreshContext: (command: RefreshAgentContextCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:refresh-context", command),
      decideChangeSet: (command: DecideChangeSetCommand) =>
        invokeTyped<AgentRunCommandResult>(
          ipc,
          "application:agent-run:decide-change-set",
          command
        ),
      undoRun: (command: UndoRunCommand) =>
        invokeTyped<AgentRunCommandResult>(ipc, "application:agent-run:undo", command),
      read: (runId: string) =>
        invokeTyped<Result<AgentRunReadResult, UnifiedError>>(
          ipc,
          "application:agent-run:read",
          runId
        ),
      list: (projectId: string) =>
        invokeTyped<Result<readonly AgentRunSnapshot[], UnifiedError>>(
          ipc,
          "application:agent-run:list",
          projectId
        ),
      onEvent: (listener: (event: AgentRunEvent) => void) => {
        if (ipc.on === undefined) return () => undefined;
        return ipc.on("application:agent-run:event", (payload) => {
          if (isAgentRunEvent(payload)) listener(payload);
        });
      }
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

function isAiWritingSuggestionStreamPushEvent(
  value: unknown
): value is AiWritingSuggestionStreamPushEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    typeof event["streamId"] === "string" &&
    typeof event["sequence"] === "number" &&
    (event["type"] === "event" || event["type"] === "error" || event["type"] === "completed")
  );
}

function isAgentRunEvent(value: unknown): value is AgentRunEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event["schemaVersion"] === "1.0" &&
    typeof event["runId"] === "string" &&
    typeof event["projectId"] === "string" &&
    typeof event["sequence"] === "number" &&
    Number.isInteger(event["sequence"]) &&
    typeof event["runRevision"] === "number" &&
    Number.isInteger(event["runRevision"]) &&
    typeof event["type"] === "string" &&
    typeof event["createdAt"] === "string"
  );
}

async function invokeTyped<T>(
  ipc: IpcInvoker,
  channel: ApplicationIpcChannel,
  ...args: readonly unknown[]
): Promise<T> {
  return (await ipc.invoke(channel, ...args)) as T;
}
