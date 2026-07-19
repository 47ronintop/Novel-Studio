import { realpath } from "node:fs/promises";
import { join } from "node:path";

import {
  createAgentBackedAiWritingWorkflowSession,
  createAgentUsageSession,
  createChapterEditorSession,
  createConfigStudioSession,
  createDesktopApplication,
  createEngineeringWorkspaceSession,
  createModelSettingsSession,
  createPluginSettingsSession,
  createProjectSearchSession,
  createProjectWorkspaceSession,
  createStoryBibleSession,
  createUserPreferencesSession,
  resolveDefaultModelRuntimeProfile
} from "@novel-studio/application";
import type {
  ChapterEditorSession,
  DesktopApplication,
  EngineeringWorkspaceSession,
  ModelConnectionTester,
  ModelDiscoveryPort,
  ProjectWorkspaceSnapshot,
  ProjectSettings,
  ProjectSettingsPort
} from "@novel-studio/application";
import { createLlmAdapter, type LlmProvider } from "@novel-studio/llm-adapter";
import {
  ChapterFileRepository,
  AgentUsageFileRepository,
  ConfigAssetRepository,
  EngineeringWorkspaceFileRepository,
  HistoryRepository,
  PluginRegistryFileRepository,
  ProjectCreationFileRepository,
  ProjectFileRepository,
  ProjectLockFileRepository,
  ProjectSettingsRepository,
  RecoveryRepository,
  SearchIndexFileRepository,
  StoryBibleFileRepository,
  UserPreferencesFileRepository,
  WorkspaceStateFileRepository
} from "@novel-studio/repository";
import { err, ok } from "@novel-studio/shared";

export const DEFAULT_FIXTURE_CHAPTER_ID = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const DEFAULT_PROJECT_TITLE = "未命名长篇项目";
const DEFAULT_PROJECT_ID = "prj_minimal_chapter";
const DEFAULT_CHAPTER_TITLE = "第一章";
const DEFAULT_CHAPTER_BODY = "这是第一章的正文。你可以直接开始写作。\n";

export interface ProjectDesktopApplicationOptions {
  readonly projectRoot: string;
  readonly chapterId: string;
  readonly projectTitle: string;
  readonly userDataRoot?: string;
  readonly now?: () => string;
  readonly createVersionId?: () => string;
  readonly modelConnectionTester?: ModelConnectionTester;
  readonly modelDiscoveryPort?: ModelDiscoveryPort;
  readonly createAiProvider?: (input: DesktopAiProviderFactoryInput) => LlmProvider;
  readonly projectLockOwnerId?: string;
}

export interface BootstrappedDefaultDesktopApplicationOptions {
  readonly projectRoot: string;
  readonly userDataRoot?: string;
  readonly now?: () => string;
  readonly createVersionId?: () => string;
  readonly modelConnectionTester?: ModelConnectionTester;
  readonly modelDiscoveryPort?: ModelDiscoveryPort;
  readonly createAiProvider?: (input: DesktopAiProviderFactoryInput) => LlmProvider;
  readonly projectLockOwnerId?: string;
}

export interface BootstrappedDefaultDesktopApplication {
  readonly application: DesktopApplication;
  readonly workspace: ProjectWorkspaceSnapshot;
}

export interface DesktopAiProviderFactoryInput {
  readonly chapterEditorSession: ChapterEditorSession;
}

export interface DesktopEngineeringWorkspaceSessionOptions {
  readonly userDataRoot: string;
  readonly projectLockOwnerId: string;
  readonly now?: () => string;
}

