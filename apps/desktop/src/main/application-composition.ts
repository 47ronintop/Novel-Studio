import { join } from "node:path";

import {
  createAgentBackedAiWritingWorkflowSession,
  createChapterEditorSession,
  createConfigStudioSession,
  createDesktopApplication,
  createModelSettingsSession,
  createPluginSettingsSession,
  createProjectSearchSession,
  createProjectWorkspaceSession,
  createStoryBibleSession,
  resolveDefaultModelRuntimeProfile
} from "@novel-studio/application";
import type {
  ChapterEditorSession,
  DesktopApplication,
  ModelConnectionTester,
  ProjectSettings,
  ProjectSettingsPort
} from "@novel-studio/application";
import { createLlmAdapter, type LlmProvider } from "@novel-studio/llm-adapter";
import {
  ChapterFileRepository,
  ConfigAssetRepository,
  HistoryRepository,
  PluginRegistryFileRepository,
  ProjectFileRepository,
  ProjectLockFileRepository,
  ProjectSettingsRepository,
  RecoveryRepository,
  SearchIndexFileRepository,
  StoryBibleFileRepository
} from "@novel-studio/repository";

export const DEFAULT_FIXTURE_CHAPTER_ID = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const DEFAULT_PROJECT_TITLE = "Minimal Chapter Project";
const DEFAULT_PROJECT_ID = "prj_minimal_chapter";
const DEFAULT_CHAPTER_TITLE = "第一章";
const DEFAULT_CHAPTER_BODY = "原始章节正文。\n";

export interface ProjectDesktopApplicationOptions {
  readonly projectRoot: string;
  readonly chapterId: string;
  readonly projectTitle: string;
  readonly now?: () => string;
  readonly createVersionId?: () => string;
  readonly modelConnectionTester?: ModelConnectionTester;
}

export interface BootstrappedDefaultDesktopApplicationOptions {
  readonly projectRoot: string;
  readonly now?: () => string;
  readonly createVersionId?: () => string;
  readonly modelConnectionTester?: ModelConnectionTester;
}

export function createProjectDesktopApplication(
  options: ProjectDesktopApplicationOptions
): DesktopApplication {
  const lockOwnerId = createProjectLockOwnerId();
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
  const projectWorkspaceSession = createProjectWorkspaceSession({
    ...(options.now === undefined ? {} : { now: options.now }),
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
  const settingsPort: ProjectSettingsPort = {
    readSettings: () => createSettingsRepository().readSettings(),
    writeSettings: (settings: ProjectSettings) => createSettingsRepository().writeSettings(settings)
  };

  return createDesktopApplication({
    chapterEditorSession,
    projectWorkspaceSession,
    modelSettingsSession: createModelSettingsSession({
      settingsPort,
      ...(options.modelConnectionTester === undefined
        ? {}
        : { connectionTester: options.modelConnectionTester })
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
          provider: createDesktopMockAiProvider(activeChapterEditorSession),
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
      projectRoot: projectWorkspaceSession.getSnapshot()?.projectRoot ?? options.projectRoot,
      traceId: "trace_desktop_settings_repository"
    });
  }

  function createPluginRegistryRepository(): PluginRegistryFileRepository {
    return new PluginRegistryFileRepository({
      projectRoot: projectWorkspaceSession.getSnapshot()?.projectRoot ?? options.projectRoot,
      traceId: "trace_desktop_plugin_registry_repository"
    });
  }

  function createStoryBibleRepository(): StoryBibleFileRepository {
    return new StoryBibleFileRepository({
      projectRoot: projectWorkspaceSession.getSnapshot()?.projectRoot ?? options.projectRoot,
      traceId: "trace_desktop_story_bible_repository"
    });
  }

  function createConfigAssetRepository(): ConfigAssetRepository {
    return new ConfigAssetRepository({
      projectRoot: projectWorkspaceSession.getSnapshot()?.projectRoot ?? options.projectRoot,
      traceId: "trace_desktop_config_asset_repository",
      historyRepository
    });
  }

  function createWorkflowRunHistoryRepository(): HistoryRepository {
    return new HistoryRepository({
      projectRoot: projectWorkspaceSession.getSnapshot()?.projectRoot ?? options.projectRoot,
      traceId: "trace_desktop_workflow_run_history_repository",
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createVersionId === undefined ? {} : { createVersionId: options.createVersionId })
    });
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
    chapterId: DEFAULT_FIXTURE_CHAPTER_ID,
    projectTitle: DEFAULT_PROJECT_TITLE
  });
}

export async function createBootstrappedDefaultDesktopApplication(
  options: BootstrappedDefaultDesktopApplicationOptions
): Promise<DesktopApplication> {
  await ensureDefaultProject(options);

  const application = createProjectDesktopApplication({
    projectRoot: options.projectRoot,
    chapterId: DEFAULT_FIXTURE_CHAPTER_ID,
    projectTitle: DEFAULT_PROJECT_TITLE,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createVersionId === undefined ? {} : { createVersionId: options.createVersionId }),
    ...(options.modelConnectionTester === undefined
      ? {}
      : { modelConnectionTester: options.modelConnectionTester })
  });
  const opened = await application.openProject(options.projectRoot);
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }

  return application;
}

function createProjectLockOwnerId(): string {
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
