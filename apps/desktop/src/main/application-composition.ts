import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import {
  createAgentBackedAiWritingWorkflowSession,
  createAgentFileOperationSession,
  createAgentUsageSession,
  createChapterEditorSession,
  createConfigStudioSession,
  createDesktopApplication,
  createEngineeringWorkspaceSession,
  createForeshadowAnalysisSession,
  createModelSettingsSession,
  createPluginSettingsSession,
  createProjectSearchSession,
  createProjectWorkspaceSession,
  createStoryAnalysisSession,
  createStoryAnalysisApplicationSession,
  createStoryAnalysisChangeSetPreparationPort,
  createStoryBibleExplicitInverseSession,
  createStoryBibleSession,
  createUserPreferencesSession,
  resolveDefaultForeshadowAnalysisRuntimeProfile,
  resolveDefaultModelRuntimeProfile,
  resolveDefaultStoryAnalysisRuntimeProfile
} from "@novel-studio/application";
import {
  usageRecordIdempotencyKey,
  validateAgentUsageRecord,
  type AgentUsageRecord
} from "@novel-studio/agent-engine";
import type {
  ChapterEditorSession,
  DesktopApplication,
  EngineeringWorkspaceSession,
  ModelConnectionTester,
  ModelDiscoveryPort,
  ProjectWorkspaceSnapshot,
  ProjectSettings,
  ProjectSettingsPort,
  StoryBibleAsset
} from "@novel-studio/application";
import {
  createLlmAdapter,
  type LlmProvider,
  type LlmRequest,
  type LlmUsage
} from "@novel-studio/llm-adapter";
import {
  ChapterFileRepository,
  AgentProjectReadRepository,
  AgentRunFileRepository,
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
import { createTrustedCreativeFileOperationsPort } from "@novel-studio/repository";
import { err, ok, type JsonObject } from "@novel-studio/shared";

import {
  createDesktopChangeSetSession,
  createDesktopVersionGroupServices,
  resolveStoryBibleRestoreStatus
} from "./agent-run-runtime.js";

export const DEFAULT_FIXTURE_CHAPTER_ID = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const DEFAULT_PROJECT_TITLE = "未命名长篇项目";
const DEFAULT_PROJECT_ID = "prj_minimal_chapter";
const DEFAULT_CHAPTER_TITLE = "第一章";
const DEFAULT_CHAPTER_BODY = "这是第一章的正文。你可以直接开始写作。\n";

export interface ProjectDesktopApplicationOptions {
  readonly projectRoot: string;
  /** Application-owned model settings root; production uses this while no project is open. */
  readonly applicationSettingsRoot?: string;
  /** Start with an empty workspace instead of treating projectRoot as the active project. */
  readonly startUnbound?: boolean;
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

export interface UnboundDesktopApplicationOptions {
  readonly userDataRoot: string;
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
  let activeProjectRoot: string | undefined = options.startUnbound
    ? undefined
    : options.projectRoot;
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
  const createProjectStoryAnalysisSession = (projectRoot: string) => {
    const snapshot = projectWorkspaceSession.getSnapshot();
    if (snapshot === undefined || snapshot.projectRoot !== projectRoot) {
      throw new Error("The active creative project changed before Story Analysis was created.");
    }
    const analysisChapterRepository = new ChapterFileRepository({
      projectRoot,
      traceId: "trace_desktop_story_analysis_chapter_repository",
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const analysisStoryBibleRepository = new StoryBibleFileRepository({
      projectRoot,
      traceId: "trace_desktop_story_analysis_story_bible_repository"
    });
    const analysisHistoryRepository = createActiveHistoryRepository(
      projectRoot,
      "trace_desktop_story_analysis_history_repository"
    );
    const analysisRunRepository = new AgentRunFileRepository({
      projectRoot,
      traceId: "trace_desktop_story_analysis_run_repository"
    });
    const analysisUsageRepository =
      options.userDataRoot === undefined
        ? undefined
        : new AgentUsageFileRepository({
            userDataRoot: options.userDataRoot,
            traceId: "trace_desktop_story_analysis_usage_repository"
          });
    const activeChapterEditorSession =
      projectWorkspaceSession.getActiveChapterEditorSession() ?? chapterEditorSession;
    return createStoryAnalysisSession({
      projectId: snapshot.project.projectId,
      chapterRepository: {
        readChapter: (chapterId) => analysisChapterRepository.readChapter(chapterId)
      },
      storyBibleRepository: {
        listStoryBible: (input) => analysisStoryBibleRepository.listStoryBible(input),
        readStoryAssetForAgent: (assetId) =>
          analysisStoryBibleRepository.readStoryAssetForAgent(assetId)
      },
      contextSnapshotPort: {
        writeContextSnapshot: (contextSnapshot) =>
          analysisRunRepository.writeContextSnapshot(contextSnapshot)
      },
      history: {
        coordinateStoryAnalysisChapter: (chapterId, operation) =>
          analysisHistoryRepository.coordinateStoryAnalysisChapter(chapterId, operation),
        writeStoryAnalysis: (input) => analysisHistoryRepository.writeStoryAnalysis(input),
        listStoryAnalyses: () => analysisHistoryRepository.listStoryAnalyses(),
        readStoryAnalysis: (workflowRunId) =>
          analysisHistoryRepository.readStoryAnalysis(workflowRunId)
      },
      resolveModelRuntimeProfile: async () => {
        const settings = await new ProjectSettingsRepository({
          projectRoot: options.applicationSettingsRoot ?? projectRoot,
          traceId: "trace_desktop_story_analysis_settings_repository"
        }).readSettings();
        return settings.ok ? resolveDefaultStoryAnalysisRuntimeProfile(settings.value) : settings;
      },
      llmAdapter: createLlmAdapter({
        provider:
          options.createAiProvider?.({ chapterEditorSession: activeChapterEditorSession }) ??
          createDesktopMockAiProvider(activeChapterEditorSession),
        clock: () => options.now?.() ?? new Date().toISOString()
      }),
      ...(analysisUsageRepository === undefined
        ? {}
        : {
            usagePort: {
              async recordUsage(input) {
                const record = createStoryAnalysisUsageRecord({
                  ...input,
                  projectId: snapshot.project.projectId
                });
                const validated = validateAgentUsageRecord(record);
                if (!validated.ok) return validated;
                const written = await analysisUsageRepository.writeFinal(
                  validated.value as unknown as JsonObject
                );
                return written.ok ? ok(validated.value.usageId) : written;
              }
            }
          }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  };

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
        readCompatibleStoryAsset: async (assetId) => {
          const read = await createStoryBibleRepository().readCompatibleStoryAsset(assetId);
          return read.ok
            ? ok({ ...read.value, asset: read.value.asset as unknown as StoryBibleAsset })
            : read;
        },
        createStoryAsset: async (input) => {
          const created = await createStoryBibleRepository().createStoryAsset(input);
          return created.ok ? ok(created.value as unknown as StoryBibleAsset) : created;
        },
        saveStoryAssetCandidate: async (input) => {
          const saved = await createStoryBibleRepository().saveStoryAssetCandidate(input);
          return saved.ok ? ok(saved.value as unknown as StoryBibleAsset) : saved;
        },
        saveStoryAssetStatusTransition: async (input) => {
          const saved = await createStoryBibleRepository().saveStoryAssetStatusTransition(input);
          return saved.ok ? ok(saved.value as unknown as StoryBibleAsset) : saved;
        },
        getStoryBibleReferences: (assetId, knownChapterIds) =>
          createStoryBibleRepository().getStoryBibleReferences(assetId, knownChapterIds),
        saveMemory: (memory) => createStoryBibleRepository().saveMemory(memory)
      },
      chapterCatalog: {
        listChapters: () => createStoryBibleChapterCatalogRepository().listChapters()
      },
      resolveRestoreStatus: (assetId, currentRevision, currentChecksum) =>
        resolveStoryBibleRestoreStatus(
          createActiveHistoryRepository(
            requireActiveProjectRoot(),
            "trace_desktop_story_bible_restore_history_repository"
          ),
          assetId,
          currentRevision,
          currentChecksum
        )
    }),
    createForeshadowAnalysisSession: (projectRoot) => {
      const analysisChapterRepository = new ChapterFileRepository({
        projectRoot,
        traceId: "trace_desktop_foreshadow_analysis_chapter_repository",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const analysisStoryBibleRepository = new StoryBibleFileRepository({
        projectRoot,
        traceId: "trace_desktop_foreshadow_analysis_story_bible_repository"
      });
      return createForeshadowAnalysisSession({
        chapterRepository: {
          readChapter: (chapterId) => analysisChapterRepository.readChapter(chapterId)
        },
        storyBibleRepository: {
          readStoryBible: () => analysisStoryBibleRepository.readStoryBible()
        },
        resolveModelRuntimeProfile: async () => {
          const settings = await new ProjectSettingsRepository({
            projectRoot: options.applicationSettingsRoot ?? projectRoot,
            traceId: "trace_desktop_foreshadow_analysis_settings_repository"
          }).readSettings();
          return settings.ok
            ? resolveDefaultForeshadowAnalysisRuntimeProfile(settings.value)
            : settings;
        },
        llmAdapter: createLlmAdapter({
          provider:
            options.createAiProvider?.({ chapterEditorSession }) ??
            createDesktopMockAiProvider(chapterEditorSession),
          clock: () => options.now?.() ?? new Date().toISOString()
        }),
        ...(options.now === undefined ? {} : { now: options.now })
      });
    },
    createStoryAnalysisSession: createProjectStoryAnalysisSession,
    createStoryBibleExplicitInverseSession: (projectRoot) => {
      const snapshot = projectWorkspaceSession.getSnapshot();
      if (snapshot === undefined || snapshot.projectRoot !== projectRoot) {
        throw new Error(
          "The active creative project changed before the explicit inverse editor was created."
        );
      }
      const storyBible = new StoryBibleFileRepository({
        projectRoot,
        traceId: "trace_desktop_story_bible_explicit_inverse_repository",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const chapter = new ChapterFileRepository({
        projectRoot,
        traceId: "trace_desktop_story_bible_explicit_inverse_chapter_repository",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const runRepository = new AgentRunFileRepository({
        projectRoot,
        traceId: "trace_desktop_story_bible_explicit_inverse_run_repository"
      });
      const projectReads = new AgentProjectReadRepository({
        projectRoot,
        traceId: "trace_desktop_story_bible_explicit_inverse_project_reads"
      });
      const changeSets = createDesktopChangeSetSession({
        projectId: snapshot.project.projectId,
        projectReads,
        chapterRepository: chapter,
        storyBible,
        repository: runRepository
      });
      const versionGroups = createDesktopVersionGroupServices({
        contentRoot: projectRoot,
        stateRoot: projectRoot,
        projectId: snapshot.project.projectId,
        projectLockOwnerId: lockOwnerId,
        trustedCreativeMutations: createTrustedCreativeFileOperationsPort({
          workspaceKind: "creativeProject",
          projectRoot
        }),
        projectReads,
        chapterRepository: chapter,
        storyBible
      }).versionGroupSession;
      return createStoryBibleExplicitInverseSession({
        projectId: snapshot.project.projectId,
        repository: {
          readCompatibleStoryAsset: (assetId) => storyBible.readCompatibleStoryAsset(assetId),
          prepareStoryAssetCandidateReadOnly: (input) =>
            storyBible.prepareStoryAssetCandidateReadOnly(
              input as Parameters<StoryBibleFileRepository["prepareStoryAssetCandidateReadOnly"]>[0]
            ),
          validateStoryBibleCandidateGroup: (input) =>
            storyBible.validateStoryBibleCandidateGroup(input)
        },
        chapterCatalog: { listChapters: () => chapter.listChapters() },
        changeSets,
        versionGroups,
        ...(options.now === undefined ? {} : { now: options.now })
      });
    },
    createStoryAnalysisApplicationSession: (projectRoot) => {
      const snapshot = projectWorkspaceSession.getSnapshot();
      if (snapshot === undefined || snapshot.projectRoot !== projectRoot) {
        throw new Error("The active creative project changed before Story Analysis was created.");
      }
      const storyBible = new StoryBibleFileRepository({
        projectRoot,
        traceId: "trace_desktop_story_analysis_apply_story_bible_repository",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const chapter = new ChapterFileRepository({
        projectRoot,
        traceId: "trace_desktop_story_analysis_apply_chapter_repository",
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const runRepository = new AgentRunFileRepository({
        projectRoot,
        traceId: "trace_desktop_story_analysis_apply_run_repository"
      });
      const projectReads = new AgentProjectReadRepository({
        projectRoot,
        traceId: "trace_desktop_story_analysis_apply_project_reads"
      });
      const changeSets = createDesktopChangeSetSession({
        projectId: snapshot.project.projectId,
        projectReads,
        chapterRepository: chapter,
        storyBible,
        repository: runRepository
      });
      const fileOperations = createAgentFileOperationSession({
        traceId: "trace_desktop_story_analysis_apply_file_operations"
      });
      const versionGroups = createDesktopVersionGroupServices({
        contentRoot: projectRoot,
        stateRoot: projectRoot,
        projectId: snapshot.project.projectId,
        projectLockOwnerId: lockOwnerId,
        trustedCreativeMutations: createTrustedCreativeFileOperationsPort({
          workspaceKind: "creativeProject",
          projectRoot
        }),
        projectReads,
        chapterRepository: chapter,
        storyBible
      }).versionGroupSession;
      const preparation = createStoryAnalysisChangeSetPreparationPort({
        projectId: snapshot.project.projectId,
        chapterCatalog: { listChapters: () => chapter.listChapters() },
        repository: {
          readCompatibleStoryAsset: (assetId) => storyBible.readCompatibleStoryAsset(assetId),
          prepareCreateStoryAsset: (input) =>
            storyBible.prepareCreateStoryAsset(
              input as Parameters<StoryBibleFileRepository["prepareCreateStoryAsset"]>[0]
            ),
          async prepareStoryAssetCandidateReadOnly(input) {
            const prepared = await storyBible.prepareStoryAssetCandidateReadOnly(
              input as Parameters<StoryBibleFileRepository["prepareStoryAssetCandidateReadOnly"]>[0]
            );
            return prepared.ok
              ? ok({ ...prepared.value, currentRelativePath: prepared.value.current.relativePath })
              : prepared;
          }
        },
        changeSets,
        fileOperations
      });
      return createStoryAnalysisApplicationSession({
        analysis: createProjectStoryAnalysisSession(projectRoot),
        preparation,
        changeSets,
        versionGroups
      });
    },
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
      projectRoot: options.applicationSettingsRoot ?? requireActiveProjectRoot(),
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
    const projectRoot = requireActiveProjectRoot();
    return new StoryBibleFileRepository({
      projectRoot,
      traceId: "trace_desktop_story_bible_repository",
      ...(options.now === undefined ? {} : { now: options.now }),
      beforeStoryAssetCandidateWrite: async (prepared) => {
        const snapshot = await createActiveHistoryRepository(
          projectRoot,
          "trace_desktop_story_bible_history_repository"
        ).snapshotTextAsset({
          assetType: "text",
          assetId: prepared.asset.id,
          reason: "manual-save",
          content: prepared.baseContent,
          candidateContent: prepared.content,
          createdBy: "user",
          relativePath: prepared.current.relativePath
        });
        return snapshot.ok ? ok(undefined) : snapshot;
      }
    });
  }

  function createStoryBibleChapterCatalogRepository(): ChapterFileRepository {
    return new ChapterFileRepository({
      projectRoot: requireActiveProjectRoot(),
      traceId: "trace_desktop_story_bible_chapter_catalog_repository",
      ...(options.now === undefined ? {} : { now: options.now })
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

function createStoryAnalysisUsageRecord(input: {
  readonly projectId: string;
  readonly analysisRunId: string;
  readonly chapterId: string;
  readonly usage: LlmUsage;
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly safeInputBudget: number;
  readonly createdAt: string;
}): AgentUsageRecord {
  const roundId = "story_observer";
  const finalSequence = 1;
  const time = storyAnalysisUsageTime(input.createdAt);
  const cacheOutcome = input.usage.cacheOutcome ?? "unknown";
  const cost =
    input.usage.cost.status === "actual"
      ? input.usage.cost
      : ({ amount: 0, currency: "", status: "unknown" } as const);
  return {
    schemaVersion: "1.2",
    scope: {
      kind: "workspace",
      workspaceKind: "creativeProject",
      workspaceId: input.projectId
    },
    usageId: usageRecordIdempotencyKey({
      runId: input.analysisRunId,
      roundId,
      finalSequence
    }),
    runId: input.analysisRunId,
    conversationId: input.chapterId,
    roundId,
    finalSequence,
    provider: input.provider,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    ...(input.usage.cacheReadTokens === undefined
      ? {}
      : {
          cachedTokens: input.usage.cacheReadTokens,
          cacheReadTokens: input.usage.cacheReadTokens
        }),
    ...(input.usage.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: input.usage.cacheWriteTokens }),
    ...(input.usage.cacheEligibleInputTokens === undefined
      ? {}
      : { cacheEligibleInputTokens: input.usage.cacheEligibleInputTokens }),
    cacheOutcome,
    ...(cacheOutcome !== "bypass"
      ? {}
      : { cacheBypassReason: input.usage.cacheBypassReason ?? "usage_unavailable" }),
    cacheUsageStatus: input.usage.cacheUsageStatus ?? "unavailable",
    cacheInputTokenSemantics: input.usage.cacheInputTokenSemantics ?? "unavailable",
    cacheMode: null,
    cachePrefixChecksum: null,
    ...(input.usage.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: input.usage.reasoningTokens }),
    totalTokens: input.usage.totalTokens,
    usageStatus: input.usage.usageStatus,
    precision:
      input.usage.usageStatus === "actual"
        ? "reported"
        : input.usage.usageStatus === "estimated"
          ? "estimated"
          : "unknown",
    pricingVersion: null,
    unitPrices: null,
    cost,
    contextWindow: input.contextWindow,
    safeInputBudget: input.safeInputBudget,
    terminationReason: "stop",
    ...time
  };
}

function storyAnalysisUsageTime(timestamp: string): {
  readonly timestamp: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly utcOffsetMinutes: number;
} {
  const current = new Date(timestamp);
  const year = String(current.getFullYear()).padStart(4, "0");
  const month = String(current.getMonth() + 1).padStart(2, "0");
  const day = String(current.getDate()).padStart(2, "0");
  return {
    timestamp: current.toISOString(),
    localDate: `${year}-${month}-${day}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    utcOffsetMinutes: -current.getTimezoneOffset()
  };
}

export async function createUnboundDesktopApplication(
  options: UnboundDesktopApplicationOptions
): Promise<DesktopApplication> {
  const applicationStateRoot = join(options.userDataRoot, "application");
  await mkdir(applicationStateRoot, { recursive: true });
  const settingsRepository = new ProjectSettingsRepository({
    projectRoot: applicationStateRoot,
    traceId: "trace_desktop_application_settings_repository"
  });
  const currentSettings = await settingsRepository.readSettings();
  if (!currentSettings.ok && currentSettings.error.code === "SETTINGS_FILE_MISSING") {
    await settingsRepository.writeSettings(createDefaultApplicationSettings());
  }
  return createProjectDesktopApplication({
    projectRoot: applicationStateRoot,
    applicationSettingsRoot: applicationStateRoot,
    startUnbound: true,
    userDataRoot: options.userDataRoot,
    chapterId: DEFAULT_FIXTURE_CHAPTER_ID,
    projectTitle: "未打开项目",
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
}

function createDefaultApplicationSettings(): ProjectSettings {
  return {
    schemaVersion: "1.0",
    autosave: { enabled: true, intervalMs: 30_000, createHistorySnapshot: false },
    history: {
      snapshotPolicy: "manual-and-interval",
      intervalMinutes: 10,
      maxSnapshotsPerChapter: 20
    },
    models: {
      defaultProfileId: "model_default",
      profiles: [
        {
          id: "model_default",
          provider: "openai-compatible",
          displayName: "Default Model",
          baseUrl: "https://api.example.com/v1",
          apiKeyRef: "secret://model_default/api_key",
          modelName: "example-model",
          temperature: 0.7,
          maxTokens: 4096,
          topP: 1,
          timeoutMs: 60_000,
          frequencyPenalty: 0,
          presencePenalty: 0
        }
      ]
    }
  };
}

function createDesktopMockAiProvider(chapterEditorSession: ChapterEditorSession): LlmProvider {
  return {
    id: "mock",
    async complete(request) {
      const currentBody = chapterEditorSession.getState()?.chapter.body ?? "";
      const separator = currentBody.endsWith("\n") || currentBody.length === 0 ? "" : "\n";
      const selectedText = desktopMockSelectionText(request);
      const isForeshadowAnalysis = request.traceId === "foreshadow-analysis";

      return {
        content: {
          type: "json",
          value: isForeshadowAnalysis
            ? { candidates: [] }
            : selectedText === undefined
              ? {
                  proposedBody: `${currentBody}${separator}AI continuation draft.\n`,
                  summary: "Generated a local mock continuation for review."
                }
              : {
                  proposedText: `${selectedText} AI rewrite.`,
                  summary: "Generated a local mock selection rewrite for review."
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

function desktopMockSelectionText(request: LlmRequest): string | undefined {
  if (request.traceId !== "ai-selection-preview") return undefined;
  const marker = "Selected text: ";
  for (const message of [...request.messages].reverse()) {
    if (message.role !== "user") continue;
    const markerIndex = message.content.lastIndexOf(marker);
    if (markerIndex !== -1) return message.content.slice(markerIndex + marker.length);
  }
  return undefined;
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
