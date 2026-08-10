import type {
  ChapterSummary,
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
  ChapterVersionContent,
  ChapterVersionSummary,
  ChapterStatus,
  Result,
  UnifiedError
} from "@novel-studio/shared";
import type {
  AgentContextScope,
  ContextDraftRef,
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

import type { ApplicationCommand, NativeMenuCommandId } from "./command-registry.js";
import type {
  AgentRunDraftResult,
  ReadAgentRunDraftCommand,
  RefreshContextDraftCommand,
  SyncStartDraftCommand,
  UpdateAgentRunDraftCommand,
  UpdateContextDraftCommand
} from "./agent-run-draft-session.js";
import type { CompactContextResult, PackedAgentContextPreview } from "./agent-context-session.js";
import type { WorkspaceModelSharingDefaults } from "./agent-model-sharing.js";
import type {
  AgentSendPreviewDtoV2,
  ConfirmAgentSendPreviewCommandV2
} from "./agent-send-preview-session.js";
import type {
  CreativeProjectFileDocument,
  CreativeProjectFileLifecycleCommand,
  CreativeProjectFileLifecycleReceipt,
  CreativeProjectFileSaveResult,
  CreativeProjectFileSessionIdentity,
  CreativeProjectFileTreeSnapshot
} from "./creative-project-file-session.js";
import type {
  AiWritingSuggestion,
  AiWritingSelectionPreview,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamEvent,
  AiWritingSuggestionStreamHandle,
  AiWritingSuggestionStreamPushEvent,
  AiWritingSuggestionStreamStartRequest,
  WorkflowRunRecord,
  WorkflowRunSummary
} from "./ai-writing-workflow-session.js";
import type {
  ChapterEditorSnapshot,
  ChapterSuggestionDiffPreview
} from "./chapter-editor-session.js";
import type {
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetSnapshot,
  ConfigAssetType,
  ConfigVersionSummary
} from "./config-studio-session.js";
import type {
  DesktopShellState,
  ChapterStatusUpdateResult,
  ProjectChapterSelectionDto,
  ProjectCreationPreviewDto,
  ProjectRecoveryApplyResultDto,
  ProjectWorkspaceSnapshotDto,
  WorkspaceActivationDto
} from "./desktop-application.js";
import type {
  EngineeringTextFileSaveResult,
  EngineeringTextFileSnapshot,
  EngineeringWorkspaceSnapshot
} from "./engineering-workspace-session.js";
import type { ModelDiscoverySnapshot } from "./model-discovery-session.js";
import type {
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSnapshot,
  StoryAnalysisSettings
} from "./model-settings-session.js";
import type { PluginSettingsSnapshot } from "./plugin-settings-session.js";
import type { ProjectRecoveryDraftPreview } from "./project-workspace-session.js";
import type {
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults
} from "./project-search-session.js";
import type {
  CreateStoryBibleAssetCommand,
  MemoryRecord,
  SaveStoryBibleAssetCandidateCommand,
  SaveStoryBibleStatusTransitionCommand,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleEditableAsset,
  StoryBibleReferenceImpact,
  StoryBibleRestorableStatus,
  StoryBibleSnapshot
} from "./story-bible-session.js";
import type { ForeshadowAnalysisInput } from "./foreshadow-analysis-session.js";
import type {
  StoryAnalysisHistorySummary,
  StoryAnalysisRecordDto,
  StoryAnalysisReviewCommand
} from "./story-analysis-session.js";
import type {
  StoryAnalysisApplicationPreviewDto,
  StoryAnalysisApplicationResultDto
} from "./story-analysis-application-session.js";
import type {
  StoryBibleExplicitInverseApplyResult,
  StoryBibleExplicitInverseCancelResult,
  StoryBibleExplicitInversePreview,
  StoryBibleExplicitInverseSourceCommand
} from "./story-bible-explicit-inverse-session.js";
import type {
  UserPreferencesSaveInput,
  UserPreferencesSnapshot
} from "./user-preferences-session.js";
import type { AgentNetworkSettingsData } from "./agent-network-settings-session.js";
import type { AgentNetworkProviderProfile } from "./agent-network-policy.js";
import type { McpServerConfig, McpSettingsData } from "./mcp-settings-session.js";
import type {
  AgentRunReadResult,
  AnswerAgentUserInputCommand,
  DecideContextShareApprovalCommand
} from "./agent-run-session.js";
import type {
  AgentUsageQuery,
  AgentUsageReport,
  ClearAgentUsageCommand
} from "./agent-usage-types.js";
import type {
  AgentConversationCommandResult,
  AgentConversationDeleteResult,
  AgentConversationListPage,
  AgentConversationReadResult,
  AgentConversationSearchPage,
  ChangeAgentConversationStatusCommand,
  CreateAgentConversationCommand,
  DeleteAgentConversationCommand,
  ListAgentConversationsQuery,
  ReadAgentConversationQuery,
  SearchAgentConversationsQuery
} from "./agent-conversation-session.js";

export type ReadAgentPermissionSummaryQuery =
  | {
      readonly kind: "draft";
      readonly projectId: string;
      readonly conversationId: string;
      readonly runDraftId: string;
      readonly runDraftRevision: number;
      readonly runDraftChecksum: string;
    }
  | {
      readonly kind: "run";
      readonly projectId: string;
      readonly runId: string;
      readonly permissionSummaryId: string;
    };

export interface ForeshadowAnalysisEvidenceDto {
  readonly chapterId: string;
  readonly excerpt: string;
  readonly excerptHash: string;
}

export interface ForeshadowAnalysisUsageDto {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly usageStatus: "missing" | "estimated" | "actual";
  readonly cost: {
    readonly amount: number;
    readonly currency: string;
    readonly status: "unknown" | "estimated" | "actual";
  };
}

export type WorkspaceContextSourcePreferenceUpdate =
  | {
      readonly refId: string;
      readonly decision: "pinned" | "excluded";
      readonly priority: number;
      readonly ref?: ContextDraftRef;
    }
  | {
      readonly refId: string;
      readonly decision: null;
    };

export type WorkspaceContextPolicyUpdate =
  | "disable_conventions"
  | "revoke_workspace_trust"
  | {
      readonly action: "set_source_preference";
      readonly preference: WorkspaceContextSourcePreferenceUpdate;
    }
  | {
      readonly action: "set_sharing_defaults";
      readonly defaults: WorkspaceModelSharingDefaults | null;
    };

interface ForeshadowAnalysisCandidateDtoBase {
  readonly candidateId: string;
  readonly evidence: ForeshadowAnalysisEvidenceDto;
  readonly reason: string;
  readonly duplicateForeshadowIds: readonly string[];
}

export interface ForeshadowNewCandidateDto extends ForeshadowAnalysisCandidateDtoBase {
  readonly kind: "new";
  readonly suggested: {
    readonly title: string;
    readonly summary: string;
    readonly trackingStatus: "planted";
    readonly plantedChapterId: string;
    readonly plannedPayoffChapterId?: string;
    readonly notes?: string;
    readonly relatedEntityIds?: readonly string[];
  };
}

export interface ForeshadowProgressCandidateDto extends ForeshadowAnalysisCandidateDtoBase {
  readonly kind: "progress";
  readonly targetForeshadowId: string;
  readonly suggested: {
    readonly trackingStatus: "progressing" | "ready-to-payoff";
    readonly summary?: string;
    readonly notes?: string;
  };
}

export interface ForeshadowPayoffCandidateDto extends ForeshadowAnalysisCandidateDtoBase {
  readonly kind: "payoff";
  readonly targetForeshadowId: string;
  readonly suggested: {
    readonly trackingStatus: "paid-off";
    readonly actualPayoffChapterId: string;
    readonly summary?: string;
    readonly notes?: string;
  };
}

export type ForeshadowAnalysisCandidateDto =
  ForeshadowNewCandidateDto | ForeshadowProgressCandidateDto | ForeshadowPayoffCandidateDto;

export interface ForeshadowAnalysisResultDto {
  readonly analysisId: string;
  readonly chapterIds: readonly string[];
  readonly candidates: readonly ForeshadowAnalysisCandidateDto[];
  readonly usage: ForeshadowAnalysisUsageDto;
  readonly createdAt: string;
}

/** Clone-safe notification published after a Story Analysis run completes successfully. */
export interface StoryAnalysisCompletionEvent {
  readonly schemaVersion: "1.0";
  readonly projectId: string;
  readonly chapterId: string;
  readonly workflowRunId: string;
  readonly trigger: "manual" | "chapter_completed";
  readonly workflowStatus: "pending-confirmation" | "applied" | "failed";
  readonly storyBibleChanged: boolean;
}

export interface NovelStudioApi {
  getShellState(): Promise<DesktopShellState>;
  commands: {
    list(): Promise<readonly ApplicationCommand[]>;
    execute(commandId: string): Promise<Result<DesktopShellState, UnifiedError>>;
  };
  project: {
    getActiveWorkspace(): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
    refreshActiveWorkspace(): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
    chooseOpenCreativeDirectory(): Promise<Result<ProjectDirectorySelectionDto, UnifiedError>>;
    chooseCreateParentDirectory(): Promise<Result<ProjectDirectorySelectionDto, UnifiedError>>;
    openCreativeProject(selectionId: string): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
    previewCreativeProject(input: {
      readonly parentSelectionId: string;
      readonly folderName: string;
    }): Promise<Result<ProjectCreationPreviewDto, UnifiedError>>;
    createCreativeProject(
      input: CreateCreativeProjectRequest
    ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
    listChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>>;
    createChapter(
      input: CreateChapterInput
    ): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
    renameChapter(
      input: RenameChapterInput
    ): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
    duplicateChapter(
      input: DuplicateChapterInput
    ): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
    deleteChapter(
      input: DeleteChapterInput
    ): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
    selectChapter(chapterId: string): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
    selectChapterAndLoad(
      chapterId: string
    ): Promise<Result<ProjectChapterSelectionDto, UnifiedError>>;
    previewRecoveryDraft(
      sessionId: string
    ): Promise<Result<ProjectRecoveryDraftPreview, UnifiedError>>;
    applyRecoveryDraft(
      sessionId: string
    ): Promise<Result<ProjectRecoveryApplyResultDto, UnifiedError>>;
    discardRecoveryDraft(
      sessionId: string
    ): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
  };
  workspace: {
    chooseEngineeringDirectory(): Promise<Result<ProjectDirectorySelectionDto, UnifiedError>>;
    chooseTextFile(): Promise<Result<ProjectTextFileSelectionDto, UnifiedError>>;
    openEngineeringWorkspace(
      selectionId: string
    ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
    attachActiveCreativeProjectEngineeringWorkspace(): Promise<
      Result<EngineeringWorkspaceSnapshot, UnifiedError>
    >;
    refreshEngineeringTree(): Promise<Result<EngineeringWorkspaceSnapshot, UnifiedError>>;
    readTextFile(path: string): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>>;
    saveTextFile(input: {
      readonly path: string;
      readonly content: string;
      readonly expectedChecksum: string;
    }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>>;
    onEngineeringMutationSync(
      listener: (request: EngineeringMutationRendererSyncRequestV2) => void
    ): () => void;
    completeEngineeringMutationSync(
      completion: EngineeringMutationRendererSyncCompletionV2
    ): Promise<Result<void, UnifiedError>>;
    createProjectConventions(): Promise<Result<ProjectConventionsCreateResult, UnifiedError>>;
    updateContextPolicy(update: WorkspaceContextPolicyUpdate): Promise<Result<void, UnifiedError>>;
  };
  creativeProjectFiles: {
    refresh(
      identity: CreativeProjectFileSessionIdentity
    ): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>>;
    readTextFile(
      input: CreativeProjectFileSessionIdentity & { readonly path: string }
    ): Promise<Result<CreativeProjectFileDocument, UnifiedError>>;
    saveTextFile(
      input: CreativeProjectFileSessionIdentity & {
        readonly path: string;
        readonly content: string;
        readonly expectedTreeRevision: string;
        readonly expectedNodeRevision: string;
        readonly expectedChecksum: string;
      }
    ): Promise<Result<CreativeProjectFileSaveResult, UnifiedError>>;
    executeLifecycle(
      command: CreativeProjectFileLifecycleCommand
    ): Promise<Result<CreativeProjectFileLifecycleReceipt, UnifiedError>>;
  };
  ai: {
    generateChapterSuggestion(
      request: AiWritingSuggestionRequest
    ): Promise<Result<AiWritingSuggestion, UnifiedError>>;
    startChapterSuggestionStream(
      request: AiWritingSuggestionStreamStartRequest
    ): Promise<Result<AiWritingSuggestionStreamHandle, UnifiedError>>;
    onChapterSuggestionStreamEvent(
      listener: (event: AiWritingSuggestionStreamPushEvent) => void
    ): () => void;
    cancelChapterSuggestionStream(streamId: string): Promise<Result<void, UnifiedError>>;
    /** @deprecated Use the clone-safe push stream methods. */
    streamChapterSuggestion?(
      request: AiWritingSuggestionRequest,
      options?: AiWritingSuggestionStreamOptions
    ): AsyncIterable<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
    generateSelectionPreview(
      request: AiWritingSelectionPreviewRequest
    ): Promise<Result<AiWritingSelectionPreview, UnifiedError>>;
    applySelectionPreview(previewId: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    applyChapterSuggestion(
      suggestionId: string
    ): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    listWorkflowRuns(): Promise<Result<WorkflowRunSummary[], UnifiedError>>;
    readWorkflowRun(workflowRunId: string): Promise<Result<WorkflowRunRecord, UnifiedError>>;
  };
  agentRuns: {
    prepareStart(command: SyncStartDraftCommand): Promise<AgentRunDraftResult>;
    readRunDraft(command: ReadAgentRunDraftCommand): Promise<AgentRunDraftResult>;
    updateRunDraft(command: UpdateAgentRunDraftCommand): Promise<AgentRunDraftResult>;
    updateContextDraft(command: UpdateContextDraftCommand): Promise<AgentRunDraftResult>;
    refreshContextDraft(command: RefreshContextDraftCommand): Promise<AgentRunDraftResult>;
    previewContextBudget(
      command: PreviewContextBudgetCommand
    ): Promise<Result<ContextBudgetSnapshot, UnifiedError>>;
    previewPackedContext(
      command: PreviewContextBudgetCommand
    ): Promise<Result<PackedAgentContextPreview, UnifiedError>>;
    compactContext(
      command: CompactContextCommand
    ): Promise<Result<CompactContextResult, UnifiedError>>;
    prepareSendPreview(command: {
      readonly schemaVersion: "2.0";
      readonly commandId: string;
      readonly startCommand: StartAgentRunCommand;
    }): Promise<Result<AgentSendPreviewDtoV2, UnifiedError>>;
    confirmSendPreview(command: ConfirmAgentSendPreviewCommandV2): Promise<AgentRunCommandResult>;
    readSendLedger(runId: string): Promise<
      Result<
        readonly {
          readonly entryId: string;
          readonly roundNumber: number;
          readonly roundKind: "first_send" | "subsequent_send";
          readonly canonicalPayloadChecksum: string;
          readonly canonicalRoundManifestChecksum: string;
          readonly previewId: string | null;
          readonly sentAt: string;
          readonly additions: readonly {
            readonly additionId: string;
            readonly kind:
              | "assistant"
              | "tool_result"
              | "remote_result"
              | "user_control"
              | "jit_context"
              | "context_refresh"
              | "recovery";
            readonly content: string;
            readonly contentChecksum: string;
          }[];
        }[],
        UnifiedError
      >
    >;
    start(command: StartAgentRunCommand): Promise<AgentRunCommandResult>;
    stop(command: StopAgentRunCommand): Promise<AgentRunCommandResult>;
    answerUserInput(command: AnswerAgentUserInputCommand): Promise<AgentRunCommandResult>;
    resume(command: ResumeAgentRunCommand): Promise<AgentRunCommandResult>;
    retryStep(command: RetryAgentRunStepCommand): Promise<AgentRunCommandResult>;
    retryTarget(command: RetryRunTargetCommand): Promise<AgentRunCommandResult>;
    decidePlan(command: DecideAgentPlanCommand): Promise<AgentRunCommandResult>;
    readPermissionSummary(
      query: ReadAgentPermissionSummaryQuery
    ): Promise<Result<PermissionSummary | undefined, UnifiedError>>;
    decidePlanRevision(command: DecidePlanRevisionCommand): Promise<AgentRunCommandResult>;
    refreshContext(command: RefreshAgentContextCommand): Promise<AgentRunCommandResult>;
    decideChangeSet(command: DecideChangeSetCommand): Promise<AgentRunCommandResult>;
    decideToolApproval(command: DecideToolApprovalCommand): Promise<AgentRunCommandResult>;
    decideContextShareApproval(
      command: DecideContextShareApprovalCommand
    ): Promise<AgentRunCommandResult>;
    undoRun(command: UndoRunCommand): Promise<AgentRunCommandResult>;
    read(runId: string): Promise<Result<AgentRunReadResult, UnifiedError>>;
    list(
      scopeOrProjectId: AgentContextScope | string
    ): Promise<Result<readonly AgentRunSnapshot[], UnifiedError>>;
    onEvent(listener: (event: AgentRunEvent) => void): () => void;
  };
  agentConversations: {
    create(
      command: CreateAgentConversationCommand
    ): Promise<Result<AgentConversationListPage["items"][number], UnifiedError>>;
    list(
      query: ListAgentConversationsQuery
    ): Promise<Result<AgentConversationListPage, UnifiedError>>;
    read(
      query: ReadAgentConversationQuery
    ): Promise<Result<AgentConversationReadResult, UnifiedError>>;
    archive(command: ChangeAgentConversationStatusCommand): Promise<AgentConversationCommandResult>;
    restore(command: ChangeAgentConversationStatusCommand): Promise<AgentConversationCommandResult>;
    delete(command: DeleteAgentConversationCommand): Promise<AgentConversationDeleteResult>;
    search(
      query: SearchAgentConversationsQuery
    ): Promise<Result<AgentConversationSearchPage, UnifiedError>>;
  };
  search: {
    rebuildIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
    query(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
  };
  chapter: {
    load(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    edit(nextBody: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    save(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    saveWithStatus(status: ChapterStatus): Promise<Result<ChapterStatusUpdateResult, UnifiedError>>;
    listVersions(): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
    previewVersion(versionId: string): Promise<Result<ChapterVersionContent, UnifiedError>>;
    restoreVersion(versionId: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    previewSuggestionDiff(
      nextBody: string
    ): Promise<Result<ChapterSuggestionDiffPreview, UnifiedError>>;
  };
  /** Optional while older preload surfaces are still upgraded; absence is fail-closed. */
  writingEditor?: {
    reportState(report: WritingEditorStateReport): Promise<WritingEditorStateReportResult>;
  };
  /** Optional while the engineering editor handshake is being rolled out; absence is fail-closed. */
  engineeringEditor?: {
    reportState(report: EngineeringEditorStateReport): Promise<EngineeringEditorStateReportResult>;
  };
  settings: {
    listModelProfiles(): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
    discoverModelOptions(profileId: string): Promise<Result<ModelDiscoverySnapshot, UnifiedError>>;
    saveModelProfile(
      profile: ModelProfile,
      options?: { readonly makeDefault?: boolean }
    ): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
    saveModelSecret(secretRef: string, secret: string): Promise<Result<void, UnifiedError>>;
    testModelProfileConnection(
      profileId: string
    ): Promise<Result<ModelConnectionResult, UnifiedError>>;
    readStoryAnalysisSettings(): Promise<Result<StoryAnalysisSettings, UnifiedError>>;
    saveStoryAnalysisSettings(
      settings: StoryAnalysisSettings
    ): Promise<Result<StoryAnalysisSettings, UnifiedError>>;
    listAgentUsage(query: AgentUsageQuery): Promise<Result<AgentUsageReport, UnifiedError>>;
    clearAgentUsage(
      command: ClearAgentUsageCommand
    ): Promise<Result<AgentUsageReport, UnifiedError>>;
  };
  plugins: {
    loadRegistry(): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
    setEnabled(
      pluginId: string,
      enabled: boolean
    ): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
  };
  storyBible: {
    load(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
    readAsset(assetId: string): Promise<Result<StoryBibleEditableAsset, UnifiedError>>;
    createAsset(
      input: CreateStoryBibleAssetCommand
    ): Promise<Result<StoryBibleAsset, UnifiedError>>;
    saveAssetCandidate(
      input: SaveStoryBibleAssetCandidateCommand
    ): Promise<Result<StoryBibleAsset, UnifiedError>>;
    prepareExplicitInverseChange?(input: {
      readonly source: StoryBibleExplicitInverseSourceCommand;
    }): Promise<Result<StoryBibleExplicitInversePreview, UnifiedError>>;
    applyExplicitInverseChange?(input: {
      readonly previewId: string;
      readonly revision: number;
      readonly checksum: string;
    }): Promise<Result<StoryBibleExplicitInverseApplyResult, UnifiedError>>;
    cancelExplicitInverseChange?(input: {
      readonly previewId: string;
      readonly revision: number;
      readonly checksum: string;
    }): Promise<Result<StoryBibleExplicitInverseCancelResult, UnifiedError>>;
    saveStatusTransition?(
      input: SaveStoryBibleStatusTransitionCommand
    ): Promise<Result<StoryBibleAsset, UnifiedError>>;
    getReferences?(assetId: string): Promise<Result<StoryBibleReferenceImpact, UnifiedError>>;
    resolveRestoreStatus?(
      assetId: string
    ): Promise<Result<StoryBibleRestorableStatus, UnifiedError>>;
    saveAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
    saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
    buildConsistencyReport(): Promise<Result<StoryBibleConsistencyReport, UnifiedError>>;
    buildContextCandidates(
      options?: StoryBibleContextCandidateOptions
    ): Promise<Result<readonly StoryBibleContextCandidate[], UnifiedError>>;
    detectForeshadows(
      input: ForeshadowAnalysisInput
    ): Promise<Result<ForeshadowAnalysisResultDto, UnifiedError>>;
  };
  storyAnalysis: {
    analyzeChapter(input: {
      readonly chapterId: string;
    }): Promise<Result<StoryAnalysisRecordDto, UnifiedError>>;
    onCompletion(listener: (event: StoryAnalysisCompletionEvent) => void): () => void;
    list(): Promise<Result<readonly StoryAnalysisHistorySummary[], UnifiedError>>;
    read(workflowRunId: string): Promise<Result<StoryAnalysisRecordDto, UnifiedError>>;
    transitionRecord(
      command: StoryAnalysisReviewCommand
    ): Promise<Result<StoryAnalysisRecordDto, UnifiedError>>;
    refreshStaleness(workflowRunId: string): Promise<Result<StoryAnalysisRecordDto, UnifiedError>>;
    prepareApplication(input: {
      readonly workflowRunId: string;
      readonly suggestionIds: readonly string[];
    }): Promise<Result<StoryAnalysisApplicationPreviewDto, UnifiedError>>;
    applyApplication(input: {
      readonly workflowRunId: string;
      readonly suggestionIds: readonly string[];
      readonly changeSetId: string;
      readonly revision: number;
      readonly checksum: string;
    }): Promise<Result<StoryAnalysisApplicationResultDto, UnifiedError>>;
  };
  studio: {
    loadConfigAsset(
      assetType: ConfigAssetType,
      assetId: string
    ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
    saveConfigAsset(
      input: ConfigAssetSaveInput
    ): Promise<Result<ConfigVersionSummary, UnifiedError>>;
    restoreConfigAssetVersion(
      input: ConfigAssetRestoreInput
    ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
  };
  preferences: {
    load(): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
    save(input: UserPreferencesSaveInput): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
  };
  menu: {
    onNativeCommand(listener: (commandId: NativeMenuCommandId) => void): () => void;
  };
  agentNetwork: {
    getSettings(): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
    updateSettings(
      partial: Partial<AgentNetworkSettingsData>
    ): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
    saveProvider(
      profile: Omit<AgentNetworkProviderProfile, "policyRevision">
    ): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
    removeProvider(providerId: string): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
    setDefaultProvider(providerId: string): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
    testConnection(
      profileId: string
    ): Promise<Result<{ readonly latencyMs: number }, UnifiedError>>;
    revoke(): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
  };
  agentMcp: {
    listServers(): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
    addServer(config: McpServerConfig): Promise<Result<McpSettingsData, UnifiedError>>;
    removeServer(serverId: string): Promise<Result<McpSettingsData, UnifiedError>>;
    testConnection(serverId: string): Promise<Result<{ readonly latencyMs: number }, UnifiedError>>;
    revokeServer(serverId: string): Promise<Result<McpSettingsData, UnifiedError>>;
  };
}

/** Renderer-to-Main liveness handshake for managed writing editors. */
export interface WritingEditorStateReport {
  readonly workspaceId: string;
  readonly resourceKind: "chapter" | "story_bible";
  readonly resourceId: string;
  readonly editorInstanceId: string;
  readonly connection: "connected" | "disconnected" | "unknown";
  readonly rendererRevision: number;
  readonly acknowledgedRevision: number;
  readonly dirty: boolean;
  readonly bufferChecksum: string;
  /** Current editor text; Main verifies this against bufferChecksum before retaining it. */
  readonly bufferContent: string;
}

export type WritingEditorStateReportResult =
  | {
      readonly ok: true;
      readonly acknowledgement: WritingEditorStateAcknowledgement;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "EDITOR_STATE_UNAVAILABLE"
          | "EDITOR_STATE_INPUT_INVALID"
          | "EDITOR_STATE_WORKSPACE_MISMATCH"
          | "EDITOR_STATE_UPDATE_INVALID"
          | "EDITOR_STATE_STALE_UPDATE";
        readonly message: string;
      };
    };

export interface WritingEditorStateAcknowledgement {
  readonly workspaceId: string;
  readonly resourceKind: WritingEditorStateReport["resourceKind"];
  readonly resourceId: string;
  readonly editorInstanceId: string;
  /** Renderer revision durably accepted by Main; include it in the next report acknowledgement. */
  readonly rendererRevision: number;
}

/** Renderer-to-Main liveness handshake for an engineering workspace file editor. */
export interface EngineeringEditorStateReport {
  /** Main-issued opaque binding for the currently open native workspace root. */
  readonly rootBindingId: string;
  /** Canonical POSIX workspace-relative identity; absolute paths never cross IPC. */
  readonly relativePath: string;
  readonly editorInstanceId: string;
  readonly connection: "connected" | "disconnected" | "unknown";
  readonly rendererRevision: number;
  readonly acknowledgedRevision: number;
  readonly dirty: boolean;
  readonly bufferChecksum: string;
  /** Retained only after Main validates checksum and only for an explicit dirty-buffer share. */
  readonly bufferContent: string;
}

export type EngineeringEditorStateReportResult =
  | {
      readonly ok: true;
      readonly acknowledgement: EngineeringEditorStateAcknowledgement;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "EDITOR_STATE_UNAVAILABLE"
          | "EDITOR_STATE_INPUT_INVALID"
          | "EDITOR_STATE_ROOT_BINDING_MISMATCH"
          | "EDITOR_STATE_UPDATE_INVALID"
          | "EDITOR_STATE_STALE_UPDATE";
        readonly message: string;
      };
    };

export interface EngineeringEditorStateAcknowledgement {
  readonly rootBindingId: string;
  readonly relativePath: string;
  readonly editorInstanceId: string;
  /** Renderer revision durably accepted by Main; include it in the next report acknowledgement. */
  readonly rendererRevision: number;
}

/** Provider-safe Main-to-Renderer refresh request emitted only after a committed B7 mutation. */
export interface EngineeringMutationRendererSyncRequestV2 {
  readonly schemaVersion: "2.0";
  readonly requestId: string;
  readonly operationKind:
    "replace_file" | "create_file" | "move_file" | "delete_file" | "create_directory";
  readonly relativePaths: readonly string[];
}

export interface EngineeringMutationRendererSyncCompletionV2 {
  readonly schemaVersion: "2.0";
  readonly requestId: string;
  readonly status: "synchronized" | "failed";
}

export interface AiWritingSuggestionStreamOptions {
  readonly signal?: AbortSignal;
}

export interface ProjectDirectorySelectionDto {
  readonly canceled: boolean;
  readonly selectionId?: string;
  readonly displayName?: string;
}

export interface ProjectTextFileSelectionDto {
  readonly canceled: boolean;
  /** POSIX-style path relative to the active workspace root. Absolute paths never cross IPC. */
  readonly relativePath?: string;
  readonly displayName?: string;
}

export interface ProjectConventionsCreateResult {
  readonly relativePath: "AGENTS.md" | "conventions/writing.md";
  readonly status: "created" | "existing";
}

export interface CreateCreativeProjectRequest {
  readonly parentSelectionId: string;
  readonly folderName: string;
  readonly projectId: string;
  readonly title: string;
  readonly language: string;
  readonly projectType?: string;
  readonly targetWordCount?: number;
}
