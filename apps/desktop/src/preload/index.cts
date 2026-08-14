import { contextBridge, ipcRenderer } from "electron";
import type {
  ApplicationCommand,
  ApplicationIpcChannel,
  AgentConversationCommandResult,
  AgentConversationDeleteResult,
  AgentConversationListPage,
  AgentConversationReadResult,
  AgentConversationSearchPage,
  AgentConversationSummary,
  AgentSendPreviewDtoV2,
  AgentUsageQuery,
  AgentUsageReport,
  DecideContextShareApprovalCommand,
  ClearAgentUsageCommand,
  ConfirmAgentSendPreviewCommandV2,
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
  ChapterStatus,
  ChapterStatusUpdateResult,
  ChapterSuggestionDiffPreview,
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetSnapshot,
  ConfigAssetType,
  ConfigVersionSummary,
  CreativeFolderConfirmationRequest,
  CreativeFolderCopyResult,
  CreativeProjectFileDocument,
  CreativeProjectFileLifecycleCommand,
  CreativeProjectFileLifecycleReceipt,
  CreativeProjectFileSaveResult,
  CreativeProjectFileSessionIdentity,
  CreativeProjectFileTreeSnapshot,
  CreateCreativeProjectRequest,
  CreateAgentConversationCommand,
  DeleteAgentConversationCommand,
  ChangeAgentConversationStatusCommand,
  ListAgentConversationsQuery,
  ReadAgentConversationQuery,
  SearchAgentConversationsQuery,
  DesktopShellState,
  MemoryRecord,
  ModelConnectionResult,
  ModelDiscoveryRequestOptions,
  ModelDiscoverySnapshot,
  ModelProfile,
  ModelSettingsSnapshot,
  NativeMenuCommandId,
  NovelStudioApi,
  OpenCreativeDirectoryInspection,
  PackedAgentContextPreview,
  ReadAgentPermissionSummaryQuery,
  PluginSettingsSnapshot,
  ProjectChapterSelectionDto,
  ProjectConventionsCreateResult,
  ProjectDirectorySelectionDto,
  ProjectTextFileSelectionDto,
  ProjectCreationPreviewDto,
  ProjectRecoveryApplyResultDto,
  ProjectRecoveryDraftPreview,
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults,
  ProjectWorkspaceSnapshotDto,
  WorkspaceActivationDto,
  EngineeringTextFileSaveResult,
  EngineeringTextFileSnapshot,
  EngineeringMutationRendererSyncCompletionV2,
  EngineeringMutationRendererSyncRequestV2,
  EngineeringWorkspaceSnapshot,
  ForeshadowAnalysisInput,
  ForeshadowAnalysisResultDto,
  CreateStoryBibleAssetCommand,
  SaveStoryBibleAssetCandidateCommand,
  SaveStoryBibleStatusTransitionCommand,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleEditableAsset,
  StoryBibleReferenceImpact,
  StoryBibleRestorableStatus,
  StoryBibleSnapshot,
  StoryBibleExplicitInverseApplyResult,
  StoryBibleExplicitInverseCancelResult,
  StoryBibleExplicitInversePreview,
  StoryBibleExplicitInverseSourceCommand,
  StoryAnalysisHistorySummary,
  StoryAnalysisApplicationPreviewDto,
  StoryAnalysisApplicationResultDto,
  StoryAnalysisCompletionEvent,
  StoryAnalysisRecordDto,
  StoryAnalysisReviewCommand,
  StoryAnalysisSettings,
  UserPreferencesSaveInput,
  UserPreferencesSnapshot,
  WorkspaceContextPolicyUpdate,
  EngineeringEditorStateReport,
  EngineeringEditorStateReportResult,
  WritingEditorStateReport,
  WritingEditorStateReportResult,
  WorkflowRunRecord,
  WorkflowRunSummary,
  AgentRunDraftResult,
  CompactContextResult,
  ReadAgentRunDraftCommand,
  RefreshContextDraftCommand,
  SyncStartDraftCommand,
  UpdateAgentRunDraftCommand,
  UpdateContextDraftCommand
} from "@novel-studio/application";
import type {
  AgentContextScope,
  AgentRunCommandResult,
  AgentRunEvent,
  AgentRunSnapshot,
  CompactContextCommand,
  ContextBudgetSnapshot,
  DecideChangeSetCommand,
  DecideToolApprovalCommand,
  DecideAgentPlanCommand,
  DecidePlanRevisionCommand,
  PermissionSummary,
  PreviewContextBudgetCommand,
  RefreshAgentContextCommand,
  ResumeAgentRunCommand,
  RetryAgentRunStepCommand,
  RetryRunTargetCommand,
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
    getActiveWorkspace: () =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:get-active-workspace"
      ),
    refreshActiveWorkspace: () =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:refresh-active-workspace"
      ),
    chooseOpenCreativeDirectory: () =>
      invokeTyped<Result<ProjectDirectorySelectionDto, UnifiedError>>(
        "application:project:choose-open-creative-directory"
      ),
    inspectOpenCreativeDirectory: (selectionId: string) =>
      invokeTyped<Result<OpenCreativeDirectoryInspection, UnifiedError>>(
        "application:project:inspect-open-creative-directory",
        selectionId
      ),
    confirmCreativeFolder: (request: CreativeFolderConfirmationRequest) =>
      invokeTyped<Result<CreativeFolderCopyResult, UnifiedError>>(
        "application:project:confirm-creative-folder",
        request
      ),
    chooseCreateParentDirectory: () =>
      invokeTyped<Result<ProjectDirectorySelectionDto, UnifiedError>>(
        "application:project:choose-create-parent-directory"
      ),
    openCreativeProject: (selectionId: string) =>
      invokeTyped<Result<WorkspaceActivationDto, UnifiedError>>(
        "application:project:open-creative-project",
        selectionId
      ),
    previewCreativeProject: (input: {
      readonly parentSelectionId: string;
      readonly folderName: string;
    }) =>
      invokeTyped<Result<ProjectCreationPreviewDto, UnifiedError>>(
        "application:project:preview-creative-project",
        input
      ),
    createCreativeProject: (input: CreateCreativeProjectRequest) =>
      invokeTyped<Result<WorkspaceActivationDto, UnifiedError>>(
        "application:project:create-creative-project",
        input
      ),
    listChapters: () =>
      invokeTyped<Result<readonly ChapterSummary[], UnifiedError>>(
        "application:project:list-chapters"
      ),
    createChapter: (input: CreateChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:create-chapter",
        input
      ),
    renameChapter: (input: RenameChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:rename-chapter",
        input
      ),
    duplicateChapter: (input: DuplicateChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:duplicate-chapter",
        input
      ),
    deleteChapter: (input: DeleteChapterInput) =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:delete-chapter",
        input
      ),
    selectChapter: (chapterId: string) =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:select-chapter",
        chapterId
      ),
    selectChapterAndLoad: (chapterId: string) =>
      invokeTyped<Result<ProjectChapterSelectionDto, UnifiedError>>(
        "application:project:select-chapter-and-load",
        chapterId
      ),
    previewRecoveryDraft: (sessionId: string) =>
      invokeTyped<Result<ProjectRecoveryDraftPreview, UnifiedError>>(
        "application:project:preview-recovery-draft",
        sessionId
      ),
    applyRecoveryDraft: (sessionId: string) =>
      invokeTyped<Result<ProjectRecoveryApplyResultDto, UnifiedError>>(
        "application:project:apply-recovery-draft",
        sessionId
      ),
    discardRecoveryDraft: (sessionId: string) =>
      invokeTyped<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>(
        "application:project:discard-recovery-draft",
        sessionId
      )
  },
  workspace: {
    chooseEngineeringDirectory: () =>
      invokeTyped<Result<ProjectDirectorySelectionDto, UnifiedError>>(
        "application:workspace:choose-engineering-directory"
      ),
    chooseTextFile: () =>
      invokeTyped<Result<ProjectTextFileSelectionDto, UnifiedError>>(
        "application:workspace:choose-text-file"
      ),
    openEngineeringWorkspace: (selectionId: string) =>
      invokeTyped<Result<WorkspaceActivationDto, UnifiedError>>(
        "application:workspace:open-engineering-workspace",
        selectionId
      ),
    attachActiveCreativeProjectEngineeringWorkspace: () =>
      invokeTyped<Result<EngineeringWorkspaceSnapshot, UnifiedError>>(
        "application:workspace:attach-active-creative-project"
      ),
    refreshEngineeringTree: () =>
      invokeTyped<Result<EngineeringWorkspaceSnapshot, UnifiedError>>(
        "application:workspace:refresh-engineering-tree"
      ),
    readTextFile: (path: string) =>
      invokeTyped<Result<EngineeringTextFileSnapshot, UnifiedError>>(
        "application:workspace:read-text-file",
        path
      ),
    saveTextFile: (input: {
      readonly path: string;
      readonly content: string;
      readonly expectedChecksum: string;
    }) =>
      invokeTyped<Result<EngineeringTextFileSaveResult, UnifiedError>>(
        "application:workspace:save-text-file",
        input
      ),
    onEngineeringMutationSync: (
      listener: (request: EngineeringMutationRendererSyncRequestV2) => void
    ) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (isEngineeringMutationRendererSyncRequest(payload)) listener(payload);
      };
      ipcRenderer.on("application:engineering-mutation-sync-request", wrapped);
      return () =>
        ipcRenderer.removeListener("application:engineering-mutation-sync-request", wrapped);
    },
    completeEngineeringMutationSync: (completion: EngineeringMutationRendererSyncCompletionV2) =>
      invokeTyped<Result<void, UnifiedError>>(
        "application:workspace:complete-engineering-mutation-sync",
        completion
      ),
    createProjectConventions: () =>
      invokeTyped<Result<ProjectConventionsCreateResult, UnifiedError>>(
        "application:workspace:create-project-conventions"
      ),
    updateContextPolicy: (update: WorkspaceContextPolicyUpdate) =>
      invokeTyped<Result<void, UnifiedError>>(
        "application:workspace:update-context-policy",
        typeof update === "string" ? { action: update } : update
      )
  },
  creativeProjectFiles: {
    refresh: (identity: CreativeProjectFileSessionIdentity) =>
      invokeTyped<Result<CreativeProjectFileTreeSnapshot, UnifiedError>>(
        "application:creative-project-files:refresh",
        identity
      ),
    readTextFile: (input: CreativeProjectFileSessionIdentity & { readonly path: string }) =>
      invokeTyped<Result<CreativeProjectFileDocument, UnifiedError>>(
        "application:creative-project-files:read-text-file",
        input
      ),
    saveTextFile: (
      input: CreativeProjectFileSessionIdentity & {
        readonly path: string;
        readonly content: string;
        readonly expectedTreeRevision: string;
        readonly expectedNodeRevision: string;
        readonly expectedChecksum: string;
      }
    ) =>
      invokeTyped<Result<CreativeProjectFileSaveResult, UnifiedError>>(
        "application:creative-project-files:save-text-file",
        input
      ),
    executeLifecycle: (command: CreativeProjectFileLifecycleCommand) =>
      invokeTyped<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>>(
        "application:creative-project-files:execute-lifecycle",
        command
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
    prepareStart: (command: SyncStartDraftCommand) =>
      invokeTyped<AgentRunDraftResult>("application:agent-run:prepare-start", command),
    readRunDraft: (command: ReadAgentRunDraftCommand) =>
      invokeTyped<AgentRunDraftResult>("application:agent-run:read-run-draft", command),
    updateRunDraft: (command: UpdateAgentRunDraftCommand) =>
      invokeTyped<AgentRunDraftResult>("application:agent-run:update-run-draft", command),
    updateContextDraft: (command: UpdateContextDraftCommand) =>
      invokeTyped<AgentRunDraftResult>("application:agent-run:update-context-draft", command),
    refreshContextDraft: (command: RefreshContextDraftCommand) =>
      invokeTyped<AgentRunDraftResult>("application:agent-run:refresh-context-draft", command),
    previewContextBudget: (command: PreviewContextBudgetCommand) =>
      invokeTyped<Result<ContextBudgetSnapshot, UnifiedError>>(
        "application:agent-run:preview-context-budget",
        command
      ),
    previewPackedContext: (command: PreviewContextBudgetCommand) =>
      invokeTyped<Result<PackedAgentContextPreview, UnifiedError>>(
        "application:agent-run:preview-packed-context",
        command
      ),
    compactContext: (command: CompactContextCommand) =>
      invokeTyped<Result<CompactContextResult, UnifiedError>>(
        "application:agent-run:compact-context",
        command
      ),
    prepareSendPreview: (command: {
      readonly schemaVersion: "2.0";
      readonly commandId: string;
      readonly startCommand: StartAgentRunCommand;
    }) =>
      invokeTyped<Result<AgentSendPreviewDtoV2, UnifiedError>>(
        "application:agent-run:prepare-send-preview",
        command
      ),
    confirmSendPreview: (command: ConfirmAgentSendPreviewCommandV2) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:confirm-send-preview", command),
    readSendLedger: (runId: string) =>
      invokeTyped<Awaited<ReturnType<NovelStudioApi["agentRuns"]["readSendLedger"]>>>(
        "application:agent-run:read-send-ledger",
        runId
      ),
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
    retryTarget: (command: RetryRunTargetCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:retry-target", command),
    decidePlan: (command: DecideAgentPlanCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:decide-plan", command),
    readPermissionSummary: (query: ReadAgentPermissionSummaryQuery) =>
      invokeTyped<Result<PermissionSummary | undefined, UnifiedError>>(
        "application:agent-run:read-permission-summary",
        query
      ),
    decidePlanRevision: (command: DecidePlanRevisionCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:decide-plan-revision", command),
    refreshContext: (command: RefreshAgentContextCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:refresh-context", command),
    decideChangeSet: (command: DecideChangeSetCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:decide-change-set", command),
    decideToolApproval: (command: DecideToolApprovalCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:decide-tool-approval", command),
    decideContextShareApproval: (command: DecideContextShareApprovalCommand) =>
      invokeTyped<AgentRunCommandResult>(
        "application:agent-run:decide-context-share-approval",
        command
      ),
    undoRun: (command: UndoRunCommand) =>
      invokeTyped<AgentRunCommandResult>("application:agent-run:undo", command),
    read: (runId: string) =>
      invokeTyped<Result<AgentRunReadResult, UnifiedError>>("application:agent-run:read", runId),
    list: (scopeOrProjectId: AgentContextScope | string) =>
      invokeTyped<Result<readonly AgentRunSnapshot[], UnifiedError>>(
        "application:agent-run:list",
        scopeOrProjectId
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
    delete: (command: DeleteAgentConversationCommand) =>
      invokeTyped<AgentConversationDeleteResult>("application:agent-conversation:delete", command),
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
    saveWithStatus: (status: ChapterStatus) =>
      invokeTyped<Result<ChapterStatusUpdateResult, UnifiedError>>(
        "application:chapter:set-status",
        status
      ),
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
  writingEditor: {
    reportState: (report: WritingEditorStateReport) =>
      invokeTyped<WritingEditorStateReportResult>("application:writing-editor:report-state", report)
  },
  engineeringEditor: {
    reportState: (report: EngineeringEditorStateReport) =>
      invokeTyped<EngineeringEditorStateReportResult>(
        "application:engineering-editor:report-state",
        report
      )
  },
  settings: {
    listModelProfiles: () =>
      invokeTyped<Result<ModelSettingsSnapshot, UnifiedError>>(
        "application:settings:list-model-profiles"
      ),
    discoverModelOptions: (profileId: string, options?: ModelDiscoveryRequestOptions) =>
      invokeTyped<Result<ModelDiscoverySnapshot, UnifiedError>>(
        "application:settings:discover-models",
        profileId,
        options
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
      ),
    readStoryAnalysisSettings: () =>
      invokeTyped<Result<StoryAnalysisSettings, UnifiedError>>(
        "application:settings:read-story-analysis"
      ),
    saveStoryAnalysisSettings: (settings: StoryAnalysisSettings) =>
      invokeTyped<Result<StoryAnalysisSettings, UnifiedError>>(
        "application:settings:save-story-analysis",
        settings
      ),
    listAgentUsage: (query: AgentUsageQuery) =>
      invokeTyped<Result<AgentUsageReport, UnifiedError>>(
        "application:settings:list-agent-usage",
        query
      ),
    clearAgentUsage: (command: ClearAgentUsageCommand) =>
      invokeTyped<Result<AgentUsageReport, UnifiedError>>(
        "application:settings:clear-agent-usage",
        command
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
    readAsset: (assetId: string) =>
      invokeTyped<Result<StoryBibleEditableAsset, UnifiedError>>(
        "application:story-bible:read-asset",
        assetId
      ),
    createAsset: (input: CreateStoryBibleAssetCommand) =>
      invokeTyped<Result<StoryBibleAsset, UnifiedError>>(
        "application:story-bible:create-asset",
        input
      ),
    saveAssetCandidate: (input: SaveStoryBibleAssetCandidateCommand) =>
      invokeTyped<Result<StoryBibleAsset, UnifiedError>>(
        "application:story-bible:save-asset-candidate",
        input
      ),
    prepareExplicitInverseChange: (input: {
      readonly source: StoryBibleExplicitInverseSourceCommand;
    }) =>
      invokeTyped<Result<StoryBibleExplicitInversePreview, UnifiedError>>(
        "application:story-bible:prepare-explicit-inverse-change",
        input
      ),
    applyExplicitInverseChange: (input: {
      readonly previewId: string;
      readonly revision: number;
      readonly checksum: string;
    }) =>
      invokeTyped<Result<StoryBibleExplicitInverseApplyResult, UnifiedError>>(
        "application:story-bible:apply-explicit-inverse-change",
        input
      ),
    cancelExplicitInverseChange: (input: {
      readonly previewId: string;
      readonly revision: number;
      readonly checksum: string;
    }) =>
      invokeTyped<Result<StoryBibleExplicitInverseCancelResult, UnifiedError>>(
        "application:story-bible:cancel-explicit-inverse-change",
        input
      ),
    saveStatusTransition: (input: SaveStoryBibleStatusTransitionCommand) =>
      invokeTyped<Result<StoryBibleAsset, UnifiedError>>(
        "application:story-bible:save-status-transition",
        input
      ),
    getReferences: (assetId: string) =>
      invokeTyped<Result<StoryBibleReferenceImpact, UnifiedError>>(
        "application:story-bible:get-references",
        assetId
      ),
    resolveRestoreStatus: (assetId: string) =>
      invokeTyped<Result<StoryBibleRestorableStatus, UnifiedError>>(
        "application:story-bible:resolve-restore-status",
        assetId
      ),
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
      ),
    detectForeshadows: (input: ForeshadowAnalysisInput) =>
      invokeTyped<Result<ForeshadowAnalysisResultDto, UnifiedError>>(
        "application:story-bible:detect-foreshadows",
        input
      )
  },
  storyAnalysis: {
    analyzeChapter: (input: { readonly chapterId: string }) =>
      invokeTyped<Result<StoryAnalysisRecordDto, UnifiedError>>(
        "application:story-analysis:analyze",
        input
      ),
    onCompletion: (listener: (event: StoryAnalysisCompletionEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (isStoryAnalysisCompletionEvent(payload)) listener(payload);
      };
      ipcRenderer.on("application:story-analysis:completion", wrapped);
      return () => ipcRenderer.removeListener("application:story-analysis:completion", wrapped);
    },
    list: () =>
      invokeTyped<Result<readonly StoryAnalysisHistorySummary[], UnifiedError>>(
        "application:story-analysis:list"
      ),
    read: (workflowRunId: string) =>
      invokeTyped<Result<StoryAnalysisRecordDto, UnifiedError>>(
        "application:story-analysis:read",
        workflowRunId
      ),
    transitionRecord: (command: StoryAnalysisReviewCommand) =>
      invokeTyped<Result<StoryAnalysisRecordDto, UnifiedError>>(
        "application:story-analysis:transition",
        command
      ),
    refreshStaleness: (workflowRunId: string) =>
      invokeTyped<Result<StoryAnalysisRecordDto, UnifiedError>>(
        "application:story-analysis:refresh-staleness",
        workflowRunId
      ),
    prepareApplication: (input: {
      readonly workflowRunId: string;
      readonly suggestionIds: readonly string[];
    }) =>
      invokeTyped<Result<StoryAnalysisApplicationPreviewDto, UnifiedError>>(
        "application:story-analysis:prepare-application",
        input
      ),
    applyApplication: (input: {
      readonly workflowRunId: string;
      readonly suggestionIds: readonly string[];
      readonly changeSetId: string;
      readonly revision: number;
      readonly checksum: string;
    }) =>
      invokeTyped<Result<StoryAnalysisApplicationResultDto, UnifiedError>>(
        "application:story-analysis:apply-application",
        input
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
  },
  menu: {
    onNativeCommand: (listener: (commandId: NativeMenuCommandId) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (isNativeMenuCommandId(payload)) listener(payload);
      };
      ipcRenderer.on("application:menu:native-command", wrapped);
      return () => ipcRenderer.removeListener("application:menu:native-command", wrapped);
    }
  },
  agentNetwork: {
    getSettings: () =>
      invokeTyped<
        Result<import("@novel-studio/application").AgentNetworkSettingsData, UnifiedError>
      >("application:agent-network:get-settings"),
    updateSettings: (
      partial: Partial<import("@novel-studio/application").AgentNetworkSettingsData>
    ) =>
      invokeTyped<
        Result<import("@novel-studio/application").AgentNetworkSettingsData, UnifiedError>
      >("application:agent-network:update-settings", partial),
    saveProvider: (
      profile: Omit<
        import("@novel-studio/application").AgentNetworkProviderProfile,
        "policyRevision"
      >
    ) =>
      invokeTyped<
        Result<import("@novel-studio/application").AgentNetworkSettingsData, UnifiedError>
      >("application:agent-network:save-provider", profile),
    removeProvider: (providerId: string) =>
      invokeTyped<
        Result<import("@novel-studio/application").AgentNetworkSettingsData, UnifiedError>
      >("application:agent-network:remove-provider", providerId),
    setDefaultProvider: (providerId: string) =>
      invokeTyped<
        Result<import("@novel-studio/application").AgentNetworkSettingsData, UnifiedError>
      >("application:agent-network:set-default-provider", providerId),
    testConnection: (profileId: string) =>
      invokeTyped<Result<{ readonly latencyMs: number }, UnifiedError>>(
        "application:agent-network:test-connection",
        profileId
      ),
    revoke: () =>
      invokeTyped<
        Result<import("@novel-studio/application").AgentNetworkSettingsData, UnifiedError>
      >("application:agent-network:revoke")
  },
  agentMcp: {
    listServers: () =>
      invokeTyped<
        Result<readonly import("@novel-studio/application").McpServerConfig[], UnifiedError>
      >("application:agent-mcp:list-servers"),
    addServer: (config: import("@novel-studio/application").McpServerConfig) =>
      invokeTyped<Result<import("@novel-studio/application").McpSettingsData, UnifiedError>>(
        "application:agent-mcp:add-server",
        config
      ),
    removeServer: (serverId: string) =>
      invokeTyped<Result<import("@novel-studio/application").McpSettingsData, UnifiedError>>(
        "application:agent-mcp:remove-server",
        serverId
      ),
    testConnection: (serverId: string) =>
      invokeTyped<Result<{ readonly latencyMs: number }, UnifiedError>>(
        "application:agent-mcp:test-connection",
        serverId
      ),
    revokeServer: (serverId: string) =>
      invokeTyped<Result<import("@novel-studio/application").McpSettingsData, UnifiedError>>(
        "application:agent-mcp:revoke-server",
        serverId
      )
  }
};

contextBridge.exposeInMainWorld("novelStudio", api);

function isNativeMenuCommandId(value: unknown): value is NativeMenuCommandId {
  return (
    value === "createCreativeProject" ||
    value === "openCreativeProject" ||
    value === "openEngineeringFolder"
  );
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
  const schemaVersion = event["schemaVersion"];
  const scope = event["scope"];
  const hasScope =
    (schemaVersion === "1.3" || schemaVersion === "2.0") &&
    typeof scope === "object" &&
    scope !== null &&
    !Array.isArray(scope) &&
    (((scope as Record<string, unknown>)["kind"] === "standalone" &&
      (scope as Record<string, unknown>)["scopeId"] === "standalone") ||
      ((scope as Record<string, unknown>)["kind"] === "workspace" &&
        ((scope as Record<string, unknown>)["workspaceKind"] === "creativeProject" ||
          (scope as Record<string, unknown>)["workspaceKind"] === "engineeringWorkspace") &&
        typeof (scope as Record<string, unknown>)["workspaceId"] === "string"));
  return (
    (schemaVersion === "1.0" ||
      schemaVersion === "1.1" ||
      schemaVersion === "1.2" ||
      schemaVersion === "1.3" ||
      schemaVersion === "2.0") &&
    typeof event["runId"] === "string" &&
    (hasScope || typeof event["projectId"] === "string") &&
    typeof event["sequence"] === "number" &&
    Number.isInteger(event["sequence"]) &&
    typeof event["runRevision"] === "number" &&
    Number.isInteger(event["runRevision"]) &&
    typeof event["type"] === "string" &&
    typeof event["createdAt"] === "string"
  );
}

function isStoryAnalysisCompletionEvent(value: unknown): value is StoryAnalysisCompletionEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event["schemaVersion"] === "1.0" &&
    typeof event["projectId"] === "string" &&
    typeof event["chapterId"] === "string" &&
    typeof event["workflowRunId"] === "string" &&
    (event["trigger"] === "manual" || event["trigger"] === "chapter_completed") &&
    (event["workflowStatus"] === "pending-confirmation" ||
      event["workflowStatus"] === "applied" ||
      event["workflowStatus"] === "failed") &&
    typeof event["storyBibleChanged"] === "boolean"
  );
}

function isEngineeringMutationRendererSyncRequest(
  value: unknown
): value is EngineeringMutationRendererSyncRequestV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request["schemaVersion"] === "2.0" &&
    typeof request["requestId"] === "string" &&
    /^engineering_sync_[a-f0-9]{48}$/u.test(request["requestId"]) &&
    isEngineeringMutationOperationKind(request["operationKind"]) &&
    Array.isArray(request["relativePaths"]) &&
    request["relativePaths"].every((path) => typeof path === "string")
  );
}

function isEngineeringMutationOperationKind(value: unknown): boolean {
  return (
    value === "replace_file" ||
    value === "create_file" ||
    value === "move_file" ||
    value === "delete_file" ||
    value === "create_directory"
  );
}

async function invokeTyped<T>(
  channel: ApplicationIpcChannel,
  ...args: readonly unknown[]
): Promise<T> {
  return (await ipcRenderer.invoke(channel, ...args)) as T;
}
