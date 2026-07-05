import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type {
  ChapterCatalogRepositoryPort,
  ChapterDraftRepositoryPort,
  ChapterHistoryRepositoryPort,
  ChapterSummary,
  CreateChapterInput,
  JsonObject,
  RecoveryRepositoryPort,
  Result,
  UnifiedError
} from "@novel-studio/shared";

import { createChapterEditorSession } from "./chapter-editor-session.js";
import type { ChapterEditorSession } from "./chapter-editor-session.js";

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
  activeChapterId?: string;
}

export interface ProjectWorkspaceRecoverySummary extends JsonObject {
  availableItems: ProjectWorkspaceRecoveryItem[];
}

export interface ProjectWorkspaceRecoveryItem extends JsonObject {
  sessionId: string;
  chapterId: string;
  updatedAt: string;
}

export type ProjectHealthStatus = "healthy" | "attention" | "blocked";
export type ProjectHealthSeverity = "info" | "warning" | "error";
export type ProjectHealthSource = "schema" | "cache" | "history" | "recovery" | "references";

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

export type ProjectChapterRepositoryPort = ChapterDraftRepositoryPort &
  ChapterCatalogRepositoryPort;

export interface ProjectWorkspaceSessionOptions {
  createProjectRepository(projectRoot: string): ProjectRepositoryPort;
  createChapterRepository(projectRoot: string): ProjectChapterRepositoryPort;
  createHistoryRepository(projectRoot: string): ChapterHistoryRepositoryPort;
  createRecoveryRepository(projectRoot: string): RecoveryRepositoryPort;
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
}

export function createProjectWorkspaceSession(
  options: ProjectWorkspaceSessionOptions
): ProjectWorkspaceSession {
  let state: ProjectWorkspaceSnapshot | undefined;
  let chapterRepository: ProjectChapterRepositoryPort | undefined;
  let historyRepository: ChapterHistoryRepositoryPort | undefined;
  let recoveryRepository: RecoveryRepositoryPort | undefined;
  let activeChapterEditorSession: ChapterEditorSession | undefined;

  return {
    getSnapshot: () => state,
    getActiveChapterEditorSession: () => activeChapterEditorSession,
    async openProject(projectRoot) {
      const projectRepository = options.createProjectRepository(projectRoot);
      const opened = await projectRepository.openProject();
      if (!opened.ok) {
        return opened;
      }

      return activateProject(projectRoot, opened.value);
    },
    async createProject(input) {
      const projectRepository = options.createProjectRepository(input.projectRoot);
      const created = await projectRepository.createProject({
        projectId: input.projectId,
        title: input.title,
        language: input.language,
        ...(input.projectType === undefined ? {} : { projectType: input.projectType }),
        ...(input.targetWordCount === undefined ? {} : { targetWordCount: input.targetWordCount })
      });
      if (!created.ok) {
        return created;
      }

      return activateProject(input.projectRoot, created.value);
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
    }
  };

  async function activateProject(
    projectRoot: string,
    projectSnapshot: ProjectSnapshot
  ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>> {
    chapterRepository = options.createChapterRepository(projectRoot);
    historyRepository = options.createHistoryRepository(projectRoot);
    recoveryRepository = options.createRecoveryRepository(projectRoot);
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
        recovery: recoverySummary
      }),
      ...(activeChapterId === undefined ? {} : { activeChapterId })
    };
    activeChapterEditorSession =
      activeChapterId === undefined ? undefined : createActiveChapterEditorSession(activeChapterId);

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
        recovery: recovery.value
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

  function currentTimestamp(): string {
    return options.now?.() ?? new Date().toISOString();
  }
}

interface ProjectHealthInput {
  checkedAt: string;
  chapters: readonly ChapterSummary[];
  recovery: ProjectWorkspaceRecoverySummary;
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
