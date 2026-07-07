import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type {
  ChapterSummary,
  CreateChapterInput,
  ChapterVersionContent,
  ChapterVersionSummary,
  Result,
  UnifiedError
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
  CreateProjectInput,
  ProjectRecoveryApplyResult,
  ProjectRecoveryDraftPreview,
  ProjectWorkspaceSession,
  ProjectWorkspaceSnapshot
} from "./project-workspace-session.js";
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

export interface DesktopShellState {
  readonly projectTitle: string;
  readonly activeActivity: ActivityId;
  readonly navigatorCollapsed: boolean;
  readonly inspectorCollapsed: boolean;
  readonly bottomPanelVisible: boolean;
  readonly activeBottomPanelTab: string;
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
  openProject(projectRoot: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  createProject(input: CreateProjectInput): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  listProjectChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>>;
  createProjectChapter(
    input: CreateChapterInput
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  selectProjectChapter(chapterId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  previewRecoveryDraft(
    sessionId: string
  ): Promise<Result<ProjectRecoveryDraftPreview, UnifiedError>>;
  applyRecoveryDraft(sessionId: string): Promise<Result<ProjectRecoveryApplyResult, UnifiedError>>;
  discardRecoveryDraft(sessionId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
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
  readonly modelSettingsSession?: ModelSettingsSession;
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

const DEFAULT_SHELL_STATE: DesktopShellState = {
  projectTitle: "未打开项目",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: true,
  bottomPanelVisible: false,
  activeBottomPanelTab: "工作流运行",
  workspaceLayout: {
    splitView: false,
    navigatorWidth: 260,
    inspectorWidth: 320,
    bottomPanelHeight: 180
  },
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
  const projectWorkspaceSession = options.projectWorkspaceSession;
  const modelSettingsSession = options.modelSettingsSession;
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
      if (projectWorkspaceSession === undefined) {
        return ok(undefined);
      }

      return projectWorkspaceSession.releaseProjectLock();
    },
    getShellState: () =>
      withChapterSaveStatus(
        withProjectWorkspaceState(
          shellState,
          projectWorkspaceSession?.getSnapshot(),
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
    async openProject(projectRoot) {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.openProject(projectRoot);
    },
    async createProject(input) {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.createProject(input);
    },
    async listProjectChapters() {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.listChapters();
    },
    async createProjectChapter(input) {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.createChapter(input);
    },
    async selectProjectChapter(chapterId) {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.selectChapter(chapterId);
    },
    async previewRecoveryDraft(sessionId) {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.previewRecoveryDraft(sessionId);
    },
    async applyRecoveryDraft(sessionId) {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.applyRecoveryDraft(sessionId);
    },
    async discardRecoveryDraft(sessionId) {
      if (projectWorkspaceSession === undefined) {
        return projectWorkspaceUnavailable();
      }

      return projectWorkspaceSession.discardRecoveryDraft(sessionId);
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

  function getActiveChapterEditorSession(): ChapterEditorSession | undefined {
    return projectWorkspaceSession?.getActiveChapterEditorSession() ?? chapterEditorSession;
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
    const projectRoot = projectWorkspaceSession?.getSnapshot()?.projectRoot;
    if (projectRoot === undefined || createProjectSearchSession === undefined) {
      return undefined;
    }

    return createProjectSearchSession(projectRoot);
  }
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
