import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type {
  ChapterCatalogRepositoryPort,
  ChapterDraftRepositoryPort,
  ChapterHistoryRepositoryPort,
  ChapterSummary,
  CreateChapterInput,
  JsonObject,
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
  activeChapterId?: string;
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
    const chapters = await chapterRepository.listChapters();
    if (!chapters.ok) {
      return chapters;
    }

    const activeChapterId = chapters.value[0]?.id;
    state = {
      projectRoot,
      project: projectSnapshot.project,
      settings: projectSnapshot.settings,
      chapters: chapters.value,
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

    state = {
      ...state,
      chapters: chapters.value,
      activeChapterId: selected.id
    };
    activeChapterEditorSession = createActiveChapterEditorSession(selected.id);

    return ok(state);
  }

  function createActiveChapterEditorSession(chapterId: string): ChapterEditorSession {
    if (chapterRepository === undefined || historyRepository === undefined) {
      throw new Error("Project workspace is not active.");
    }

    return createChapterEditorSession({
      chapterId,
      repository: chapterRepository,
      historyRepository,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }
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
