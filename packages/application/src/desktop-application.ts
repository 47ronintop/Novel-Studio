import {
  DEFAULT_USER_SHELL_PREFERENCES,
  EMPTY_WORKSPACE_CONTEXT,
  createUnifiedError,
  err,
  ok
} from "@novel-studio/shared";
import type {
  ChapterSummary,
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
  ModelSettingsSnapshot
} from "./model-settings-session.js";
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
  ProjectSearchQuery,
  ProjectSearchResults,
  ProjectSearchSession
} from "./project-search-session.js";
import type {
  MemoryRecord,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidateOptions,
  StoryBibleSession,
  StoryBibleSnapshot
} from "./story-bible-session.js";
import type {
  UserPreferencesSaveInput,
  UserPreferencesSession,
  UserPreferencesSnapshot
} from "./user-preferences-session.js";
import type { ContextCandidate } from "@novel-studio/context-engine";

export type ActivityId =
  "workspace" | "search" | "storyBible" | "timeline" | "ai" | "studio" | "settings";

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
  getShellState(): DesktopShellState;
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
  previewRecoveryDraft(
    sessionId: string
  ): Promise<Result<ProjectRecoveryDraftPreview, UnifiedError>>;
  applyRecoveryDraft(sessionId: string): Promise<Result<ProjectRecoveryApplyResult, UnifiedError>>;
  discardRecoveryDraft(sessionId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  refreshEngineeringTree(): Promise<Result<EngineeringWorkspaceSnapshot, UnifiedError>>;
  readEngineeringTextFile(
    path: string
  ): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>>;
  saveEngineeringTextFile(input: {
    readonly path: string;
    readonly content: string;
    readonly expectedChecksum: string;
  }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>>;
  rebuildProjectSearchIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
  searchProject(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
  loadStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
  saveStoryBibleAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveStoryBibleMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
  buildStoryBibleConsistencyReport(): Promise<Result<StoryBibleConsistencyReport, UnifiedError>>;
  buildStoryBibleContextCandidates(
    options?: StoryBibleContextCandidateOptions
  ): Promise<Result<readonly ContextCandidate[], UnifiedError>>;
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
  readonly modelSettingsSession?: ModelSettingsSession;
  readonly agentUsageSession?: AgentUsageSession;
  readonly pluginSettingsSession?: PluginSettingsSession;
  readonly pluginRuntimeSession?: PluginRuntimeSession;
  readonly configStudioSession?: ConfigStudioSession;
  readonly userPreferencesSession?: UserPreferencesSession;
  readonly storyBibleSession?: StoryBibleSession;
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
  const createProjectSearchSession = options.createProjectSearchSession;
  const aiWritingWorkflowSession = options.aiWritingWorkflowSession;
  const createAiWritingWorkflowSession = options.createAiWritingWorkflowSession;
  let dynamicAiWritingWorkflowSession: AiWritingWorkflowSession | undefined;
  let dynamicAiChapterEditorSession: ChapterEditorSession | undefined;
  let shellState = createInitialShellState(options);

  return {
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
      if (releasedEngineering !== undefined && !releasedEngineering.ok && firstError === undefined) {
        firstError = releasedEngineering.error;
      }
      return firstError === undefined ? ok(undefined) : err(firstError);
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
      const dto = toWorkspaceActivationDto(record.activation);
      shellState = {
        ...shellState,
        workspaceContext: dto.context,
        projectTitle:
          "creativeProject" in record.activation
            ? record.activation.creativeProject.project.title
            : record.activation.engineeringWorkspace.displayName
      };
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

      return activeProjectWorkspaceSession.openProject(projectRoot);
    },
    async createProjectInParent(input) {
      if (activeProjectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return activeProjectWorkspaceSession.createProjectInParent(input);
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
      if (activeEngineeringWorkspaceSession === undefined) {
        return engineeringWorkspaceUnavailable();
      }
      return activeEngineeringWorkspaceSession.refreshWorkspace();
    },
    async readEngineeringTextFile(path) {
      if (activeEngineeringWorkspaceSession === undefined) {
        return engineeringWorkspaceUnavailable();
      }
      return activeEngineeringWorkspaceSession.readTextFile(path);
    },
    async saveEngineeringTextFile(input) {
      if (activeEngineeringWorkspaceSession === undefined) {
        return engineeringWorkspaceUnavailable();
      }
      return activeEngineeringWorkspaceSession.saveTextFile(input);
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
    async loadStoryBible() {
      if (storyBibleSession === undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.loadStoryBible();
    },
    async saveStoryBibleAsset(asset) {
      if (storyBibleSession === undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.saveStoryAsset(asset);
    },
    async saveStoryBibleMemory(memory) {
      if (storyBibleSession === undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.saveMemory(memory);
    },
    async buildStoryBibleConsistencyReport() {
      if (storyBibleSession === undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.buildConsistencyReport();
    },
    async buildStoryBibleContextCandidates(options) {
      if (storyBibleSession === undefined) {
        return storyBibleUnavailable();
      }

      return storyBibleSession.buildContextCandidates(options);
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
      if (options.workflowRunHistory === undefined) {
        return workflowRunHistoryUnavailable();
      }

      return options.workflowRunHistory.listWorkflowRuns();
    },
    async readWorkflowRun(workflowRunId) {
      if (options.workflowRunHistory === undefined) {
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
    async listAgentUsage(query) {
      if (agentUsageSession === undefined) return agentUsageUnavailable();
      return agentUsageSession.listAgentUsage(query);
    },
    async clearAgentUsage(command) {
      if (agentUsageSession === undefined) return agentUsageUnavailable();
      return agentUsageSession.clearAgentUsage(command);
    },
    async loadPluginRegistry() {
      if (pluginSettingsSession === undefined) {
        return pluginRegistryUnavailable();
      }

      return pluginSettingsSession.load();
    },
    async setPluginEnabled(pluginId, enabled) {
      if (pluginSettingsSession === undefined) {
        return pluginRegistryUnavailable();
      }

      return pluginSettingsSession.setEnabled(pluginId, enabled);
    },
    async loadConfigAsset(assetType, assetId) {
      if (configStudioSession === undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.loadConfigAsset(assetType, assetId);
    },
    async saveConfigAsset(input) {
      if (configStudioSession === undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.saveConfigAsset(input);
    },
    async restoreConfigAssetVersion(input) {
      if (configStudioSession === undefined) {
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
    const context: Extract<
      WorkspaceActivationContext,
      { readonly kind: "creativeProject" }
    > = {
      kind: "creativeProject",
      workspaceId: snapshot.project.projectId,
      projectId: snapshot.project.projectId,
      displayName: snapshot.project.title,
      contentRoot: snapshot.projectRoot,
      stateRoot: snapshot.projectRoot,
      capabilities: [
        "creativeWorkbench",
        "writingContext",
        "creativeSearch",
        "creativeStudio"
      ],
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
    const projectRoot = activeProjectWorkspaceSession?.getSnapshot()?.projectRoot;
    if (projectRoot === undefined || createProjectSearchSession === undefined) {
      return undefined;
    }

    return createProjectSearchSession(projectRoot);
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
  snapshot: ProjectWorkspaceSnapshot
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
    navigatorSections: shellState.navigatorSections.map((section) => {
      switch (section.id) {
        case "chapters":
          return { ...section, itemCount: workspaceSnapshot.chapters.length };
        case "characters":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.characters.length ?? section.itemCount
          };
        case "world":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.worldAssets.length ?? section.itemCount
          };
        case "outline":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.outline === undefined ? section.itemCount : 1
          };
        case "timeline":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.timeline === undefined ? section.itemCount : 1
          };
        case "memories":
          return {
            ...section,
            itemCount: storyBibleSnapshot?.memories.length ?? section.itemCount
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