export function createDesktopEngineeringWorkspaceSession(
  options: DesktopEngineeringWorkspaceSessionOptions
): EngineeringWorkspaceSession {
  return createEngineeringWorkspaceSession({
    createRepository: (contentRoot) =>
      new EngineeringWorkspaceFileRepository({
        contentRoot,
        traceId: "trace_desktop_engineering_workspace_repository"
      }),
    createStatePort: () =>
      new WorkspaceStateFileRepository({
        userDataRoot: options.userDataRoot,
        traceId: "trace_desktop_workspace_state_repository"
      }),
    createLockPort: (stateRoot) => {
      const lock = new ProjectLockFileRepository({
        projectRoot: stateRoot,
        ownerId: options.projectLockOwnerId,
        traceId: "trace_desktop_engineering_workspace_lock",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      return {
        async acquireWorkspaceLock() {
          const acquired = await lock.acquireProjectLock();
          return acquired.ok ? ok(undefined) : err(acquired.error);
        },
        releaseWorkspaceLock: () => lock.releaseProjectLock()
      };
    },
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

export function createProjectDesktopApplication(
  options: ProjectDesktopApplicationOptions
): DesktopApplication {
  const lockOwnerId = options.projectLockOwnerId ?? createProjectLockOwnerId();
  let activeProjectRoot: string | undefined = options.projectRoot;
  const chapterRepository = new ChapterFileRepository({
    projectRoot: options.projectRoot,
    traceId: "trace_desktop_chapter_repository"
  });
  const historyRepository = new HistoryRepository({
    projectRoot: options.projectRoot,
    traceId: "trace_desktop_history_repository",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createVersionId === undefined ? {} : { createVersionId: options.createVersionId })
  });
  const recoveryRepository = new RecoveryRepository({
    projectRoot: options.projectRoot,
    traceId: "trace_desktop_recovery_repository"
  });
  const chapterEditorSession = createChapterEditorSession({
    chapterId: options.chapterId,
    repository: chapterRepository,
    historyRepository,
    recoveryRepository,
    projectId: DEFAULT_PROJECT_ID,
    sessionId: `session_${DEFAULT_PROJECT_ID}_${options.chapterId}`,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const projectCreationRepository = new ProjectCreationFileRepository({
    traceId: "trace_desktop_project_creation_repository",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const createWorkspaceSession = () =>
    createProjectWorkspaceSession({
      ...(options.now === undefined ? {} : { now: options.now }),
      projectCreationRepository,
      createProjectRepository: (projectRoot) =>
        new ProjectFileRepository({
          projectRoot,
          traceId: "trace_desktop_project_repository",
          ...(options.now === undefined ? {} : { now: options.now })
        }),
      createChapterRepository: (projectRoot) =>
        new ChapterFileRepository({
          projectRoot,
          traceId: "trace_desktop_project_chapter_repository",
          ...(options.now === undefined ? {} : { now: options.now })
        }),
      createHistoryRepository: (projectRoot) =>
        new HistoryRepository({
          projectRoot,
          traceId: "trace_desktop_project_history_repository",
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(options.createVersionId === undefined
            ? {}
            : { createVersionId: options.createVersionId })
        }),
      createRecoveryRepository: (projectRoot) =>
        new RecoveryRepository({
          projectRoot,
          traceId: "trace_desktop_project_recovery_repository"
        }),
      createProjectLockRepository: (projectRoot) =>
        new ProjectLockFileRepository({
          projectRoot,
          ownerId: lockOwnerId,
          traceId: "trace_desktop_project_lock_repository",
          ...(options.now === undefined ? {} : { now: options.now })
        })
    });
  const projectWorkspaceSession = createWorkspaceSession();
  const settingsPort: ProjectSettingsPort = {
    readSettings: () => createSettingsRepository().readSettings(),
    writeSettings: (settings: ProjectSettings) => createSettingsRepository().writeSettings(settings)
  };
  const engineeringUserDataRoot = options.userDataRoot;

  return createDesktopApplication({
    chapterEditorSession,
    projectWorkspaceSession,
    createProjectWorkspaceSession: createWorkspaceSession,
    onActiveProjectRootChange: (projectRoot) => {
      activeProjectRoot = projectRoot;
    },
    projectCreationRepository,
    ...(engineeringUserDataRoot === undefined
      ? {}
      : {
          createEngineeringWorkspaceSession: () =>
            createDesktopEngineeringWorkspaceSession({
              userDataRoot: engineeringUserDataRoot,
              projectLockOwnerId: lockOwnerId,
              ...(options.now === undefined ? {} : { now: options.now })
            })
        }),
    modelSettingsSession: createModelSettingsSession({
      settingsPort,
      ...(options.modelConnectionTester === undefined
        ? {}
        : { connectionTester: options.modelConnectionTester }),
      ...(options.modelDiscoveryPort === undefined
        ? {}
        : { discoveryPort: options.modelDiscoveryPort })
    }),
    ...(options.userDataRoot === undefined
      ? {}
      : {
          agentUsageSession: createAgentUsageSession({
            repository: new AgentUsageFileRepository({
              userDataRoot: options.userDataRoot,
              traceId: "trace_desktop_agent_usage_repository"
            })
          })
        }),
    pluginSettingsSession: createPluginSettingsSession({
      pluginRegistryPort: {
        readPluginSettings: () => createPluginRegistryRepository().readPluginSettings(),
        setPluginEnabled: (pluginId, enabled) =>
          createPluginRegistryRepository().setPluginEnabled(pluginId, enabled)
      }
    }),
    configStudioSession: createConfigStudioSession({
      configAssetPort: {
        readConfigAsset: (assetType, assetId) =>
          createConfigAssetRepository().readConfigAsset(assetType, assetId),
        writeConfigAsset: (input) => createConfigAssetRepository().writeConfigAsset(input),
        restoreConfigAssetVersion: (input) =>
          createConfigAssetRepository().restoreConfigAssetVersion(input)
      }
    }),
    ...(options.userDataRoot === undefined
      ? {}
      : {
          userPreferencesSession: createUserPreferencesSession({
            preferencesPort: new UserPreferencesFileRepository({
              userDataRoot: options.userDataRoot,
              traceId: "trace_desktop_user_preferences_repository"
            })
          })
        }),
    storyBibleSession: createStoryBibleSession({
      repository: {
        readStoryBible: () => createStoryBibleRepository().readStoryBible(),
        saveStoryAsset: (asset) => createStoryBibleRepository().saveStoryAsset(asset),
        saveMemory: (memory) => createStoryBibleRepository().saveMemory(memory)
      }
    }),
    createProjectSearchSession: (projectRoot) =>
      createProjectSearchSession({
        repository: new SearchIndexFileRepository({
          projectRoot,
          traceId: "trace_desktop_search_index_repository",
          ...(options.now === undefined ? {} : { now: options.now })
        })
      }),
    workflowRunHistory: {
      recordWorkflowRun: (record) => createWorkflowRunHistoryRepository().recordWorkflowRun(record),
      listWorkflowRuns: () => createWorkflowRunHistoryRepository().listWorkflowRuns(),
      readWorkflowRun: (workflowRunId) =>
        createWorkflowRunHistoryRepository().readWorkflowRun(workflowRunId)
    },
    createAiWritingWorkflowSession: (activeChapterEditorSession) =>
      createAgentBackedAiWritingWorkflowSession({
        chapterEditorSession: activeChapterEditorSession,
        llmAdapter: createLlmAdapter({
          provider:
            options.createAiProvider?.({
              chapterEditorSession: activeChapterEditorSession
            }) ?? createDesktopMockAiProvider(activeChapterEditorSession),
          clock: () => options.now?.() ?? new Date().toISOString()
        }),
        resolveModelRuntimeProfile: async () => {
          const settings = await settingsPort.readSettings();
          if (!settings.ok) {
            return settings;
          }

          return resolveDefaultModelRuntimeProfile(settings.value);
        },
        ...(options.now === undefined ? {} : { now: options.now }),
        workflowRunHistory: {
          recordWorkflowRun: (record) =>
            createWorkflowRunHistoryRepository().recordWorkflowRun(record)
        }
      }),
    projectTitle: options.projectTitle,
    navigatorSections: [
      { id: "chapters", title: "章节", itemCount: 1 },
      { id: "characters", title: "人物", itemCount: 0 },
      { id: "world", title: "世界观", itemCount: 0 },
      { id: "outline", title: "大纲", itemCount: 0 },
      { id: "timeline", title: "时间线", itemCount: 0 },
      { id: "memories", title: "记忆", itemCount: 0 },
      { id: "prompts", title: "提示词", itemCount: 0 },
      { id: "agents", title: "Agent", itemCount: 0 },
      { id: "workflows", title: "工作流", itemCount: 0 }
    ]
  });

  function createSettingsRepository(): ProjectSettingsRepository {
    return new ProjectSettingsRepository({
      projectRoot: requireActiveProjectRoot(),
      traceId: "trace_desktop_settings_repository"
    });
  }

  function createPluginRegistryRepository(): PluginRegistryFileRepository {
    return new PluginRegistryFileRepository({
      projectRoot: requireActiveProjectRoot(),
      traceId: "trace_desktop_plugin_registry_repository"
    });
  }

  function createStoryBibleRepository(): StoryBibleFileRepository {
    return new StoryBibleFileRepository({
      projectRoot: requireActiveProjectRoot(),
      traceId: "trace_desktop_story_bible_repository"
    });
  }

  function createConfigAssetRepository(): ConfigAssetRepository {
    const projectRoot = requireActiveProjectRoot();
    return new ConfigAssetRepository({
      projectRoot,
      traceId: "trace_desktop_config_asset_repository",
      historyRepository: createActiveHistoryRepository(
        projectRoot,
        "trace_desktop_config_asset_history_repository"
      )
    });
  }

  function createWorkflowRunHistoryRepository(): HistoryRepository {
    return createActiveHistoryRepository(
      requireActiveProjectRoot(),
      "trace_desktop_workflow_run_history_repository"
    );
  }

  function createActiveHistoryRepository(projectRoot: string, traceId: string): HistoryRepository {
    return new HistoryRepository({
      projectRoot,
      traceId,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createVersionId === undefined ? {} : { createVersionId: options.createVersionId })
    });
  }

  function requireActiveProjectRoot(): string {
    if (activeProjectRoot === undefined) {
      throw new Error("No creative project is active.");
    }
    return activeProjectRoot;
  }
}

function createDesktopMockAiProvider(chapterEditorSession: ChapterEditorSession): LlmProvider {
  return {
    id: "mock",
    async complete() {
      const currentBody = chapterEditorSession.getState()?.chapter.body ?? "";
      const separator = currentBody.endsWith("\n") || currentBody.length === 0 ? "" : "\n";

      return {
        content: {
          type: "json",
          value: {
            proposedBody: `${currentBody}${separator}AI continuation draft.\n`,
            summary: "Generated a local mock continuation for review."
          }
        },
        usage: {
          inputTokens: 16,
          outputTokens: 8,
          totalTokens: 24,
          usageStatus: "estimated",
          cost: {
            amount: 0,
            currency: "USD",
            status: "estimated"
          }
        }
      };
    },
    async *stream() {
      yield {
        type: "delta",
        value: "AI continuation draft."
      };
    }
  };
}

export function createDefaultDesktopApplication(): DesktopApplication {
  const projectRoot =
    process.env["NOVEL_STUDIO_PROJECT_ROOT"] ??
    join(process.cwd(), "fixtures", "projects", "minimal-chapter");

  return createProjectDesktopApplication({
    projectRoot,
    ...(process.env["NOVEL_STUDIO_USER_DATA_ROOT"] === undefined
      ? {}
      : { userDataRoot: process.env["NOVEL_STUDIO_USER_DATA_ROOT"] }),
    chapterId: DEFAULT_FIXTURE_CHAPTER_ID,
    projectTitle: DEFAULT_PROJECT_TITLE
  });
}

export async function createBootstrappedDefaultDesktopApplication(
  options: BootstrappedDefaultDesktopApplicationOptions
): Promise<DesktopApplication> {
  return (await createBootstrappedDefaultDesktopApplicationWithSnapshot(options)).application;
}

export async function createBootstrappedDefaultDesktopApplicationWithSnapshot(
  options: BootstrappedDefaultDesktopApplicationOptions
): Promise<BootstrappedDefaultDesktopApplication> {
  await ensureDefaultProject(options);
  const canonicalProjectRoot = await realpath(options.projectRoot);

  const application = createProjectDesktopApplication({
    projectRoot: canonicalProjectRoot,
    ...(options.userDataRoot === undefined ? {} : { userDataRoot: options.userDataRoot }),
    chapterId: DEFAULT_FIXTURE_CHAPTER_ID,
    projectTitle: DEFAULT_PROJECT_TITLE,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createVersionId === undefined ? {} : { createVersionId: options.createVersionId }),
    ...(options.modelConnectionTester === undefined
      ? {}
      : { modelConnectionTester: options.modelConnectionTester }),
    ...(options.modelDiscoveryPort === undefined
      ? {}
      : { modelDiscoveryPort: options.modelDiscoveryPort }),
    ...(options.createAiProvider === undefined
      ? {}
      : { createAiProvider: options.createAiProvider }),
    ...(options.projectLockOwnerId === undefined
      ? {}
      : { projectLockOwnerId: options.projectLockOwnerId })
  });
  const opened = await application.openProject(canonicalProjectRoot);
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }

  return { application, workspace: opened.value };
}

export function createProjectLockOwnerId(): string {
  return `desktop_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDefaultProject(
  options: BootstrappedDefaultDesktopApplicationOptions
): Promise<void> {
  const projectRepository = new ProjectFileRepository({
    projectRoot: options.projectRoot,
    traceId: "trace_desktop_default_project_repository",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const opened = await projectRepository.openProject();
  if (!opened.ok) {
    const created = await projectRepository.createProject({
      projectId: DEFAULT_PROJECT_ID,
      title: DEFAULT_PROJECT_TITLE,
      language: "zh-CN"
    });
    if (!created.ok) {
      throw new Error(created.error.message);
    }
  }

  const chapterRepository = new ChapterFileRepository({
    projectRoot: options.projectRoot,
    traceId: "trace_desktop_default_chapter_repository",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const chapters = await chapterRepository.listChapters();
  if (chapters.ok && chapters.value.length > 0) {
    return;
  }

  const createdChapter = await chapterRepository.createChapter({
    chapterId: DEFAULT_FIXTURE_CHAPTER_ID,
    title: DEFAULT_CHAPTER_TITLE,
    order: 1,
    body: DEFAULT_CHAPTER_BODY
  });
  if (!createdChapter.ok) {
    throw new Error(createdChapter.error.message);
  }
}
