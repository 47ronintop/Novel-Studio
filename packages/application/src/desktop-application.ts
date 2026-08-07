import {
  DEFAULT_USER_SHELL_PREFERENCES,
  EMPTY_WORKSPACE_CONTEXT,
  createUnifiedError,
  err,
  ok,
  resolveWorkbenchModeForContext
} from "@novel-studio/shared";
import type {
  ChapterSummary,
  ChapterStatus,
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  ChapterVersionContent,
  ChapterVersionSummary,
  RenameChapterInput,
  Result,
  UnifiedError,
  WorkspaceContextDto,
  WorkbenchMode,
  CreativeNavigatorMode
} from "@novel-studio/shared";

import {
  DEFAULT_APPLICATION_COMMANDS,
  findApplicationCommand,
  isSafeCommand
} from "./command-registry.js";
import type { ApplicationCommand, ApplicationCommandId } from "./command-registry.js";
import type {
  ChapterEditorSession,
  ChapterEditorSnapshot,
  ChapterEditorState,
  ChapterSuggestionDiffPreview
} from "./chapter-editor-session.js";
import type {
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetSnapshot,
  ConfigAssetType,
  ConfigStudioSession,
  ConfigVersionSummary
} from "./config-studio-session.js";
import type {
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSession,
  ModelSettingsSnapshot,
  StoryAnalysisSettings
} from "./model-settings-session.js";
import { DEFAULT_STORY_ANALYSIS_SETTINGS } from "./model-settings-session.js";
import type { ModelDiscoverySnapshot } from "./model-discovery-session.js";
import type { AgentUsageSession } from "./agent-usage-session.js";
import type {
  AgentUsageQuery,
  AgentUsageReport,
  ClearAgentUsageCommand
} from "./agent-usage-types.js";
import { pluginRegistryUnavailable } from "./plugin-settings-session.js";
import type { PluginSettingsSession, PluginSettingsSnapshot } from "./plugin-settings-session.js";
import type { PluginRuntimeSession } from "./plugin-runtime-session.js";
import type {
  AiWritingSuggestion,
  AiWritingSelectionPreview,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamEvent,
  AiWritingSuggestionStreamRequest,
  AiWritingWorkflowSession,
  WorkflowRunHistoryPort,
  WorkflowRunRecord,
  WorkflowRunSummary
} from "./ai-writing-workflow-session.js";
import type {
  CreateCreativeProjectInput,
  ProjectCreationPreview,
  ProjectCreationRepositoryPort,
  ProjectRecoveryApplyResult,
  ProjectRecoveryDraftPreview,
  ProjectWorkspaceHealth,
  ProjectWorkspaceRecoverySummary,
  ProjectWorkspaceSession,
  ProjectWorkspaceSnapshot,
  ProjectMetadata,
  WorkspaceProjectSettings
} from "./project-workspace-session.js";
import type {
  EngineeringTextFileSaveResult,
  EngineeringTextFileSnapshot,
  EngineeringWorkspaceSession,
  EngineeringWorkspaceSnapshot
} from "./engineering-workspace-session.js";
import type { WorkspaceActivationContext } from "./workspace-activation-context.js";
import { toWorkspaceContextDto } from "./workspace-activation-context.js";
import type {
  ProjectSearchIndex,
  ProjectSearchInvalidationReason,
  ProjectSearchQuery,
  ProjectSearchResults,
  ProjectSearchSession,
  ProjectSearchSourcesChangedInput
} from "./project-search-session.js";
import type {
  CreateStoryBibleAssetCommand,
  MemoryRecord,
  SaveStoryBibleAssetCandidateCommand,
  SaveStoryBibleStatusTransitionCommand,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidateOptions,
  StoryBibleEditableAsset,
  StoryBibleReferenceImpact,
  StoryBibleRestorableStatus,
  StoryBibleSession,
  StoryBibleSnapshot
} from "./story-bible-session.js";
import type {
  ForeshadowAnalysisInput,
  ForeshadowAnalysisResult,
  ForeshadowAnalysisSession
} from "./foreshadow-analysis-session.js";
import type {
  AnalyzeChapterStoryInput,
  StoryAnalysisHistoryRecord,
  StoryAnalysisHistorySummary,
  StoryAnalysisRecordTransition,
  StoryAnalysisSession
} from "./story-analysis-session.js";
import type {
  StoryAnalysisApplicationPreview,
  StoryAnalysisApplicationResult,
  StoryAnalysisApplicationSession
} from "./story-analysis-application-session.js";
import type { VersionGroupApplyBatchResult } from "./version-group-session.js";
import type {
  StoryBibleExplicitInverseApplyResult,
  StoryBibleExplicitInverseCancelResult,
  StoryBibleExplicitInversePreview,
  StoryBibleExplicitInverseSession,
  StoryBibleExplicitInverseSourceCommand
} from "./story-bible-explicit-inverse-session.js";
import type {
  UserPreferencesSaveInput,
  UserPreferencesSession,
  UserPreferencesSnapshot
} from "./user-preferences-session.js";
import type { ContextCandidate } from "@novel-studio/context-engine";
import type { StoryAnalysisCompletionEvent } from "./novel-studio-api.js";

export type ActivityId = "workspace" | "search" | "storyBible" | "timeline" | "studio" | "settings";

export type SaveStatus = "Saved" | "Saving" | "Unsaved" | "Recovery available";

export interface NavigatorSection {
  readonly id: string;
  readonly title: string;
  readonly itemCount: number;
}

export interface WorkspaceLayoutState {
  readonly splitView: boolean;
  readonly navigatorWidth: number;
  readonly inspectorWidth: number;
  readonly bottomPanelHeight: number;
}

export interface ProjectWorkspaceSnapshotDto {
  readonly project: ProjectMetadata;
  readonly settings: WorkspaceProjectSettings;
  readonly chapters: readonly ChapterSummary[];
  readonly recovery: ProjectWorkspaceRecoverySummary;
  readonly health: ProjectWorkspaceHealth;
  readonly lock?: {
    readonly schemaVersion: "1.0";
    readonly ownerId: string;
    readonly acquiredAt: string;
  };
  readonly activeChapterId?: string;
}

export interface ProjectRecoveryApplyResultDto {
  readonly workspace: ProjectWorkspaceSnapshotDto;
  readonly chapterEditor: ChapterEditorSnapshot;
}

export interface ProjectChapterSelectionDto {
  readonly workspace: ProjectWorkspaceSnapshotDto;
  readonly chapterEditor: ChapterEditorSnapshot;
}

export type ChapterCompletionAnalysisDisposition =
  | { readonly status: "not-triggered" }
  | { readonly status: "disabled"; readonly mode: "off" }
  | { readonly status: "prompt"; readonly mode: "prompt"; readonly chapterId: string }
  | {
      readonly status: "scheduled";
      readonly mode: "background-review";
      readonly chapterId: string;
    }
  | { readonly status: "unavailable"; readonly code: string };

export interface ChapterStatusUpdateResult {
  readonly chapter: ChapterEditorSnapshot;
  readonly completionAnalysis: ChapterCompletionAnalysisDisposition;
}

export interface ProjectCreationPreviewDto {
  readonly folderName: string;
  readonly parentDisplayName: string;
  readonly targetDisplayName: string;
}

export type PreparedWorkspaceActivation =
  | {
      readonly activationId: string;
      readonly context: Extract<WorkspaceActivationContext, { readonly kind: "creativeProject" }>;
      readonly creativeProject: ProjectWorkspaceSnapshot;
    }
  | {
      readonly activationId: string;
      readonly context: Extract<
        WorkspaceActivationContext,
        { readonly kind: "engineeringWorkspace" }
      >;
      readonly engineeringWorkspace: EngineeringWorkspaceSnapshot;
    };

export type WorkspaceActivationDto =
  | {
      readonly context: Extract<WorkspaceContextDto, { readonly kind: "creativeProject" }>;
      readonly creativeProject: ProjectWorkspaceSnapshotDto;
    }
  | {
      readonly context: Extract<WorkspaceContextDto, { readonly kind: "engineeringWorkspace" }>;
      readonly engineeringWorkspace: EngineeringWorkspaceSnapshot;
    };

export interface DesktopShellState {
  readonly projectTitle: string;
  readonly activeActivity: ActivityId;
  readonly workspaceContext: WorkspaceContextDto;
  readonly workbenchMode: WorkbenchMode;
  readonly creativeNavigatorMode: CreativeNavigatorMode;
  readonly creativeFileExpandedPathIds: readonly string[];
  readonly engineeringExpandedPathIds: readonly string[];
  readonly navigatorCollapsed: boolean;
  readonly navigatorExpandedSectionIds?: readonly string[];
  readonly inspectorCollapsed: boolean;
  readonly bottomPanelVisible: boolean;
  readonly activeBottomPanelTab: string;
  readonly focusMode: boolean;
  readonly workspaceLayout: WorkspaceLayoutState;
  readonly commandPaletteOpen: boolean;
  readonly saveStatus: SaveStatus;
  readonly navigatorSections: readonly NavigatorSection[];
  readonly bottomPanelTabs: readonly string[];
}

