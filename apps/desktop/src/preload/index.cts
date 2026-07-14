import { contextBridge, ipcRenderer } from "electron";
import type {
  ApplicationCommand,
  ApplicationIpcChannel,
  AgentConversationCommandResult,
  AgentConversationListPage,
  AgentConversationReadResult,
  AgentConversationSearchPage,
  AgentConversationSummary,
  AgentRunReadResult,
  AnswerAgentUserInputCommand,
  AiWritingSelectionPreview,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestion,
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
  CreateProjectInput,
  CreateAgentConversationCommand,
  ChangeAgentConversationStatusCommand,
  ListAgentConversationsQuery,
  ReadAgentConversationQuery,
  SearchAgentConversationsQuery,
  DesktopShellState,
  MemoryRecord,
  ModelConnectionResult,
  ModelDiscoverySnapshot,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi,
  PluginSettingsSnapshot,
  ProjectDirectorySelection,
  ProjectDirectoryTreeItem,
  ProjectTextFileReadResult,
  ProjectTextFileWriteResult,
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
import type {
  ChapterSummary,
  ChapterVersionContent,
  ChapterVersionSummary,
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
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
    readDirectory: (projectRoot: string) =>
      invokeTyped<Result<ProjectDirectoryTreeItem[], UnifiedError>>(
        "application:project:read-directory",
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
    renameChapter: (input: RenameChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:rename-chapter",
        input
      ),
    duplicateChapter: (input: DuplicateChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:duplicate-chapter",
        input
      ),
    deleteChapter: (input: DeleteChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshot, UnifiedError>>(
        "application:project:delete-chapter",
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
  file: {
    readText: (projectRoot: string, path: string) =>
      invokeTyped<Result<ProjectTextFileReadResult, UnifiedError>>(
        "application:file:read-text",
        projectRoot,
        path
      ),
    writeText: (projectRoot: string, path: string, content: string) =>
      invokeTyped<Result<ProjectTextFileWriteResult, UnifiedError>>(
        "application:file:write-text",
        projectRoot,
        path,
        content
      )
  },
  ai: {
    generateChapterSuggestion: (request: AiWritingSuggestionRequest) =>
      invokeTyped<Result<AiWritingSuggestion, UnifiedError>>(
        "application:ai:generate-chapter-suggestion",
        request
      ),
    startChapterSuggestionStream: (request: AiWritingSuggestionStreamStartRequest) =>
      invokeTyped<Result<AiWritingSuggestionStreamHandle, UnifiedError>>(
        "application:ai:start-chapter-suggestion-push-stream",
        request
      ),
    onChapterSuggestionStreamEvent: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (isAiWritingSuggestionStreamPushEvent(payload)) {
          listener(payload);
        }
      };
      ipcRenderer.on("application:ai:chapter-suggestion-push-event", wrapped);
      return () =>
        ipcRenderer.removeListener("application:ai:chapter-suggestion-push-event", wrapped);
    },
    cancelChapterSuggestionStream: (streamId: string) =>
      invokeTyped<Result<void, UnifiedError>>(
        "application:ai:cancel-chapter-suggestion-push-stream",
        streamId
      ),
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
  agentRuns: {
    start: (command: StartAgentRunCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:start", command),
    stop: (command: StopAgentRunCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:stop", command),
    answerUserInput: (command: AnswerAgentUserInputCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:answer-user-input", command),
    resume: (command: ResumeAgentRunCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:resume", command),
    retryStep: (command: RetryAgentRunStepCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:retry-step", command),
    decidePlan: (command: DecideAgentPlanCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:decide-plan", command),
    refreshContext: (command: RefreshAgentContextCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:refresh-context", command),
    decideChangeSet: (command: DecideChangeSetCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:decide-change-set", command),
    undoRun: (command: UndoRunCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:undo", command),
    read: (runId: string) =>
      invokeTyped<Result<AgentRunReadResult, UnifiedError>>("application:agent-run:read", runId),
    list: (projectId: string) =>
      invokeTyped<Result<readonly AgentRunSnapshot[], UnifiedError>>(
        "application:agent-run:list",
        projectId
      ),
    onEvent: (listener: (event: AgentRunEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (isAgentRunEvent(payload)) listener(payload);
      };
      ipcRenderer.on("application:agent-run:event", wrapped);
      return () => ipcRenderer.removeListener("application:agent-run:event", wrapped);
    }
  },
  agentConversations: {
    create: (command: CreateAgentConversationCommand) =>
      invokeTyped<Result<AgentConversationSummary, UnifiedError>>(
        "application:agent-conversation:create",
        command
      ),
    list: (query: ListAgentConversationsQuery) =>
      invokeTyped<Result<AgentConversationListPage, UnifiedError>>(
        "application:agent-conversation:list",
        query
      ),
    read: (query: ReadAgentConversationQuery) =>
      invokeTyped<Result<AgentConversationReadResult, UnifiedError>>(
        "application:agent-conversation:read",
        query
      ),
    archive: (command: ChangeAgentConversationStatusCommand) =>
      invokeTyped<AgentConversationCommandResult>(
        "application:agent-conversation:archive",
        command
      ),
    restore: (command: ChangeAgentConversationStatusCommand) =>
      invokeTyped<AgentConversationCommandResult>(
        "application:agent-conversation:restore",
        command
      ),
    search: (query: SearchAgentConversationsQuery) =>
      invokeTyped<Result<AgentConversationSearchPage, UnifiedError>>(
        "application:agent-conversation:search",
        query
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
  channel: ApplicationIpcChannel,
  ...args: readonly unknown[]
): Promise<T> {
  return (await ipcRenderer.invoke(channel, ...args)) as T;
}
