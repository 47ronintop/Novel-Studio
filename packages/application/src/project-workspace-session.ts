import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type {
  ChapterCatalogRepositoryPort,
  ChapterDraftRepositoryPort,
  ChapterHistoryRepositoryPort,
  ChapterSummary,
  CreateChapterInput,
  JsonObject,
  RecoveryRepositoryPort,
  RecoveryRecord,
  Result,
  UnifiedError
} from "@novel-studio/shared";

import { createChapterEditorSession } from "./chapter-editor-session.js";
import type { ChapterEditorSession, ChapterEditorSnapshot } from "./chapter-editor-session.js";

export interface ProjectMetadata extends JsonObject {
  schemaVersion: "1.0";
  projectId: string;
  title: string;
  projectType: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProjectSettings extends JsonObject {
  schemaVersion: "1.0";
  autosave: JsonObject;
  history: JsonObject;
  models: JsonObject;
}

export interface ProjectSnapshot {
  project: ProjectMetadata;
  settings: WorkspaceProjectSettings;
}

export interface CreateProjectInput {
  projectRoot: string;
  projectId: string;
  title: string;
  language: string;
  projectType?: string;
  targetWordCount?: number;
}

export interface ProjectWorkspaceSnapshot {
  projectRoot: string;
  project: ProjectMetadata;
  settings: WorkspaceProjectSettings;
  chapters: readonly ChapterSummary[];
  recovery: ProjectWorkspaceRecoverySummary;
  health: ProjectWorkspaceHealth;
  lock?: ProjectWorkspaceLock;
  activeChapterId?: string;
}

export interface ProjectWorkspaceLock extends JsonObject {
  schemaVersion: "1.0";
  ownerId: string;
  projectRoot: string;
  acquiredAt: string;
}

export interface ProjectWorkspaceRecoverySummary extends JsonObject {
  availableItems: ProjectWorkspaceRecoveryItem[];
}

export interface ProjectWorkspaceRecoveryItem extends JsonObject {
  sessionId: string;
  chapterId: string;
  updatedAt: string;
}

export interface ProjectRecoveryDraftPreview extends JsonObject {
  sessionId: string;
  chapterId: string;
  chapterTitle: string;
  updatedAt: string;
  body: string;
}

export interface ProjectRecoveryApplyResult {
  workspace: ProjectWorkspaceSnapshot;
  chapterEditor: ChapterEditorSnapshot;
}

export type ProjectHealthStatus = "healthy" | "attention" | "blocked";
export type ProjectHealthSeverity = "info" | "warning" | "error";
export type ProjectHealthSource =
  "schema" | "cache" | "history" | "recovery" | "references" | "lock";

export interface ProjectWorkspaceHealth extends JsonObject {
  status: ProjectHealthStatus;
  checkedAt: string;
  summary: ProjectWorkspaceHealthSummary;
  issues: ProjectWorkspaceHealthIssue[];
}

export interface ProjectWorkspaceHealthSummary extends JsonObject {
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface ProjectWorkspaceHealthIssue extends JsonObject {
  id: string;
  severity: ProjectHealthSeverity;
  source: ProjectHealthSource;
  title: string;
  message: string;
  suggestedAction: string;
}

export interface ProjectRepositoryPort {
  openProject(): Promise<Result<ProjectSnapshot, UnifiedError>>;
  createProject(
    input: Omit<CreateProjectInput, "projectRoot">
  ): Promise<Result<ProjectSnapshot, UnifiedError>>;
}

export interface ProjectWorkspaceLockPort {
  acquireProjectLock(): Promise<Result<ProjectWorkspaceLock, UnifiedError>>;
  releaseProjectLock(): Promise<Result<void, UnifiedError>>;
}

export type ProjectChapterRepositoryPort = ChapterDraftRepositoryPort &
  ChapterCatalogRepositoryPort;

export interface ProjectWorkspaceSessionOptions {
  createProjectRepository(projectRoot: string): ProjectRepositoryPort;
  createChapterRepository(projectRoot: string): ProjectChapterRepositoryPort;
  createHistoryRepository(projectRoot: string): ChapterHistoryRepositoryPort;
  createRecoveryRepository(projectRoot: string): RecoveryRepositoryPort;
  createProjectLockRepository?: (projectRoot: string) => ProjectWorkspaceLockPort;
  now?: () => string;
}

export interface ProjectWorkspaceSession {
  getSnapshot(): ProjectWorkspaceSnapshot | undefined;
  getActiveChapterEditorSession(): ChapterEditorSession | undefined;
  openProject(projectRoot: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  createProject(input: CreateProjectInput): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  listChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>>;
  createChapter(input: CreateChapterInput): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  selectChapter(chapterId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  previewRecoveryDraft(
    sessionId: string
  ): Promise<Result<ProjectRecoveryDraftPreview, UnifiedError>>;
  applyRecoveryDraft(sessionId: string): Promise<Result<ProjectRecoveryApplyResult, UnifiedError>>;
  discardRecoveryDraft(sessionId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  releaseProjectLock(): Promise<Result<void, UnifiedError>>;
}

export function createProjectWorkspaceSession(
  options: ProjectWorkspaceSessionOptions
): ProjectWorkspaceSession {
  let state: ProjectWorkspaceSnapshot | undefined;
  let chapterRepository: ProjectChapterRepositoryPort | undefined;
  let historyRepository: ChapterHistoryRepositoryPort | undefined;
  let recoveryRepository: RecoveryRepositoryPort | undefined;
  let projectLockRepository: ProjectWorkspaceLockPort | undefined;
  let activeChapterEditorSession: ChapterEditorSession | undefined;

  return {
    getSnapshot: () => state,
    getActiveChapterEditorSession: () => activeChapterEditorSession,
    async openProject(projectRoot) {
      const acquiredLock = await acquireWorkspaceLock(projectRoot);
      if (!acquiredLock.ok) {
        return acquiredLock;
      }

      const projectRepository = options.createProjectRepository(projectRoot);
      const opened = await projectRepository.openProject();
      if (!opened.ok) {
        await acquiredLock.value.repository?.releaseProjectLock();
        return opened;
      }

      return activateProject(projectRoot, opened.value, acquiredLock.value);
    },
    async createProject(input) {
      const acquiredLock = await acquireWorkspaceLock(input.projectRoot);
      if (!acquiredLock.ok) {
        return acquiredLock;
      }

      const projectRepository = options.createProjectRepository(input.projectRoot);
      const created = await projectRepository.createProject({
        projectId: input.projectId,
        title: input.title,
        language: input.language,
        ...(input.projectType === undefined ? {} : { projectType: input.projectType }),
        ...(input.targetWordCount === undefined ? {} : { targetWordCount: input.targetWordCount })
      });
      if (!created.ok) {
        await acquiredLock.value.repository?.releaseProjectLock();
        return created;
      }

      return activateProject(input.projectRoot, created.value, acquiredLock.value);
    },
    async listChapters() {
      if (chapterRepository === undefined) {
        return workspaceUnavailable();
      }

      return chapterRepository.listChapters();
    },
    async createChapter(input) {
      if (state === undefined || chapterRepository === undefined) {
        return workspaceUnavailable();
      }

      const created = await chapterRepository.createChapter(input);
      if (!created.ok) {
        return created;
      }

      return activateChapter(created.value.frontmatter.id);
    },
    async selectChapter(chapterId) {
      if (state === undefined) {
        return workspaceUnavailable();
      }

      return activateChapter(chapterId);
    },
    async previewRecoveryDraft(sessionId) {
      const record = await findDirtyChapterRecoveryRecord(sessionId);
      if (!record.ok) {
        return record;
      }

      const body = recoveryRecordBody(record.value);
      if (!body.ok) {
        return body;
      }

      const chapter = state?.chapters.find((entry) => entry.id === record.value.openAssetId);
      if (chapter === undefined) {
        return missingRecoveryChapter(record.value.openAssetId);
      }

      return ok({
        sessionId: record.value.sessionId,
        chapterId: record.value.openAssetId,
        chapterTitle: chapter.title,
        updatedAt: record.value.updatedAt,
        body: body.value
      });
    },
    async applyRecoveryDraft(sessionId) {
      const record = await findDirtyChapterRecoveryRecord(sessionId);
      if (!record.ok) {
        return record;
      }

      const body = recoveryRecordBody(record.value);
      if (!body.ok) {
        return body;
      }

      const activated = await activateChapter(record.value.openAssetId);
      if (!activated.ok) {
        return activated;
      }

      const editor = activeChapterEditorSession;
      if (editor === undefined) {
        return workspaceUnavailable();
      }

      const loaded = await editor.load();
      if (!loaded.ok) {
        return loaded;
      }

      const edited = await editor.edit(body.value);
      if (!edited.ok) {
        return edited;
      }

      const markedClean = await markRecoveryRecordClean(record.value);
      if (!markedClean.ok) {
        return markedClean;
      }

      const workspace = await refreshWorkspaceRecovery();
      if (!workspace.ok) {
        return workspace;
      }

      const versions = await editor.listVersions();
      if (!versions.ok) {
        return versions;
      }

      return ok({
        workspace: workspace.value,
        chapterEditor: {
          state: edited.value,
          versions: versions.value
        }
      });
    },
    async discardRecoveryDraft(sessionId) {
      const record = await findDirtyChapterRecoveryRecord(sessionId);
      if (!record.ok) {
        return record;
      }

      const markedClean = await markRecoveryRecordClean(record.value);
      if (!markedClean.ok) {
        return markedClean;
      }

      return refreshWorkspaceRecovery();
    },
    async releaseProjectLock() {
      if (projectLockRepository === undefined) {
        return ok(undefined);
      }

      const released = await projectLockRepository.releaseProjectLock();
      if (!released.ok) {
        return released;
      }

      projectLockRepository = undefined;
      if (state !== undefined) {
        state = {
          projectRoot: state.projectRoot,
          project: state.project,
          settings: state.settings,
          chapters: state.chapters,
          recovery: state.recovery,
          health: buildProjectHealth({
            checkedAt: currentTimestamp(),
            chapters: state.chapters,
            recovery: state.recovery
          }),
          ...(state.activeChapterId === undefined ? {} : { activeChapterId: state.activeChapterId })
        };
      }

      return ok(undefined);
    }
  };

  async function activateProject(
    projectRoot: string,
    projectSnapshot: ProjectSnapshot,
    acquiredLock: AcquiredWorkspaceLock
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>> {
    const previousLockRepository = projectLockRepository;
    const previousProjectRoot = state?.projectRoot;
    chapterRepository = options.createChapterRepository(projectRoot);
    historyRepository = options.createHistoryRepository(projectRoot);
    recoveryRepository = options.createRecoveryRepository(projectRoot);
    projectLockRepository = acquiredLock.repository;
    const chapters = await chapterRepository.listChapters();
    if (!chapters.ok) {
      return chapters;
    }
    const recovery = await loadRecoverySummary(projectSnapshot.project.projectId);
    if (!recovery.ok) {
      return recovery;
    }

    const activeChapterId = chapters.value[0]?.id;
    const recoverySummary = recovery.value;
    state = {
      projectRoot,
      project: projectSnapshot.project,
      settings: projectSnapshot.settings,
      chapters: chapters.value,
      recovery: recoverySummary,
      health: buildProjectHealth({
        checkedAt: currentTimestamp(),
        chapters: chapters.value,
        recovery: recoverySummary,
        ...(acquiredLock.lock === undefined ? {} : { lock: acquiredLock.lock })
      }),
      ...(acquiredLock.lock === undefined ? {} : { lock: acquiredLock.lock }),
      ...(activeChapterId === undefined ? {} : { activeChapterId })
    };
    activeChapterEditorSession =
      activeChapterId === undefined ? undefined : createActiveChapterEditorSession(activeChapterId);

    if (
      previousLockRepository !== undefined &&
      previousProjectRoot !== undefined &&
      previousProjectRoot !== projectRoot
    ) {
      await previousLockRepository.releaseProjectLock();
    }

    return ok(state);
  }

  async function activateChapter(
    chapterId: string
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>> {
    if (state === undefined || chapterRepository === undefined) {
      return workspaceUnavailable();
    }

    const chapters = await chapterRepository.listChapters();
    if (!chapters.ok) {
      return chapters;
    }

    const selected = chapters.value.find((chapter) => chapter.id === chapterId);
    if (selected === undefined) {
      return err(
        createUnifiedError({
          code: "PROJECT_CHAPTER_NOT_FOUND",
          category: "UserError",
          message: "The requested chapter is not part of the open project.",
          recoverability: "user-action",
          suggestedAction: "Choose a chapter from the project navigator.",
          traceId: "project-workspace-session"
        })
      );
    }

    const recovery = await loadRecoverySummary(state.project.projectId);
    if (!recovery.ok) {
      return recovery;
    }

    state = {
      ...state,
      chapters: chapters.value,
      recovery: recovery.value,
      health: buildProjectHealth({
        checkedAt: currentTimestamp(),
        chapters: chapters.value,
        recovery: recovery.value,
        ...(state.lock === undefined ? {} : { lock: state.lock })
      }),
      activeChapterId: selected.id
    };
    activeChapterEditorSession = createActiveChapterEditorSession(selected.id);

    return ok(state);
  }

  function createActiveChapterEditorSession(chapterId: string): ChapterEditorSession {
    if (
      chapterRepository === undefined ||
      historyRepository === undefined ||
      recoveryRepository === undefined ||
      state === undefined
    ) {
      throw new Error("Project workspace is not active.");
    }

    return createChapterEditorSession({
      chapterId,
      repository: chapterRepository,
      historyRepository,
      recoveryRepository,
      projectId: state.project.projectId,
      sessionId: createRecoverySessionId(state.project.projectId, chapterId),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  async function loadRecoverySummary(
    projectId: string
  ): Promise<Result<ProjectWorkspaceRecoverySummary, UnifiedError>> {
    if (recoveryRepository === undefined) {
      return ok({ availableItems: [] });
    }

    const records = await recoveryRepository.listRecoveryRecords();
    if (!records.ok) {
      return records;
    }

    return ok({
      availableItems: records.value
        .filter(
          (record) =>
            record.projectId === projectId && record.assetType === "chapter" && record.dirty
        )
        .map((record) => ({
          sessionId: record.sessionId,
          chapterId: record.openAssetId,
          updatedAt: record.updatedAt
        }))
    });
  }

  async function findDirtyChapterRecoveryRecord(
    sessionId: string
  ): Promise<Result<RecoveryRecord, UnifiedError>> {
    if (state === undefined || recoveryRepository === undefined) {
      return workspaceUnavailable();
    }

    const records = await recoveryRepository.listRecoveryRecords();
    if (!records.ok) {
      return records;
    }

    const record = records.value.find((entry) => entry.sessionId === sessionId);
    if (record === undefined || !record.dirty) {
      return recoveryDraftNotFound(sessionId);
    }
    if (record.projectId !== state.project.projectId || record.assetType !== "chapter") {
      return unsupportedRecoveryDraft(sessionId);
    }

    return ok(record);
  }

  async function markRecoveryRecordClean(
    record: RecoveryRecord
  ): Promise<Result<void, UnifiedError>> {
    if (recoveryRepository === undefined) {
      return workspaceUnavailable();
    }

    const written = await recoveryRepository.writeRecoveryRecord({
      ...record,
      dirty: false,
      updatedAt: currentTimestamp()
    });
    if (!written.ok) {
      return written;
    }

    return ok(undefined);
  }

  async function refreshWorkspaceRecovery(): Promise<
    Result<ProjectWorkspaceSnapshot, UnifiedError>
  > {
    if (state === undefined) {
      return workspaceUnavailable();
    }

    const recovery = await loadRecoverySummary(state.project.projectId);
    if (!recovery.ok) {
      return recovery;
    }

    state = {
      ...state,
      recovery: recovery.value,
      health: buildProjectHealth({
        checkedAt: currentTimestamp(),
        chapters: state.chapters,
        recovery: recovery.value,
        ...(state.lock === undefined ? {} : { lock: state.lock })
      })
    };

    return ok(state);
  }

  function currentTimestamp(): string {
    return options.now?.() ?? new Date().toISOString();
  }

  async function acquireWorkspaceLock(
    projectRoot: string
  ): Promise<Result<AcquiredWorkspaceLock, UnifiedError>> {
    const repository = options.createProjectLockRepository?.(projectRoot);
    if (repository === undefined) {
      return ok({});
    }

    const lock = await repository.acquireProjectLock();
    if (!lock.ok) {
      return lock;
    }

    return ok({
      lock: lock.value,
      repository
    });
  }
}

interface AcquiredWorkspaceLock {
  readonly lock?: ProjectWorkspaceLock;
  readonly repository?: ProjectWorkspaceLockPort;
}

interface ProjectHealthInput {
  checkedAt: string;
  chapters: readonly ChapterSummary[];
  recovery: ProjectWorkspaceRecoverySummary;
  lock?: ProjectWorkspaceLock;
}

function buildProjectHealth(input: ProjectHealthInput): ProjectWorkspaceHealth {
  const chapterIds = new Set(input.chapters.map((chapter) => chapter.id));
  const issues: ProjectWorkspaceHealthIssue[] = [
    {
      id: "schema.project_opened",
      severity: "info",
      source: "schema",
      title: "Project schema validated",
      message: "Project metadata and settings passed repository validation during open/create.",
      suggestedAction: "No action required."
    },
    {
      id: "cache.search_rebuildable",
      severity: "info",
      source: "cache",
      title: "Cache is rebuildable",
      message:
        "Search and derived indexes are treated as cache and can be rebuilt from project files.",
      suggestedAction: "Use rebuild index if search results look stale."
    },
    {
      id: "history.protected",
      severity: "info",
      source: "history",
      title: "History is protected",
      message: "Version history and recovery data are outside cache cleanup scope.",
      suggestedAction: "Keep history cleanup explicit and separate from cache actions."
    }
  ];

  if (input.recovery.availableItems.length > 0) {
    issues.push({
      id: "recovery.dirty_drafts",
      severity: "warning",
      source: "recovery",
      title: "Recoverable drafts available",
      message: `There are ${input.recovery.availableItems.length} dirty recovery draft(s).`,
      suggestedAction: "Review recovery drafts before continuing long edits."
    });
  }

  if (input.lock !== undefined) {
    issues.push({
      id: "lock.project_active",
      severity: "info",
      source: "lock",
      title: "Project lock active",
      message: `Project is locked for local owner ${input.lock.ownerId}.`,
      suggestedAction: "Close this window to release the local project lock."
    });
  }

  for (const recoveryItem of input.recovery.availableItems) {
    if (!chapterIds.has(recoveryItem.chapterId)) {
      issues.push({
        id: `references.recovery_missing_chapter.${recoveryItem.chapterId}`,
        severity: "error",
        source: "references",
        title: "Recovery record points to a missing chapter",
        message: `Recovery draft ${recoveryItem.chapterId} no longer matches a chapter.`,
        suggestedAction: "Review recovery history before clearing or archiving it."
      });
    }
  }

  const summary = {
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    infoCount: issues.filter((issue) => issue.severity === "info").length
  };

  return {
    status: summary.errorCount > 0 ? "blocked" : summary.warningCount > 0 ? "attention" : "healthy",
    checkedAt: input.checkedAt,
    summary,
    issues
  };
}

function createRecoverySessionId(projectId: string, chapterId: string): string {
  return `session_${sanitizeRecoveryId(projectId)}_${sanitizeRecoveryId(chapterId)}`;
}

function recoveryRecordBody(record: RecoveryRecord): Result<string, UnifiedError> {
  if (
    record.draftContentRef.strategy !== "inline" ||
    record.draftContentRef.content === undefined
  ) {
    return err(
      createUnifiedError({
        code: "RECOVERY_DRAFT_CONTENT_UNAVAILABLE",
        category: "UserError",
        message: "Recovery draft content is not available for preview.",
        recoverability: "user-action",
        suggestedAction: "Keep the recovery record for manual inspection.",
        traceId: "project-workspace-session"
      })
    );
  }

  return ok(record.draftContentRef.content);
}

function recoveryDraftNotFound(sessionId: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "RECOVERY_DRAFT_NOT_FOUND",
      category: "UserError",
      message: "The requested recovery draft is not available.",
      recoverability: "user-action",
      suggestedAction: "Refresh the project recovery list and try again.",
      traceId: "project-workspace-session",
      redactedDetail: { sessionId }
    })
  );
}

function unsupportedRecoveryDraft(sessionId: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "RECOVERY_DRAFT_UNSUPPORTED",
      category: "UserError",
      message: "Only chapter recovery drafts can be reviewed in this workspace.",
      recoverability: "user-action",
      suggestedAction: "Open the matching asset editor or keep the recovery record for later.",
      traceId: "project-workspace-session",
      redactedDetail: { sessionId }
    })
  );
}

function missingRecoveryChapter(chapterId: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "PROJECT_CHAPTER_NOT_FOUND",
      category: "UserError",
      message: "The recovered chapter is not part of the open project.",
      recoverability: "user-action",
      suggestedAction: "Review recovery history before clearing or archiving the record.",
      traceId: "project-workspace-session",
      redactedDetail: { chapterId }
    })
  );
}

function sanitizeRecoveryId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length === 0 ? "unknown" : sanitized;
}

function workspaceUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "PROJECT_WORKSPACE_UNAVAILABLE",
      category: "UserError",
      message: "No project workspace is open.",
      recoverability: "user-action",
      suggestedAction: "Create or open a project before using workspace commands.",
      traceId: "project-workspace-session"
    })
  );
}
