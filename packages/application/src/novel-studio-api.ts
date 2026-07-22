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
import type {
  AgentRunCommandResult,
  AgentRunEvent,
  AgentRunSnapshot,
  CompactContextCommand,
  ContextBudgetSnapshot,
  DecideChangeSetCommand,
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
import type { CompactContextResult } from "./agent-context-session.js";
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
  ModelSettingsSnapshot
} from "./model-settings-session.js";
import type { PluginSettingsSnapshot } from "./plugin-settings-session.js";
import type { ProjectRecoveryDraftPreview } from "./project-workspace-session.js";
import type {
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults
} from "./project-search-session.js";
import type {
  MemoryRecord,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleSnapshot
} from "./story-bible-session.js";
import type {
  UserPreferencesSaveInput,
  UserPreferencesSnapshot
} from "./user-preferences-session.js";
import type { AgentRunReadResult, AnswerAgentUserInputCommand } from "./agent-run-session.js";
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

export interface NovelStudioApi {
  getShellState(): Promise<DesktopShellState>;
  commands: {
    list(): Promise<readonly ApplicationCommand[]>;
    execute(commandId: string): Promise<Result<DesktopShellState, UnifiedError>>;
  };
  project: {
    getActiveWorkspace(): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
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
    compactContext(
      command: CompactContextCommand
    ): Promise<Result<CompactContextResult, UnifiedError>>;
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
    undoRun(command: UndoRunCommand): Promise<AgentRunCommandResult>;
    read(runId: string): Promise<Result<AgentRunReadResult, UnifiedError>>;
    list(projectId: string): Promise<Result<readonly AgentRunSnapshot[], UnifiedError>>;
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
    listVersions(): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
    previewVersion(versionId: string): Promise<Result<ChapterVersionContent, UnifiedError>>;
    restoreVersion(versionId: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    previewSuggestionDiff(
      nextBody: string
    ): Promise<Result<ChapterSuggestionDiffPreview, UnifiedError>>;
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
    saveAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
    saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
    buildConsistencyReport(): Promise<Result<StoryBibleConsistencyReport, UnifiedError>>;
    buildContextCandidates(
      options?: StoryBibleContextCandidateOptions
    ): Promise<Result<readonly StoryBibleContextCandidate[], UnifiedError>>;
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
}

export interface AiWritingSuggestionStreamOptions {
  readonly signal?: AbortSignal;
}

export interface ProjectDirectorySelectionDto {
  readonly canceled: boolean;
  readonly selectionId?: string;
  readonly displayName?: string;
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