export interface DesktopApplication {
  shutdown(): Promise<Result<void, UnifiedError>>;
  canCloseWorkspace(): Result<void, UnifiedError>;
  closeWorkspace(): Promise<Result<DesktopShellState, UnifiedError>>;
  getShellState(): DesktopShellState;
  getActiveProjectWorkspace(): Result<ProjectWorkspaceSnapshot, UnifiedError>;
  refreshActiveProjectWorkspace(): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  listCommands(): readonly ApplicationCommand[];
  executeCommand(commandId: string): Result<DesktopShellState, UnifiedError>;
  prepareOpenCreativeProject(
    projectRoot: string
  ): Promise<Result<PreparedWorkspaceActivation, UnifiedError>>;
  prepareCreateCreativeProject(
    input: CreateCreativeProjectInput
  ): Promise<Result<PreparedWorkspaceActivation, UnifiedError>>;
  prepareOpenEngineeringWorkspace(
    contentRoot: string
  ): Promise<Result<PreparedWorkspaceActivation, UnifiedError>>;
  commitWorkspaceActivation(activationId: string): WorkspaceActivationDto;
  discardWorkspaceActivation(activationId: string): Promise<Result<void, UnifiedError>>;
  finalizeWorkspaceActivation(activationId: string): Promise<Result<void, UnifiedError>>;
  previewCreativeProject(input: {
    readonly parentDirectory: string;
    readonly folderName: string;
  }): Promise<Result<ProjectCreationPreviewDto, UnifiedError>>;
  openProject(projectRoot: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  createProjectInParent(
    input: CreateCreativeProjectInput
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  listProjectChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>>;
  createProjectChapter(
    input: CreateChapterInput
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  renameProjectChapter(
    input: RenameChapterInput
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  duplicateProjectChapter(
    input: DuplicateChapterInput
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  deleteProjectChapter(
    input: DeleteChapterInput
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  selectProjectChapter(chapterId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  selectProjectChapterAndLoad(
    chapterId: string
  ): Promise<Result<ProjectChapterSelectionDto, UnifiedError>>;
  previewRecoveryDraft(
    sessionId: string
  ): Promise<Result<ProjectRecoveryDraftPreview, UnifiedError>>;
  applyRecoveryDraft(sessionId: string): Promise<Result<ProjectRecoveryApplyResult, UnifiedError>>;
  discardRecoveryDraft(sessionId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  refreshEngineeringTree(): Promise<Result<EngineeringWorkspaceSnapshot, UnifiedError>>;
  attachActiveCreativeProjectEngineeringWorkspace(): Promise<
    Result<EngineeringWorkspaceSnapshot, UnifiedError>
  >;
  readEngineeringTextFile(path: string): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>>;
  saveEngineeringTextFile(input: {
    readonly path: string;
    readonly content: string;
    readonly expectedChecksum: string;
  }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>>;
  rebuildProjectSearchIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
  searchProject(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
  notifyProjectSearchSourcesChanged(input: ProjectSearchSourcesChangedInput): Promise<void>;
  loadStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
  saveStoryBibleAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
  readStoryBibleAssetForEditing(
    assetId: string
  ): Promise<Result<StoryBibleEditableAsset, UnifiedError>>;
  createStoryBibleAsset(
    input: CreateStoryBibleAssetCommand
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveStoryBibleAssetCandidate(
    input: SaveStoryBibleAssetCandidateCommand
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  prepareStoryBibleExplicitInverseChange(input: {
    readonly source: StoryBibleExplicitInverseSourceCommand;
  }): Promise<Result<StoryBibleExplicitInversePreview, UnifiedError>>;
  applyStoryBibleExplicitInverseChange(input: {
    readonly previewId: string;
    readonly revision: number;
    readonly checksum: string;
  }): Promise<Result<StoryBibleExplicitInverseApplyResult, UnifiedError>>;
  cancelStoryBibleExplicitInverseChange(input: {
    readonly previewId: string;
    readonly revision: number;
    readonly checksum: string;
  }): Promise<Result<StoryBibleExplicitInverseCancelResult, UnifiedError>>;
  saveStoryBibleStatusTransition(
    input: SaveStoryBibleStatusTransitionCommand
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  getStoryBibleReferences(
    assetId: string
  ): Promise<Result<StoryBibleReferenceImpact, UnifiedError>>;
  resolveStoryBibleRestoreStatus(
    assetId: string
  ): Promise<Result<StoryBibleRestorableStatus, UnifiedError>>;
  saveStoryBibleMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
  buildStoryBibleConsistencyReport(): Promise<Result<StoryBibleConsistencyReport, UnifiedError>>;
  buildStoryBibleContextCandidates(
    options?: StoryBibleContextCandidateOptions
  ): Promise<Result<readonly ContextCandidate[], UnifiedError>>;
  detectForeshadows(
    input: ForeshadowAnalysisInput
  ): Promise<Result<ForeshadowAnalysisResult, UnifiedError>>;
  analyzeChapterStory(
    input: AnalyzeChapterStoryInput
  ): Promise<Result<StoryAnalysisHistoryRecord, UnifiedError>>;
  subscribeStoryAnalysisCompletion(
    listener: (event: StoryAnalysisCompletionEvent) => void
  ): () => void;
  listStoryAnalyses(): Promise<Result<readonly StoryAnalysisHistorySummary[], UnifiedError>>;
  readStoryAnalysis(
    workflowRunId: string
  ): Promise<Result<StoryAnalysisHistoryRecord, UnifiedError>>;
  transitionStoryAnalysisRecord(input: {
    readonly workflowRunId: string;
    readonly recordId: string;
    readonly expectedRevision: number;
    readonly transition: StoryAnalysisRecordTransition;
  }): Promise<Result<StoryAnalysisHistoryRecord, UnifiedError>>;
  refreshStoryAnalysisStaleness(
    workflowRunId: string
  ): Promise<Result<StoryAnalysisHistoryRecord, UnifiedError>>;
  prepareStoryAnalysisApplication(input: {
    readonly workflowRunId: string;
    readonly suggestionIds: readonly string[];
  }): Promise<Result<StoryAnalysisApplicationPreview, UnifiedError>>;
  applyStoryAnalysisApplication(input: {
    readonly workflowRunId: string;
    readonly suggestionIds: readonly string[];
    readonly changeSetId: string;
    readonly revision: number;
    readonly checksum: string;
  }): Promise<Result<StoryAnalysisApplicationResult, UnifiedError>>;
  generateActiveChapterSuggestion(
    request: AiWritingSuggestionRequest
  ): Promise<Result<AiWritingSuggestion, UnifiedError>>;
  streamActiveChapterSuggestion(
    request: AiWritingSuggestionStreamRequest
  ): AsyncIterable<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
  generateActiveSelectionPreview(
    request: AiWritingSelectionPreviewRequest
  ): Promise<Result<AiWritingSelectionPreview, UnifiedError>>;
  applyActiveSelectionPreview(
    previewId: string
  ): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  applyActiveChapterSuggestion(
    suggestionId: string
  ): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  listWorkflowRuns(): Promise<Result<WorkflowRunSummary[], UnifiedError>>;
  readWorkflowRun(workflowRunId: string): Promise<Result<WorkflowRunRecord, UnifiedError>>;
  loadActiveChapter(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  readActiveChapterState(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  editActiveChapter(nextBody: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  saveActiveChapter(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  saveActiveChapterStatus(
    status: ChapterStatus
  ): Promise<Result<ChapterStatusUpdateResult, UnifiedError>>;
  listActiveChapterVersions(): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
  previewActiveChapterVersion(
    versionId: string
  ): Promise<Result<ChapterVersionContent, UnifiedError>>;
  restoreActiveChapterVersion(
    versionId: string
  ): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  previewActiveChapterSuggestionDiff(
    nextBody: string
  ): Result<ChapterSuggestionDiffPreview, UnifiedError>;
  listModelProfiles(): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  discoverModelOptions(profileId: string): Promise<Result<ModelDiscoverySnapshot, UnifiedError>>;
  saveModelProfile(
    profile: ModelProfile,
    options?: { readonly makeDefault?: boolean }
  ): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  testModelProfileConnection(
    profileId: string
  ): Promise<Result<ModelConnectionResult, UnifiedError>>;
  readStoryAnalysisSettings(): Promise<Result<StoryAnalysisSettings, UnifiedError>>;
  saveStoryAnalysisSettings(
    settings: StoryAnalysisSettings
  ): Promise<Result<StoryAnalysisSettings, UnifiedError>>;
  listAgentUsage(query: AgentUsageQuery): Promise<Result<AgentUsageReport, UnifiedError>>;
  clearAgentUsage(command: ClearAgentUsageCommand): Promise<Result<AgentUsageReport, UnifiedError>>;
  loadPluginRegistry(): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
  setPluginEnabled(
    pluginId: string,
    enabled: boolean
  ): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
  loadConfigAsset(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
  saveConfigAsset(input: ConfigAssetSaveInput): Promise<Result<ConfigVersionSummary, UnifiedError>>;
  restoreConfigAssetVersion(
    input: ConfigAssetRestoreInput
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
  loadUserPreferences(): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
  saveUserPreferences(
    input: UserPreferencesSaveInput
  ): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
}

export interface DesktopApplicationOptions {
  readonly chapterEditorSession?: ChapterEditorSession;
  readonly projectWorkspaceSession?: ProjectWorkspaceSession;
  readonly createProjectWorkspaceSession?: () => ProjectWorkspaceSession;
  readonly projectCreationRepository?: ProjectCreationRepositoryPort;
  readonly engineeringWorkspaceSession?: EngineeringWorkspaceSession;
  readonly createEngineeringWorkspaceSession?: () => EngineeringWorkspaceSession;
  readonly createWorkspaceActivationId?: () => string;
  readonly onActiveProjectRootChange?: (projectRoot: string | undefined) => void;
  readonly modelSettingsSession?: ModelSettingsSession;
  readonly agentUsageSession?: AgentUsageSession;
  readonly pluginSettingsSession?: PluginSettingsSession;
  readonly pluginRuntimeSession?: PluginRuntimeSession;
  readonly configStudioSession?: ConfigStudioSession;
  readonly userPreferencesSession?: UserPreferencesSession;
  readonly storyBibleSession?: StoryBibleSession;
  readonly createForeshadowAnalysisSession?: (projectRoot: string) => ForeshadowAnalysisSession;
  readonly createStoryAnalysisSession?: (projectRoot: string) => StoryAnalysisSession;
  readonly createStoryAnalysisApplicationSession?: (
    projectRoot: string
  ) => StoryAnalysisApplicationSession;
  readonly createStoryBibleExplicitInverseSession?: (
    projectRoot: string
  ) => StoryBibleExplicitInverseSession;
  readonly createProjectSearchSession?: (projectRoot: string) => ProjectSearchSession;
  readonly aiWritingWorkflowSession?: AiWritingWorkflowSession;
  readonly workflowRunHistory?: WorkflowRunHistoryPort;
  readonly createAiWritingWorkflowSession?: (
    chapterEditorSession: ChapterEditorSession
  ) => AiWritingWorkflowSession;
  readonly projectTitle?: string;
  readonly navigatorSections?: readonly NavigatorSection[];
}

interface PreparedWorkspaceActivationRecord {
  readonly activation: PreparedWorkspaceActivation;
  projectSession?: ProjectWorkspaceSession | undefined;
  engineeringSession?: EngineeringWorkspaceSession | undefined;
  createdProjectRoot?: string | undefined;
  previousProjectSession?: ProjectWorkspaceSession | undefined;
  previousEngineeringSession?: EngineeringWorkspaceSession | undefined;
  state: "prepared" | "committed";
}

interface ActiveProjectSearchBinding {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly session: ProjectSearchSession;
}

interface StoryAnalysisExecutionBinding {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly searchBinding?: ActiveProjectSearchBinding;
}

const DEFAULT_SHELL_STATE: DesktopShellState = {
  projectTitle: "未打开项目",
  activeActivity: "workspace",
  workspaceContext: EMPTY_WORKSPACE_CONTEXT,
  ...DEFAULT_USER_SHELL_PREFERENCES,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [
    { id: "chapters", title: "章节", itemCount: 0 },
    { id: "characters", title: "人物", itemCount: 0 },
    { id: "world", title: "世界观", itemCount: 0 },
    { id: "outline", title: "大纲", itemCount: 0 },
    { id: "timeline", title: "时间线", itemCount: 0 },
    { id: "memories", title: "记忆", itemCount: 0 },
    { id: "prompts", title: "提示词", itemCount: 0 },
    { id: "agents", title: "Agent", itemCount: 0 },
    { id: "workflows", title: "工作流", itemCount: 0 }
  ],
  bottomPanelTabs: ["工作流运行", "问题", "搜索", "日志"]
};

export function createDesktopApplication(
  options: DesktopApplicationOptions = {}
): DesktopApplication {
  const chapterEditorSession = options.chapterEditorSession;
  let activeProjectWorkspaceSession = options.projectWorkspaceSession;
  let activeEngineeringWorkspaceSession = options.engineeringWorkspaceSession;
  let attachedCreativeEngineeringWorkspaceSession: EngineeringWorkspaceSession | undefined;
  const activationRecords = new Map<string, PreparedWorkspaceActivationRecord>();
  const projectCreationRepository = options.projectCreationRepository;
  let activationSequence = 0;
  const modelSettingsSession = options.modelSettingsSession;
  const agentUsageSession = options.agentUsageSession;
  const pluginSettingsSession = options.pluginSettingsSession;
  const pluginRuntimeSession = options.pluginRuntimeSession;
  const configStudioSession = options.configStudioSession;
  const userPreferencesSession = options.userPreferencesSession;
  const storyBibleSession = options.storyBibleSession;
  const createForeshadowAnalysisSession = options.createForeshadowAnalysisSession;
  const createStoryAnalysisSession = options.createStoryAnalysisSession;
  const createStoryAnalysisApplicationSession = options.createStoryAnalysisApplicationSession;
  const createStoryBibleExplicitInverseSession = options.createStoryBibleExplicitInverseSession;
  let activeStoryBibleExplicitInverseBinding:
    | { readonly projectRoot: string; readonly session: StoryBibleExplicitInverseSession }
    | undefined;
  const createProjectSearchSession = options.createProjectSearchSession;
  const initialProjectSnapshot = activeProjectWorkspaceSession?.getSnapshot();
  let activeProjectSearchBinding: ActiveProjectSearchBinding | undefined =
    initialProjectSnapshot === undefined || createProjectSearchSession === undefined
      ? undefined
      : {
          projectId: initialProjectSnapshot.project.projectId,
          projectRoot: initialProjectSnapshot.projectRoot,
          session: createProjectSearchSession(initialProjectSnapshot.projectRoot)
        };
  let projectScopeGeneration = 0;
  const aiWritingWorkflowSession = options.aiWritingWorkflowSession;
  const createAiWritingWorkflowSession = options.createAiWritingWorkflowSession;
  let dynamicAiWritingWorkflowSession: AiWritingWorkflowSession | undefined;
  let dynamicAiChapterEditorSession: ChapterEditorSession | undefined;
  const storyAnalysisCompletionListeners = new Set<(event: StoryAnalysisCompletionEvent) => void>();
  let shellState = createInitialShellState(options);

  const refreshProjectSearchBinding = (projectRoot: string | undefined): void => {
    const snapshot = activeProjectWorkspaceSession?.getSnapshot();
    if (
      projectRoot === undefined ||
      snapshot === undefined ||
      createProjectSearchSession === undefined
    ) {
      activeProjectSearchBinding = undefined;
      return;
    }
    if (
      activeProjectSearchBinding?.projectRoot === projectRoot &&
      activeProjectSearchBinding.projectId === snapshot.project.projectId
    ) {
      return;
    }
    activeProjectSearchBinding = {
      projectId: snapshot.project.projectId,
      projectRoot,
      session: createProjectSearchSession(projectRoot)
    };
  };

  const refreshProjectScopedBindings = (projectRoot: string | undefined): void => {
    projectScopeGeneration += 1;
    activeStoryBibleExplicitInverseBinding?.session.clearPreviews();
    activeStoryBibleExplicitInverseBinding = undefined;
    refreshProjectSearchBinding(projectRoot);
    try {
      options.onActiveProjectRootChange?.(projectRoot);
    } catch {
      // The project transition already succeeded; binding hooks are best-effort only.
    }
    try {
      storyBibleSession?.clearSnapshot?.();
    } catch {
      // The project transition already succeeded; cache invalidation is best-effort only.
    }
  };

  return {
    subscribeStoryAnalysisCompletion(listener) {
      storyAnalysisCompletionListeners.add(listener);
      return () => storyAnalysisCompletionListeners.delete(listener);
    },
    async shutdown() {
      let firstError: UnifiedError | undefined;
      for (const [activationId, record] of [...activationRecords]) {
        const cleaned =
          record.state === "prepared"
            ? await discardPreparedActivation(activationId)
            : await finalizeCommittedActivation(activationId);
        if (!cleaned.ok && firstError === undefined) firstError = cleaned.error;
      }
      const releasedProject = await activeProjectWorkspaceSession?.releaseProjectLock();
      if (releasedProject !== undefined && !releasedProject.ok && firstError === undefined) {
        firstError = releasedProject.error;
      }
      const releasedEngineering = await activeEngineeringWorkspaceSession?.releaseWorkspaceLock();
      if (
        releasedEngineering !== undefined &&
        !releasedEngineering.ok &&
        firstError === undefined
      ) {
        firstError = releasedEngineering.error;
      }
      const releasedAttached =
        await attachedCreativeEngineeringWorkspaceSession?.releaseWorkspaceLock();
      if (releasedAttached !== undefined && !releasedAttached.ok && firstError === undefined) {
        firstError = releasedAttached.error;
      }
      activeProjectSearchBinding = undefined;
      return firstError === undefined ? ok(undefined) : err(firstError);
    },
    canCloseWorkspace() {
      if (shellState.workspaceContext.kind === "none") return ok(undefined);
      if (getActiveChapterEditorSession()?.getState()?.dirty === true) {
        return err(workspaceCloseError("WORKSPACE_CLOSE_DIRTY", "Save or discard changes first."));
      }
      return ok(undefined);
    },
    async closeWorkspace() {
      const allowed = this.canCloseWorkspace();
      if (!allowed.ok) return allowed;
      if (shellState.workspaceContext.kind === "none") return ok(shellState);

      const releasedProject = await activeProjectWorkspaceSession?.releaseProjectLock();
      if (releasedProject !== undefined && !releasedProject.ok) return releasedProject;
      const releasedEngineering = await activeEngineeringWorkspaceSession?.releaseWorkspaceLock();
      if (releasedEngineering !== undefined && !releasedEngineering.ok) return releasedEngineering;
      const releasedAttached =
        await attachedCreativeEngineeringWorkspaceSession?.releaseWorkspaceLock();
      if (releasedAttached !== undefined && !releasedAttached.ok) return releasedAttached;

      activeProjectWorkspaceSession = undefined;
      activeEngineeringWorkspaceSession = undefined;
      attachedCreativeEngineeringWorkspaceSession = undefined;
      dynamicAiWritingWorkflowSession = undefined;
      dynamicAiChapterEditorSession = undefined;
      shellState = {
        ...shellState,
        projectTitle: "未打开项目",
        workspaceContext: EMPTY_WORKSPACE_CONTEXT,
        saveStatus: "Saved"
      };
      refreshProjectScopedBindings(undefined);
      return ok(shellState);
    },
    getShellState: () =>
      withChapterSaveStatus(
        withProjectWorkspaceState(
          shellState,
          activeProjectWorkspaceSession?.getSnapshot(),
          storyBibleSession?.getSnapshot()
        ),
        getActiveChapterEditorSession()?.getState()
      ),
    getActiveProjectWorkspace() {
      const snapshot = activeProjectWorkspaceSession?.getSnapshot();
      return snapshot === undefined ? projectWorkspaceUnavailable() : ok(snapshot);
    },
    async refreshActiveProjectWorkspace() {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }
      return activeProjectWorkspaceSession.refreshFromRepository();
    },
    listCommands: () => [
      ...DEFAULT_APPLICATION_COMMANDS,
      ...(pluginRuntimeSession?.listCommands() ?? [])
    ],
    executeCommand: (commandId: string) => {
      const command = findApplicationCommand(commandId);

      if (command !== undefined && isSafeCommand(command)) {
        shellState = reduceShellState(shellState, command.id);

        return ok(shellState);
      }

      if (pluginRuntimeSession?.canExecuteCommand(commandId) === true) {
        const result = pluginRuntimeSession.executeCommand({
          commandId,
          traceId: "application-plugin-command"
        });
        if (!result.ok) {
          return result;
        }

        return ok(shellState);
      }

      return err(
        createUnifiedError({
          code: "APPLICATION_COMMAND_NOT_ALLOWED",
          category: "UserError",
          message: "The requested command is not available in the desktop shell.",
          recoverability: "user-action",
          suggestedAction: "Choose an available command from the command palette.",
          traceId: "application-command-bridge"
        })
      );
    },
    async prepareOpenCreativeProject(projectRoot) {
      const session = createProjectCandidateSession();
      if (session === undefined) return projectWorkspaceUnavailable();
      const opened = await session.openProject(projectRoot);
      if (!opened.ok) return opened;
      return storeCreativeActivation(session, opened.value);
    },
    async prepareCreateCreativeProject(input) {
      const session = createProjectCandidateSession();
      if (session === undefined) return projectWorkspaceUnavailable();
      const created = await session.createProjectInParent(input);
      if (!created.ok) return created;
      return storeCreativeActivation(session, created.value, created.value.projectRoot);
    },
    async prepareOpenEngineeringWorkspace(contentRoot) {
      const session = createEngineeringCandidateSession();
      if (session === undefined) return engineeringWorkspaceUnavailable();
      const opened = await session.openEngineeringWorkspace(contentRoot);
      if (!opened.ok) return opened;
      const activationId = createActivationId();
      const activation: PreparedWorkspaceActivation = {
        activationId,
        context: opened.value.context,
        engineeringWorkspace: opened.value.snapshot
      };
      activationRecords.set(activationId, {
        activation,
        engineeringSession: session,
        state: "prepared"
      });
      return ok(activation);
    },
    commitWorkspaceActivation(activationId) {
      const record = activationRecords.get(activationId);
      if (record === undefined || record.state !== "prepared") {
        throw new Error(`Unknown workspace activation: ${activationId}`);
      }
      record.state = "committed";
      record.previousProjectSession = activeProjectWorkspaceSession;
      record.previousEngineeringSession = activeEngineeringWorkspaceSession;
      if ("creativeProject" in record.activation) {
        activeProjectWorkspaceSession = record.projectSession;
        activeEngineeringWorkspaceSession = undefined;
      } else {
        activeProjectWorkspaceSession = undefined;
        activeEngineeringWorkspaceSession = record.engineeringSession;
      }
      attachedCreativeEngineeringWorkspaceSession = undefined;
      const dto = toWorkspaceActivationDto(record.activation);
      shellState = {
        ...shellState,
        workspaceContext: dto.context,
        workbenchMode: resolveWorkbenchModeForContext(shellState.workbenchMode, dto.context),
        projectTitle:
          "creativeProject" in record.activation
            ? record.activation.creativeProject.project.title
            : record.activation.engineeringWorkspace.displayName
      };
      refreshProjectScopedBindings(activeProjectWorkspaceSession?.getSnapshot()?.projectRoot);
      return dto;
    },
    async discardWorkspaceActivation(activationId) {
      return discardPreparedActivation(activationId);
    },
    async finalizeWorkspaceActivation(activationId) {
      return finalizeCommittedActivation(activationId);
    },
    async previewCreativeProject(input) {
      if (projectCreationRepository === undefined) return projectWorkspaceUnavailable();
      const preview = await projectCreationRepository.previewProjectInParent(input);
      return preview.ok ? ok(toProjectCreationPreviewDto(preview.value)) : preview;
    },
    async openProject(projectRoot) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      const opened = await activeProjectWorkspaceSession.openProject(projectRoot);
      if (opened.ok) {
        refreshProjectScopedBindings(opened.value.projectRoot);
      }
      return opened;
    },
    async createProjectInParent(input) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      const created = await activeProjectWorkspaceSession.createProjectInParent(input);
      if (created.ok) {
        refreshProjectScopedBindings(created.value.projectRoot);
      }
      return created;
    },
    async listProjectChapters() {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.listChapters();
    },
    async createProjectChapter(input) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.createChapter(input);
    },
    async renameProjectChapter(input) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.renameChapter(input);
    },
    async duplicateProjectChapter(input) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.duplicateChapter(input);
    },
    async deleteProjectChapter(input) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.deleteChapter(input);
    },
    async selectProjectChapter(chapterId) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.selectChapter(chapterId);
    },
    async selectProjectChapterAndLoad(chapterId) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      const selected = await activeProjectWorkspaceSession.selectChapterAndLoad(chapterId);
      return selected.ok
        ? ok({
            workspace: toProjectWorkspaceSnapshotDto(selected.value.workspace),
            chapterEditor: selected.value.chapterEditor
          })
        : selected;
    },
    async previewRecoveryDraft(sessionId) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.previewRecoveryDraft(sessionId);
    },
    async applyRecoveryDraft(sessionId) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.applyRecoveryDraft(sessionId);
    },
    async discardRecoveryDraft(sessionId) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.discardRecoveryDraft(sessionId);
    },
    async refreshEngineeringTree() {
      const session =
        activeEngineeringWorkspaceSession ?? attachedCreativeEngineeringWorkspaceSession;
      if (session === undefined) {
        return engineeringWorkspaceUnavailable();
      }
      return session.refreshWorkspace();
    },
    async attachActiveCreativeProjectEngineeringWorkspace() {
      if (activeProjectWorkspaceSession === undefined) {
        return engineeringWorkspaceUnavailable();
      }

      const snapshot = activeProjectWorkspaceSession.getSnapshot();
      if (snapshot === undefined) {
        return engineeringWorkspaceUnavailable();
      }

      const attached = attachedCreativeEngineeringWorkspaceSession;
      if (
        attached !== undefined &&
        attached.getActivation()?.context.workspaceId === snapshot.project.projectId
      ) {
        return attached.refreshWorkspace();
      }

      const session = createEngineeringCandidateSession();
      if (session === undefined) return engineeringWorkspaceUnavailable();
      const opened = await session.attachCreativeProject({
        projectId: snapshot.project.projectId,
        projectRoot: snapshot.projectRoot
      });
      if (!opened.ok) return opened;
      attachedCreativeEngineeringWorkspaceSession = session;
      return ok(opened.value.snapshot);
    },
    async readEngineeringTextFile(path) {
      const session =
        activeEngineeringWorkspaceSession ?? attachedCreativeEngineeringWorkspaceSession;
      if (session === undefined) {
        return engineeringWorkspaceUnavailable();
      }
      return session.readTextFile(path);
    },
    async saveEngineeringTextFile(input) {
      const session =
        activeEngineeringWorkspaceSession ?? attachedCreativeEngineeringWorkspaceSession;
      if (session === undefined) {
        return engineeringWorkspaceUnavailable();
      }
      return session.saveTextFile(input);
    },
    async rebuildProjectSearchIndex() {
      const searchSession = getProjectSearchSession();
      if (searchSession === undefined) {
        return projectSearchUnavailable();
      }

      return searchSession.rebuildIndex();
    },
    async searchProject(input) {
      const searchSession = getProjectSearchSession();
      if (searchSession === undefined) {
        return projectSearchUnavailable();
      }

      return searchSession.search(input);
    },
    async notifyProjectSearchSourcesChanged(input) {
      if (
        activeProjectSearchBinding?.projectId !== input.projectId ||
        !input.relativePaths.some(isManagedStoryBibleRelativePath)
      ) {
        return;
      }
      await invalidateActiveProjectSearch(input.reason);
    },
    async loadStoryBible() {
      if (storyBibleSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.loadStoryBible();
    },
    async saveStoryBibleAsset(asset) {
      if (storyBibleSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }

      const saved = await storyBibleSession.saveStoryAsset(asset);
      if (saved.ok) {
        await invalidateActiveProjectSearch("story-bible-save");
      }
      return saved;
    },
    async readStoryBibleAssetForEditing(assetId) {
      if (
        storyBibleSession?.readStoryAssetForEditing === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      return storyBibleSession.readStoryAssetForEditing(assetId);
    },
    async createStoryBibleAsset(input) {
      if (
        storyBibleSession?.createStoryAsset === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      const saved = await storyBibleSession.createStoryAsset(input);
      if (saved.ok) await invalidateActiveProjectSearch("story-bible-save");
      return saved;
    },
    async saveStoryBibleAssetCandidate(input) {
      if (
        storyBibleSession?.saveStoryAssetCandidate === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      const saved = await storyBibleSession.saveStoryAssetCandidate(input);
      if (saved.ok) await invalidateActiveProjectSearch("story-bible-save");
      return saved;
    },
    async prepareStoryBibleExplicitInverseChange(input) {
      const binding = getStoryBibleExplicitInverseBinding();
      if (binding === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }
      const generation = projectScopeGeneration;
      const result = await binding.session.prepareStoryBibleExplicitInverseChange(input);
      if (
        generation !== projectScopeGeneration ||
        activeEngineeringWorkspaceSession !== undefined ||
        activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== binding.projectRoot
      ) {
        return storyBibleExplicitInverseWorkspaceChanged();
      }
      return result;
    },
    async applyStoryBibleExplicitInverseChange(input) {
      const binding = getStoryBibleExplicitInverseBinding();
      if (binding === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }
      const generation = projectScopeGeneration;
      const result = await binding.session.applyStoryBibleExplicitInverseChange(input);
      if (
        generation !== projectScopeGeneration ||
        activeEngineeringWorkspaceSession !== undefined ||
        activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== binding.projectRoot
      ) {
        return storyBibleExplicitInverseWorkspaceChanged();
      }
      if (result.ok && result.value.applied) {
        storyBibleSession?.clearSnapshot?.();
        await invalidateActiveProjectSearch("story-bible-save");
      }
      return result;
    },
    async cancelStoryBibleExplicitInverseChange(input) {
      const binding = getStoryBibleExplicitInverseBinding();
      if (binding === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }
      const generation = projectScopeGeneration;
      const result = await binding.session.cancelStoryBibleExplicitInverseChange(input);
      if (
        generation !== projectScopeGeneration ||
        activeEngineeringWorkspaceSession !== undefined ||
        activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== binding.projectRoot
      ) {
        return storyBibleExplicitInverseWorkspaceChanged();
      }
      return result;
    },
    async saveStoryBibleStatusTransition(input) {
      if (
        storyBibleSession?.saveStoryAssetStatusTransition === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      const saved = await storyBibleSession.saveStoryAssetStatusTransition(input);
      if (saved.ok) await invalidateActiveProjectSearch("story-bible-save");
      return saved;
    },
    async getStoryBibleReferences(assetId) {
      if (
        storyBibleSession?.getStoryAssetReferences === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      return storyBibleSession.getStoryAssetReferences(assetId);
    },
    async resolveStoryBibleRestoreStatus(assetId) {
      if (
        storyBibleSession?.resolveStoryAssetRestoreStatus === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      return storyBibleSession.resolveStoryAssetRestoreStatus(assetId);
    },
    async saveStoryBibleMemory(memory) {
      if (storyBibleSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }

      const saved = await storyBibleSession.saveMemory(memory);
      if (saved.ok) {
        await invalidateActiveProjectSearch("story-bible-save");
      }
      return saved;
    },
    async buildStoryBibleConsistencyReport() {
      if (storyBibleSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.buildConsistencyReport();
    },
    async buildStoryBibleContextCandidates(options) {
      if (storyBibleSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.buildContextCandidates(options);
    },
    async detectForeshadows(input) {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createForeshadowAnalysisSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }

      const generation = projectScopeGeneration;
      const result = await createForeshadowAnalysisSession(projectRoot).analyze(input);
      if (
        generation !== projectScopeGeneration ||
        activeEngineeringWorkspaceSession !== undefined ||
        activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== projectRoot
      ) {
        return foreshadowScanWorkspaceChanged();
      }
      return result;
    },
    async analyzeChapterStory(input) {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createStoryAnalysisSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      const generation = projectScopeGeneration;
      const result = await analyzeChapterWithMaintenance(projectRoot, input, generation);
      if (
        generation !== projectScopeGeneration ||
        activeEngineeringWorkspaceSession !== undefined ||
        activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== projectRoot
      ) {
        return storyAnalysisWorkspaceChanged();
      }
      return result;
    },
    async listStoryAnalyses() {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createStoryAnalysisSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      return createStoryAnalysisSession(projectRoot).listAnalyses();
    },
    async readStoryAnalysis(workflowRunId) {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createStoryAnalysisSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      return createStoryAnalysisSession(projectRoot).readAnalysis(workflowRunId);
    },
    async transitionStoryAnalysisRecord(input) {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createStoryAnalysisSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      return createStoryAnalysisSession(projectRoot).transitionRecord(input);
    },
    async refreshStoryAnalysisStaleness(workflowRunId) {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createStoryAnalysisSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      return createStoryAnalysisSession(projectRoot).refreshStaleness(workflowRunId);
    },
    async prepareStoryAnalysisApplication(input) {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createStoryAnalysisApplicationSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      const generation = projectScopeGeneration;
      const result =
        await createStoryAnalysisApplicationSession(projectRoot).prepareApplication(input);
      if (
        generation !== projectScopeGeneration ||
        activeEngineeringWorkspaceSession !== undefined ||
        activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== projectRoot
      ) {
        return storyAnalysisWorkspaceChanged();
      }
      return result;
    },
    async applyStoryAnalysisApplication(input) {
      const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
      if (
        projectRoot === undefined ||
        createStoryAnalysisApplicationSession === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return storyBibleUnavailable();
      }
      const generation = projectScopeGeneration;
      const execution = captureStoryAnalysisExecution(projectRoot);
      const result =
        await createStoryAnalysisApplicationSession(projectRoot).applyApplication(input);
      if (result.ok && didStoryBibleChange(result.value.batch)) {
        if (isActiveProjectScope(projectRoot, generation)) {
          try {
            storyBibleSession?.clearSnapshot?.();
          } catch {
            // The durable batch already committed; the visible cache can retry on its next read.
          }
        }
        await invalidateProjectSearchBinding(execution?.searchBinding, "story-bible-save");
      }
      if (
        generation !== projectScopeGeneration ||
        activeEngineeringWorkspaceSession !== undefined ||
        activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== projectRoot
      ) {
        // Do not hide a durable apply/partial-failure outcome behind a workspace transition.
        return result.ok ? result : storyAnalysisWorkspaceChanged();
      }
      return result;
    },
    async generateActiveChapterSuggestion(request) {
      const activeAiWritingWorkflowSession = getAiWritingWorkflowSession();
      if (activeAiWritingWorkflowSession === undefined) {
        return aiWritingWorkflowUnavailable();
      }

      return activeAiWritingWorkflowSession.generateChapterSuggestion(request);
    },
    async *streamActiveChapterSuggestion(request) {
      const activeAiWritingWorkflowSession = getAiWritingWorkflowSession();
      if (activeAiWritingWorkflowSession === undefined) {
        yield aiWritingWorkflowUnavailable();
        return;
      }

      yield* activeAiWritingWorkflowSession.streamChapterSuggestion(request);
    },
    async generateActiveSelectionPreview(request) {
      const activeAiWritingWorkflowSession = getAiWritingWorkflowSession();
      if (activeAiWritingWorkflowSession === undefined) {
        return aiWritingWorkflowUnavailable();
      }

      return activeAiWritingWorkflowSession.generateSelectionPreview(request);
    },
    async applyActiveSelectionPreview(previewId) {
      const activeAiWritingWorkflowSession = getAiWritingWorkflowSession();
      if (activeAiWritingWorkflowSession === undefined) {
        return aiWritingWorkflowUnavailable();
      }

      return activeAiWritingWorkflowSession.applySelectionPreview(previewId);
    },
    async applyActiveChapterSuggestion(suggestionId) {
      const activeAiWritingWorkflowSession = getAiWritingWorkflowSession();
      if (activeAiWritingWorkflowSession === undefined) {
        return aiWritingWorkflowUnavailable();
      }

      return activeAiWritingWorkflowSession.applyChapterSuggestion(suggestionId);
    },
    async listWorkflowRuns() {
      if (
        options.workflowRunHistory === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return workflowRunHistoryUnavailable();
      }

      return options.workflowRunHistory.listWorkflowRuns();
    },
    async readWorkflowRun(workflowRunId) {
      if (
        options.workflowRunHistory === undefined ||
        activeEngineeringWorkspaceSession !== undefined
      ) {
        return workflowRunHistoryUnavailable();
      }

      return options.workflowRunHistory.readWorkflowRun(workflowRunId);
    },
    async loadActiveChapter() {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const loaded = await activeChapterEditorSession.load();
      if (!loaded.ok) {
        return loaded;
      }

      return createChapterSnapshot(activeChapterEditorSession, loaded.value);
    },
    async readActiveChapterState() {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      const state = activeChapterEditorSession?.getState();
      return activeChapterEditorSession === undefined || state === undefined
        ? chapterEditorUnavailable()
        : createChapterSnapshot(activeChapterEditorSession, state);
    },
    async editActiveChapter(nextBody: string) {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const edited = await activeChapterEditorSession.edit(nextBody);
      if (!edited.ok) {
        return edited;
      }

      return createChapterSnapshot(activeChapterEditorSession, edited.value);
    },
    async saveActiveChapter() {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const saved = await activeChapterEditorSession.save();
      if (!saved.ok) {
        return saved;
      }

      return createChapterSnapshot(activeChapterEditorSession, saved.value);
    },
    async saveActiveChapterStatus(status) {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const saved = await activeChapterEditorSession.saveWithStatus(status);
      if (!saved.ok) {
        return saved;
      }
      const chapter = await createChapterSnapshot(activeChapterEditorSession, saved.value.state);
      if (!chapter.ok) {
        return chapter;
      }
      const completionAnalysis = await resolveChapterCompletionAnalysis(
        saved.value.state.chapter.frontmatter.id,
        saved.value.completedTransition
      );
      return ok({ chapter: chapter.value, completionAnalysis });
    },
    async listActiveChapterVersions() {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      return activeChapterEditorSession.listVersions();
    },
    async previewActiveChapterVersion(versionId: string) {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      return activeChapterEditorSession.previewVersion(versionId);
    },
    async restoreActiveChapterVersion(versionId: string) {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const restored = await activeChapterEditorSession.restoreVersion(versionId);
      if (!restored.ok) {
        return restored;
      }

      return createChapterSnapshot(activeChapterEditorSession, restored.value);
    },
    previewActiveChapterSuggestionDiff(nextBody: string) {
      const activeChapterEditorSession = getActiveChapterEditorSession();
      if (activeChapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      return ok(activeChapterEditorSession.previewSuggestionDiff(nextBody));
    },
    async listModelProfiles() {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }

      return modelSettingsSession.listModelProfiles();
    },
    async discoverModelOptions(profileId) {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }

      return modelSettingsSession.discoverModelOptions(profileId);
    },
    async saveModelProfile(profile, saveOptions) {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }

      return modelSettingsSession.saveModelProfile(profile, saveOptions);
    },
    async testModelProfileConnection(profileId) {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }

      return modelSettingsSession.testModelProfileConnection(profileId);
    },
    async readStoryAnalysisSettings() {
      return modelSettingsSession === undefined
        ? ok(DEFAULT_STORY_ANALYSIS_SETTINGS)
        : modelSettingsSession.readStoryAnalysisSettings();
    },
    async saveStoryAnalysisSettings(settings) {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }
      return modelSettingsSession.saveStoryAnalysisSettings(settings);
    },
    async listAgentUsage(query) {
      if (agentUsageSession === undefined) return agentUsageUnavailable();
      return agentUsageSession.listAgentUsage(query);
    },
    async clearAgentUsage(command) {
      if (agentUsageSession === undefined) return agentUsageUnavailable();
      return agentUsageSession.clearAgentUsage(command);
    },
    async loadPluginRegistry() {
      if (pluginSettingsSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return pluginRegistryUnavailable();
      }

      return pluginSettingsSession.load();
    },
    async setPluginEnabled(pluginId, enabled) {
      if (pluginSettingsSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return pluginRegistryUnavailable();
      }

      return pluginSettingsSession.setEnabled(pluginId, enabled);
    },
    async loadConfigAsset(assetType, assetId) {
      if (configStudioSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.loadConfigAsset(assetType, assetId);
    },
    async saveConfigAsset(input) {
      if (configStudioSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.saveConfigAsset(input);
    },
    async restoreConfigAssetVersion(input) {
      if (configStudioSession === undefined || activeEngineeringWorkspaceSession !== undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.restoreConfigAssetVersion(input);
    },
    async loadUserPreferences() {
      if (userPreferencesSession === undefined) {
        return userPreferencesUnavailable();
      }

      return userPreferencesSession.load();
    },
    async saveUserPreferences(input) {
      if (userPreferencesSession === undefined) {
        return userPreferencesUnavailable();
      }

      return userPreferencesSession.save(input);
    }
  };

  async function discardPreparedActivation(
    activationId: string
  ): Promise<Result<void, UnifiedError>> {
    const record = activationRecords.get(activationId);
    if (record === undefined || record.state !== "prepared") return ok(undefined);
    let firstError: UnifiedError | undefined;
    if (record.projectSession !== undefined) {
      const released = await record.projectSession.releaseProjectLock();
      if (released.ok) record.projectSession = undefined;
      else firstError = released.error;
    }
    if (record.engineeringSession !== undefined) {
      const released = await record.engineeringSession.releaseWorkspaceLock();
      if (released.ok) record.engineeringSession = undefined;
      else if (firstError === undefined) firstError = released.error;
    }
    if (record.createdProjectRoot !== undefined && projectCreationRepository !== undefined) {
      const cleaned = await projectCreationRepository.cleanupCreatedProject(
        record.createdProjectRoot
      );
      if (cleaned.ok) record.createdProjectRoot = undefined;
      else if (firstError === undefined) firstError = cleaned.error;
    }
    if (
      record.projectSession === undefined &&
      record.engineeringSession === undefined &&
      record.createdProjectRoot === undefined
    ) {
      activationRecords.delete(activationId);
    }
    return firstError === undefined ? ok(undefined) : err(firstError);
  }

  async function finalizeCommittedActivation(
    activationId: string
  ): Promise<Result<void, UnifiedError>> {
    const record = activationRecords.get(activationId);
    if (record === undefined || record.state !== "committed") return ok(undefined);
    let firstError: UnifiedError | undefined;
    if (record.previousProjectSession !== undefined) {
      const released = await record.previousProjectSession.releaseProjectLock();
      if (released.ok) record.previousProjectSession = undefined;
      else firstError = released.error;
    }
    if (record.previousEngineeringSession !== undefined) {
      const released = await record.previousEngineeringSession.releaseWorkspaceLock();
      if (released.ok) record.previousEngineeringSession = undefined;
      else if (firstError === undefined) firstError = released.error;
    }
    if (
      record.previousProjectSession === undefined &&
      record.previousEngineeringSession === undefined
    ) {
      activationRecords.delete(activationId);
    }
    return firstError === undefined ? ok(undefined) : err(firstError);
  }

  function createProjectCandidateSession(): ProjectWorkspaceSession | undefined {
    try {
      return options.createProjectWorkspaceSession?.();
    } catch {
      return undefined;
    }
  }

  function createEngineeringCandidateSession(): EngineeringWorkspaceSession | undefined {
    try {
      return options.createEngineeringWorkspaceSession?.();
    } catch {
      return undefined;
    }
  }

  function storeCreativeActivation(
    session: ProjectWorkspaceSession,
    snapshot: ProjectWorkspaceSnapshot,
    createdProjectRoot?: string
  ): Result<PreparedWorkspaceActivation, UnifiedError> {
    const activationId = createActivationId();
    const context: Extract<WorkspaceActivationContext, { readonly kind: "creativeProject" }> = {
      kind: "creativeProject",
      workspaceId: snapshot.project.projectId,
      projectId: snapshot.project.projectId,
      displayName: snapshot.project.title,
      contentRoot: snapshot.projectRoot,
      stateRoot: snapshot.projectRoot,
      capabilities: ["creativeWorkbench", "writingContext", "creativeSearch", "creativeStudio"],
      ...(snapshot.activeChapterId === undefined
        ? {}
        : { activeChapterId: snapshot.activeChapterId })
    };
    const activation: PreparedWorkspaceActivation = {
      activationId,
      context,
      creativeProject: snapshot
    };
    activationRecords.set(activationId, {
      activation,
      projectSession: session,
      ...(createdProjectRoot === undefined ? {} : { createdProjectRoot }),
      state: "prepared"
    });
    return ok(activation);
  }

  function createActivationId(): string {
    activationSequence += 1;
    return (
      options.createWorkspaceActivationId?.() ??
      `workspace_activation_${Date.now()}_${activationSequence}`
    );
  }

  function getActiveChapterEditorSession(): ChapterEditorSession | undefined {
    if (activeEngineeringWorkspaceSession !== undefined) {
      return undefined;
    }
    return activeProjectWorkspaceSession?.getActiveChapterEditorSession() ?? chapterEditorSession;
  }

  function getAiWritingWorkflowSession(): AiWritingWorkflowSession | undefined {
    if (aiWritingWorkflowSession !== undefined) {
      return aiWritingWorkflowSession;
    }
    if (createAiWritingWorkflowSession === undefined) {
      return undefined;
    }

    const activeChapterEditorSession = getActiveChapterEditorSession();
    if (activeChapterEditorSession === undefined) {
      return undefined;
    }
    if (dynamicAiChapterEditorSession !== activeChapterEditorSession) {
      dynamicAiChapterEditorSession = activeChapterEditorSession;
      dynamicAiWritingWorkflowSession = createAiWritingWorkflowSession(activeChapterEditorSession);
    }

    return dynamicAiWritingWorkflowSession;
  }

  function getProjectSearchSession(): ProjectSearchSession | undefined {
    return activeProjectSearchBinding?.session;
  }

  function getStoryBibleExplicitInverseBinding():
    | { readonly projectRoot: string; readonly session: StoryBibleExplicitInverseSession }
    | undefined {
    const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
    if (projectRoot === undefined || createStoryBibleExplicitInverseSession === undefined) {
      return undefined;
    }
    if (activeStoryBibleExplicitInverseBinding?.projectRoot === projectRoot) {
      return activeStoryBibleExplicitInverseBinding;
    }
    try {
      activeStoryBibleExplicitInverseBinding = {
        projectRoot,
        session: createStoryBibleExplicitInverseSession(projectRoot)
      };
      return activeStoryBibleExplicitInverseBinding;
    } catch {
      return undefined;
    }
  }

  async function invalidateActiveProjectSearch(
    reason: ProjectSearchInvalidationReason
  ): Promise<void> {
    await invalidateProjectSearchBinding(activeProjectSearchBinding, reason);
  }

  async function invalidateProjectSearchBinding(
    binding: ActiveProjectSearchBinding | undefined,
    reason: ProjectSearchInvalidationReason
  ): Promise<void> {
    const session = binding?.session;
    if (session === undefined) {
      return;
    }
    try {
      await session.invalidate(reason);
    } catch {
      // The source write already committed; search can retry cache invalidation on its next rebuild.
    }
  }

  async function resolveChapterCompletionAnalysis(
    chapterId: string,
    completedTransition: boolean
  ): Promise<ChapterCompletionAnalysisDisposition> {
    if (!completedTransition) {
      return { status: "not-triggered" };
    }

    const generation = projectScopeGeneration;
    const workspace = activeProjectWorkspaceSession?.getSnapshot();
    if (workspace === undefined || activeEngineeringWorkspaceSession !== undefined) {
      return { status: "unavailable", code: "STORY_ANALYSIS_WORKSPACE_UNAVAILABLE" };
    }

    const settings =
      modelSettingsSession === undefined
        ? ok(DEFAULT_STORY_ANALYSIS_SETTINGS)
        : await modelSettingsSession.readStoryAnalysisSettings();
    if (!settings.ok) {
      return { status: "unavailable", code: settings.error.code };
    }
    if (
      generation !== projectScopeGeneration ||
      activeProjectWorkspaceSession?.getSnapshot()?.projectRoot !== workspace.projectRoot
    ) {
      return { status: "unavailable", code: "STORY_ANALYSIS_WORKSPACE_CHANGED" };
    }
    if (settings.value.completionMode === "off") {
      return { status: "disabled", mode: "off" };
    }
    if (createStoryAnalysisSession === undefined) {
      return { status: "unavailable", code: "STORY_ANALYSIS_UNAVAILABLE" };
    }
    if (settings.value.completionMode === "prompt") {
      return { status: "prompt", mode: "prompt", chapterId };
    }

    try {
      const session = createStoryAnalysisSession(workspace.projectRoot);
      void analyzeChapterWithMaintenance(
        workspace.projectRoot,
        { chapterId, trigger: "chapter_completed" },
        generation,
        session
      ).then(
        () => undefined,
        () => undefined
      );
      return { status: "scheduled", mode: "background-review", chapterId };
    } catch {
      return { status: "unavailable", code: "STORY_ANALYSIS_SCHEDULE_FAILED" };
    }
  }

  /**
   * Runs Story Analysis and, when it is explicitly enabled at completion time, applies only the
   * safe subset. Analysis remains useful even if the optional maintenance step cannot run.
   */
  async function analyzeChapterWithMaintenance(
    projectRoot: string,
    input: AnalyzeChapterStoryInput,
    generation: number,
    analysisSession = createStoryAnalysisSession?.(projectRoot)
  ): Promise<Result<StoryAnalysisHistoryRecord, UnifiedError>> {
    if (analysisSession === undefined) {
      return storyBibleUnavailable();
    }
    const execution = captureStoryAnalysisExecution(projectRoot);
    const analyzed = await analysisSession.analyzeChapter(input);
    if (!analyzed.ok) return analyzed;

    // Read after analysis so a settings change made while the analysis was running takes effect.
    let settings: Result<StoryAnalysisSettings, UnifiedError>;
    try {
      settings =
        modelSettingsSession === undefined
          ? ok(DEFAULT_STORY_ANALYSIS_SETTINGS)
          : await modelSettingsSession.readStoryAnalysisSettings();
    } catch {
      publishStoryAnalysisCompletion(execution, input, analyzed.value, false);
      return analyzed;
    }
    if (
      !settings.ok ||
      settings.value.storyBibleMaintenanceMode !== "safe-auto" ||
      createStoryAnalysisApplicationSession === undefined
    ) {
      publishStoryAnalysisCompletion(execution, input, analyzed.value, false);
      return analyzed;
    }

    try {
      const applied = await createStoryAnalysisApplicationSession(
        projectRoot
      ).autoApplySafeSuggestions({
        workflowRunId: analyzed.value.workflowRun.workflowRunId
      });
      if (!applied.ok) {
        publishStoryAnalysisCompletion(execution, input, analyzed.value, false);
        return analyzed;
      }

      const storyBibleChanged = didStoryBibleChange(applied.value.batch);
      if (storyBibleChanged) {
        if (isActiveProjectScope(projectRoot, generation)) {
          try {
            storyBibleSession?.clearSnapshot?.();
          } catch {
            // The Story Bible write already committed; the cache can be refreshed on the next read.
          }
        }
        await invalidateProjectSearchBinding(execution?.searchBinding, "story-bible-save");
      }
      publishStoryAnalysisCompletion(execution, input, applied.value.analysis, storyBibleChanged);
      return ok(applied.value.analysis);
    } catch {
      // A completed chapter and its analysis must not be rolled back by optional maintenance.
      publishStoryAnalysisCompletion(execution, input, analyzed.value, false);
      return analyzed;
    }
  }

  function captureStoryAnalysisExecution(
    projectRoot: string
  ): StoryAnalysisExecutionBinding | undefined {
    const project = activeProjectWorkspaceSession?.getSnapshot();
    if (project?.projectRoot !== projectRoot) return undefined;
    const activeBinding = activeProjectSearchBinding;
    return {
      projectId: project.project.projectId,
      projectRoot,
      ...(activeBinding?.projectRoot === projectRoot &&
      activeBinding.projectId === project.project.projectId
        ? { searchBinding: activeBinding }
        : {})
    };
  }

  function publishStoryAnalysisCompletion(
    execution: StoryAnalysisExecutionBinding | undefined,
    input: AnalyzeChapterStoryInput,
    analysis: StoryAnalysisHistoryRecord,
    storyBibleChanged: boolean
  ): void {
    if (execution === undefined) return;
    const event: StoryAnalysisCompletionEvent = {
      schemaVersion: "1.0",
      projectId: execution.projectId,
      chapterId: input.chapterId,
      workflowRunId: analysis.workflowRun.workflowRunId,
      trigger: input.trigger,
      workflowStatus: analysis.workflowRun.status,
      storyBibleChanged
    };
    for (const listener of storyAnalysisCompletionListeners) {
      try {
        listener(structuredClone(event));
      } catch {
        // Notifications are presentation-only and must never change durable analysis results.
      }
    }
  }

  function didStoryBibleChange(batch: VersionGroupApplyBatchResult | undefined): boolean {
    return (
      batch?.groups.some(
        (group) => group.status === "applied" || group.status === "partial_failure"
      ) === true
    );
  }

  function isActiveProjectScope(projectRoot: string, generation: number): boolean {
    return (
      generation === projectScopeGeneration &&
      activeEngineeringWorkspaceSession === undefined &&
      activeProjectWorkspaceSession?.getSnapshot()?.projectRoot === projectRoot
    );
  }
}

export function toProjectCreationPreviewDto(
  preview: ProjectCreationPreview
): ProjectCreationPreviewDto {
  return {
    folderName: preview.folderName,
    parentDisplayName: preview.parentDisplayName,
    targetDisplayName: preview.targetDisplayName
  };
}

export function toProjectWorkspaceSnapshotDto(
  snapshot: ProjectWorkspaceSnapshot | ProjectWorkspaceSnapshotDto
): ProjectWorkspaceSnapshotDto {
  return {
    project: snapshot.project,
    settings: snapshot.settings,
    chapters: snapshot.chapters,
    recovery: snapshot.recovery,
    health: snapshot.health,
    ...(snapshot.lock === undefined
      ? {}
      : {
          lock: {
            schemaVersion: snapshot.lock.schemaVersion,
            ownerId: snapshot.lock.ownerId,
            acquiredAt: snapshot.lock.acquiredAt
          }
        }),
    ...(snapshot.activeChapterId === undefined ? {} : { activeChapterId: snapshot.activeChapterId })
  };
}

export function toWorkspaceActivationDto(
  activation: PreparedWorkspaceActivation
): WorkspaceActivationDto {
  return "creativeProject" in activation
    ? {
        context: toWorkspaceContextDto(activation.context),
        creativeProject: toProjectWorkspaceSnapshotDto(activation.creativeProject)
      }
    : {
        context: toWorkspaceContextDto(activation.context),
        engineeringWorkspace: activation.engineeringWorkspace
      };
}

function createInitialShellState(options: DesktopApplicationOptions): DesktopShellState {
  return {
    ...DEFAULT_SHELL_STATE,
    ...(options.projectTitle === undefined ? {} : { projectTitle: options.projectTitle }),
    ...(options.navigatorSections === undefined
      ? {}
      : { navigatorSections: options.navigatorSections })
  };
}

function withChapterSaveStatus(
  shellState: DesktopShellState,
  chapterState: ChapterEditorState | undefined
): DesktopShellState {
  if (chapterState === undefined) {
    return shellState;
  }

  return {
    ...shellState,
    saveStatus: chapterState.saveStatus
  };
}

function withProjectWorkspaceState(
  shellState: DesktopShellState,
  workspaceSnapshot: ProjectWorkspaceSnapshot | undefined,
  storyBibleSnapshot: StoryBibleSnapshot | undefined
): DesktopShellState {
  if (workspaceSnapshot === undefined) {
    return shellState;
  }

  return {
    ...shellState,
    projectTitle: workspaceSnapshot.project.title,
    workspaceContext: toWorkspaceContextDto({
      kind: "creativeProject",
      workspaceId: workspaceSnapshot.project.projectId,
      projectId: workspaceSnapshot.project.projectId,
      displayName: workspaceSnapshot.project.title,
      contentRoot: workspaceSnapshot.projectRoot,
      stateRoot: workspaceSnapshot.projectRoot,
      capabilities: ["creativeWorkbench", "writingContext", "creativeSearch", "creativeStudio"],
      ...(workspaceSnapshot.activeChapterId === undefined
        ? {}
        : { activeChapterId: workspaceSnapshot.activeChapterId })
    }),
    navigatorSections: shellState.navigatorSections.map((section) => {
      switch (section.id) {
        case "chapters":
          return { ...section, itemCount: workspaceSnapshot.chapters.length };
        case "characters":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.characters.length ?? 0
          };
        case "world":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.worldAssets.length ?? 0
          };
        case "outline":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.outline === undefined ? 0 : 1
          };
        case "timeline":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.timeline === undefined ? 0 : 1
          };
        case "foreshadows":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.foreshadows.length ?? 0
          };
        case "memories":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.memories.length ?? 0
          };
        default:
          return section;
      }
    })
  };
}

async function createChapterSnapshot(
  session: ChapterEditorSession,
  state: ChapterEditorState
): Promise<Result<ChapterEditorSnapshot, UnifiedError>> {
  const versions = await session.listVersions();
  if (!versions.ok) {
    return versions;
  }

  return ok({
    state,
    versions: versions.value
  });
}

function chapterEditorUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CHAPTER_EDITOR_UNAVAILABLE",
      category: "UserError",
      message: "No chapter editor session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project chapter before using editor commands.",
      traceId: "application-chapter-editor"
    })
  );
}

function modelSettingsUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "MODEL_SETTINGS_UNAVAILABLE",
      category: "UserError",
      message: "No model settings session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project with settings support before editing model profiles.",
      traceId: "application-model-settings"
    })
  );
}

function configStudioUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CONFIG_STUDIO_UNAVAILABLE",
      category: "UserError",
      message: "No config studio session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project with Studio support before editing configuration assets.",
      traceId: "application-config-studio"
    })
  );
}

function agentUsageUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AGENT_USAGE_UNAVAILABLE",
      category: "StorageError",
      message: "Agent usage data is unavailable.",
      recoverability: "retryable",
      suggestedAction: "Restart the desktop application and try again.",
      traceId: "application-agent-usage"
    })
  );
}

function storyBibleUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_BIBLE_UNAVAILABLE",
      category: "UserError",
      message: "No Story Bible session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project before using Story Bible commands.",
      traceId: "application-story-bible"
    })
  );
}

function foreshadowScanWorkspaceChanged<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "FORESHADOW_SCAN_WORKSPACE_CHANGED",
      category: "UserError",
      message: "The active workspace changed before foreshadow analysis finished.",
      recoverability: "user-action",
      suggestedAction: "Run the analysis again in the current project.",
      traceId: "application-foreshadow-analysis"
    })
  );
}

function storyAnalysisWorkspaceChanged<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_ANALYSIS_WORKSPACE_CHANGED",
      category: "UserError",
      message: "The active workspace changed before Story Analysis finished.",
      recoverability: "user-action",
      suggestedAction: "Run the analysis again in the current project.",
      traceId: "application-story-analysis"
    })
  );
}

function storyBibleExplicitInverseWorkspaceChanged<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_BIBLE_EXPLICIT_INVERSE_WORKSPACE_CHANGED",
      category: "UserError",
      message: "The active workspace changed before the explicit inverse edit finished.",
      recoverability: "user-action",
      suggestedAction: "Reload the Story Bible entry and prepare the two-sided preview again.",
      traceId: "application-story-bible-explicit-inverse"
    })
  );
}

function projectWorkspaceUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "PROJECT_WORKSPACE_UNAVAILABLE",
      category: "UserError",
      message: "No project workspace session is available.",
      recoverability: "user-action",
      suggestedAction: "Create or open a project before using project workflow commands.",
      traceId: "application-project-workspace"
    })
  );
}

function engineeringWorkspaceUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_WORKSPACE_UNAVAILABLE",
      category: "UserError",
      message: "No engineering workspace session is available.",
      recoverability: "user-action",
      suggestedAction: "Choose an engineering folder before using workspace commands.",
      traceId: "application-engineering-workspace"
    })
  );
}

function workspaceCloseError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "UserError",
    message,
    recoverability: "user-action",
    suggestedAction: "Resolve pending workspace state and retry closing the workspace.",
    traceId: "application-workspace-close"
  });
}

function projectSearchUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "PROJECT_SEARCH_UNAVAILABLE",
      category: "UserError",
      message: "No project search session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project before using project search.",
      traceId: "application-project-search"
    })
  );
}

const MANAGED_STORY_BIBLE_PATH_ROOTS = new Set([
  "characters",
  "world",
  "outline",
  "timeline",
  "foreshadows",
  "memories"
]);

function isManagedStoryBibleRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  const root = normalized.split("/", 1)[0];
  return root !== undefined && MANAGED_STORY_BIBLE_PATH_ROOTS.has(root);
}

function aiWritingWorkflowUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AI_WRITING_WORKFLOW_UNAVAILABLE",
      category: "UserError",
      message: "No AI writing workflow session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project chapter before generating AI writing suggestions.",
      traceId: "application-ai-writing-workflow"
    })
  );
}

function workflowRunHistoryUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "WORKFLOW_RUN_HISTORY_UNAVAILABLE",
      category: "UserError",
      message: "No workflow run history is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project before viewing workflow run history.",
      traceId: "application-workflow-run-history"
    })
  );
}

function userPreferencesUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "USER_PREFERENCES_UNAVAILABLE",
      category: "UserError",
      message: "No user preferences session is available.",
      recoverability: "user-action",
      suggestedAction: "Continue with runtime defaults or restart the desktop application.",
      traceId: "application-user-preferences"
    })
  );
}

function reduceShellState(
  shellState: DesktopShellState,
  commandId: ApplicationCommandId
): DesktopShellState {
  switch (commandId) {
    case "workspace.open-command-palette":
      return { ...shellState, commandPaletteOpen: true };
    case "workspace.toggle-navigator":
      return { ...shellState, navigatorCollapsed: !shellState.navigatorCollapsed };
    case "workspace.toggle-inspector":
      return { ...shellState, inspectorCollapsed: !shellState.inspectorCollapsed };
    case "workspace.toggle-bottom-panel":
      return { ...shellState, bottomPanelVisible: !shellState.bottomPanelVisible };
    case "workspace.toggle-split-view":
      return {
        ...shellState,
        workspaceLayout: {
          ...shellState.workspaceLayout,
          splitView: !shellState.workspaceLayout.splitView
        }
      };
    case "workspace.toggle-focus-mode":
      return { ...shellState, focusMode: !shellState.focusMode };
    case "workspace.narrow-navigator":
      return {
        ...shellState,
        workspaceLayout: {
          ...shellState.workspaceLayout,
          navigatorWidth: clampPanelWidth(shellState.workspaceLayout.navigatorWidth - 40, 200, 360)
        }
      };
    case "workspace.widen-navigator":
      return {
        ...shellState,
        workspaceLayout: {
          ...shellState.workspaceLayout,
          navigatorWidth: clampPanelWidth(shellState.workspaceLayout.navigatorWidth + 40, 200, 360)
        }
      };
    case "workspace.narrow-inspector":
      return {
        ...shellState,
        workspaceLayout: {
          ...shellState.workspaceLayout,
          inspectorWidth: clampPanelWidth(shellState.workspaceLayout.inspectorWidth - 40, 240, 440)
        }
      };
    case "workspace.widen-inspector":
      return {
        ...shellState,
        workspaceLayout: {
          ...shellState.workspaceLayout,
          inspectorWidth: clampPanelWidth(shellState.workspaceLayout.inspectorWidth + 40, 240, 440)
        }
      };
    default:
      return shellState;
  }
}

function clampPanelWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
